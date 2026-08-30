"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import {
  OrbitControls,
  ContactShadows,
  Environment,
  Lightformer,
  useGLTF,
  useProgress,
  useTexture,
} from "@react-three/drei";
import * as THREE from "three";
import { Garment } from "./Garment";
import { Controls } from "./Controls";
import { Options } from "./Options";
import { useStore } from "@/lib/store";

useGLTF.preload("/assets/figure.glb");
useGLTF.preload("/assets/tee.glb");
useGLTF.preload("/assets/trews.glb");

/**
 * A studio sweep, drawn in a 2D canvas rather than fetched.
 *
 * A pure black field gives the figure nothing to sit in: the silhouette dissolves at the
 * edges and a white garment reads as the only light in the frame rather than as white. A
 * soft pool behind her, falling off to near black at the corners, is what a photographer
 * gets from a light aimed at the back wall, and it costs one 512px canvas.
 */
function Backdrop() {
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const g = c.getContext("2d")!;
    g.fillStyle = "#070706";
    g.fillRect(0, 0, 512, 512);
    const pool = g.createRadialGradient(256, 205, 8, 256, 250, 300);
    pool.addColorStop(0, "#1d1a16");
    pool.addColorStop(0.4, "#131110");
    pool.addColorStop(1, "#070706");
    g.fillStyle = pool;
    g.fillRect(0, 0, 512, 512);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  return <primitive attach="background" object={tex} />;
}

/**
 * The light rig, built entirely in-engine.
 *
 * Nothing here fetches an HDRI: drei's Environment presets pull from a CDN, and this gets
 * demoed on venue wifi. The Lightformers are rendered into a small cube target locally,
 * which gives the broad wrapping light a studio softbox produces and that no number of bare
 * directional lights can fake. The directional lights that remain are there for the shadow
 * and for a little snap on top.
 *
 * The ratio is the point. One warm key, doing nearly all the work. A cool fill roughly a
 * stop and a half under it, enough to keep the shadow side from going muddy and no more,
 * because a garment with no shadow side has no folds. Two hard rims behind that draw the
 * silhouette off the dark ground. Everything sits deliberately below the level that clips a
 * near-white garment: the tee has to keep its drape instead of blowing out to paper, and a
 * dark print has to stay dark, which broad ambient is very good at ruining.
 */
function Rig() {
  return (
    <>
      <Environment resolution={256} frames={1}>
        {/* key, camera left and high: a big soft source, warm */}
        <Lightformer
          form="rect"
          intensity={1.8}
          color="#fff7ee"
          position={[-3.4, 3.0, 3.6]}
          scale={[6, 7, 1]}
        />
        {/* bounce card, camera right: cool, and well under the key */}
        <Lightformer
          form="rect"
          intensity={0.12}
          color="#cfdcf7"
          position={[4.2, 0.9, 2.6]}
          scale={[7, 6, 1]}
        />
        {/* two rims behind, the thing that lifts her off the ground */}
        <Lightformer
          form="rect"
          intensity={6.5}
          color="#fff1df"
          position={[-4.3, 2.2, -1.6]}
          scale={[0.5, 6, 1]}
        />
        <Lightformer
          form="rect"
          intensity={4.5}
          color="#dfe9ff"
          position={[4.3, 2.4, -1.4]}
          scale={[0.45, 6, 1]}
        />
        {/* a wide soft ceiling, and a dark warm floor bounce so undersides are not voids */}
        <Lightformer
          form="rect"
          intensity={0.055}
          color="#f6efe6"
          position={[0, 6, 0.5]}
          scale={[9, 9, 1]}
          rotation={[Math.PI / 2, 0, 0]}
        />
        <Lightformer
          form="rect"
          intensity={0.05}
          color="#5a4a3c"
          position={[0, -4, 1.8]}
          scale={[9, 9, 1]}
          rotation={[-Math.PI / 2, 0, 0]}
        />
      </Environment>

      {/* the only caster. Low, warm and soft, so the arms lay a suggestion across the
          garment rather than a stencil */}
      <directionalLight
        position={[-3.0, 4.2, 3.4]}
        intensity={2.2}
        color="#fff6ea"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-radius={7}
        shadow-bias={-0.0006}
        shadow-normalBias={0.02}
      >
        <orthographicCamera attach="shadow-camera" args={[-1.6, 1.6, 2.2, -1.4, 0.5, 12]} />
      </directionalLight>
      {/* cool fill, opposite the key, no shadow */}
      <directionalLight position={[3.6, 1.2, 2.2]} intensity={0.22} color="#c4d3ee" />
      {/* Two strip lights behind her, one either side. This is what stops the silhouette
          dissolving into a dark ground: the outer edge of an arm, a trouser leg and the
          top of the hair each pick up a hard line, and the figure sits in front of the
          backdrop instead of being cut out of it. Warm on the key side, cool opposite. */}
      <directionalLight position={[-3.4, 2.0, -2.2]} intensity={1.9} color="#ffe4c4" />
      <directionalLight position={[3.4, 2.2, -2.0]} intensity={1.4} color="#cddcf8" />
      {/* a floor of light so nothing reads as pure black, well under the env */}
      <hemisphereLight args={["#efe7dc", "#1b1512", 0.03]} />
    </>
  );
}

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
        // No renderer here does subsurface, so skin is faked with the two things that
        // actually read: a broad rough diffuse with almost no specular lobe, and a warm
        // sheen that lights the grazing angles. That warmth around the jaw and the cheek
        // is what a subsurface pass buys you, and without it the mouth is the only warm
        // thing on the face, which is why the lips were reading orange.
        m.material = new THREE.MeshPhysicalMaterial({
          map: skin,
          roughness: 0.84,
          metalness: 0,
          specularIntensity: 0.18,
          specularColor: new THREE.Color("#ffeedd"),
          sheen: 0.28,
          sheenRoughness: 0.9,
          sheenColor: new THREE.Color("#c4674a"),
          envMapIntensity: 0.45,
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
      const isEye = /high-poly|eye(?!lash|brow)/i.test(m.name);
      if (isEye) {
        // A catchlight is most of what makes a CG face look alive, and the eye was
        // rendering at garment roughness, so it had none. Tune the loaded material rather
        // than replacing it: the iris is painted on the INSIDE of the ball and read
        // through a blended, double-sided cornea, so any opaque replacement shows the
        // outer shell only and she goes blind.
        mat.roughness = 0.34;
        mat.metalness = 0;
        mat.envMapIntensity = 0.3;
        mat.needsUpdate = true;
        m.castShadow = false;
        m.receiveShadow = false;
        return;
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
          roughness: 0.48,
          metalness: 0,
          specularIntensity: 0.34,
          // a whisper of warm sheen is the only thing that separates a black bob from a
          // black ground. Any more and the map, which is nearly black, tints ginger.
          sheen: 0.18,
          sheenRoughness: 0.7,
          sheenColor: new THREE.Color("#7a5a3e"),
          envMapIntensity: 0.32,
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
    <div className="relative h-full w-full bg-[#0b0a09]">
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{
          preserveDrawingBuffer: true,
          antialias: true,
          // filmic, so the near-white garment rolls off into its folds instead of
          // clipping to paper. The exposure is set here rather than left at 1 because
          // the whole rig is balanced against it.
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 0.78,
        }}
        camera={{ position: [0, -0.05, 3.7], fov: 32 }}
      >
        <Backdrop />
        <Rig />
        <Suspense fallback={null}>
          <group position={[0, -0.9, 0]}>
            <Figure />
            <Garment id="tee" url="/assets/tee.glb" params={params} printTex={tex} lift={0.007} />
            <Garment id="trews" url="/assets/trews.glb" params={params} printTex={tex} />
            <ContactShadows
              position={[0, 0.002, 0]}
              opacity={0.72}
              scale={5}
              blur={3.2}
              far={1.4}
              resolution={512}
              color="#000000"
            />
          </group>
        </Suspense>
        <OrbitControls
          target={[0, 0.08, 0]}
          enablePan
          enableDamping
          dampingFactor={0.075}
          rotateSpeed={0.65}
          minDistance={0.6}
          maxDistance={5}
          maxPolarAngle={Math.PI * 0.62}
        />
      </Canvas>
      <Loading />
      {/* the sliders live over the garment, not in the chat column: you drag
          them while you are looking at the print */}
      <Controls />
      {/* the kept looks lay down opposite them, over the garment they are versions of */}
      <Options />
    </div>
  );
}
