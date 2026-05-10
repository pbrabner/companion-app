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

import { chatStream } from '@/shared/ai/client';
import { REFLECTION_EMPATHIC_SYSTEM_PROMPT } from '@/shared/ai/prompts/reflection-empathic';
import { createServerClient } from '@/shared/db/server';

const MIN_CONTENT_LEN = 3;
const MAX_CONTENT_LEN = 8000;

function jsonResponse(status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
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

  // 5. INSERT into journal_entries (RLS auto-applied via auth.uid())
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

  // 6. Stream empathic response from Sonnet
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      // First line: JSON metadata so the client captures reflection_id immediately.
      controller.enqueue(
        encoder.encode(JSON.stringify({ reflection_id: reflectionId }) + '\n'),
      );
      try {
        for await (const chunk of chatStream({
          system: REFLECTION_EMPATHIC_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: trimmed }],
        })) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (err) {
        // Privacy gate: log error CLASS name only (e.g. "APIError",
        // "APIConnectionError"). Never err.message — Anthropic SDK errors
        // can echo request payload fragments back in the message body
        // (e.g. validation errors quote the rejected content), which would
        // leak user reflection content into observability.
        const errCode =
          err instanceof Error ? err.constructor.name : 'unknown';
        console.error('[reflect] ai_unavailable', {
          user_id: userId,
          reflection_id: reflectionId,
          content_length: trimmed.length,
          error_code: errCode,
        });
        controller.enqueue(
          encoder.encode(
            '\n' + JSON.stringify({ error: 'ai_unavailable', reflection_id: reflectionId }) + '\n',
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
