'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { UserHeadProfile, HairPreset } from '@/types';
import { HAIR_PRESETS } from '@/data/mockProfile';

// ScanCamera must be client-only (MediaPipe uses browser APIs)
const ScanCamera = dynamic(() => import('./ScanCamera'), { ssr: false });

interface ScanSetupProps {
  onComplete: (profile: UserHeadProfile) => void;
}

type HairType   = 'straight' | 'wavy' | 'curly';
type HairLength = 'short' | 'medium' | 'long';
type FaceShape  = 'oval' | 'round' | 'square' | 'oblong';

type CameraState = 'requesting' | 'granted' | 'denied' | 'scan_complete';

// ── Fallback profile builder (no camera) ─────────────────────

const presetMap: Record<HairLength, HairPreset> = {
  short:  'buzz',
  medium: 'taper_fade',
  long:   'pompadour',
};

const proportionMap: Record<FaceShape, { width: number; height: number }> = {
  oval:   { width: 1.0, height: 1.3 },
  round:  { width: 1.2, height: 1.1 },
  square: { width: 1.2, height: 1.2 },
  oblong: { width: 0.9, height: 1.5 },
};

function buildFallbackProfile(
  faceShape: FaceShape,
  hairType: HairType,
  hairLength: HairLength
): UserHeadProfile {
  const preset  = presetMap[hairLength];
  const params  = HAIR_PRESETS[preset];
  const { width, height } = proportionMap[faceShape];
  const crownY  = height * 0.5;

  return {
    headProportions: { width, height, crownY },
    anchors: {
      earLeft:  [-width * 0.53, 0, 0],
      earRight: [ width * 0.53, 0, 0],
    },
    hairMeasurements: {
      crownHeight: params.topLength  * 0.3,
      sideWidth:   params.sideLength * 0.2,
      backLength:  params.backLength * 0.25,
      flatness:    1 - params.messiness,
    },
    currentStyle: { preset, hairType, colorRGB: '#3b1f0a', params },
  };
}

// ── Merge scan profile with form answers ──────────────────────

function mergeProfile(
  scanned: UserHeadProfile,
  hairType: HairType,
  hairLength: HairLength
): UserHeadProfile {
  const preset = presetMap[hairLength];
  const params = HAIR_PRESETS[preset];
  return {
    // Keep the real head geometry from MediaPipe
    headProportions: scanned.headProportions,
    anchors:         scanned.anchors,
    hairMeasurements: scanned.hairMeasurements,
    faceScanData:    scanned.faceScanData,
    // Overlay style choices from the form
    currentStyle: { preset, hairType, colorRGB: '#3b1f0a', params },
  };
}

// ── Component ─────────────────────────────────────────────────

export default function ScanSetup({ onComplete }: ScanSetupProps) {
  const [hairType,   setHairType]   = useState<HairType>('straight');
  const [hairLength, setHairLength] = useState<HairLength>('medium');
  const [faceShape,  setFaceShape]  = useState<FaceShape>('oval');

  const [cameraState, setCameraState]     = useState<CameraState>('requesting');
  const [scannedProfile, setScannedProfile] = useState<UserHeadProfile | null>(null);
  const [waitingForScan, setWaitingForScan] = useState(false);

  // ── Request camera permission immediately ─────────────────

  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: false })
      .then(() => setCameraState('granted'))
      .catch(() => setCameraState('denied'));
  }, []);

  // ── Handlers ──────────────────────────────────────────────

  function handleScanComplete(profile: UserHeadProfile) {
    setScannedProfile(profile);
    setCameraState('scan_complete');
    if (waitingForScan) {
      // User already clicked "Start Styling" — finish now
      onComplete(mergeProfile(profile, hairType, hairLength));
    }
  }

  function handleStart() {
    if (cameraState === 'scan_complete' && scannedProfile) {
      onComplete(mergeProfile(scannedProfile, hairType, hairLength));
    } else if (cameraState === 'denied') {
      onComplete(buildFallbackProfile(faceShape, hairType, hairLength));
    } else {
      // Scan still running — flag to complete as soon as it's done
      setWaitingForScan(true);
    }
  }

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950 bg-opacity-95">
      <div className="bg-gray-900 rounded-2xl p-8 w-full max-w-md flex flex-col gap-6 shadow-2xl">

        <div>
          <h1 className="text-2xl font-bold text-white">ShapeUp</h1>
          <p className="text-gray-400 text-sm mt-1">Scan your face to get started</p>
        </div>

        {/* Camera — shown prominently at top when granted */}
        {(cameraState === 'granted' || cameraState === 'scan_complete') && (
          <ScanCamera
            hairType={hairType}
            onScanComplete={handleScanComplete}
            onDismiss={() => setCameraState('denied')}
          />
        )}

        {/* Requesting state */}
        {cameraState === 'requesting' && (
          <div className="w-full rounded-2xl bg-gray-800 flex items-center justify-center text-gray-400 text-sm" style={{ aspectRatio: '1/1' }}>
            Requesting camera…
          </div>
        )}

        {/* Form questions */}
        <div className="flex flex-col gap-4">

          {/* Hair Type */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400 uppercase tracking-widest">Hair Type</label>
            <div className="flex gap-2">
              {(['straight', 'wavy', 'curly'] as HairType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setHairType(t)}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm capitalize transition-colors ${
                    hairType === t
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Current Length */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400 uppercase tracking-widest">Current Length</label>
            <div className="flex gap-2">
              {(['short', 'medium', 'long'] as HairLength[]).map((l) => (
                <button
                  key={l}
                  onClick={() => setHairLength(l)}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm capitalize transition-colors ${
                    hairLength === l
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Face Shape — only shown when camera is denied */}
          {cameraState === 'denied' && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400 uppercase tracking-widest">Face Shape</label>
              <select
                value={faceShape}
                onChange={(e) => setFaceShape(e.target.value as FaceShape)}
                className="bg-gray-800 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="oval">Oval</option>
                <option value="round">Round</option>
                <option value="square">Square</option>
                <option value="oblong">Oblong</option>
              </select>
            </div>
          )}
        </div>

        <button
          onClick={handleStart}
          className="bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl px-4 py-3 transition-colors"
        >
          {waitingForScan
            ? 'Analyzing…'
            : cameraState === 'scan_complete'
            ? 'Start Styling →'
            : cameraState === 'denied'
            ? 'Start Styling →'
            : 'Start Styling →'}
        </button>
      </div>
    </div>
  );
}
