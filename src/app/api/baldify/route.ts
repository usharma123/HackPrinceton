// POST /api/baldify — Gemini bald-ify for scan phase
//
// Body: { imageDataUrl: string }
//
// Saves original scan to public/scans/original.png, sends to Gemini
// to remove all scalp hair, saves result to public/scans/bald.png,
// returns { baldImageDataUrl }.
//
// The bald image is the input to FaceLift (Gaussian head reconstruction).
// Requires GEMINI_API_KEY in .env.local

import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

const GEMINI_IMAGE_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent';

const SCANS_DIR = path.join(process.cwd(), 'public', 'scans');

const BALD_PROMPT = `Remove all scalp hair from this person so they appear completely bald.

Render the scalp as smooth, natural skin — matching the exact skin tone, \
texture, and lighting of the face. Preserve the natural skull contour \
implied by the existing hairline and head shape.

Do NOT change anything else. Keep identical:
- facial features, expression, and proportions
- skin tone and texture on the face
- eyebrows and any facial hair (beard, stubble, mustache)
- ears, neck, shoulders
- pose, camera angle, framing
- lighting direction, shadows, and color grading
- background

Output must be photorealistic. No stylization, no hats, no head coverings, \
no added hair. Match the original photo's resolution and quality.`;

function stripDataUrlPrefix(dataUrl: string): { base64: string; mimeType: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('Invalid data URL format');
  return { mimeType: match[1], base64: match[2] };
}

export async function POST(req: NextRequest) {
  const { imageDataUrl } = await req.json();

  if (!imageDataUrl) {
    return NextResponse.json({ error: 'Missing imageDataUrl' }, { status: 400 });
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

  // Save original scan — canonical source of truth for this session
  try {
    await mkdir(SCANS_DIR, { recursive: true });
    await writeFile(path.join(SCANS_DIR, 'original.png'), Buffer.from(base64, 'base64'));
  } catch (err) {
    console.error('[baldify] Failed to save original:', err);
  }

  try {
    const geminiRes = await fetch(`${GEMINI_IMAGE_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inlineData: { mimeType, data: base64 } },
              { text: BALD_PROMPT },
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
      console.error('[baldify] Gemini error:', err);
      return NextResponse.json({ error: 'Gemini request failed', detail: err }, { status: 500 });
    }

    const data = await geminiRes.json();

    const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> =
      data.candidates?.[0]?.content?.parts ?? [];

    const imagePart = parts.find((p) => p.inlineData?.data);
    if (!imagePart?.inlineData) {
      console.error('[baldify] No image in Gemini response:', JSON.stringify(data));
      return NextResponse.json({ error: 'Gemini returned no image' }, { status: 500 });
    }

    const { data: baldBase64, mimeType: baldMime } = imagePart.inlineData;
    const baldDataUrl = `data:${baldMime};base64,${baldBase64}`;

    // Save bald image — input for FaceLift Gaussian reconstruction
    try {
      await writeFile(path.join(SCANS_DIR, 'bald.png'), Buffer.from(baldBase64, 'base64'));
    } catch (err) {
      console.error('[baldify] Failed to save bald image:', err);
    }

    return NextResponse.json({ baldImageDataUrl: baldDataUrl });
  } catch (err) {
    console.error('[baldify]', err);
    return NextResponse.json({ error: 'Baldify failed' }, { status: 500 });
  }
}
