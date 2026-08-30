"use client";
import { useEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { GarmentId, Params } from "@/lib/types";

/**
 * Placement lives in GARMENT space, never UV space.
 *
 * UV space here is the packed sewing pattern, so "0.5, 0.42" is wherever a panel happens to
 * sit in the square, not the middle of the chest. Projecting through the garment's own local
 * box instead means "centred, a hand below the neck" lands in the same place on every
 * silhouette, and the numbers transfer between the tee and the trousers.
 *
 * Repeats project triplanar rather than tiling the UV square. UV space is the packed sewing
 * pattern, so tiling it restarts the motif at every panel edge and puts a hard seam straight
 * down the centre front where the two front panels meet. A single wrap around the body fixes
 * that but smears anywhere the surface runs parallel to the projection, which on a garment is
 * the sides and, badly, the sleeves. Sampling on all three axes and blending by the surface
 * normal means every face is printed by whichever axis faces it most squarely, so nothing
 * stretches.
 *
 * Hue, saturation, brightness and contrast are applied here, to the sampled print colour,
 * rather than by re-cutting the print in a sandbox. A designer expects them to move like a
 * slider in Photoshop, and a round trip to a sandbox cannot do that. Doing it in the shader
 * also means the print itself is never rewritten, so every setting is reversible.
 */

const VERT_HEAD = /* glsl */ `
  varying vec3 vLocalPos;
  varying vec3 vLocalNormal;
  varying vec2 vNuniUv;
`;
const VERT_BODY = /* glsl */ `
  vLocalPos = position;
  vLocalNormal = normal;
  vNuniUv = uv;
`;

const FRAG_HEAD = /* glsl */ `
  uniform sampler2D uPrint;
  uniform vec3  uCloth;
  uniform int   uHasPrint;
  uniform int   uMode;        // 0 placed, 1 repeat
  uniform vec3  uBoxMin;
  uniform vec3  uBoxSize;
  uniform float uAcross;
  uniform float uHeight;
  uniform float uSize;
  uniform float uRot;
  uniform float uAspect;      // print w/h
  uniform float uFaceSign;    // which way the front of the garment looks
  uniform float uRepeatSize;  // centimetres per tile, measured on the body
  uniform float uRadius;      // mean distance from the body's axis, for arc length
  uniform float uRepeatRot;
  uniform vec2  uRepeatOffset;
  uniform float uHue;         // turns, -0.5 .. 0.5
  uniform float uSat;         // 1 unchanged
  uniform float uBright;      // 1 unchanged
  uniform float uContrast;    // 1 unchanged
  varying vec3 vLocalPos;
  varying vec3 vLocalNormal;
  varying vec2 vNuniUv;

  vec2 rot2(vec2 p, float a) {
    float s = sin(a), c = cos(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  }

  // The print is decoded to linear the moment it is sampled, but hue, saturation, brightness
  // and contrast are all defined on the gamma-encoded values a designer sees in Photoshop.
  // Mid grey is 0.5 there and 0.21 in linear, so a contrast pivot applied linearly would
  // pull everything towards a colour nobody asked for. Encode, adjust, decode.
  vec3 nuniToSrgb(vec3 c) {
    c = max(c, vec3(0.0));
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
  }
  vec3 nuniToLinear(vec3 c) {
    c = max(c, vec3(0.0));
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
  }

  vec3 nuniRgbToHsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
  }
  vec3 nuniHsvToRgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  // Colour only. Alpha never comes near this, so the cut-out edge is exactly as sharp at
  // every setting as it is at none.
  vec3 nuniAdjust(vec3 lin) {
    // neutral is an exact passthrough, so a slider dragged out and back leaves no residue
    if (uHue == 0.0 && uSat == 1.0 && uBright == 1.0 && uContrast == 1.0) return lin;

    vec3 c = nuniToSrgb(lin);

    if (uHue != 0.0) {
      vec3 hsv = nuniRgbToHsv(c);
      hsv.x = fract(hsv.x + uHue);
      c = nuniHsvToRgb(hsv);
    }

    // saturation is a lerp against luma rather than HSV's S: pulling HSV saturation to zero
    // takes a pure red to white, where a designer expects a properly weighted mid grey
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(luma), c, uSat);

    c *= uBright;
    c = (c - 0.5) * uContrast + 0.5;

    return nuniToLinear(clamp(c, 0.0, 1.0));
  }
`;

const FRAG_BODY = /* glsl */ `
  // the garment colour rides our own uniform rather than the material's. three caches the
  // built-in diffuse uniform against the material version, so setting material.color after
  // the first compile never reaches the shader.
  diffuseColor.rgb = uCloth;

  if (uHasPrint == 1) {
    vec4 ink = vec4(0.0);

    if (uMode == 0) {
      // only the side of the garment facing the viewer's front takes the graphic
      if (vLocalNormal.z * uFaceSign > 0.0) {
        float W = max(uBoxSize.x, 1e-5);
        float gx = (vLocalPos.x - (uBoxMin.x + uBoxSize.x * 0.5)) / W;
        float gy = (vLocalPos.y - uBoxMin.y) / W;
        vec2 d = vec2(gx, gy) - vec2(uAcross * 0.5, uHeight * (uBoxSize.y / W));
        d = rot2(d, -uRot);
        vec2 uvp = vec2(d.x / uSize, d.y / (uSize / uAspect)) + 0.5;
        uvp.y = 1.0 - uvp.y;
        if (uvp.x > 0.0 && uvp.x < 1.0 && uvp.y > 0.0 && uvp.y < 1.0) {
          ink = texture2D(uPrint, uvp);
        }
      }
    } else {
      float tile = max(uRepeatSize, 0.001);
      vec3 pl = (vLocalPos - uBoxMin) / tile;
      vec2 asp = vec2(1.0, uAspect);

      // sample down each axis, then let the surface normal choose. The fourth power
      // sharpens the blend so a face is printed by one projection rather than smeared
      // between two.
      vec2 qx = rot2(pl.zy * asp, uRepeatRot) + uRepeatOffset;
      vec2 qy = rot2(pl.xz * asp, uRepeatRot) + uRepeatOffset;
      vec2 qz = rot2(pl.xy * asp, uRepeatRot) + uRepeatOffset;

      vec3 w = abs(normalize(vLocalNormal));
      w = w * w * w * w;
      w /= max(w.x + w.y + w.z, 1e-5);

      ink = texture2D(uPrint, fract(qx)) * w.x
          + texture2D(uPrint, fract(qy)) * w.y
          + texture2D(uPrint, fract(qz)) * w.z;
    }

    // live colour adjustment, on the sampled print only. The garment's own colour and the
    // alpha threshold below are both untouched by it.
    ink.rgb = nuniAdjust(ink.rgb);

    // transparent pixels carry black RGB, so a straight mix by alpha draws a dark
    // rectangle round the motif. Threshold it away.
    float a = smoothstep(0.55, 0.9, ink.a);
    diffuseColor.rgb = mix(diffuseColor.rgb, ink.rgb, a);
  }
`;

export function Garment({
  id,
  url,
  params,
  printTex,
  lift = 0,
}: {
  id: GarmentId;
  url: string;
  params: Params;
  printTex: THREE.Texture | null;
  lift?: number;
}) {
  const { scene } = useGLTF(url);
  // owned by us and reused across recompiles, so nothing is orphaned if three rebuilds
  // the program
  const uniforms = useRef<Record<string, THREE.IUniform>>({
    uPrint: { value: null },
    uCloth: { value: new THREE.Color("#ffffff") },
    uHasPrint: { value: 0 },
    uMode: { value: 0 },
    uBoxMin: { value: new THREE.Vector3() },
    uBoxSize: { value: new THREE.Vector3(1, 1, 1) },
    uAcross: { value: 0 },
    uHeight: { value: 0.6 },
    uSize: { value: 0.4 },
    uRot: { value: 0 },
    uAspect: { value: 1 },
    uFaceSign: { value: 1 },
    uRepeatSize: { value: 0.14 },
    uRadius: { value: 0.2 },
    uRepeatRot: { value: 0 },
    uRepeatOffset: { value: new THREE.Vector2() },
    uHue: { value: 0 },
    uSat: { value: 1 },
    uBright: { value: 1 },
    uContrast: { value: 1 },
  });

  const { geometry, box, radius } = useMemo(() => {
    let geo: THREE.BufferGeometry | null = null;
    scene.updateMatrixWorld(true);
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || geo) return;
      geo = m.geometry.clone();
      // the exporter parks the Z-up-to-Y-up flip on the node, and we are about to throw the
      // node away, so bake it in. Garment space wants Y up or nothing lands where it should.
      geo.applyMatrix4(m.matrixWorld);
    });
    const g = geo as unknown as THREE.BufferGeometry;
    // the sim OBJ carries no vertex normals, so without this the garment renders flat and faceted
    if (!g.attributes.normal) g.computeVertexNormals();
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    const mid = bb.getCenter(new THREE.Vector3());
    const pos = g.attributes.position as THREE.BufferAttribute;
    let sum = 0;
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i) - mid.x;
      const dz = pos.getZ(i) - mid.z;
      sum += Math.hypot(dx, dz);
    }
    return { geometry: g, box: bb, radius: sum / Math.max(1, pos.count) };
  }, [scene]);

  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color("#ffffff"),
      roughness: 0.86,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    m.onBeforeCompile = (shader) => {
      uniforms.current.uBoxMin.value = box.min.clone();
      uniforms.current.uBoxSize.value = box.getSize(new THREE.Vector3());
      uniforms.current.uRadius.value = radius;
      Object.assign(shader.uniforms, uniforms.current);

      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${VERT_HEAD}`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>\n${VERT_BODY}`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${FRAG_HEAD}`)
        .replace("#include <color_fragment>", `#include <color_fragment>\n${FRAG_BODY}`);
    };
    m.customProgramCacheKey = () => `nuni-${id}`;
    return m;
  }, [box, id, radius]);

  useEffect(() => {
    const u = uniforms.current;
    const place = params.placement[id];
    (u.uCloth.value as THREE.Color).set(params.colours[id]);
    const on = !!printTex && params.targets.includes(id);
    u.uHasPrint.value = on ? 1 : 0;
    u.uPrint.value = printTex;
    u.uMode.value = params.mode === "repeat" ? 1 : 0;
    u.uAcross.value = place.across;
    u.uHeight.value = place.height;
    u.uSize.value = Math.max(0.02, place.size);
    u.uRot.value = (place.rotation * Math.PI) / 180;
    u.uRepeatRot.value = (params.repeat.rotation * Math.PI) / 180;
    u.uRepeatOffset.value.set(params.repeat.offsetX, params.repeat.offsetY);
    // the meshes are in metres and the repeat is quoted in centimetres
    u.uRepeatSize.value = Math.max(0.02, params.repeat.scale) / 100;
    // degrees round the wheel, carried into the shader as turns so the wrap is a plain fract
    u.uHue.value = params.adjust.hue / 360;
    u.uSat.value = params.adjust.saturation;
    u.uBright.value = params.adjust.brightness;
    u.uContrast.value = params.adjust.contrast;
    if (printTex?.image) {
      const im = printTex.image as { width: number; height: number };
      u.uAspect.value = im.width / im.height || 1;
    }
  }, [params, printTex, id]);

  return (
    <mesh geometry={geometry} material={material} castShadow receiveShadow scale={1 + lift} />
  );
}
