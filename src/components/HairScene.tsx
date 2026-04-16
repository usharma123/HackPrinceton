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

import React, { useMemo, useEffect, useState, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { HairParams, UserHeadProfile } from '@/types';
import FaceHead from './FaceHead';
import ARFaceHead from './ARFaceHead';
import HairStrandMesh from './HairStrandMesh';
import { useARFaceMesh } from '@/hooks/useARFaceMesh';
import { parseNPY } from '@/lib/parseNPY';

// ── Sub-components ──────────────────────────────────────────

interface HeadMeshProps {
  profile?: UserHeadProfile;
  showFace?: boolean;
  showHead?: boolean;
  arMesh?: import('@/types').ARFaceMesh | null;
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
function CanonicalHeadGLB({ profile, showFace = true, showHead = true, arMesh }: HeadMeshProps) {
  const { scene } = useGLTF('/models/head.glb?v=6');

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

  const MODEL_SCALE = 0.8111;
  // Face center sits above y=0 in outer-group space (face is in the upper
  // portion of the head+neck+shoulders model).  After glbScale amplification
  // this offset grows; FACE_Y_CORRECTION cancels it so the GLB face aligns
  // with the MediaPipe mesh center at y=0.  Tune if still misaligned.
  const FACE_Y_CORRECTION = -0.5; // outer-group units
  // Shift the whole assembly (GLB + FaceHead) down for scene framing.
  const Y_OFFSET = -0.5 + faceHeight * MODEL_SCALE * 0.16;
  const Z_OFFSET = faceHeight * MODEL_SCALE * 0.07;

  return (
    <group scale={[MODEL_SCALE, MODEL_SCALE, MODEL_SCALE]} position={[0, Y_OFFSET, Z_OFFSET]}>
      <group scale={[scaleX, scaleY, scaleX]}>
        {!arMesh && showHead && (
          <group
            position={[0, -(glbCenterY * glbScale) + FACE_Y_CORRECTION, 0]}
            scale={[glbScale, glbScale, glbScale]}
            rotation={[0.0245, 0, 0]}
          >
            <primitive object={scene} castShadow receiveShadow />
          </group>
        )}
        {showFace && (
          <group position={[0, -faceHeight * 0.08, faceSurfaceZ + faceHeight * 0.05]} rotation={[0.06109, 0, 0]} scale={[0.88, 0.88, 0.88]}>
            {arMesh
              ? <ARFaceHead arMesh={arMesh} />
              : profile?.faceScanData && <FaceHead faceScanData={profile.faceScanData} outerScaleY={scaleY} chinTargetY={chinTargetY} />
            }
          </group>
        )}
      </group>
    </group>
  );
}

function CanonicalHead({ profile, showFace, showHead, arMesh }: HeadMeshProps) {
  return (
    <Suspense fallback={<HeadMesh profile={profile} showFace={showFace} arMesh={arMesh} />}>
      <CanonicalHeadGLB profile={profile} showFace={showFace} showHead={showHead} arMesh={arMesh} />
    </Suspense>
  );
}

// ── Hair depth points (npy) ─────────────────────────────────

// Renders a .npy file as a visible point cloud.
// Handles two shapes:
//   (N, 3)  — direct XYZ points (used as-is, scaled by scale/position group)
//   (H, W)  — 2D depth map: constructs 3D points by mapping pixel (i,j) →
//              (x, y) in PLY bbox space and depth value → z offset.
//              Subsampled every DEPTH_STEP pixels to keep point count manageable.
const DEPTH_STEP = 6; // sample every Nth pixel from the depth map
// PLY bbox extents used to normalize depth map pixel coords into PLY space.
const PLY_W = 0.34; const PLY_H = 0.37; const PLY_D = 0.30;
const PLY_Y_CENTER = 1.72; const PLY_Z_CENTER = -0.016;

function HairDepthPoints({ url, color, scale, position }: {
  url: string;
  color: string;
  scale: number;
  position: [number, number, number];
}) {
  const [geo, setGeo] = useState<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    let cancelled = false;
    parseNPY(url).then(({ data, shape }) => {
      if (cancelled) return;
      const g = new THREE.BufferGeometry();

      let positions: Float32Array;

      if (shape.length === 2) {
        // 2D depth map (H, W): build point cloud in PLY coordinate space
        const [H, W] = shape;
        const pts: number[] = [];
        for (let i = 0; i < H; i += DEPTH_STEP) {
          for (let j = 0; j < W; j += DEPTH_STEP) {
            const d = data[i * W + j];
            if (d <= 0) continue; // skip background/empty pixels
            const x = ((j - W / 2) / W) * PLY_W;
            const y = PLY_Y_CENTER - ((i - H / 2) / H) * PLY_H;
            const z = PLY_Z_CENTER + (d - 0.5) * PLY_D;
            pts.push(x, y, z);
          }
        }
        positions = new Float32Array(pts);
      } else {
        // (N, 3): direct XYZ points
        positions = new Float32Array(data);
      }

      g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      setGeo(g);
    });
    return () => { cancelled = true; };
  }, [url]);

  useEffect(() => () => { geo?.dispose(); }, [geo]);

  if (!geo) return null;
  return (
    <group scale={scale} position={position}>
      <points geometry={geo}>
        <pointsMaterial color={color} size={0.02} sizeAttenuation depthWrite={false} />
      </points>
    </group>
  );
}

// ── Scene content ───────────────────────────────────────────

// PLY hair bbox (scene units): width≈0.34, height≈0.37, depth≈0.30, center y≈1.72
// Head is 1.6 canonical × MODEL_SCALE 1.5 ≈ 2.4 units wide, crown at world y≈1.26.
// Scale 9 brings hair width to ~3.1 units (matching head), matching the observed
// 50%-too-narrow issue.  Y: PLY_ymin(1.5373)*9=13.84; pos_y = crown(1.26)−13.84=−12.58
// Z: PLY z-center is −0.016; at scale 9 that's −0.14, so +0.14 re-centers it.
const HAIR_PLY_SCALE   = 13.109;
const HAIR_PLY_POS: [number, number, number] = [0, -23.349, 0.714];

// Dev: all known hair layers. Toggle multiple simultaneously to identify pairs.
// Colors are fixed per layer so you can distinguish overlapping sets visually.
// type 'ply' → HairStrandMesh, type 'npy' → HairDepthPoints
const HAIR_LAYERS = [
  { type: 'ply', id: 'strands_1',    label: 'Strands 1',   url: '/hair/strands_1.ply',   color: '#3b1f0a', lineWidth: 0.8, renderOrder: 0 },
  { type: 'ply', id: 'depth_1',      label: 'Depth 1',     url: '/hair/depth_1.ply',     color: '#3b1f0a', lineWidth: 1.0, renderOrder: 1 },
  { type: 'ply', id: 'preset_a',     label: 'Preset A',    url: '/hair/preset_a.ply',    color: '#c8a050', lineWidth: 0.8, renderOrder: 0 },
  { type: 'ply', id: 'preset_b',     label: 'Preset B',    url: '/hair/preset_b.ply',    color: '#222222', lineWidth: 0.8, renderOrder: 0 },
  { type: 'ply', id: 'preset_c',     label: 'Preset C',    url: '/hair/preset_c.ply',    color: '#8b1a0a', lineWidth: 0.8, renderOrder: 0 },
  { type: 'ply', id: 'guest',        label: 'Guest',       url: '/hair/guest.ply',       color: '#c0b090', lineWidth: 0.8, renderOrder: 0 },
  { type: 'ply', id: 'brunohair',    label: 'Bruno',       url: '/hair/brunohair.ply',   color: '#0f0d0c', lineWidth: 0.8, renderOrder: 0 },
  { type: 'npy', id: 'bruno_depth',  label: 'Bruno Depth', url: '/hair/brunohair_depth.npy', color: '#44aaff', lineWidth: 0, renderOrder: 0 },
] as const;


interface SceneProps {
  profile?: UserHeadProfile;
  showFace?: boolean;
  showHead?: boolean;
  visibleLayers: Set<string>;
}

function Scene({ profile, showFace = true, showHead = true, visibleLayers }: SceneProps) {
  const arMesh = useARFaceMesh();
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 10, 5]}  intensity={1.0} castShadow />
      <directionalLight position={[0, 2, 5]}   intensity={0.8} />

      {/* FaceHead is rendered inside CanonicalHeadGLB / HeadMesh so it
          shares the same GLB bounding-box measurement for rFace. */}
      <CanonicalHead profile={profile} showFace={showFace} showHead={showHead} arMesh={arMesh} />

      {HAIR_LAYERS.filter(l => visibleLayers.has(l.id)).map(l =>
        l.type === 'npy' ? (
          <HairDepthPoints
            key={l.id}
            url={l.url}
            color={l.color}
            scale={HAIR_PLY_SCALE}
            position={HAIR_PLY_POS}
          />
        ) : (
          <HairStrandMesh
            key={l.id}
            url={l.url}
            color={l.color}
            scale={HAIR_PLY_SCALE}
            position={HAIR_PLY_POS}
            lineWidth={l.lineWidth}
            renderOrder={l.renderOrder}
          />
        )
      )}

      <OrbitControls
        enablePan={false}
        minPolarAngle={0}
        maxPolarAngle={Math.PI / 2 + (10 * Math.PI / 180)}
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

export default function HairScene({ params: _params, colorRGB: _colorRGB, profile }: HairSceneProps) {
  const [showFace, setShowFace] = useState(true);
  const [showHead, setShowHead] = useState(true);
  const [visibleLayers, setVisibleLayers] = useState<Set<string>>(
    new Set(['strands_1', 'depth_1'])
  );

  const toggleLayer = (id: string) =>
    setVisibleLayers(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const btnStyle: React.CSSProperties = {
    padding: '4px 10px', fontSize: 12,
    background: '#000', color: '#fff', border: 'none',
    borderRadius: 4, cursor: 'pointer',
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas
        shadows
        camera={{ position: [0, 0, 7.8], fov: 45 }}
        style={{ width: '100%', height: '100%', background: '#001f5b' }}
      >
        <Scene profile={profile} showFace={showFace} showHead={showHead} visibleLayers={visibleLayers} />
      </Canvas>
      <div style={{ position: 'absolute', bottom: 12, left: 12, display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: '90%' }}>
        <button onClick={() => setShowHead(v => !v)} style={{ ...btnStyle, opacity: showHead ? 1 : 0.4 }}>
          head
        </button>
        <button onClick={() => setShowFace(v => !v)} style={{ ...btnStyle, opacity: showFace ? 1 : 0.4 }}>
          face
        </button>
        {HAIR_LAYERS.map(l => (
          <button key={l.id} onClick={() => toggleLayer(l.id)} style={{
            ...btnStyle,
            outline: visibleLayers.has(l.id) ? `2px solid ${l.color}` : 'none',
            opacity: visibleLayers.has(l.id) ? 1 : 0.4,
          }}>
            {l.label}
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
