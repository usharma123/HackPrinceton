'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { parsePLY } from '@/lib/parsePLY';

interface HairStrandMeshProps {
  url: string;
  color?: string;
  scale?: number;
  position?: [number, number, number];
  renderOrder?: number;
}

export default function HairStrandMesh({
  url,
  color = '#3b1f0a',
  scale = 1,
  position = [0, 0, 0],
  renderOrder = 0,
}: HairStrandMeshProps) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const geoRef = useRef<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    let cancelled = false;
    parsePLY(url).then(geo => {
      if (cancelled) { geo.dispose(); return; }
      geoRef.current = geo;
      setGeometry(geo);
    });
    return () => {
      cancelled = true;
      geoRef.current?.dispose();
    };
  }, [url]);

  if (!geometry) return null;

  return (
    <lineSegments
      geometry={geometry}
      scale={[scale, scale, scale]}
      position={position}
      renderOrder={renderOrder}
    >
      <lineBasicMaterial color={color} />
    </lineSegments>
  );
}
