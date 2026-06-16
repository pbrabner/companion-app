/**
 * Síntese incremental da micro-memória (slice B). Lê user_memory + reflexões
 * novas, chama Haiku (fallback Gemini interno do classifyHaiku), valida e grava.
 * Threshold gate em maybeSynthesizeMemory.
 *
 * Privacy ★ALTO: nunca loga body/ai_response/findings — só metadata.
 * @module shared/memory/synthesize
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { classifyHaiku } from '@/shared/ai/client';
import type { Database } from '@/shared/db/types';
import { MEMORY_SYNTHESIS_PROMPT } from '@/shared/ai/prompts/memory-synthesis';
import { MAX_FINDINGS, SYNTHESIS_THRESHOLD, sanitizeFindings, type MemoryFinding } from './types';

type Supabase = SupabaseClient<Database>;

type MemoryRow = { findings: MemoryFinding[]; last_synthesized_at: string | null; source_count: number };
type NewReflection = { id: string; body: string; ai_response: string | null; created_at: string };

/**
 * Normaliza a resposta do modelo: aceita tanto um array direto de findings
 * quanto um objeto { findings: [...] }. Sempre devolve algo que sanitizeFindings
 * consegue validar.
 */
function extractFindings(raw: unknown): unknown {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') return (raw as { findings?: unknown }).findings;
  return undefined;
}

export async function maybeSynthesizeMemory(userId: string, supabase: Supabase): Promise<void> {
  try {
    const { data: mem } = await supabase
      .from('user_memory')
      .select('findings, last_synthesized_at, source_count')
      .eq('user_id', userId)
      .maybeSingle();

    const memRow = mem as Partial<MemoryRow> | null;
    const current: MemoryRow = {
      findings: sanitizeFindings(memRow?.findings),
      last_synthesized_at: memRow?.last_synthesized_at ?? null,
      source_count: memRow?.source_count ?? 0,
    };

    const base = supabase
      .from('journal_entries')
      .select('id, body, ai_response, created_at')
      .eq('user_id', userId);
    const filtered = current.last_synthesized_at
      ? base.gt('created_at', current.last_synthesized_at)
      : base;
    const { data: rows } = await filtered
      .order('created_at', { ascending: false })
      .limit(MAX_FINDINGS);
    const newReflections = (rows as NewReflection[] | null) ?? [];

    if (newReflections.length < SYNTHESIS_THRESHOLD) return;

    await synthesizeMemory(userId, supabase, current, newReflections);
  } catch (err) {
    console.error('[memory] synthesis_failed', {
      user_id: userId,
      error_code: err instanceof Error ? err.constructor.name : 'unknown',
    });
  }
}

async function synthesizeMemory(
  userId: string,
  supabase: Supabase,
  current: MemoryRow,
  newReflections: NewReflection[],
): Promise<void> {
  const prompt = [
    'FINDINGS ATUAIS:',
    JSON.stringify(current.findings),
    '',
    'REFLEXÕES NOVAS (mais recentes primeiro):',
    ...newReflections.map((r) => `- [${r.created_at}] ${r.body}${r.ai_response ? `\n  (resposta: ${r.ai_response})` : ''}`),
  ].join('\n');

  const raw = await classifyHaiku<unknown>({
    prompt: `${MEMORY_SYNTHESIS_PROMPT}\n\n${prompt}`,
    schema: { findings: 'array of {text,confidence,first_seen,last_seen,evidence_count}' },
    maxTokens: 1024,
  });

  const findings = sanitizeFindings(extractFindings(raw)).slice(0, MAX_FINDINGS);
  if (findings.length === 0 && current.findings.length > 0) {
    return; // modelo devolveu vazio mas já tínhamos memória — não destrói.
  }

  const { error } = await supabase.from('user_memory').upsert({
    user_id: userId,
    findings,
    last_synthesized_at: new Date().toISOString(),
    source_count: current.source_count + newReflections.length,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    console.error('[memory] upsert_failed', { user_id: userId, error_code: (error as { code?: string }).code ?? 'unknown' });
  }
}
