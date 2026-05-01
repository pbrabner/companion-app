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

vi.mock('@anthropic-ai/sdk', () => {
  const Anthropic = vi.fn().mockImplementation(() => ({
    messages: {
      stream: streamMock,
      create: createMock,
    },
  }));
  return { default: Anthropic };
});

beforeEach(() => {
  vi.resetModules();
  streamMock.mockReset();
  createMock.mockReset();
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
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
