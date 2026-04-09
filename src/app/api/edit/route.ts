// ============================================================
// POST /api/edit — LLM Edit Loop endpoint
//
// Body: { system: string, message: string }
// Response: LLMEditResponse JSON
//
// Wired to Gemini 1.5 Flash via Google Generative AI SDK.
//
// ETHAN: set GEMINI_API_KEY in .env.local
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

export async function POST(req: NextRequest) {
  const { system, message } = await req.json();

  if (!system || !message) {
    return NextResponse.json({ error: 'Missing system or message' }, { status: 400 });
  }

  try {
    const result = await model.generateContent({
      systemInstruction: system,
      contents: [{ role: 'user', parts: [{ text: message }] }],
      generationConfig: { maxOutputTokens: 512 },
    });

    const text = result.response.text();

    // Strip any accidental markdown fences the model might add
    const jsonText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(jsonText);

    return NextResponse.json(parsed);
  } catch (err) {
    console.error('[/api/edit]', err);
    return NextResponse.json({ error: 'LLM request failed' }, { status: 500 });
  }
}
