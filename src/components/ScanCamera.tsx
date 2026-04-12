'use client';

// ============================================================
// ScanCamera — MediaPipe FaceMesh + SelfieSegmentation
//
// Loads MediaPipe via CDN script injection (avoids Next.js/webpack
// WASM issues). Runs both models on each video frame, collects
// 15 stable frames, averages them, then calls onScanComplete.
//
// Must be dynamically imported with ssr:false at the call site.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { UserHeadProfile } from '@/types';
import { mediapipeToProfile, averageProfiles, FRAMES_TO_COLLECT } from '@/lib/mediapipeToProfile';

interface ScanCameraProps {
  hairType: 'straight' | 'wavy' | 'curly';
  onScanComplete: (profile: UserHeadProfile) => void;
  onDismiss: () => void;
}

const CDN_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe';

const SCRIPTS = [
  `${CDN_BASE}/face_mesh/face_mesh.js`,
  `${CDN_BASE}/selfie_segmentation/selfie_segmentation.js`,
];

export default function ScanCamera({ hairType, onScanComplete, onDismiss }: ScanCameraProps) {
  const videoRef   = useRef<HTMLVideoElement>(null);
  const maskCanvas = useRef<HTMLCanvasElement>(null); // hidden, for mask readback
  const previewCanvas = useRef<HTMLCanvasElement>(null); // visible preview with overlay

  const latestLandmarks = useRef<Array<{ x: number; y: number; z: number }> | null>(null);
  const latestMask      = useRef<ImageData | null>(null);
  const collectedProfiles = useRef<UserHeadProfile[]>([]);
  const animFrameId     = useRef<number | null>(null);
  const faceMeshRef     = useRef<MediaPipeFaceMesh | null>(null);
  const segRef          = useRef<MediaPipeSelfieSegmentation | null>(null);
  const scanningRef     = useRef(false);

  const [status, setStatus]   = useState<'loading' | 'ready' | 'scanning' | 'done' | 'error'>('loading');
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');

  // ── Load MediaPipe scripts from CDN ──────────────────────

  useEffect(() => {
    let loaded = 0;

    function onAllLoaded() {
      startCamera();
    }

    SCRIPTS.forEach((src) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        loaded++;
        if (loaded === SCRIPTS.length) onAllLoaded();
        return;
      }
      const el = document.createElement('script');
      el.src = src;
      el.crossOrigin = 'anonymous';
      el.onload = () => {
        loaded++;
        if (loaded === SCRIPTS.length) onAllLoaded();
      };
      el.onerror = () => {
        setStatus('error');
        setErrorMsg('Failed to load MediaPipe. Check your connection.');
      };
      document.head.appendChild(el);
    });

    return () => {
      scanningRef.current = false;
      if (animFrameId.current) cancelAnimationFrame(animFrameId.current);
      faceMeshRef.current?.close();
      segRef.current?.close();
      // Stop camera stream
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  // ── Start camera stream ───────────────────────────────────

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 480 },
        audio: false,
      });
      const video = videoRef.current!;
      video.srcObject = stream;
      video.setAttribute('playsinline', ''); // required for iOS Safari
      await video.play();
      initMediaPipe();
    } catch {
      setStatus('error');
      setErrorMsg('Camera access denied.');
    }
  }

  // ── Init MediaPipe models ─────────────────────────────────

  function initMediaPipe() {
    const FaceMesh          = window.FaceMesh;
    const SelfieSegmentation = window.SelfieSegmentation;

    if (!FaceMesh || !SelfieSegmentation) {
      setStatus('error');
      setErrorMsg('MediaPipe not available.');
      return;
    }

    const faceMesh = new FaceMesh({
      locateFile: (f) => `${CDN_BASE}/face_mesh/${f}`,
    });
    faceMesh.setOptions({
      maxNumFaces:            1,
      refineLandmarks:        true,
      minDetectionConfidence: 0.7,
      minTrackingConfidence:  0.7,
    });
    faceMesh.onResults((results) => {
      if (results.multiFaceLandmarks?.[0]) {
        latestLandmarks.current = results.multiFaceLandmarks[0];
      }
    });
    faceMeshRef.current = faceMesh;

    const seg = new SelfieSegmentation({
      locateFile: (f) => `${CDN_BASE}/selfie_segmentation/${f}`,
    });
    seg.setOptions({ modelSelection: 1 });
    seg.onResults((results) => {
      const canvas = maskCanvas.current;
      if (!canvas || !results.segmentationMask) return;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(results.segmentationMask as CanvasImageSource, 0, 0, 640, 480);
      latestMask.current = ctx.getImageData(0, 0, 640, 480);
    });
    segRef.current = seg;

    setStatus('ready');
  }

  // ── Per-frame processing loop ─────────────────────────────

  async function processFrame() {
    if (!scanningRef.current) return;
    const video = videoRef.current;
    if (!video || video.readyState < 2) {
      animFrameId.current = requestAnimationFrame(processFrame);
      return;
    }

    try {
      await faceMeshRef.current?.send({ image: video });
      await segRef.current?.send({ image: video });
    } catch {
      // Model not warmed up yet; skip frame silently
    }

    // Collect frame if both models have results
    if (latestLandmarks.current && latestMask.current && scanningRef.current) {
      try {
        const profile = mediapipeToProfile({
          landmarks:         latestLandmarks.current,
          segmentationMask:  latestMask.current,
          hairType,
          imageWidth:        640,
          imageHeight:       480,
        });
        collectedProfiles.current.push(profile);
        const prog = collectedProfiles.current.length / FRAMES_TO_COLLECT;
        setProgress(prog);

        if (collectedProfiles.current.length >= FRAMES_TO_COLLECT) {
          scanningRef.current = false;
          setStatus('done');
          const final = averageProfiles(collectedProfiles.current);
          onScanComplete(final);
          return;
        }
      } catch {
        // Bad landmark data; skip frame
      }
    }

    // Draw mirrored preview with scan overlay
    drawPreview();

    animFrameId.current = requestAnimationFrame(processFrame);
  }

  function drawPreview() {
    const video  = videoRef.current;
    const canvas = previewCanvas.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext('2d')!;
    // Mirror the feed
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    // Scan progress arc
    if (scanningRef.current) {
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const r  = Math.min(cx, cy) * 0.85;
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + progress * 2 * Math.PI);
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth   = 4;
      ctx.stroke();
    }
  }

  function startScan() {
    collectedProfiles.current = [];
    latestLandmarks.current   = null;
    latestMask.current        = null;
    scanningRef.current       = true;
    setProgress(0);
    setStatus('scanning');
    animFrameId.current = requestAnimationFrame(processFrame);
  }

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Hidden elements */}
      <video ref={videoRef} className="hidden" muted playsInline />
      <canvas ref={maskCanvas} width={640} height={480} className="hidden" />

      {/* Visible preview */}
      <div className="relative w-64 h-48 rounded-xl overflow-hidden bg-gray-800">
        <canvas
          ref={previewCanvas}
          width={640}
          height={480}
          className="w-full h-full object-cover"
        />
        {status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400">
            Loading camera…
          </div>
        )}
        {status === 'scanning' && (
          <div className="absolute bottom-2 left-0 right-0 text-center text-xs text-blue-300">
            Hold still… {Math.round(progress * 100)}%
          </div>
        )}
        {status === 'done' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-60 text-green-400 font-semibold text-sm">
            Scan complete
          </div>
        )}
      </div>

      {status === 'error' && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-red-400 text-xs text-center">{errorMsg}</p>
          <button
            onClick={onDismiss}
            className="text-xs text-gray-400 underline"
          >
            Skip camera scan
          </button>
        </div>
      )}

      {status === 'ready' && (
        <button
          onClick={startScan}
          className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg px-5 py-2 transition-colors"
        >
          Scan Face
        </button>
      )}

      {status === 'loading' && (
        <button
          onClick={onDismiss}
          className="text-xs text-gray-500 underline"
        >
          Skip camera scan
        </button>
      )}
    </div>
  );
}
