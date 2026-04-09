'use client';

import { useState } from 'react';
import { UserHeadProfile, HairPreset } from '@/types';
import { HAIR_PRESETS } from '@/data/mockProfile';

interface ScanSetupProps {
  onComplete: (profile: UserHeadProfile) => void;
}

type FaceShape = 'oval' | 'round' | 'square' | 'oblong';
type HairType = 'straight' | 'wavy' | 'curly';
type HairLength = 'short' | 'medium' | 'long';

function buildProfile(
  faceShape: FaceShape,
  hairType: HairType,
  hairLength: HairLength
): UserHeadProfile {
  // Map face shape → head proportions (approximate scene units)
  const proportionMap: Record<FaceShape, { width: number; height: number }> = {
    oval:   { width: 1.0, height: 1.3 },
    round:  { width: 1.2, height: 1.1 },
    square: { width: 1.2, height: 1.2 },
    oblong: { width: 0.9, height: 1.5 },
  };

  // Map hair length → preset + params
  const presetMap: Record<HairLength, HairPreset> = {
    short:  'buzz',
    medium: 'taper_fade',
    long:   'pompadour',
  };

  const preset = presetMap[hairLength];
  const params = HAIR_PRESETS[preset];
  const { width, height } = proportionMap[faceShape];

  return {
    headProportions: { width, height, crownY: height * 0.5 },
    anchors: {
      earLeft:  [-width * 0.5, 0, 0],
      earRight: [ width * 0.5, 0, 0],
    },
    hairMeasurements: {
      crownHeight: params.topLength * 0.3,
      sideWidth:   params.sideLength * 0.2,
      backLength:  params.backLength * 0.25,
      flatness:    1 - params.messiness,
    },
    currentStyle: {
      preset,
      hairType,
      colorRGB: '#3b1f0a',
      params,
    },
  };
}

export default function ScanSetup({ onComplete }: ScanSetupProps) {
  const [faceShape, setFaceShape] = useState<FaceShape>('oval');
  const [hairType, setHairType] = useState<HairType>('straight');
  const [hairLength, setHairLength] = useState<HairLength>('medium');

  const handleStart = () => {
    onComplete(buildProfile(faceShape, hairType, hairLength));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950 bg-opacity-95">
      <div className="bg-gray-900 rounded-2xl p-8 w-full max-w-sm flex flex-col gap-6 shadow-2xl">
        <div>
          <h1 className="text-2xl font-bold text-white">ShapeUp</h1>
          <p className="text-gray-400 text-sm mt-1">Tell us about your hair to get started</p>
        </div>

        <div className="flex flex-col gap-4">
          {/* Face Shape */}
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
        </div>

        <button
          onClick={handleStart}
          className="bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl px-4 py-3 transition-colors"
        >
          Start Styling →
        </button>
      </div>
    </div>
  );
}
