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
// ============================================================

'use client';

import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
import * as THREE from 'three';
import { HairParams } from '@/types';

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
  position: [number, number, number];
  baseScale: [number, number, number];
  lengthScale: number;   // driven by HairParams
  messiness: number;
  colorRGB: string;
}

function HairZone({ position, baseScale, lengthScale, messiness, colorRGB }: HairZoneProps) {
  const meshRef = useRef<THREE.Mesh>(null!);

  // Subtle jitter each frame proportional to messiness
  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.getElapsedTime();
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
  params: HairParams;
  colorRGB: string;
}

function Scene({ params, colorRGB }: SceneProps) {
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 10, 5]} intensity={1.2} castShadow />

      {/* Head */}
      <HeadMesh />

      {/* Top hair — sits above the sphere, scales upward */}
      <HairZone
        position={[0, 1.3, 0]}
        baseScale={[0.85, 0.5, 0.85]}
        lengthScale={params.topLength}
        messiness={params.messiness}
        colorRGB={colorRGB}
      />

      {/* Left side hair */}
      <HairZone
        position={[-1.05, 0.1, 0]}
        baseScale={[0.25, 0.8, 0.7]}
        lengthScale={params.sideLength}
        messiness={params.messiness}
        colorRGB={colorRGB}
      />

      {/* Right side hair */}
      <HairZone
        position={[1.05, 0.1, 0]}
        baseScale={[0.25, 0.8, 0.7]}
        lengthScale={params.sideLength}
        messiness={params.messiness}
        colorRGB={colorRGB}
      />

      {/* Back hair */}
      <HairZone
        position={[0, 0.0, -1.05]}
        baseScale={[0.75, 0.7, 0.25]}
        lengthScale={params.backLength}
        messiness={params.messiness}
        colorRGB={colorRGB}
      />

      <OrbitControls
        enablePan={false}
        minPolarAngle={0}
        maxPolarAngle={Math.PI / 2}  // upper hemisphere only
        minDistance={2.5}
        maxDistance={6}
      />
    </>
  );
}

// ── Public component ────────────────────────────────────────

interface HairSceneProps {
  params: HairParams;
  colorRGB?: string;
}

export default function HairScene({ params, colorRGB = '#3b1f0a' }: HairSceneProps) {
  return (
    <Canvas
      shadows
      camera={{ position: [0, 1, 4], fov: 45 }}
      style={{ width: '100%', height: '100%' }}
    >
      <Scene params={params} colorRGB={colorRGB} />
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
  // Traverse the loaded .glb and scale named groups.
  // Convention: mesh groups must be named "Hair_Top", "Hair_Sides", "Hair_Back"
  scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;

    if (child.name === 'Hair_Top') {
      child.scale.y = params.topLength;
    }
    if (child.name.startsWith('Hair_Side')) {
      child.scale.y = params.sideLength;
      // Apply taper: scale sides down proportional to taper value
      child.scale.x = 1 - params.taper * 0.5;
    }
    if (child.name === 'Hair_Back') {
      child.scale.y = params.backLength;
    }

    // Messiness: inject vertex noise (done in shader / via morph targets in production)
    // Placeholder: just adjust roughness to hint at texture
    if (child.name.startsWith('Hair_') && child.material instanceof THREE.MeshStandardMaterial) {
      child.material.roughness = 0.5 + params.messiness * 0.5;
    }
  });
}
