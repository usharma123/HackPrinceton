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

import { useRef, useMemo, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { HairParams, UserHeadProfile } from '@/types';
import FaceHead from './FaceHead';

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

interface HeadMeshProps {
  profile?: UserHeadProfile;
}

// Sphere fallback — shown while head.glb loads or if it fails.
// rFace = 1.05 so the face mesh sits just outside the unit sphere.
function HeadMesh({ profile }: HeadMeshProps) {
  const scaleX = profile ? (profile.headProportions.width  / 1.6) : 1;
  const scaleY = profile ? (profile.headProportions.height / 2.2) : 1;

  return (
    <group scale={[scaleX, scaleY, scaleX]}>
      <mesh castShadow receiveShadow>
        <sphereGeometry args={[1, 64, 64]} />
        <meshStandardMaterial color="#f5c9a0" roughness={0.8} metalness={0.0} />
      </mesh>
      {profile?.faceScanData && (
        <FaceHead faceScanData={profile.faceScanData} rFace={1.05} />
      )}
    </group>
  );
}

// Canonical head .glb
// The exported model is NOT at canonical scale — we measure its bounds at runtime
// and compute the correction factor so ear-to-ear = 1.6 scene units with the ear
// midpoint at the scene origin (y = 0).
//
// We also derive rFace = box.max.z * canonicalScale, which is the exact Z depth
// of the head's front face surface in canonical pre-scale space.  FaceHead uses
// this so its hemisphere projection lands on the head surface — no guesswork.
function CanonicalHeadGLB({ profile }: HeadMeshProps) {
  const { scene } = useGLTF('/models/head.glb');

  const { canonicalScale, glbCenterY, glbCenterZ, rFace } = useMemo(() => {
    scene.updateWorldMatrix(true, true);
    const box    = new THREE.Box3().setFromObject(scene);
    const size   = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const cs     = 1.6 / Math.max(size.x, 0.001);

    // The GLB origin may be anywhere — only Y is corrected when rendering.
    // rFace must be the distance from the GLB's Z *center* to its front face,
    // not from the GLB origin to box.max.z (which collapses to ≈0 if the model
    // origin sits at the nose).  Minimum 0.85 so the hemisphere covers ears (x≈±0.8).
    const depthFromCenter = Math.max(box.max.z - center.z, 0);
    const rf = Math.max(depthFromCenter * cs, 0.85) * 1.02;

    return { canonicalScale: cs, glbCenterY: center.y, glbCenterZ: center.z, rFace: rf };
  }, [scene]);

  const scaleX = profile ? (profile.headProportions.width  / 1.6) : 1;
  const scaleY = profile ? (profile.headProportions.height / 2.2) : 1;

  // Two-level group:
  //  outer — applies the profile's non-uniform head-proportion scale around origin
  //  inner — scales the GLB to canonical size and shifts its ear midpoint to y = 0
  return (
    <group scale={[scaleX, scaleY, scaleX]}>
      <group
        position={[0, -(glbCenterY * canonicalScale), 0]}
        scale={[canonicalScale, canonicalScale, canonicalScale]}
      >
        <primitive object={scene} castShadow receiveShadow />
      </group>
      {profile?.faceScanData && (
        // Z-offset to the head's Z center so the hemisphere projects to
        // the nose position regardless of where the GLB origin is placed.
        <group position={[0, 0, glbCenterZ * canonicalScale]}>
          <FaceHead faceScanData={profile.faceScanData} rFace={rFace} />
        </group>
      )}
    </group>
  );
}

function CanonicalHead({ profile }: HeadMeshProps) {
  return (
    <Suspense fallback={<HeadMesh profile={profile} />}>
      <CanonicalHeadGLB profile={profile} />
    </Suspense>
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
  profile?: UserHeadProfile;
}

function Scene({ params, colorRGB, zones, profile }: SceneProps) {
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 10, 5]}  intensity={1.0} castShadow />
      <directionalLight position={[0, 2, 5]}   intensity={0.8} />

      {/* FaceHead is rendered inside CanonicalHeadGLB / HeadMesh so it
          shares the same GLB bounding-box measurement for rFace. */}
      <CanonicalHead profile={profile} />

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
      <Scene params={params} colorRGB={colorRGB} zones={zones} profile={profile} />
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
