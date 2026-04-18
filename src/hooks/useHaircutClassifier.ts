import { useCallback, useState } from 'react';

export type HaircutTopK = [string, number][];

export interface HaircutResult {
  top1_style_id: string;
  top1_confidence: number;
  topk: HaircutTopK;
}

export type HaircutClassifierStatus = 'idle' | 'loading' | 'done' | 'error';

export interface HaircutClassifierState {
  status: HaircutClassifierStatus;
  result: HaircutResult | null;
  error: string | null;
}

export function useHaircutClassifier() {
  const [state, setState] = useState<HaircutClassifierState>({
    status: 'idle',
    result: null,
    error: null,
  });

  const classifyImage = useCallback(async (imageDataUrl: string) => {
    setState({ status: 'loading', result: null, error: null });
    try {
      const res = await fetch('/api/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageDataUrl }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as HaircutResult;
      setState({ status: 'done', result: data, error: null });
      return data;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setState({ status: 'error', result: null, error: msg });
      throw e;
    }
  }, []);

  const classifyText = useCallback(async (prompt: string) => {
    setState({ status: 'loading', result: null, error: null });
    try {
      const res = await fetch('/api/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as HaircutResult;
      setState({ status: 'done', result: data, error: null });
      return data;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setState({ status: 'error', result: null, error: msg });
      throw e;
    }
  }, []);

  const reset = useCallback(() => {
    setState({ status: 'idle', result: null, error: null });
  }, []);

  return { ...state, classifyImage, classifyText, reset };
}
