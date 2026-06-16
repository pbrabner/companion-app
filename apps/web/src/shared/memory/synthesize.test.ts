/**
 * Tests for maybeSynthesizeMemory + threshold. CA-MM-2..6.
 * @module shared/memory/synthesize.test
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

const classifyHaikuMock = vi.fn();
vi.mock('@/shared/ai/client', () => ({
  classifyHaiku: (...a: unknown[]) => classifyHaikuMock(...a),
}));

type Result = { data: unknown; error: unknown };
let memoryRow: Result = { data: null, error: null };
let newReflections: Result = { data: [], error: null };
let upsertResult: Result = { data: null, error: null };
const upsertMock = vi.fn();

function makeSupabase() {
  return {
    from(table: string) {
      if (table === 'user_memory') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => memoryRow }) }),
          upsert: async (row: unknown) => { upsertMock(row); return upsertResult; },
        };
      }
      // journal_entries
      const tail = { order: () => ({ limit: async () => newReflections }) };
      return {
        select: () => ({
          eq: () => ({
            gt: () => tail,
            order: () => ({ limit: async () => newReflections }),
          }),
        }),
      };
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  memoryRow = { data: null, error: null };
  newReflections = { data: [], error: null };
  upsertResult = { data: null, error: null };
});
afterEach(() => vi.restoreAllMocks());

const USER = 'user-mm';
function reflections(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `r${i}`, body: `reflexão ${i}`, ai_response: `resposta ${i}`,
    created_at: `2026-06-0${i + 1}T12:00:00Z`,
  }));
}

describe('maybeSynthesizeMemory + threshold', () => {
  it('CA-MM-2: < 3 reflexões novas → no-op', async () => {
    newReflections = { data: reflections(2), error: null };
    const { maybeSynthesizeMemory } = await import('./synthesize');
    await maybeSynthesizeMemory(USER, makeSupabase() as never);
    expect(classifyHaikuMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('CA-MM-3: ≥ 3 → chama classifyHaiku', async () => {
    memoryRow = { data: { findings: [], last_synthesized_at: null, source_count: 0 }, error: null };
    newReflections = { data: reflections(3), error: null };
    classifyHaikuMock.mockResolvedValueOnce([
      { text: 'padrão A', confidence: 0.3, first_seen: '2026-06-01T12:00:00Z', last_seen: '2026-06-03T12:00:00Z', evidence_count: 3 },
    ]);
    const { maybeSynthesizeMemory } = await import('./synthesize');
    await maybeSynthesizeMemory(USER, makeSupabase() as never);
    expect(classifyHaikuMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledTimes(1);
  });

  it('CA-MM-4: cap 20 respeitado', async () => {
    memoryRow = { data: { findings: [], last_synthesized_at: null, source_count: 0 }, error: null };
    newReflections = { data: reflections(3), error: null };
    classifyHaikuMock.mockResolvedValueOnce(
      Array.from({ length: 25 }, (_, i) => ({ text: `f${i}`, confidence: 0.4, first_seen: 'a', last_seen: 'b', evidence_count: 2 })),
    );
    const { maybeSynthesizeMemory } = await import('./synthesize');
    await maybeSynthesizeMemory(USER, makeSupabase() as never);
    const upserted = upsertMock.mock.calls[0]![0] as { findings: unknown[] };
    expect(upserted.findings.length).toBe(20);
  });

  it('CA-MM-5: classifyHaiku lança → não faz upsert (last_synthesized_at não avança)', async () => {
    memoryRow = { data: { findings: [{ text: 'old', confidence: 0.5, first_seen: 'x', last_seen: 'x', evidence_count: 3 }], last_synthesized_at: '2026-06-01T00:00:00Z', source_count: 3 }, error: null };
    newReflections = { data: reflections(3), error: null };
    classifyHaikuMock.mockRejectedValueOnce(new Error('bad'));
    const { maybeSynthesizeMemory } = await import('./synthesize');
    await maybeSynthesizeMemory(USER, makeSupabase() as never);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('CA-MM-6 ★ALTO: conteúdo (sentinel) nunca em logs', async () => {
    const sentinel = `<<SENTINEL_${randomUUID()}_END>>`;
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
    ];
    memoryRow = { data: { findings: [], last_synthesized_at: null, source_count: 0 }, error: null };
    newReflections = { data: [{ id: 'r0', body: `texto com ${sentinel}`, ai_response: sentinel, created_at: '2026-06-01T12:00:00Z' }, ...reflections(2)], error: null };
    classifyHaikuMock.mockRejectedValueOnce(new Error('boom'));
    const { maybeSynthesizeMemory } = await import('./synthesize');
    await maybeSynthesizeMemory(USER, makeSupabase() as never);
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(sentinel);
    }
  });

  it('CA-MM-4b: last_synthesized_at = created_at da reflexão mais nova do batch (não now)', async () => {
    memoryRow = { data: { findings: [], last_synthesized_at: null, source_count: 0 }, error: null };
    // ASC: array em ordem cronológica; a mais nova é a última
    newReflections = { data: [
      { id: 'r0', body: 'a', ai_response: null, created_at: '2026-06-01T12:00:00Z' },
      { id: 'r1', body: 'b', ai_response: null, created_at: '2026-06-02T12:00:00Z' },
      { id: 'r2', body: 'c', ai_response: null, created_at: '2026-06-03T12:00:00Z' },
    ], error: null };
    classifyHaikuMock.mockResolvedValueOnce([
      { text: 'p', confidence: 0.3, first_seen: 'a', last_seen: 'b', evidence_count: 3 },
    ]);
    const { maybeSynthesizeMemory } = await import('./synthesize');
    await maybeSynthesizeMemory(USER, makeSupabase() as never);
    const upserted = upsertMock.mock.calls[0]![0] as { last_synthesized_at: string };
    expect(upserted.last_synthesized_at).toBe('2026-06-03T12:00:00Z');
  });

  it('CA-MM-4c: findings vazio do modelo (usuário novo) → NÃO faz upsert (watermark não avança)', async () => {
    memoryRow = { data: { findings: [], last_synthesized_at: null, source_count: 0 }, error: null };
    newReflections = { data: reflections(3), error: null };
    classifyHaikuMock.mockResolvedValueOnce([]); // modelo devolve array vazio
    const { maybeSynthesizeMemory } = await import('./synthesize');
    await maybeSynthesizeMemory(USER, makeSupabase() as never);
    expect(upsertMock).not.toHaveBeenCalled();
  });
});
