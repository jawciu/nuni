"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, ContactShadows, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { Garment } from "./Garment";
import { useStore } from "@/lib/store";

useGLTF.preload("/assets/body.glb");
useGLTF.preload("/assets/tee.glb");
useGLTF.preload("/assets/trews.glb");

function Body() {
  const { scene } = useGLTF("/assets/body.glb");
  const cloned = useMemo(() => {
    const s = scene.clone(true);
    s.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.computeVertexNormals();
      // desaturated and darker than the cloth, so the print stays the loudest thing on screen
      m.material = new THREE.MeshStandardMaterial({
        color: new THREE.Color("#b08a76"),
        roughness: 0.72,
        metalness: 0,
      });
      m.castShadow = true;
      m.receiveShadow = true;
    });
    return s;
  }, [scene]);
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
            <Garment id="tee" url="/assets/tee.glb" params={params} printTex={tex} colour="#eae5dd" lift={0.007} />
            <Garment id="trews" url="/assets/trews.glb" params={params} printTex={tex} colour="#3d4350" />
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
    </div>
  );
}
