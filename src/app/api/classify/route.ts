// POST { imageDataUrl: string } | { prompt: string }
// -> { top1_style_id: string, top1_confidence: number, topk: [string, number][] }
//
// Proxies the Python haircut-classifier service (see haircut-classifier/).
// Set CLASSIFIER_URL in .env.local. Defaults to http://localhost:5003 for dev.

import { NextRequest, NextResponse } from 'next/server';

const CLASSIFIER_URL = process.env.CLASSIFIER_URL ?? 'http://localhost:5003';

type ClassifierResponse = {
  top1_style_id: string;
  top1_confidence: number;
  topk: [string, number][];
};

export async function POST(req: NextRequest) {
  const body = await req.json();

  if (typeof body?.prompt === 'string') {
    const upstream = await fetch(`${CLASSIFIER_URL}/classify/text`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
      },
      body: JSON.stringify({ prompt: body.prompt }),
    });
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Classifier error: ${await upstream.text().catch(() => '')}` },
        { status: 502 },
      );
    }
    return NextResponse.json((await upstream.json()) as ClassifierResponse);
  }

  if (typeof body?.imageDataUrl === 'string' && body.imageDataUrl.startsWith('data:image')) {
    const base64 = body.imageDataUrl.split(',')[1];
    const buffer = Buffer.from(base64, 'base64');
    const blob = new Blob([buffer], { type: 'image/jpeg' });
    const form = new FormData();
    form.append('image', blob, 'upload.jpg');

    const upstream = await fetch(`${CLASSIFIER_URL}/classify/image`, {
      method: 'POST',
      headers: { 'ngrok-skip-browser-warning': 'true' },
      body: form,
    });
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Classifier error: ${await upstream.text().catch(() => '')}` },
        { status: 502 },
      );
    }
    return NextResponse.json((await upstream.json()) as ClassifierResponse);
  }

  return NextResponse.json(
    { error: 'Send { prompt } for text or { imageDataUrl } for image classification' },
    { status: 400 },
  );
}

export async function GET() {
  const upstream = await fetch(`${CLASSIFIER_URL}/taxonomy`, {
    headers: { 'ngrok-skip-browser-warning': 'true' },
  });
  if (!upstream.ok) {
    return NextResponse.json({ error: 'Taxonomy unavailable' }, { status: 502 });
  }
  return NextResponse.json(await upstream.json());
}
