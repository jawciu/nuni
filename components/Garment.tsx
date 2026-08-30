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
 * Repeats wrap the body cylindrically rather than tiling the UV square. UV space is the
 * packed sewing pattern, so tiling it restarts the motif at every panel edge and puts a hard
 * seam straight down the centre front, where the two front panels meet. Wrapping around the
 * body instead gives one seam at centre back, which is where a real garment has one.
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
  varying vec3 vLocalPos;
  varying vec3 vLocalNormal;
  varying vec2 vNuniUv;

  vec2 rot2(vec2 p, float a) {
    float s = sin(a), c = cos(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
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
      // wrap the tile grid around the body's vertical axis: arc length across, height up.
      // A planar projection would smear badly down the sides and the sleeves.
      vec3 c = uBoxMin + uBoxSize * 0.5;
      float ang = atan(vLocalPos.z - c.z, vLocalPos.x - c.x);
      float tile = max(uRepeatSize, 0.001);
      vec2 q = vec2(
        (ang * uRadius) / tile,
        ((vLocalPos.y - uBoxMin.y) * uAspect) / tile
      );
      q = rot2(q, uRepeatRot);
      ink = texture2D(uPrint, fract(q + uRepeatOffset));
    }

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
    if (printTex?.image) {
      const im = printTex.image as { width: number; height: number };
      u.uAspect.value = im.width / im.height || 1;
    }
  }, [params, printTex, id]);

  return (
    <mesh geometry={geometry} material={material} castShadow receiveShadow scale={1 + lift} />
  );
}
