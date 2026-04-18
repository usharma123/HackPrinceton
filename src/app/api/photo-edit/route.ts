// ============================================================
// POST /api/photo-edit — Gemini hair photo editor
//
// Body: { prompt: string, imageDataUrl: string }
//   imageDataUrl: base64 data URL of the original scan photo
//
// Saves original to public/scans/original.png, sends it to
// Gemini 2.0 Flash image generation with a hair-only edit
// instruction, saves the result to public/scans/edited.png,
// and returns the edited image as a base64 data URL.
//
// Requires GEMINI_API_KEY in .env.local
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

const GEMINI_IMAGE_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent';

const SCANS_DIR = path.join(process.cwd(), 'public', 'scans');

function stripDataUrlPrefix(dataUrl: string): { base64: string; mimeType: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('Invalid data URL format');
  return { mimeType: match[1], base64: match[2] };
}

export async function POST(req: NextRequest) {
  const { prompt, imageDataUrl } = await req.json();

  if (!prompt || !imageDataUrl) {
    return NextResponse.json({ error: 'Missing prompt or imageDataUrl' }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });
  }

  let base64: string;
  let mimeType: string;
  try {
    ({ base64, mimeType } = stripDataUrlPrefix(imageDataUrl));
  } catch {
    return NextResponse.json({ error: 'Invalid imageDataUrl' }, { status: 400 });
  }

  // Save original scan to public/scans/original.png for reference and HairStep input
  try {
    await mkdir(SCANS_DIR, { recursive: true });
    await writeFile(
      path.join(SCANS_DIR, 'original.png'),
      Buffer.from(base64, 'base64')
    );
  } catch (err) {
    console.error('[photo-edit] Failed to save original:', err);
  }

  const editInstruction = [
    'Edit this portrait photo.',
    'STRICT CONSTRAINTS — do not violate these:',
    '  • Preserve the exact head shape, size, and position in frame.',
    '  • Preserve all facial landmark positions (eyes, nose, mouth, ears, jawline).',
    '  • Preserve skin tone, face texture, background, lighting, and clothing.',
    '  • Do NOT alter anything outside the hair region.',
    'ONLY change the hair to match this description:',
    prompt,
  ].join('\n');

  try {
    const geminiRes = await fetch(`${GEMINI_IMAGE_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inlineData: { mimeType, data: base64 } },
              { text: editInstruction },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
        },
      }),
    });

    if (!geminiRes.ok) {
      const err = await geminiRes.text();
      console.error('[photo-edit] Gemini error:', err);
      return NextResponse.json({ error: 'Gemini request failed', detail: err }, { status: 500 });
    }

    const data = await geminiRes.json();

    // Extract the image part from the response
    const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> =
      data.candidates?.[0]?.content?.parts ?? [];

    const imagePart = parts.find((p) => p.inlineData?.data);
    if (!imagePart?.inlineData) {
      console.error('[photo-edit] No image in Gemini response:', JSON.stringify(data));
      return NextResponse.json({ error: 'Gemini returned no image' }, { status: 500 });
    }

    const { data: editedBase64, mimeType: editedMime } = imagePart.inlineData;
    const editedDataUrl = `data:${editedMime};base64,${editedBase64}`;

    // Save edited image to public/scans/edited.png for HairStep input
    try {
      await writeFile(
        path.join(SCANS_DIR, 'edited.png'),
        Buffer.from(editedBase64, 'base64')
      );
    } catch (err) {
      console.error('[photo-edit] Failed to save edited image:', err);
    }

    return NextResponse.json({ editedImageDataUrl: editedDataUrl });
  } catch (err) {
    console.error('[photo-edit]', err);
    return NextResponse.json({ error: 'Photo edit failed' }, { status: 500 });
  }
}
