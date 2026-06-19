/**
 * POST /api/onboarding — grava o baseline + marca o profile como onboardado.
 * Single-submit atômico-por-design: onboarded_at é o commit lógico (gravado por
 * último). Privacy ★ALTO: nunca loga mood/áreas/track/conteúdo, só metadata.
 * @module app/api/onboarding/route
 */
import { createServerClient } from '@/shared/db/server';
import { LIFE_AREA_SLUGS } from '@/app/onboarding/life-areas';

function jsonResponse(status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

interface OnboardingInput {
  accepted: boolean;
  track: string;
  mood: number;
  areas: string[];
}

function parseInput(raw: unknown, validTracks: Set<string>): OnboardingInput | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (o.accepted !== true) return null;
  if (typeof o.track !== 'string' || !validTracks.has(o.track)) return null;
  if (typeof o.mood !== 'number' || !Number.isInteger(o.mood) || o.mood < 1 || o.mood > 5) return null;
  if (!Array.isArray(o.areas) || o.areas.length === 0) return null;
  if (!o.areas.every((a) => typeof a === 'string' && LIFE_AREA_SLUGS.includes(a))) return null;
  if (new Set(o.areas).size !== o.areas.length) return null; // sem duplicatas
  return { accepted: true, track: o.track, mood: o.mood, areas: o.areas as string[] };
}

export async function POST(request: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }

  const supabase = await createServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return jsonResponse(401, { error: 'unauthenticated' });
  }
  const userId = userData.user.id;

  const { data: tracks } = await supabase.from('tracks_catalog').select('slug');
  const validTracks = new Set((tracks ?? []).map((t: { slug: string }) => t.slug));

  const input = parseInput(raw, validTracks);
  if (!input) {
    return jsonResponse(400, { error: 'invalid_input' });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('onboarded_at')
    .eq('id', userId)
    .maybeSingle();
  if ((profile as { onboarded_at: string | null } | null)?.onboarded_at) {
    return jsonResponse(409, { error: 'already_onboarded' });
  }

  const { error: baselineError } = await supabase
    .from('onboarding_baseline')
    .upsert({ user_id: userId, mood: input.mood, life_areas: input.areas });
  if (baselineError) {
    console.error('[onboarding] baseline_failed', {
      user_id: userId,
      error_code: baselineError.code ?? 'unknown',
    });
    return jsonResponse(500, { error: 'persistence_failed' });
  }

  const now = new Date().toISOString();
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ privacy_accepted_at: now, active_track: input.track, onboarded_at: now })
    .eq('id', userId);
  if (profileError) {
    console.error('[onboarding] profile_failed', {
      user_id: userId,
      error_code: profileError.code ?? 'unknown',
    });
    return jsonResponse(500, { error: 'persistence_failed' });
  }

  return jsonResponse(200, { ok: true });
}
