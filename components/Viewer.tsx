"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import {
  OrbitControls,
  ContactShadows,
  useGLTF,
  useProgress,
  useTexture,
} from "@react-three/drei";
import * as THREE from "three";
import { Garment } from "./Garment";
import { useStore } from "@/lib/store";

useGLTF.preload("/assets/figure.glb");
useGLTF.preload("/assets/tee.glb");
useGLTF.preload("/assets/trews.glb");

function Figure() {
  // body, eyes, brows, lashes and hair. The hair and eye maps ride in the GLB; the skin
  // does not, because MakeHuman's skin material does not survive a glTF export, so it is
  // applied here against the mesh's own MakeHuman UVs.
  const { scene } = useGLTF("/assets/figure.glb");
  const skin = useTexture("/assets/skin.jpg");
  // desaturated then tinted offline, because a glTF export keeps only the raw texture and
  // throws the node graph that did the tinting away
  const hairMap = useTexture("/assets/hair.png");

  const cloned = useMemo(() => {
    for (const t of [skin, hairMap]) {
      t.flipY = false;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      t.needsUpdate = true;
    }

    const s = scene.clone(true);
    s.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const isBody = /^human$|base/i.test(m.name);
      if (isBody) {
        m.material = new THREE.MeshStandardMaterial({
          map: skin,
          roughness: 0.62,
          metalness: 0,
        });
        m.castShadow = true;
        m.receiveShadow = true;
        return;
      }
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat?.map) {
        mat.map.colorSpace = THREE.SRGBColorSpace;
        mat.map.anisotropy = 8;
      }
      const isHair = /hair/i.test(m.name + " " + (mat?.name ?? ""));
      const hairish = isHair || /eyelash|eyebrow/i.test(m.name + " " + (mat?.name ?? ""));
      if (hairish) {
        // hair, lashes and brows are alpha-cut cards. Blended they sort wrongly against
        // themselves and the head shows through; a hard cutout has no sort order at all.
        mat.transparent = false;
        mat.alphaTest = 0.18;
        mat.depthWrite = true;
        mat.side = THREE.DoubleSide;
        // the maps are warm brown rather than neutral, so tinting only darkens. Sheen and
        // a hot specular blow every outward facing strand white and lose the colour.
        // A hot specular turns every outward facing strand silver and the colour
        // disappears entirely: the map is nearly black, so anything silver on screen is
        // pure highlight. Hair wants a broad soft highlight, not a wet one, and
        // MeshStandardMaterial gives no way to turn the lobe down, so use the physical
        // one and cut specularIntensity.
        const soft = new THREE.MeshPhysicalMaterial({
          // no alphaMap: three reads its GREEN channel, and these maps are nearly black,
          // so every fragment would fail the cutout. The map's own alpha is the mask.
          map: isHair ? hairMap : mat.map,
          transparent: false,
          alphaTest: 0.18,
          depthWrite: true,
          side: THREE.DoubleSide,
          roughness: 0.5,
          metalness: 0,
          specularIntensity: 0.3,
          sheen: 0,
          envMapIntensity: 0.25,
        });
        if (!isHair) soft.color.set("#2e211a");
        m.material = soft;
        m.castShadow = true;
        m.receiveShadow = true;
        return;
      } else {
        mat.roughness = 0.62;
        mat.metalness = 0;
      }
      mat.needsUpdate = true;
      m.castShadow = true;
      m.receiveShadow = true;
    });
    return s;
  }, [scene, skin, hairMap]);

  return <primitive object={cloned} />;
}

function usePrintTexture(url: string | null) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!url) {
      setTex(null);
      return;
    }
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    let dead = false;
    loader.load(url, (t) => {
      if (dead) return;
      // this UV convention wants flipY off, and without SRGB the print washes out
      t.flipY = false;
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      t.needsUpdate = true;
      setTex(t);
    });
    return () => {
      dead = true;
    };
  }, [url]);
  return tex;
}

/** The meshes are a megabyte and a half between them, so the first few seconds are a black
 *  rectangle unless we say something. It is the first thing anyone sees. */
function Loading() {
  const { active, progress } = useProgress();
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-end justify-center pb-16">
      <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.2em] text-stone-600">
        <span className="h-px w-16 overflow-hidden bg-white/10">
          <span
            className="block h-px bg-stone-400 transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </span>
        hanging the garments
      </div>
    </div>
  );
}

export function Viewer() {
  const params = useStore((s) => s.params);
  const prints = useStore((s) => s.prints);
  const activeId = useStore((s) => s.activePrintId);
  const active = prints.find((p) => p.id === activeId) ?? null;
  const tex = usePrintTexture(active?.url ?? null);

  return (
    <div className="relative h-full w-full bg-[#0e0d0c]">
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        camera={{ position: [0, 0.35, 3.35], fov: 32 }}
      >
        <color attach="background" args={["#0e0d0c"]} />
        <hemisphereLight args={["#f4efe8", "#2a2320", 0.55]} />
        <directionalLight
          position={[2.4, 3.4, 3.0]}
          intensity={2.1}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0004}
        />
        <directionalLight position={[-3, 1.8, 1.2]} intensity={0.5} color="#cfd8e6" />
        <directionalLight position={[0, 1.4, -3]} intensity={0.75} color="#ffd9b8" />
        <Suspense fallback={null}>
          <group position={[0, -0.9, 0]}>
            <Figure />
            <Garment id="tee" url="/assets/tee.glb" params={params} printTex={tex} lift={0.007} />
            <Garment id="trews" url="/assets/trews.glb" params={params} printTex={tex} />
            <ContactShadows position={[0, 0.002, 0]} opacity={0.5} scale={4} blur={2.4} far={1.6} />
          </group>
        </Suspense>
        <OrbitControls
          target={[0, 0.08, 0]}
          enablePan
          minDistance={0.6}
          maxDistance={5}
          maxPolarAngle={Math.PI * 0.62}
        />
      </Canvas>
      <Loading />
    </div>
  );
}
