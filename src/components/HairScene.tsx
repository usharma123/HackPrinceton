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

import { useMemo, useEffect, useState, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { HairParams, UserHeadProfile } from '@/types';
import FaceHead from './FaceHead';
import HairStrandMesh from './HairStrandMesh';

// ── Sub-components ──────────────────────────────────────────

interface HeadMeshProps {
  profile?: UserHeadProfile;
  showFace?: boolean;
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
function CanonicalHeadGLB({ profile, showFace = true }: HeadMeshProps) {
  const { scene } = useGLTF('/models/head.glb?v=5');

  const { glbScale, glbCenterY, faceSurfaceZ, chinTargetY, faceHeight } = useMemo(() => {
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

    const faceHeight = glbFaceHeight_native * gs;

    return { glbScale: gs, glbCenterY: center.y, faceSurfaceZ: fsz, chinTargetY: cty, faceHeight };
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
    scene.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((m) => {
        if (m instanceof THREE.MeshStandardMaterial) m.color.copy(color);
      });
    });
  }, [scene]);

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
          rotation={[0.0245, 0, 0]}
        >
          <primitive object={scene} castShadow receiveShadow />
        </group>
        {profile?.faceScanData && showFace && (
          // Z-offset places the face mesh flush on the head model's front surface.
          // scaleX=1 always, so Z is unaffected by the outer group's scale.
          <group position={[0, -faceHeight * 0.08, faceSurfaceZ + faceHeight * 0.05]} rotation={[0.06109, 0, 0]} scale={[0.8, 0.8, 0.8]}>
            <FaceHead faceScanData={profile.faceScanData} outerScaleY={scaleY} chinTargetY={chinTargetY} />
          </group>
        )}
      </group>
    </group>
  );
}

function CanonicalHead({ profile, showFace }: HeadMeshProps) {
  return (
    <Suspense fallback={<HeadMesh profile={profile} showFace={showFace} />}>
      <CanonicalHeadGLB profile={profile} showFace={showFace} />
    </Suspense>
  );
}

// ── Scene content ───────────────────────────────────────────

// PLY hair bbox (scene units): width≈0.34, height≈0.37, depth≈0.30, center y≈1.72
// Head is 1.6 canonical × MODEL_SCALE 1.5 ≈ 2.4 units wide, crown at world y≈1.26.
// Scale 9 brings hair width to ~3.1 units (matching head), matching the observed
// 50%-too-narrow issue.  Y: PLY_ymin(1.5373)*9=13.84; pos_y = crown(1.26)−13.84=−12.58
// Z: PLY z-center is −0.016; at scale 9 that's −0.14, so +0.14 re-centers it.
const HAIR_PLY_SCALE   = 12.060;
const HAIR_PLY_POS: [number, number, number] = [0, -21.569, 0.386];

interface SceneProps {
  colorRGB: string;
  profile?: UserHeadProfile;
  showFace?: boolean;
  showHair?: boolean;
}

function Scene({ colorRGB, profile, showFace = true, showHair = true }: SceneProps) {
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 10, 5]}  intensity={1.0} castShadow />
      <directionalLight position={[0, 2, 5]}   intensity={0.8} />

      {/* FaceHead is rendered inside CanonicalHeadGLB / HeadMesh so it
          shares the same GLB bounding-box measurement for rFace. */}
      <CanonicalHead profile={profile} showFace={showFace} />

      {showHair && (
        <>
          <HairStrandMesh
            url="/hair/hair1.ply"
            color={colorRGB}
            scale={HAIR_PLY_SCALE}
            position={HAIR_PLY_POS}
            lineWidth={0.8}
          />
          <HairStrandMesh
            url="/hair/depth.ply"
            color={colorRGB}
            scale={HAIR_PLY_SCALE}
            position={HAIR_PLY_POS}
            lineWidth={1}
            renderOrder={1}
          />
        </>
      )}

      <OrbitControls
        enablePan={false}
        minPolarAngle={0}
        maxPolarAngle={Math.PI / 2}
        minDistance={2.5}
        maxDistance={7.8}
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
  const [showFace, setShowFace] = useState(true);
  const [showHair, setShowHair] = useState(true);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas
        shadows
        camera={{ position: [0, 1, 4], fov: 45 }}
        style={{ width: '100%', height: '100%' }}
      >
        <Scene colorRGB={colorRGB} profile={profile} showFace={showFace} showHair={showHair} />
      </Canvas>
      <div style={{ position: 'absolute', bottom: 12, left: 12, display: 'flex', gap: 6 }}>
        {[
          { label: 'face', show: showFace, toggle: () => setShowFace(v => !v) },
          { label: 'hair', show: showHair, toggle: () => setShowHair(v => !v) },
        ].map(({ label, show, toggle }) => (
          <button key={label} onClick={toggle} style={{
            padding: '4px 10px', fontSize: 12, opacity: 0.6,
            background: '#000', color: '#fff', border: 'none',
            borderRadius: 4, cursor: 'pointer',
          }}>
            {show ? `hide ${label}` : `show ${label}`}
          </button>
        ))}
      </div>
    </div>
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
