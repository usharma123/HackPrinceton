// ============================================================
// HairScene — COCO's domain
//
// Three.js scene via react-three-fiber.
// Currently uses placeholder geometry (sphere = head, boxes = hair zones).
// Replace the geometry with loaded .glb meshes once assets are ready.
//
// Props:
//   params   — HairParams driving mesh scale
//   colorRGB — hex string for hair material
//   profile  — optional UserHeadProfile; when provided, hair zones are
//              positioned dynamically from headProportions + anchors.
//              Falls back to hardcoded positions when absent.
// ============================================================

'use client';

import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { HairParams, UserHeadProfile } from '@/types';

// ── Hair zone position computation ───────────────────────────

interface ZoneLayout {
  position: [number, number, number];
  baseScale: [number, number, number];
}

interface HairZones {
  top:   ZoneLayout;
  left:  ZoneLayout;
  right: ZoneLayout;
  back:  ZoneLayout;
}

// Hardcoded fallback (matches original exactly)
const FALLBACK_ZONES: HairZones = {
  top:   { position: [0, 1.3, 0],      baseScale: [0.85, 0.5, 0.85] },
  left:  { position: [-1.05, 0.1, 0],  baseScale: [0.25, 0.8, 0.7]  },
  right: { position: [1.05, 0.1, 0],   baseScale: [0.25, 0.8, 0.7]  },
  back:  { position: [0, 0.0, -1.05],  baseScale: [0.75, 0.7, 0.25] },
};

function computeZones(profile: UserHeadProfile): HairZones {
  const { headProportions: hp, anchors } = profile;

  // Width ratio relative to canonical 1.6 — scales horizontal footprint
  const widthRatio = hp.width / 1.6;

  // ── Hair_Top ───────────────────────────────────────────────
  // Center sits one base-block-half above the crown
  const topBaseH: number = 0.5;
  const topY = hp.crownY + topBaseH * 0.5;

  // ── Hair_Sides ─────────────────────────────────────────────
  // X: ear anchor ± 0.2 outset so the block clears the head surface
  // Y: slightly above ear level
  const sideBaseH: number = 0.8;
  const sideOutset = 0.2;
  const leftX  = anchors.earLeft[0]  - sideOutset;
  const rightX = anchors.earRight[0] + sideOutset;
  const sideY  = anchors.earLeft[1] + sideBaseH * 0.25; // ~0.2 above ear

  // ── Hair_Back ──────────────────────────────────────────────
  // Approximate head radius from height (canonical 2.2 → radius 1.0)
  const headRadius  = hp.height / 2.2;
  const backBlockD  = 0.25;
  const backZ       = -(headRadius + backBlockD * 0.5);

  return {
    top: {
      position:  [0, topY, 0],
      baseScale: [0.85 * widthRatio, topBaseH, 0.85 * widthRatio],
    },
    left: {
      position:  [leftX,  sideY, 0],
      baseScale: [0.25, sideBaseH, 0.7 * widthRatio],
    },
    right: {
      position:  [rightX, sideY, 0],
      baseScale: [0.25, sideBaseH, 0.7 * widthRatio],
    },
    back: {
      position:  [0, 0, backZ],
      baseScale: [0.75 * widthRatio, 0.7, backBlockD],
    },
  };
}

// ── Sub-components ──────────────────────────────────────────

function HeadMesh() {
  return (
    <mesh castShadow receiveShadow>
      <sphereGeometry args={[1, 64, 64]} />
      <meshStandardMaterial color="#f5c9a0" roughness={0.8} metalness={0.0} />
    </mesh>
  );
}

interface HairZoneProps {
  position:   [number, number, number];
  baseScale:  [number, number, number];
  lengthScale: number;
  messiness:  number;
  colorRGB:   string;
}

function HairZone({ position, baseScale, lengthScale, messiness, colorRGB }: HairZoneProps) {
  const meshRef = useRef<THREE.Mesh>(null!);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t   = clock.getElapsedTime();
    const amp = messiness * 0.015;
    meshRef.current.rotation.x = Math.sin(t * 2.1) * amp;
    meshRef.current.rotation.z = Math.cos(t * 1.7) * amp;
  });

  return (
    <mesh ref={meshRef} position={position} castShadow>
      <boxGeometry args={[baseScale[0], baseScale[1] * lengthScale, baseScale[2]]} />
      <meshStandardMaterial color={colorRGB} roughness={0.9} metalness={0.0} />
    </mesh>
  );
}

// ── Scene content ───────────────────────────────────────────

interface SceneProps {
  params:   HairParams;
  colorRGB: string;
  zones:    HairZones;
}

function Scene({ params, colorRGB, zones }: SceneProps) {
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 10, 5]} intensity={1.2} castShadow />

      <HeadMesh />

      <HairZone
        position={zones.top.position}
        baseScale={zones.top.baseScale}
        lengthScale={params.topLength}
        messiness={params.messiness}
        colorRGB={colorRGB}
      />
      <HairZone
        position={zones.left.position}
        baseScale={zones.left.baseScale}
        lengthScale={params.sideLength}
        messiness={params.messiness}
        colorRGB={colorRGB}
      />
      <HairZone
        position={zones.right.position}
        baseScale={zones.right.baseScale}
        lengthScale={params.sideLength}
        messiness={params.messiness}
        colorRGB={colorRGB}
      />
      <HairZone
        position={zones.back.position}
        baseScale={zones.back.baseScale}
        lengthScale={params.backLength}
        messiness={params.messiness}
        colorRGB={colorRGB}
      />

      <OrbitControls
        enablePan={false}
        minPolarAngle={0}
        maxPolarAngle={Math.PI / 2}
        minDistance={2.5}
        maxDistance={6}
      />
    </>
  );
}

// ── Public component ────────────────────────────────────────

interface HairSceneProps {
  params:    HairParams;
  colorRGB?: string;
  profile?:  UserHeadProfile;
}

export default function HairScene({ params, colorRGB = '#3b1f0a', profile }: HairSceneProps) {
  const zones = useMemo(
    () => (profile ? computeZones(profile) : FALLBACK_ZONES),
    [profile]
  );

  return (
    <Canvas
      shadows
      camera={{ position: [0, 1, 4], fov: 45 }}
      style={{ width: '100%', height: '100%' }}
    >
      <Scene params={params} colorRGB={colorRGB} zones={zones} />
    </Canvas>
  );
}

// ============================================================
// TODO (Coco): replace placeholder geometry with .glb
//
// import { useGLTF } from '@react-three/drei';
//
// function HeadMesh() {
//   const { scene } = useGLTF('/models/head.glb');
//   return <primitive object={scene} />;
// }
//
// Use updateHairMesh(params) below to drive .glb mesh groups:
// ============================================================

export function updateHairMesh(
  scene: THREE.Object3D,
  params: HairParams
) {
  scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;

    if (child.name === 'Hair_Top') {
      child.scale.y = params.topLength;
    }
    if (child.name.startsWith('Hair_Side')) {
      child.scale.y = params.sideLength;
      child.scale.x = 1 - params.taper * 0.5;
    }
    if (child.name === 'Hair_Back') {
      child.scale.y = params.backLength;
    }

    if (child.name.startsWith('Hair_') && child.material instanceof THREE.MeshStandardMaterial) {
      child.material.roughness = 0.5 + params.messiness * 0.5;
    }
  });
}
