/**
 * Multi-provider AI client used by the Companion app.
 *
 * chatStream tenta Claude (Sonnet 4.6) primeiro e cai pra Gemini
 * (2.5 Flash) se o provider primário falhar ANTES de emitir qualquer
 * chunk. Falha mid-stream (após emitir) propaga — não dá pra trocar de
 * provider no meio sem duplicar texto pro cliente.
 *
 * Ordem resolvida por env:
 *   - ANTHROPIC_API_KEY presente → Claude disponível
 *   - GEMINI_API_KEY presente → Gemini disponível
 *   - AI_PROVIDER=gemini inverte a ordem (Gemini primário, Claude fallback)
 *   - Default: [claude, gemini] (Claude primário)
 *
 * classifyHaiku permanece Anthropic-only (T-010 futuro).
 * @module shared/ai/client
 */

import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';

/** Verified model IDs for the Companion project. */
export const SONNET_MODEL = 'claude-sonnet-4-6';
export const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
export const GEMINI_MODEL = 'gemini-2.5-flash';

export type AiProvider = 'claude' | 'gemini';

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
 * Resolve a ordem de providers a tentar, baseado nas keys presentes e no
 * override AI_PROVIDER. Só inclui providers com key configurada.
 */
export function resolveProviderOrder(): AiProvider[] {
  const hasClaude = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasGemini = Boolean(process.env.GEMINI_API_KEY);
  const override = process.env.AI_PROVIDER;

  const available: AiProvider[] = [];
  if (override === 'gemini') {
    if (hasGemini) available.push('gemini');
    if (hasClaude) available.push('claude');
  } else {
    if (hasClaude) available.push('claude');
    if (hasGemini) available.push('gemini');
  }
  return available;
}

/** Stream Claude (Sonnet) — yields text_delta chunks. */
async function* claudeStream(args: ChatStreamArgs): AsyncIterable<string> {
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

/** Stream Gemini (2.5 Flash) — yields text chunks. systemInstruction em config. */
async function* geminiStream(args: ChatStreamArgs): AsyncIterable<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  const ai = new GoogleGenAI({ apiKey });

  const contents = args.messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const stream = await ai.models.generateContentStream({
    model: args.model ?? GEMINI_MODEL,
    contents,
    config: {
      systemInstruction: args.system,
      maxOutputTokens: args.maxTokens ?? 4096,
    },
  });

  for await (const chunk of stream as AsyncIterable<unknown>) {
    const raw = (chunk as { text?: unknown }).text;
    const text = typeof raw === 'function' ? (raw as () => unknown).call(chunk) : raw;
    if (typeof text === 'string' && text.length > 0) {
      yield text;
    }
  }
}

const PROVIDER_STREAMS: Record<AiProvider, (args: ChatStreamArgs) => AsyncIterable<string>> = {
  claude: claudeStream,
  gemini: geminiStream,
};

/**
 * Stream a chat completion com fallback Claude → Gemini.
 *
 * Fallback só ocorre se o provider primário falhar ANTES de emitir
 * qualquer chunk. Falha após emitir propaga (cliente já recebeu texto
 * parcial; trocar duplicaria). Sem nenhum provider configurado, lança erro.
 */
export async function* chatStream(args: ChatStreamArgs): AsyncIterable<string> {
  const order = resolveProviderOrder();
  if (order.length === 0) {
    throw new Error(
      'Nenhum provider AI configurado. Defina ANTHROPIC_API_KEY e/ou GEMINI_API_KEY.',
    );
  }

  let lastError: unknown;
  for (const provider of order) {
    let emitted = false;
    try {
      for await (const chunk of PROVIDER_STREAMS[provider](args)) {
        emitted = true;
        yield chunk;
      }
      return; // provider concluiu com sucesso
    } catch (err) {
      lastError = err;
      if (emitted) {
        throw err; // mid-stream: não dá pra fallback
      }
      // falhou antes de emitir → tenta próximo provider
    }
  }
  throw lastError ?? new Error('Todos os providers AI falharam.');
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
