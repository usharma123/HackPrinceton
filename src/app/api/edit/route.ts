// ============================================================
// POST /api/edit — LLM Edit Loop endpoint
//
// Body: { system: string, message: string }
// Response: LLMEditResponse JSON
//
// Currently wired to Claude claude-haiku-4-5 via Anthropic SDK.
// Swap the model string for Gemini/GPT-4o-mini if preferred.
//
// ETHAN: set ANTHROPIC_API_KEY in .env.local
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(req: NextRequest) {
  const { system, message } = await req.json();

  if (!system || !message) {
    return NextResponse.json({ error: 'Missing system or message' }, { status: 400 });
  }

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system,
      messages: [{ role: 'user', content: message }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';

    // Strip any accidental markdown fences the model might add
    const jsonText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(jsonText);

    return NextResponse.json(parsed);
  } catch (err) {
    console.error('[/api/edit]', err);
    return NextResponse.json({ error: 'LLM request failed' }, { status: 500 });
  }
}
