import { describe, expect, it, vi, afterEach } from 'vitest';
import { streamRetry } from './stream-retry';

function streamFrom(text: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      c.enqueue(enc.encode(text));
      c.close();
    },
  });
}

afterEach(() => vi.restoreAllMocks());

describe('streamRetry', () => {
  it('200 → itera eventos do parseReflectStream (metadata + text)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(streamFrom('{"reflection_id":"r9"}\nOlá'), { status: 200 }),
    );
    const result = await streamRetry('r9');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const events = [];
    for await (const e of result.events) events.push(e);
    expect(events[0]).toEqual({ type: 'metadata', reflection_id: 'r9' });
    expect(events.some((e) => e.type === 'text' && e.chunk.includes('Olá'))).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/reflect/r9/retry', { method: 'POST' });
  });

  it('401 → { ok:false, code:"auth" }', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }));
    const r = await streamRetry('r9');
    expect(r).toEqual({ ok: false, code: 'auth' });
  });

  it('409 → { ok:false, code:"already_answered" }', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 409 }));
    const r = await streamRetry('r9');
    expect(r).toEqual({ ok: false, code: 'already_answered' });
  });

  it('rede cai → { ok:false, code:"network" }', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('net'));
    const r = await streamRetry('r9');
    expect(r).toEqual({ ok: false, code: 'network' });
  });
});
