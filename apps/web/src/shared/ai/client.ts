/**
 * Anthropic SDK client + helpers used by the Companion app.
 * Exposes a singleton Anthropic instance plus two helpers:
 *   - chatStream: Sonnet 4.6 streaming chat as an async iterator of text chunks.
 *   - classifyHaiku: Haiku 4.5 single-shot classifier returning a parsed JSON
 *     object. The Anthropic SDK has no native structured-output mode, so we
 *     instruct the model via system prompt to reply with raw JSON only and
 *     then JSON.parse the first text block.
 * @module shared/ai/client
 */

import Anthropic from '@anthropic-ai/sdk';

/** Verified model IDs for the Companion project. */
export const SONNET_MODEL = 'claude-sonnet-4-6';
export const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

/** Chat message role accepted by the helpers. */
export type ChatRole = 'user' | 'assistant';

/** Minimal chat message shape mirroring the Anthropic SDK input. */
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** Args accepted by chatStream. */
export interface ChatStreamArgs {
  system: string;
  messages: ChatMessage[];
  /** Optional override; defaults to SONNET_MODEL. */
  model?: string;
  /** Optional max tokens; defaults to 4096. */
  maxTokens?: number;
}

/** Args accepted by classifyHaiku. */
export interface ClassifyHaikuArgs {
  prompt: string;
  /**
   * Schema descriptor used to build the system prompt and document the
   * expected JSON shape. Free-form by design — the helper does not enforce
   * runtime validation; callers should narrow the return type via the
   * generic parameter.
   */
  schema: Record<string, unknown>;
  /** Optional override; defaults to HAIKU_MODEL. */
  model?: string;
  /** Optional max tokens; defaults to 256. */
  maxTokens?: number;
}

/**
 * Lazily instantiate the Anthropic client so that env-var validation happens
 * at call time, not at module import time. This keeps the module importable
 * in unit tests where ANTHROPIC_API_KEY may not be set and the SDK is mocked.
 */
function createClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  return new Anthropic({ apiKey });
}

/**
 * Stream a chat completion with Sonnet 4.6 and yield text chunks as they
 * arrive. Consumes the SDK stream and re-emits only the `text_delta` payloads
 * from `content_block_delta` events as plain strings.
 */
export async function* chatStream(args: ChatStreamArgs): AsyncIterable<string> {
  const client = createClient();
  const stream = await client.messages.stream({
    model: args.model ?? SONNET_MODEL,
    max_tokens: args.maxTokens ?? 4096,
    system: args.system,
    messages: args.messages,
  });

  for await (const event of stream as AsyncIterable<unknown>) {
    const evt = event as {
      type?: string;
      delta?: { type?: string; text?: string };
    };
    if (
      evt.type === 'content_block_delta' &&
      evt.delta?.type === 'text_delta' &&
      typeof evt.delta.text === 'string'
    ) {
      yield evt.delta.text;
    }
  }
}

/**
 * Classify input via Haiku 4.5 and return a parsed JSON object. The system
 * prompt instructs the model to reply with raw JSON only (no prose, no code
 * fences); the first text content block is parsed via JSON.parse.
 *
 * The generic parameter narrows the return type — callers should validate the
 * shape at the boundary if untrusted input flows into the prompt.
 */
export async function classifyHaiku<T = unknown>(args: ClassifyHaikuArgs): Promise<T> {
  const client = createClient();
  const schemaDescription = JSON.stringify(args.schema);
  const system =
    'You are a strict JSON classifier. Reply with raw JSON only — no prose, ' +
    'no markdown, no code fences. The JSON must conform to this schema: ' +
    schemaDescription;

  const response = await client.messages.create({
    model: args.model ?? HAIKU_MODEL,
    max_tokens: args.maxTokens ?? 256,
    system,
    messages: [{ role: 'user', content: args.prompt }],
  });

  const content = (response as { content?: Array<{ type?: string; text?: string }> }).content ?? [];
  const firstText = content.find((block) => block.type === 'text')?.text;
  if (typeof firstText !== 'string') {
    throw new Error('classifyHaiku: model response did not contain a text block');
  }
  return JSON.parse(firstText) as T;
}
