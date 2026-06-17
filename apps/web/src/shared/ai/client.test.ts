/**
 * Tests for the Anthropic client helpers — chatStream (Sonnet 4.6 streaming
 * async iterator) and classifyHaiku (Haiku 4.5 JSON-mode classifier). The
 * Anthropic SDK is mocked entirely via vi.mock; no real network calls.
 * @module shared/ai/client.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared mock state captured by the factory so each test can override behavior.
const streamMock = vi.fn();
const createMock = vi.fn();
const geminiGenerateMock = vi.fn();
const geminiStreamMock = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  const Anthropic = vi.fn().mockImplementation(() => ({
    messages: {
      stream: streamMock,
      create: createMock,
    },
  }));
  return { default: Anthropic };
});

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(() => ({
    models: {
      generateContent: geminiGenerateMock,
      generateContentStream: geminiStreamMock,
    },
  })),
}));

beforeEach(() => {
  vi.resetModules();
  streamMock.mockReset();
  createMock.mockReset();
  geminiGenerateMock.mockReset();
  geminiStreamMock.mockReset();
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
  process.env.GEMINI_API_KEY = 'test-gemini-key';
});

describe('chatStream (Sonnet 4.6, streaming)', () => {
  it('exports chatStream as a function', async () => {
    const mod = await import('@/shared/ai/client');
    expect(typeof mod.chatStream).toBe('function');
  });

  it('produces "a","b","c" in order when stream yields three text_delta chunks', async () => {
    // Mock the SDK stream as an async iterator of content_block_delta events.
    streamMock.mockImplementation(async function* () {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'a' } };
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'b' } };
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'c' } };
    });

    const { chatStream } = await import('@/shared/ai/client');

    const collected: string[] = [];
    for await (const chunk of chatStream({
      system: 'you are a helpful assistant',
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      collected.push(chunk);
    }

    expect(collected).toEqual(['a', 'b', 'c']);
  });
});

describe('classifyHaiku (Haiku 4.5, JSON via system prompt)', () => {
  it('exports classifyHaiku as a function', async () => {
    const mod = await import('@/shared/ai/client');
    expect(typeof mod.classifyHaiku).toBe('function');
  });

  it('returns { risk: "none" } when model responds with {"risk":"none"} JSON text', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: '{"risk":"none"}' }],
    });

    const { classifyHaiku } = await import('@/shared/ai/client');

    const result = await classifyHaiku<{ risk: 'high' | 'none' }>({
      prompt: 'Classify the risk level of: hello',
      schema: { risk: ['high', 'none'] },
    });

    expect(result).toEqual({ risk: 'none' });
  });
});

describe('classifyHaiku — fallback Gemini (CA-MM-7)', () => {
  it('Haiku ok → usa Haiku, não chama Gemini', async () => {
    createMock.mockResolvedValueOnce({ content: [{ type: 'text', text: '{"ok":true}' }] });
    const { classifyHaiku } = await import('./client');
    const out = await classifyHaiku<{ ok: boolean }>({ prompt: 'x', schema: { ok: 'boolean' } });
    expect(out).toEqual({ ok: true });
    expect(geminiGenerateMock).not.toHaveBeenCalled();
  });

  it('Haiku indisponível → cai pro Gemini', async () => {
    createMock.mockRejectedValueOnce(new Error('APIConnectionError'));
    geminiGenerateMock.mockResolvedValueOnce({ text: '{"ok":true,"via":"gemini"}' });
    const { classifyHaiku } = await import('./client');
    const out = await classifyHaiku<{ ok: boolean; via?: string }>({ prompt: 'x', schema: { ok: 'boolean' } });
    expect(out.ok).toBe(true);
    expect(geminiGenerateMock).toHaveBeenCalledTimes(1);
  });

  it('Haiku e Gemini falham → throw', async () => {
    createMock.mockRejectedValueOnce(new Error('anthropic down'));
    geminiGenerateMock.mockRejectedValueOnce(new Error('gemini down'));
    const { classifyHaiku } = await import('./client');
    await expect(classifyHaiku({ prompt: 'x', schema: { ok: 'boolean' } })).rejects.toThrow();
  });
});

describe('chatStream — fallback Gemini streaming (CA-CSF-1)', () => {
  it('quando Anthropic falha na abertura, streama os chunks .text do Gemini', async () => {
    streamMock.mockReturnValueOnce(
      (async function* () {
        throw new Error('APIConnectionError');
      })(),
    );
    geminiStreamMock.mockResolvedValueOnce(
      (async function* () {
        yield { text: 'g1' };
        yield { text: 'g2' };
      })(),
    );

    const { chatStream } = await import('./client');

    const collected: string[] = [];
    for await (const chunk of chatStream({
      system: 'sys',
      messages: [{ role: 'user', content: 'oi' }],
    })) {
      collected.push(chunk);
    }

    expect(collected).toEqual(['g1', 'g2']);
  });

  it('mapeia role assistant→model e user→user no contents do Gemini', async () => {
    streamMock.mockReturnValueOnce(
      (async function* () {
        throw new Error('down');
      })(),
    );
    geminiStreamMock.mockResolvedValueOnce(
      (async function* () {
        yield { text: 'x' };
      })(),
    );

    const { chatStream } = await import('./client');
    for await (const _ of chatStream({
      system: 'sys',
      messages: [
        { role: 'user', content: 'pergunta' },
        { role: 'assistant', content: 'resposta' },
      ],
    })) {
      void _;
    }

    expect(geminiStreamMock).toHaveBeenCalledTimes(1);
    const callArg = geminiStreamMock.mock.calls[0]![0];
    expect(callArg.config).toEqual({ systemInstruction: 'sys' });
    expect(callArg.contents).toEqual([
      { role: 'user', parts: [{ text: 'pergunta' }] },
      { role: 'model', parts: [{ text: 'resposta' }] },
    ]);
  });
});
