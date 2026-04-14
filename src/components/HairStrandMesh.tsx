'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { useThree } from '@react-three/fiber';
import { parsePLY } from '@/lib/parsePLY';

interface HairStrandMeshProps {
  url: string;
  color?: string;
  scale?: number;
  position?: [number, number, number];
  renderOrder?: number;
  /** Screen-space line width in pixels (default 1.8) */
  lineWidth?: number;
  /** Number of jittered clones added to fill density gaps (default 3) */
  clones?: number;
  /** Max XYZ jitter offset per clone in scene units (default 0.015) */
  jitter?: number;
}

export default function HairStrandMesh({
  url,
  color = '#3b1f0a',
  scale = 1,
  position = [0, 0, 0],
  renderOrder = 0,
  lineWidth = 1.8,
  clones = 3,
  jitter = 0.015,
}: HairStrandMeshProps) {
  const { size } = useThree();
  const [lineSegs, setLineSegs] = useState<LineSegments2 | null>(null);
  const lineSegsRef = useRef<LineSegments2 | null>(null);

  useEffect(() => {
    let cancelled = false;
    parsePLY(url).then(geo => {
      if (cancelled) { geo.dispose(); return; }

      // ── Build flat position pairs for LineSegmentsGeometry ──────────────
      // parsePLY returns a BufferGeometry with position + index (edge pairs).
      // LineSegmentsGeometry.setPositions wants [x1,y1,z1, x2,y2,z2, ...].
      const posAttr = geo.attributes.position as THREE.BufferAttribute;
      const indexAttr = geo.getIndex()!;
      const edgeCount = indexAttr.count / 2;

      // Collect base segment pairs
      const baseSegments: number[] = [];
      for (let i = 0; i < edgeCount; i++) {
        const a = indexAttr.getX(i * 2);
        const b = indexAttr.getX(i * 2 + 1);
        baseSegments.push(
          posAttr.getX(a), posAttr.getY(a), posAttr.getZ(a),
          posAttr.getX(b), posAttr.getY(b), posAttr.getZ(b),
        );
      }

      // ── Clone with jitter to fill density gaps ──────────────────────────
      const allSegments = [...baseSegments];
      for (let c = 0; c < clones; c++) {
        const dx = (Math.random() - 0.5) * 2 * jitter;
        const dy = (Math.random() - 0.5) * 2 * jitter;
        const dz = (Math.random() - 0.5) * 2 * jitter;
        for (let i = 0; i < baseSegments.length; i += 3) {
          allSegments.push(
            baseSegments[i]     + dx,
            baseSegments[i + 1] + dy,
            baseSegments[i + 2] + dz,
          );
        }
      }

      const lsGeo = new LineSegmentsGeometry();
      lsGeo.setPositions(allSegments);

      const mat = new LineMaterial({
        color: new THREE.Color(color).getHex(),
        linewidth: lineWidth,
        resolution: new THREE.Vector2(size.width, size.height),
      });

      const ls = new LineSegments2(lsGeo, mat);
      ls.scale.set(scale, scale, scale);
      ls.position.set(...position);
      ls.renderOrder = renderOrder;

      lineSegsRef.current = ls;
      geo.dispose();
      setLineSegs(ls);
    });
    return () => {
      cancelled = true;
      if (lineSegsRef.current) {
        lineSegsRef.current.geometry.dispose();
        (lineSegsRef.current.material as LineMaterial).dispose();
        lineSegsRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, clones, jitter]);

  // Keep resolution in sync when canvas resizes
  useEffect(() => {
    if (!lineSegsRef.current) return;
    (lineSegsRef.current.material as LineMaterial).resolution.set(size.width, size.height);
  }, [size]);

  // Update color/lineWidth without rebuilding geometry
  useEffect(() => {
    if (!lineSegsRef.current) return;
    const mat = lineSegsRef.current.material as LineMaterial;
    mat.color.set(color);
    mat.linewidth = lineWidth;
  }, [color, lineWidth]);

  if (!lineSegs) return null;

  return <primitive object={lineSegs} />;
}
