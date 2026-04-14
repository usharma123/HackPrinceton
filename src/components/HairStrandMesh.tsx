'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { useThree } from '@react-three/fiber';
import { parsePLY } from '@/lib/parsePLY';

interface HairStrandMeshProps {
  url: string;
  color?: string;
  scale?: number;
  position?: [number, number, number];
  renderOrder?: number;
  lineWidth?: number;
}

interface HairData {
  lineSegs: LineSegments2;
  capGeo: THREE.BufferGeometry;
}

export default function HairStrandMesh({
  url,
  color = '#3b1f0a',
  scale = 1,
  position = [0, 0, 0],
  renderOrder = 0,
  lineWidth = 1.2,
}: HairStrandMeshProps) {
  const { size } = useThree();
  const [hairData, setHairData] = useState<HairData | null>(null);
  const hairDataRef = useRef<HairData | null>(null);

  useEffect(() => {
    let cancelled = false;
    parsePLY(url).then(geo => {
      if (cancelled) { geo.dispose(); return; }

      const posAttr = geo.attributes.position as THREE.BufferAttribute;
      const indexAttr = geo.getIndex()!;
      const edgeCount = indexAttr.count / 2;
      const vertexCount = posAttr.count;

      // ── Strand lines ────────────────────────────────────────────────────────
      const segments: number[] = [];
      for (let i = 0; i < edgeCount; i++) {
        const a = indexAttr.getX(i * 2);
        const b = indexAttr.getX(i * 2 + 1);
        segments.push(
          posAttr.getX(a), posAttr.getY(a), posAttr.getZ(a),
          posAttr.getX(b), posAttr.getY(b), posAttr.getZ(b),
        );
      }

      const lsGeo = new LineSegmentsGeometry();
      lsGeo.setPositions(segments);

      const mat = new LineMaterial({
        color: new THREE.Color(color).getHex(),
        linewidth: lineWidth,
        resolution: new THREE.Vector2(size.width, size.height),
      });

      const ls = new LineSegments2(lsGeo, mat);
      ls.scale.set(scale, scale, scale);
      ls.position.set(...position);
      ls.renderOrder = renderOrder;

      // ── Convex hull cap ──────────────────────────────────────────────────────
      // Exclude the frontmost vertices (curtain bangs) from the hull — they span
      // the full width at high Z and cause the hull to cover the face.
      // Only use vertices in the back 60% of the Z range.
      let minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < vertexCount; i++) {
        const z = posAttr.getZ(i);
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
      const zCutoff = minZ + (maxZ - minZ) * 0.6;

      const points: THREE.Vector3[] = [];
      for (let i = 0; i < vertexCount; i += 4) {
        if (posAttr.getZ(i) > zCutoff) continue;
        points.push(new THREE.Vector3(
          posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i),
        ));
      }
      const capGeo = new ConvexGeometry(points);

      geo.dispose();

      const data: HairData = { lineSegs: ls, capGeo };
      hairDataRef.current = data;
      setHairData(data);
    });
    return () => {
      cancelled = true;
      if (hairDataRef.current) {
        hairDataRef.current.lineSegs.geometry.dispose();
        (hairDataRef.current.lineSegs.material as LineMaterial).dispose();
        hairDataRef.current.capGeo.dispose();
        hairDataRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Keep resolution in sync when canvas resizes
  useEffect(() => {
    if (!hairDataRef.current) return;
    (hairDataRef.current.lineSegs.material as LineMaterial).resolution.set(size.width, size.height);
  }, [size]);

  // Update color/lineWidth without rebuilding geometry
  useEffect(() => {
    if (!hairDataRef.current) return;
    const mat = hairDataRef.current.lineSegs.material as LineMaterial;
    mat.color.set(color);
    mat.linewidth = lineWidth;
  }, [color, lineWidth]);

  if (!hairData) return null;

  return (
    <>
      {/* Solid convex hull cap — fills the interior, renders behind strands */}
      <mesh
        geometry={hairData.capGeo}
        scale={[scale, scale, scale]}
        position={position}
        renderOrder={renderOrder - 1}
      >
        <meshStandardMaterial color={color} roughness={0.9} metalness={0.0} />
      </mesh>

      {/* Strand lines on top */}
      <primitive object={hairData.lineSegs} />
    </>
  );
}
