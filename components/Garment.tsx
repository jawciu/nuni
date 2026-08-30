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
 * Repeats are the opposite: they belong in UV/cloth space, so they break at panel seams the
 * way real printed cloth does.
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
  uniform float uRepeatCount; // tiles across the 0-1 UV square, density corrected
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
  if (uHasPrint == 1) {
    vec4 ink = vec4(0.0);

    if (uMode == 0) {
      // only the side of the cloth facing the viewer's front takes the graphic
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
      vec2 t = rot2(vNuniUv - 0.5, uRepeatRot) + 0.5;
      ink = texture2D(uPrint, t * uRepeatCount + uRepeatOffset);
    }

    // transparent pixels carry black RGB, so a straight mix by alpha draws a dark
    // rectangle round the motif. Threshold it away.
    float a = smoothstep(0.55, 0.9, ink.a);
    diffuseColor.rgb = mix(diffuseColor.rgb, ink.rgb, a);
  }
`;

/** UV units per centimetre. Each garment is unwrapped into its own 0-1 square, so the tee
 *  and the trousers do not share a texel density (measured 2.14 : 1). Deriving it from the
 *  mesh means a repeat comes out the same size on both without anyone hand-tuning a look. */
function texelDensity(geo: THREE.BufferGeometry): number {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  if (!uv) return 1;
  const idx = geo.index;
  const n = idx ? idx.count : pos.count;
  let uvArea = 0;
  let area3 = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), cr = new THREE.Vector3();
  for (let i = 0; i < n; i += 3) {
    const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    ab.subVectors(b, a); ac.subVectors(c, a);
    area3 += cr.crossVectors(ab, ac).length() * 0.5;
    const u0 = uv.getX(i0), v0 = uv.getY(i0);
    const u1 = uv.getX(i1), v1 = uv.getY(i1);
    const u2 = uv.getX(i2), v2 = uv.getY(i2);
    uvArea += Math.abs((u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0)) * 0.5;
  }
  if (area3 <= 0) return 1;
  // geometry is in metres here; density is quoted per centimetre
  return Math.sqrt(uvArea / area3) / 100;
}

export function Garment({
  id,
  url,
  params,
  printTex,
  colour,
  lift = 0,
}: {
  id: GarmentId;
  url: string;
  params: Params;
  printTex: THREE.Texture | null;
  colour: string;
  lift?: number;
}) {
  const { scene } = useGLTF(url);
  const matRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const uniforms = useRef<Record<string, THREE.IUniform>>({});

  const { geometry, box, density } = useMemo(() => {
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
    // the sim OBJ carries no vertex normals, so without this the cloth renders flat and faceted
    if (!g.attributes.normal) g.computeVertexNormals();
    g.computeBoundingBox();
    return { geometry: g, box: g.boundingBox!, density: texelDensity(g) };
  }, [scene]);

  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(colour),
      roughness: 0.86,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uPrint = { value: null };
      shader.uniforms.uHasPrint = { value: 0 };
      shader.uniforms.uMode = { value: 0 };
      shader.uniforms.uBoxMin = { value: box.min.clone() };
      shader.uniforms.uBoxSize = { value: box.getSize(new THREE.Vector3()) };
      shader.uniforms.uAcross = { value: 0 };
      shader.uniforms.uHeight = { value: 0.6 };
      shader.uniforms.uSize = { value: 0.4 };
      shader.uniforms.uRot = { value: 0 };
      shader.uniforms.uAspect = { value: 1 };
      shader.uniforms.uFaceSign = { value: 1 };
      shader.uniforms.uRepeatCount = { value: 6 };
      shader.uniforms.uRepeatRot = { value: 0 };
      shader.uniforms.uRepeatOffset = { value: new THREE.Vector2() };
      uniforms.current = shader.uniforms;

      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${VERT_HEAD}`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>\n${VERT_BODY}`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${FRAG_HEAD}`)
        .replace("#include <color_fragment>", `#include <color_fragment>\n${FRAG_BODY}`);
    };
    // force a recompile whenever the colour changes identity
    m.customProgramCacheKey = () => `nuni-${id}`;
    matRef.current = m;
    return m;
  }, [box, colour, id]);

  useEffect(() => {
    if (matRef.current) matRef.current.color.set(colour);
  }, [colour]);

  useEffect(() => {
    const u = uniforms.current;
    if (!u.uHasPrint) return;
    const on = !!printTex && params.targets.includes(id);
    u.uHasPrint.value = on ? 1 : 0;
    u.uPrint.value = printTex;
    u.uMode.value = params.mode === "repeat" ? 1 : 0;
    u.uAcross.value = params.placement.across;
    u.uHeight.value = params.placement.height;
    u.uSize.value = Math.max(0.02, params.placement.size);
    u.uRot.value = (params.placement.rotation * Math.PI) / 180;
    u.uRepeatRot.value = (params.repeat.rotation * Math.PI) / 180;
    u.uRepeatOffset.value.set(params.repeat.offsetX, params.repeat.offsetY);
    // tiles across the UV square for a motif `scale` centimetres wide
    u.uRepeatCount.value = 1 / Math.max(0.001, params.repeat.scale * density);
    if (printTex?.image) {
      const im = printTex.image as { width: number; height: number };
      u.uAspect.value = im.width / im.height || 1;
    }
  }, [params, printTex, id, density]);

  return (
    <mesh geometry={geometry} material={material} castShadow receiveShadow scale={1 + lift} />
  );
}
