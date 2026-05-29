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

vi.mock('@google/genai', () => {
  const GoogleGenAI = vi.fn().mockImplementation(() => ({
    models: {
      generateContentStream: geminiStreamMock,
    },
  }));
  return { GoogleGenAI };
});

beforeEach(() => {
  vi.resetModules();
  streamMock.mockReset();
  createMock.mockReset();
  geminiStreamMock.mockReset();
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
  delete process.env.GEMINI_API_KEY;
  delete process.env.AI_PROVIDER;
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

describe('resolveProviderOrder', () => {
  it('returns [claude] when só ANTHROPIC_API_KEY set', async () => {
    const { resolveProviderOrder } = await import('@/shared/ai/client');
    expect(resolveProviderOrder()).toEqual(['claude']);
  });

  it('returns [claude, gemini] when ambas keys set (default)', async () => {
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    const { resolveProviderOrder } = await import('@/shared/ai/client');
    expect(resolveProviderOrder()).toEqual(['claude', 'gemini']);
  });

  it('returns [gemini, claude] when AI_PROVIDER=gemini', async () => {
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    process.env.AI_PROVIDER = 'gemini';
    const { resolveProviderOrder } = await import('@/shared/ai/client');
    expect(resolveProviderOrder()).toEqual(['gemini', 'claude']);
  });

  it('returns [gemini] when só GEMINI_API_KEY set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    const { resolveProviderOrder } = await import('@/shared/ai/client');
    expect(resolveProviderOrder()).toEqual(['gemini']);
  });

  it('returns [] quando nenhuma key', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { resolveProviderOrder } = await import('@/shared/ai/client');
    expect(resolveProviderOrder()).toEqual([]);
  });
});

describe('chatStream fallback (Claude → Gemini)', () => {
  it('usa Gemini quando Claude falha ANTES de emitir chunk', async () => {
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    // Claude lança imediatamente (ex: auth error) sem emitir
    streamMock.mockImplementation(async function* () {
      throw new Error('claude auth failed');
      // eslint-disable-next-line no-unreachable
      yield {};
    });
    // Gemini yields chunks
    geminiStreamMock.mockImplementation(async function* () {
      yield { text: 'gem-a' };
      yield { text: 'gem-b' };
    });

    const { chatStream } = await import('@/shared/ai/client');
    const collected: string[] = [];
    for await (const chunk of chatStream({
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      collected.push(chunk);
    }
    expect(collected).toEqual(['gem-a', 'gem-b']);
  });

  it('NÃO faz fallback se Claude falha APÓS emitir chunk (propaga erro)', async () => {
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    streamMock.mockImplementation(async function* () {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } };
      throw new Error('claude mid-stream failure');
    });
    geminiStreamMock.mockImplementation(async function* () {
      yield { text: 'should-not-appear' };
    });

    const { chatStream } = await import('@/shared/ai/client');
    const collected: string[] = [];
    let threw = false;
    try {
      for await (const chunk of chatStream({
        system: 's',
        messages: [{ role: 'user', content: 'hi' }],
      })) {
        collected.push(chunk);
      }
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(collected).toEqual(['partial']);
    expect(geminiStreamMock).not.toHaveBeenCalled();
  });

  it('Gemini primário quando AI_PROVIDER=gemini', async () => {
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    process.env.AI_PROVIDER = 'gemini';
    geminiStreamMock.mockImplementation(async function* () {
      yield { text: 'g1' };
    });

    const { chatStream } = await import('@/shared/ai/client');
    const collected: string[] = [];
    for await (const chunk of chatStream({
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      collected.push(chunk);
    }
    expect(collected).toEqual(['g1']);
    expect(streamMock).not.toHaveBeenCalled();
  });

  it('lança erro quando nenhum provider configurado', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { chatStream } = await import('@/shared/ai/client');
    let threw = false;
    try {
      for await (const _ of chatStream({ system: 's', messages: [{ role: 'user', content: 'x' }] })) {
        void _;
      }
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it('Gemini stream: text como função (getter) também funciona', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    geminiStreamMock.mockImplementation(async function* () {
      yield { text: () => 'fn-text' };
    });
    const { chatStream } = await import('@/shared/ai/client');
    const collected: string[] = [];
    for await (const chunk of chatStream({ system: 's', messages: [{ role: 'user', content: 'x' }] })) {
      collected.push(chunk);
    }
    expect(collected).toEqual(['fn-text']);
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
