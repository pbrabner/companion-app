import { describe, it, expect } from 'vitest';
import { parseReflectStream } from './parse-stream';

function makeReader(chunks: string[]) {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    read: async () => {
      if (i >= chunks.length) return { done: true, value: undefined };
      return { done: false, value: encoder.encode(chunks[i++]) };
    },
  } as ReadableStreamDefaultReader<Uint8Array>;
}

async function collect<T>(g: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of g) out.push(v);
  return out;
}

describe('parseReflectStream', () => {
  it('extracts metadata from first line', async () => {
    const reader = makeReader(['{"reflection_id":"abc-123"}\n', 'Hello world']);
    const events = await collect(parseReflectStream(reader));
    expect(events[0]).toEqual({ type: 'metadata', reflection_id: 'abc-123' });
    const text = events.filter((e) => e.type === 'text').map((e: any) => e.chunk).join('');
    expect(text).toBe('Hello world');
  });

  it('handles metadata + text split across chunks', async () => {
    const reader = makeReader(['{"reflection_id":"x"', '}\nfoo', 'bar']);
    const events = await collect(parseReflectStream(reader));
    expect(events[0]).toEqual({ type: 'metadata', reflection_id: 'x' });
    const text = events.filter((e) => e.type === 'text').map((e: any) => e.chunk).join('');
    expect(text).toBe('foobar');
  });

  it('emits text chunks as they arrive', async () => {
    const reader = makeReader(['{"reflection_id":"x"}\n', 'one ', 'two ', 'three']);
    const events = await collect(parseReflectStream(reader));
    const texts = events.filter((e) => e.type === 'text').map((e: any) => e.chunk);
    expect(texts.join('')).toBe('one two three');
    expect(texts.length).toBeGreaterThanOrEqual(2);
  });

  it('detects tail error JSON', async () => {
    const reader = makeReader([
      '{"reflection_id":"x"}\n',
      'partial response',
      '\n{"error":"ai_unavailable","reflection_id":"x"}\n',
    ]);
    const events = await collect(parseReflectStream(reader));
    const last = events[events.length - 1];
    expect(last).toEqual({ type: 'error', code: 'ai_unavailable', reflection_id: 'x' });
  });

  it('treats malformed metadata gracefully (no metadata event)', async () => {
    const reader = makeReader(['not json\n', 'rest']);
    const events = await collect(parseReflectStream(reader));
    expect(events.some((e) => e.type === 'metadata')).toBe(false);
    const text = events.filter((e) => e.type === 'text').map((e: any) => e.chunk).join('');
    expect(text).toContain('rest');
  });

  it('handles empty stream', async () => {
    const reader = makeReader([]);
    const events = await collect(parseReflectStream(reader));
    expect(events).toEqual([]);
  });
});
