/**
 * Route Handler for GET /api/reflections — historico paginado por cursor
 * das reflexoes do usuario autenticado, com resposta IA quando persistida.
 *
 * Leitura SEMPRE com a session do usuario (RLS owner_select isola por dono
 * no banco — D-RH-5: service client e exclusivo do caminho de escrita).
 *
 * Privacy gate (CA-RH-4 ★ALTO): nunca loga body/ai_response, so metadata.
 *
 * @module app/api/reflections/route
 */

import { createServerClient } from '@/shared/db/server';

const DEFAULT_LIMIT = 20;
const MIN_LIMIT = 1;
const MAX_LIMIT = 50;

function jsonResponse(status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function clampLimit(raw: string | null): number {
  const parsed = Number(raw);
  if (raw === null || !Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(parsed), MIN_LIMIT), MAX_LIMIT);
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);

  const limit = clampLimit(url.searchParams.get('limit'));
  const before = url.searchParams.get('before');
  if (before !== null && Number.isNaN(Date.parse(before))) {
    return jsonResponse(400, { error: 'invalid_cursor' });
  }

  const supabase = await createServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return jsonResponse(401, { error: 'unauthorized' });
  }

  let query = supabase
    .from('journal_entries')
    .select('id, body, created_at, ai_response, ai_response_at')
    .order('created_at', { ascending: false })
    .limit(limit + 1);
  if (before !== null) {
    query = query.lt('created_at', before);
  }

  const { data, error } = await query;
  if (error || !data) {
    console.error('[reflections] db_error', {
      user_id: userData.user.id,
      error_code: error?.code ?? 'unknown',
    });
    return jsonResponse(500, { error: 'db_error' });
  }

  const hasMore = data.length > limit;
  const page = hasMore ? data.slice(0, limit) : data;
  const lastRow = page[page.length - 1];
  const nextCursor = hasMore && lastRow ? (lastRow.created_at as string) : null;

  return jsonResponse(200, { reflections: page, next_cursor: nextCursor });
}
