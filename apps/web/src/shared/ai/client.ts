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
import { GoogleGenAI } from '@google/genai';

/** Verified model IDs for the Companion project. */
export const SONNET_MODEL = 'claude-sonnet-4-6';
export const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

/** Modelo Gemini de fallback — verificar disponibilidade na conta. */
export const GEMINI_FALLBACK_MODEL = 'gemini-flash-latest';

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
 *
 * Se o Anthropic falhar ANTES do primeiro token (abertura), cai automaticamente
 * para o Gemini via chatStreamGeminiFallback. Se falhar após já ter emitido
 * algum token (mid-stream), re-lança — o parcial já foi entregue. O erro
 * original NÃO é logado (pode ecoar conteúdo do prompt).
 */
export async function* chatStream(args: ChatStreamArgs): AsyncIterable<string> {
  let yielded = false;
  try {
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
        yielded = true;
        yield evt.delta.text;
      }
    }
  } catch (err) {
    // Anthropic indisponível. Se já emitimos algum token (falha mid-stream),
    // re-lançamos — o texto parcial já foi entregue e a rota trata como
    // ai_unavailable. Se falhou antes do 1º token (abertura), caímos pro Gemini.
    // NÃO logamos o erro original (pode ecoar conteúdo do prompt).
    if (yielded) throw err;
    yield* chatStreamGeminiFallback(args);
  }
}

/**
 * Fallback de chat streaming via Gemini quando o Anthropic está indisponível.
 * Mapeia ChatMessage[] para o formato `contents` do Gemini (role assistant→model)
 * e re-emite os chunks de texto. NÃO loga conteúdo.
 */
async function* chatStreamGeminiFallback(
  args: ChatStreamArgs,
): AsyncIterable<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  const genai = new GoogleGenAI({ apiKey });
  const contents = args.messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const stream = await genai.models.generateContentStream({
    model: GEMINI_FALLBACK_MODEL,
    contents,
    config: { systemInstruction: args.system },
  });
  for await (const chunk of stream as AsyncIterable<{ text?: string }>) {
    const t = chunk.text;
    if (typeof t === 'string' && t.length > 0) {
      yield t;
    }
  }
}

/**
 * Fallback de classificação via Gemini quando o Anthropic está indisponível.
 * Mesmo contrato de saída do classifyHaiku (JSON parseado). NÃO loga conteúdo.
 */
async function classifyGeminiFallback<T>(system: string, prompt: string): Promise<T> {
  const apiKey = process.env.GEMINI_API_KEY;
  const genai = new GoogleGenAI({ apiKey });
  const result = await genai.models.generateContent({
    model: GEMINI_FALLBACK_MODEL,
    contents: prompt,
    config: { systemInstruction: system },
  });
  const text = (result as { text?: string }).text;
  if (typeof text !== 'string') {
    throw new Error('classifyGeminiFallback: resposta sem texto');
  }
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  return JSON.parse(cleaned) as T;
}

/**
 * Classify input via Haiku 4.5 and return a parsed JSON object. The system
 * prompt instructs the model to reply with raw JSON only (no prose, no code
 * fences); the first text content block is parsed via JSON.parse.
 *
 * The generic parameter narrows the return type — callers should validate the
 * shape at the boundary if untrusted input flows into the prompt.
 *
 * Se o Anthropic estiver indisponível (erro de conexão/timeout ou resposta
 * inválida), cai para o fallback Gemini com o mesmo contrato de saída. O erro
 * original NÃO é logado para não ecoar conteúdo do prompt.
 */
export async function classifyHaiku<T = unknown>(args: ClassifyHaikuArgs): Promise<T> {
  const schemaDescription = JSON.stringify(args.schema);
  const system =
    'You are a strict JSON classifier. Reply with raw JSON only — no prose, ' +
    'no markdown, no code fences. The JSON must conform to this schema: ' +
    schemaDescription;

  try {
    const client = createClient();
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
  } catch {
    // Anthropic indisponível ou resposta inválida → fallback Gemini.
    // Não logamos o erro original (pode ecoar conteúdo do prompt).
    return classifyGeminiFallback<T>(system, args.prompt);
  }
}
