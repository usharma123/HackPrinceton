'use client';

// ============================================================
// FaceHead — renders the user's face as a structural 3D mesh
//
// Pipeline:
//  1. Map x, y landmarks to scene space (ear-to-ear = 1.6 units)
//  2. Project z onto the front hemisphere of radius `rFace`
//     — passed in from the parent so it matches the actual GLB
//       head model's front face depth (measured at runtime)
//  3. Index with canonical MediaPipe triangulation (898 triangles)
//  4. Solid skin-toned material lit by scene lights
// ============================================================

import { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { FacemeshDatas } from '@react-three/drei';
import { FaceScanData } from '@/types';

// ── Coordinate conversion ──────────────────────────────────────
function landmarksToScene(
  landmarks: FaceScanData['landmarks'],
  imageWidth: number,
  imageHeight: number,
  rFace: number,
): Float32Array {
  const lm = landmarks;

  const earToEarNorm = Math.abs(lm[454].x - lm[234].x);
  const scale  = 1.6 / Math.max(earToEarNorm, 0.01);
  const centerX = (lm[234].x + lm[454].x) / 2;
  const centerY = (lm[234].y + lm[454].y) / 2;
  const yScale  = scale * (imageHeight / imageWidth);

  // MediaPipe Z encodes facial topography: nose is most negative (closest
  // to camera), eye sockets and temples slightly positive.  After negation
  // this becomes the forward protrusion at each landmark.
  // Fixed constant — MediaPipe z is already normalized to face scale, so
  // scaling by the XY scale factor was over-exaggerating nose protrusion.
  const zFeatureScale = 0.4;

  const positions = new Float32Array(lm.length * 3);
  lm.forEach((p, i) => {
    const x  =  (p.x - centerX) * scale;
    const y  = -(p.y - centerY) * yScale;

    // Sphere baseline: smooth curvature that matches the head surface
    const r2      = rFace * rFace - x * x - y * y;
    const zSphere = r2 > 0 ? Math.sqrt(r2) : 0;

    // Feature offset: adds nose bridge/tip protrusion, eye socket concavity,
    // brow ridge, jaw — the actual facial topology from the scan
    const zFeature = -p.z * zFeatureScale;

    positions[i * 3]     = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = zSphere + zFeature;
  });
  return positions;
}

// ── Build geometry ─────────────────────────────────────────────
function buildFaceGeometry(faceScanData: FaceScanData, rFace: number): THREE.BufferGeometry {
  const { landmarks, imageWidth, imageHeight } = faceScanData;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.BufferAttribute(landmarksToScene(landmarks, imageWidth, imageHeight, rFace), 3),
  );
  geo.setIndex(FacemeshDatas.TRIANGULATION as number[]);
  geo.computeVertexNormals();
  return geo;
}

// ── Component ──────────────────────────────────────────────────
interface FaceHeadProps {
  faceScanData: FaceScanData;
  /** Hemisphere projection radius — should match the head model's
   *  front face Z depth in canonical pre-scale space.
   *  Derived at runtime from the GLB bounding box in CanonicalHeadGLB. */
  rFace: number;
}

export default function FaceHead({ faceScanData, rFace }: FaceHeadProps) {
  const meshRef = useRef<THREE.Mesh>(null!);

  const geometry = useMemo(
    () => buildFaceGeometry(faceScanData, rFace),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [faceScanData, rFace],
  );

  const material = useMemo(
    () => new THREE.MeshStandardMaterial({
      color:     '#e8be9a',
      roughness: 0.82,
      metalness: 0.0,
      side:      THREE.FrontSide,
    }),
    [],
  );

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  return (
    <mesh ref={meshRef} geometry={geometry} material={material} castShadow receiveShadow />
  );
}
