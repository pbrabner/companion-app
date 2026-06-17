/**
 * Route Handler for POST /api/reflect — accepts a written reflection,
 * persists it under the authenticated user's RLS context, and streams an
 * empathic response from Claude Sonnet 4.6 back to the browser.
 *
 * Stream contract: text/plain chunked. First line is JSON metadata
 * `{"reflection_id": "<uuid>"}\n`. Subsequent chunks are raw Claude text.
 * Final line (only on Claude failure post-INSERT) is JSON
 * `\n{"error":"ai_unavailable","reflection_id":"<uuid>"}\n`.
 *
 * Privacy gate (RF-007 / CA-T009-3 ★ALTO): never logs `content` or `body`,
 * only metadata (user_id, reflection_id, content_length, error_code).
 *
 * @module app/api/reflect/route
 */

import {
  buildReflectionSystemPrompt,
  REFLECTION_EMPATHIC_SYSTEM_PROMPT,
} from '@/shared/ai/prompts/reflection-empathic';
import { createServerClient } from '@/shared/db/server';
import { maybeSynthesizeMemory } from '@/shared/memory/synthesize';
import { sanitizeFindings } from '@/shared/memory/types';
import { buildReflectionResponseStream } from './response-stream';

const MIN_CONTENT_LEN = 3;
const MAX_CONTENT_LEN = 8000;

function jsonResponse(status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

const SYNTH_TIMEOUT_MS = 5000;

/** Dispara a síntese da micro-memória best-effort com timeout — NUNCA relança. */
async function triggerSynthesis(
  userId: string,
  supabase: Awaited<ReturnType<typeof createServerClient>>,
): Promise<void> {
  try {
    const synth = Promise.resolve(maybeSynthesizeMemory(userId, supabase));
    const timeout = new Promise<void>((resolve) => {
      setTimeout(() => resolve(), SYNTH_TIMEOUT_MS).unref?.();
    });
    await Promise.race([synth, timeout]);
  } catch (err) {
    console.error('[reflect] synthesis_trigger_failed', {
      user_id: userId,
      error_code: err instanceof Error ? err.constructor.name : 'unknown',
    });
  }
}

export async function POST(request: Request): Promise<Response> {
  // 1. Parse JSON body
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }

  // 2. Validate content shape
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { content?: unknown }).content !== 'string'
  ) {
    return jsonResponse(400, { error: 'invalid_input' });
  }
  const rawContent = (parsed as { content: string }).content;

  // 3. Validate length (max checked BEFORE trim to avoid ambiguity on huge whitespace)
  if (rawContent.length > MAX_CONTENT_LEN) {
    return jsonResponse(413, { error: 'too_long' });
  }
  const trimmed = rawContent.trim();
  if (trimmed.length < MIN_CONTENT_LEN) {
    return jsonResponse(400, { error: 'too_short' });
  }

  // 4. Auth check
  const supabase = await createServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return jsonResponse(401, { error: 'unauthenticated' });
  }
  const userId = userData.user.id;

  // 5. INSERT into journal_entries (RLS auto-applied via auth.uid()).
  // prompt_used is null in T-009: free-form reflection, no suggested prompt.
  // RF-009 (prompt suggestion) is Marco 2 — column will be populated then.
  const { data: insertData, error: insertError } = await supabase
    .from('journal_entries')
    .insert({ user_id: userId, body: trimmed, prompt_used: null })
    .select('id')
    .single();

  if (insertError || !insertData) {
    // Privacy gate: log only metadata, never content/body.
    console.error('[reflect] persistence_failed', {
      user_id: userId,
      content_length: trimmed.length,
      error_code: insertError?.code ?? 'unknown',
    });
    return jsonResponse(500, { error: 'persistence_failed' });
  }
  const reflectionId: string = insertData.id;

  // Read-feedback: micro-memória no system prompt (best-effort — falha degrada
  // pro prompt base). Leitura com a session do usuário (RLS owner).
  let systemPrompt = REFLECTION_EMPATHIC_SYSTEM_PROMPT;
  try {
    const { data: mem } = await supabase
      .from('user_memory')
      .select('findings')
      .eq('user_id', userId)
      .maybeSingle();
    systemPrompt = buildReflectionSystemPrompt(
      sanitizeFindings((mem as { findings?: unknown } | null)?.findings),
    );
  } catch {
    // sem memória / erro → prompt base (já default)
  }

  // 6. Stream empathic response from Sonnet
  const stream = buildReflectionResponseStream({
    reflectionId,
    body: trimmed,
    userId,
    systemPrompt,
    onComplete: () => triggerSynthesis(userId, supabase),
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
