'use client';

import { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { HairParams, UserHeadProfile } from '@/types';
import { mockUserHeadProfile } from '@/data/mockProfile';
import EditPanel from '@/components/EditPanel';
import ScanSetup from '@/components/ScanSetup';
import FaceLiftPanel from '@/components/FaceLiftPanel';
import { useFaceLift } from '@/hooks/useFaceLift';

// Dynamically import HairScene (Three.js — no SSR)
const HairScene = dynamic(() => import('@/components/HairScene'), { ssr: false });

export default function Home() {
  const [showSetup, setShowSetup] = useState(true);
  const [profile, setProfile] = useState<UserHeadProfile>(mockUserHeadProfile);
  const [params, setParams] = useState<HairParams>(mockUserHeadProfile.currentStyle.params);
  const [editedPhotoUrl, setEditedPhotoUrl] = useState<string | null>(null);

  // Bald image is produced by /api/baldify immediately after scan.
  // FaceLift receives the bald image (not the original) for Gaussian head reconstruction.
  const [baldPhotoUrl, setBaldPhotoUrl] = useState<string | undefined>(undefined);
  const facelift = useFaceLift(baldPhotoUrl);

  const handleSetupComplete = useCallback(async (newProfile: UserHeadProfile) => {
    setProfile(newProfile);
    setParams(newProfile.currentStyle.params);
    setShowSetup(false);

    // Fire baldify in parallel with scene load — don't block the UI
    const scanImage = newProfile.faceScanData?.imageDataUrl;
    if (scanImage) {
      try {
        const res = await fetch('/api/baldify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageDataUrl: scanImage }),
        });
        const data = await res.json();
        if (data.baldImageDataUrl) {
          setBaldPhotoUrl(data.baldImageDataUrl);
        } else {
          console.error('[baldify]', data.error);
        }
      } catch (err) {
        console.error('[baldify] request failed:', err);
      }
    }
  }, []);

  const handleParamsChange = (next: HairParams) => {
    setParams(next);
    setProfile((prev) => ({
      ...prev,
      currentStyle: { ...prev.currentStyle, params: next },
    }));
  };

  return (
    <main className="flex h-screen bg-gray-950 text-white overflow-hidden">
      {showSetup && <ScanSetup onComplete={handleSetupComplete} />}

      {/* 3D Viewport */}
      <div className="flex-1 relative">
        <HairScene params={params} colorRGB={profile.currentStyle.colorRGB} profile={profile} />
        <div className="absolute top-3 left-3 text-xs text-gray-500 pointer-events-none">
          ShapeUp · drag to rotate
        </div>
      </div>

      {/* Sidebar */}
      <div className="w-72 border-l border-gray-800 flex-shrink-0">
        <EditPanel
          profile={profile}
          onParamsChange={handleParamsChange}
          onEditedPhoto={setEditedPhotoUrl}
        />
      </div>

      {/* FaceLift reconstruction panel — appears after setup, bottom-right corner */}
      {!showSetup && (
        <FaceLiftPanel status={facelift.status} jobId={facelift.jobId} />
      )}
    </main>
  );
}
