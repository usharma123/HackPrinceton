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

import { useRef, useMemo, useEffect, Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
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

// Enables material-level clip planes (must run inside Canvas).
function EnableLocalClipping() {
  const { gl } = useThree();
  useEffect(() => { gl.localClippingEnabled = true; }, [gl]);
  return null;
}

// ── Sub-components ──────────────────────────────────────────

interface HeadMeshProps {
  profile?: UserHeadProfile;
}

// Sphere fallback — shown while head.glb loads or if it fails.
// FaceHead sits on the front of the unit sphere (z≈1) inside the same
// outer scale group so proportions stay consistent.
function HeadMesh({ profile }: HeadMeshProps) {
  const scaleX = profile ? (profile.headProportions.width  / 1.6) : 1;
  const scaleY = profile ? (profile.headProportions.height / 2.2) : 1;

  return (
    <group scale={[scaleX, scaleY, scaleX]}>
      <mesh castShadow receiveShadow>
        <sphereGeometry args={[1, 64, 64]} />
        <meshStandardMaterial color="#e8be9a" roughness={0.8} metalness={0.0} />
      </mesh>
      {profile?.faceScanData && (
        <group position={[0, 0, 1.0]}>
          <FaceHead faceScanData={profile.faceScanData} outerScaleY={scaleY} />
        </group>
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

  const { glbScale, glbCenterY, faceSurfaceZ, chinTargetY } = useMemo(() => {
    scene.updateWorldMatrix(true, true);
    const box    = new THREE.Box3().setFromObject(scene);
    const size   = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    // The model now includes head + neck + shoulders.  size.x is the shoulder
    // width, but the face is only ~45% of that span.  Scale so the face
    // portion = 1.6 canonical units (matching the MediaPipe mesh width).
    const FACE_FRACTION = 0.45; // face ≈ 40–50% of total model X — tune if needed
    const cs      = 1.6 / Math.max(size.x, 0.001);
    const gs      = cs / FACE_FRACTION; // GLB-group scale; face → 1.6 units

    // faceSurfaceZ: front face plane in outer-group units (updated for gs).
    const fsz = box.max.z * gs;

    // ── GLB chin detection ───────────────────────────────────────────────────
    // The canonical head is the most-protruding oval (z near box.max.z).
    // Scan all mesh vertices whose world-space Z > 75% of box.max.z to find
    // the bottommost point on that oval — the chin.
    const FACE_Y_CORRECTION = -0.5; // must match the constant used in the JSX below
    const frontThreshold = box.max.z * 0.75;
    let glbChinY_native    = Infinity;
    let glbFaceTopY_native = -Infinity;
    const tmp = new THREE.Vector3();
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const pos = child.geometry.attributes.position;
      if (!pos) return;
      for (let i = 0; i < pos.count; i++) {
        tmp.fromBufferAttribute(pos, i).applyMatrix4(child.matrixWorld);
        if (tmp.z > frontThreshold) {
          if (tmp.y < glbChinY_native)    glbChinY_native    = tmp.y;
          if (tmp.y > glbFaceTopY_native) glbFaceTopY_native = tmp.y;
        }
      }
    });
    // Raise the raw chin point by 1/20th of the front-face oval height so the
    // target lands slightly above the very bottom edge of the mesh geometry.
    const glbFaceHeight_native = glbFaceTopY_native - glbChinY_native;
    const adjustedChinY = glbChinY_native + glbFaceHeight_native / 20;

    // Convert GLB-native Y → outer-group local space:
    //   inner group: position = -(center.y * gs) + FACE_Y_CORRECTION, scale = gs
    //   vertex y in outer group = (vertex_y_native - center.y) * gs + FACE_Y_CORRECTION
    const cty = glbChinY_native < Infinity
      ? (adjustedChinY - center.y) * gs + FACE_Y_CORRECTION
      : undefined;

    return { glbScale: gs, glbCenterY: center.y, faceSurfaceZ: fsz, chinTargetY: cty };
  }, [scene]);

  const scaleX = profile ? (profile.headProportions.width  / 1.6) : 1;
  const scaleY = profile ? (profile.headProportions.height / 2.2) : 1;

  // Three-level group:
  //  model-scale — uniform 1.5× to accommodate the larger head+neck+shoulders model;
  //                Y_OFFSET shifts the assembly down so the face lands on the mesh.
  //  outer       — applies the profile's non-uniform head-proportion scale around origin
  //  inner       — scales the GLB to canonical size and shifts its ear midpoint to y = 0
  //
  // FaceHead lives INSIDE the outer group so it scales with the head model.
  // outerScaleY only cancels the non-uniform scaleY; the uniform MODEL_SCALE
  // does not distort face proportions, so it does not need to be passed through.
  // Recolor the GLB's baked materials to match the FaceHead skin tone.
  useEffect(() => {
    const color = new THREE.Color('#e8be9a');
    // Clip the GLB head so it doesn't protrude forward past the face surface.
    // The clip plane (world space) removes geometry with world-Z > clipZ,
    // which is everything in front of 90% of the face surface depth.
    // The MediaPipe face (depthTest:false) covers this clipped area from the front,
    // so no gap is visible — but the GLB edge no longer pokes out from the side.
    // THREE.js clips points where dot(normal, p) + constant < 0.
    // Normal (0,0,-1), constant +clipZ → clips where -z + clipZ < 0 → z > clipZ.
    // This removes geometry in front of clipZ (the protruding front face of the GLB).
    const clipZ = faceSurfaceZ * scaleX * MODEL_SCALE * 0.90;
    const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), clipZ);
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((m) => {
        if (m instanceof THREE.MeshStandardMaterial) {
          m.color.copy(color);
          m.clippingPlanes = [clipPlane];
        }
      });
    });
  }, [scene, faceSurfaceZ, scaleX]);

  const MODEL_SCALE = 1.5;
  // Face center sits above y=0 in outer-group space (face is in the upper
  // portion of the head+neck+shoulders model).  After glbScale amplification
  // this offset grows; FACE_Y_CORRECTION cancels it so the GLB face aligns
  // with the MediaPipe mesh center at y=0.  Tune if still misaligned.
  const FACE_Y_CORRECTION = -0.5; // outer-group units
  // Shift the whole assembly (GLB + FaceHead) down for scene framing.
  const Y_OFFSET = -0.5;

  return (
    <group scale={[MODEL_SCALE, MODEL_SCALE, MODEL_SCALE]} position={[0, Y_OFFSET, 0]}>
      <group scale={[scaleX, scaleY, scaleX]}>
        <group
          position={[0, -(glbCenterY * glbScale) + FACE_Y_CORRECTION, 0]}
          scale={[glbScale, glbScale, glbScale]}
        >
          <primitive object={scene} castShadow receiveShadow />
        </group>
        {profile?.faceScanData && (
          // Z-offset places the face mesh flush on the head model's front surface.
          // scaleX=1 always, so Z is unaffected by the outer group's scale.
          <group position={[0, 0, faceSurfaceZ]}>
            <FaceHead faceScanData={profile.faceScanData} outerScaleY={scaleY} chinTargetY={chinTargetY} />
          </group>
        )}
      </group>
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
    <mesh ref={meshRef} position={position} castShadow renderOrder={2}>
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
      <EnableLocalClipping />
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
