/**
 * POST /api/reflect/[id]/retry — re-gera a resposta empática de uma reflexão
 * que ficou com ai_response NULL e faz UPDATE, com streaming (mesmo contrato do
 * POST /api/reflect). Guard: só quando ai_response é NULL (409 caso contrário).
 * Privacy ★ALTO: nunca loga body/ai_response, só metadata + error_code.
 * @module app/api/reflect/[id]/retry/route
 */
import { buildReflectionResponseStream } from '../../response-stream';
import {
  buildReflectionSystemPrompt,
  REFLECTION_EMPATHIC_SYSTEM_PROMPT,
} from '@/shared/ai/prompts/reflection-empathic';
import { createServerClient } from '@/shared/db/server';
import { sanitizeFindings } from '@/shared/memory/types';

function jsonResponse(status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  const supabase = await createServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return jsonResponse(401, { error: 'unauthenticated' });
  }
  const userId = userData.user.id;

  const { data: row } = await supabase
    .from('journal_entries')
    .select('body, ai_response')
    .eq('id', id)
    .maybeSingle();

  if (!row) {
    return jsonResponse(404, { error: 'not_found' });
  }
  // Truthy check (não `!== null`): uma resposta vazia ('') também conta como
  // "sem resposta real" e deve poder ser re-gerada.
  if ((row as { ai_response: string | null }).ai_response) {
    return jsonResponse(409, { error: 'already_answered' });
  }
  const body = (row as { body: string }).body;

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
    // sem memória / erro → prompt base
  }

  const stream = buildReflectionResponseStream({
    reflectionId: id,
    body,
    userId,
    systemPrompt,
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
