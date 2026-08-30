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

useGLTF.preload("/assets/body.glb");
useGLTF.preload("/assets/tee.glb");
useGLTF.preload("/assets/trews.glb");

function Body() {
  const { scene } = useGLTF("/assets/body.glb");
  // the same skin she was picked in, makeup painted into the map. The mesh keeps its
  // MakeHuman UVs through the OBJ and GLB round trip, so this lands without any fitting.
  const skin = useTexture("/assets/skin.png");

  const cloned = useMemo(() => {
    skin.flipY = false;
    skin.colorSpace = THREE.SRGBColorSpace;
    skin.anisotropy = 8;
    skin.needsUpdate = true;

    const s = scene.clone(true);
    s.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.computeVertexNormals();
      m.material = new THREE.MeshStandardMaterial({
        map: skin,
        // skin is never shiny across the whole face, and a broad soft highlight reads far
        // better than a wet one
        roughness: 0.62,
        metalness: 0,
      });
      m.castShadow = true;
      m.receiveShadow = true;
    });
    return s;
  }, [scene, skin]);

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
            <Body />
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
