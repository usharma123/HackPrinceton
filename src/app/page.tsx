'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { HairParams } from '@/types';
import { mockUserHeadProfile } from '@/data/mockProfile';
import EditPanel from '@/components/EditPanel';

// Dynamically import HairScene (Three.js — no SSR)
const HairScene = dynamic(() => import('@/components/HairScene'), { ssr: false });

export default function Home() {
  const [params, setParams] = useState<HairParams>(
    mockUserHeadProfile.currentStyle.params
  );

  // Keep a mutable profile reference so useLLM always gets current params
  const [profile, setProfile] = useState(mockUserHeadProfile);

  const handleParamsChange = (next: HairParams) => {
    setParams(next);
    setProfile((prev) => ({
      ...prev,
      currentStyle: { ...prev.currentStyle, params: next },
    }));
  };

  return (
    <main className="flex h-screen bg-gray-950 text-white overflow-hidden">
      {/* 3D Viewport */}
      <div className="flex-1 relative">
        <HairScene params={params} colorRGB={profile.currentStyle.colorRGB} />
        <div className="absolute top-3 left-3 text-xs text-gray-500 pointer-events-none">
          ShapeUp · drag to rotate
        </div>
      </div>

      {/* Sidebar */}
      <div className="w-72 border-l border-gray-800 flex-shrink-0">
        <EditPanel profile={profile} onParamsChange={handleParamsChange} />
      </div>
    </main>
  );
}
