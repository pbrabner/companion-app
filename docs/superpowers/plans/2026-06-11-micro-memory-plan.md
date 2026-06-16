# Micro-memória (slice A+B+C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Memória cumulativa de findings da IA por usuário, sintetizada das reflexões+respostas e realimentada no system prompt do Sonnet no /reflect.

**Architecture:** Tabela `user_memory` (1 linha/user, findings jsonb). Síntese Haiku incremental disparada on-demand (threshold ≥3 reflexões novas) best-effort no /reflect, com fallback Gemini no `classifyHaiku`. Read-feedback injeta findings compactos no system prompt antes do `chatStream`. Spec: `docs/superpowers/specs/2026-06-11-micro-memory-design.md` (commit 210eb55).

**Tech Stack:** Next.js 15/React 19, Supabase (`@supabase/ssr`), `@anthropic-ai/sdk`, `@google/genai` (nova), Vitest, pnpm. App em `apps/web`.

**Workflow playbook:** `micro-memory` (risk desenvolvimento) — controller registra `record-dispatch` por executor/qa/reviewer (MESMO target string started/done).

**Regras transversais:**
- NUNCA `git add .` — paths explícitos.
- Privacy ★ALTO: `body`/`ai_response`/`findings` NUNCA em logs (sentinel CA-MM-6).
- Síntese e leitura via **session do usuário** (RLS owner), NÃO service role (D-MM-5).
- Best-effort: síntese NUNCA afeta o stream nem o ai_response (timeout 5s).
- NÃO modificar testes existentes (só ADD).
- Comandos de teste em `D:\companion-app\apps\web`.
- Confirmado no pre-flight: `GEMINI_API_KEY` presente no `.env.local`; `@google/genai` NÃO instalado.

---

### Task 0: Pre-flight (INLINE controller)

- [ ] **0.1:** `git -C "D:\companion-app" branch --show-current` → `feat/micro-memory` (HEAD 210eb55 = spec).
- [ ] **0.2:** Baseline `pnpm test` → `101 passed | 5 skipped`.
- [ ] **0.3:** Confirmar `GEMINI_API_KEY` em `apps/web/.env.local` (já verificado: presente). `@google/genai` ausente do package.json → Task 2 instala.
- [ ] **0.4:** Workflow `--to approved` + `--to executing` ao autorizar.

---

### Task 1: Migration 0009 + types regen (haiku)

**Files:** Create `supabase/migrations/0009_user_memory.sql`; Modify `apps/web/src/shared/db/types.ts`

- [ ] **1.1: Criar migration** com conteúdo EXATO:

```sql
-- migration: 0009_user_memory
-- purpose: micro-memoria cumulativa de findings da IA por usuario (slice A).
-- spec: docs/superpowers/specs/2026-06-11-micro-memory-design.md
-- Apply no live: MANUAL via SQL Editor (drift conhecido). NAO db push.
CREATE TABLE public.user_memory (
  user_id             uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  findings            jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_synthesized_at timestamptz NULL,
  source_count        integer NOT NULL DEFAULT 0,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY owner_select ON public.user_memory
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY owner_insert ON public.user_memory
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY owner_update ON public.user_memory
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY owner_delete ON public.user_memory
  FOR DELETE TO authenticated USING (user_id = auth.uid());
```

- [ ] **1.2: Regenerar types.ts** (pattern PR #9 — `supabase start` CLI é bugado; container descartável):

```bash
docker run -d --name types-pg -e POSTGRES_PASSWORD=postgres -p 55432:5432 public.ecr.aws/supabase/postgres:17.6.1.084
# loop até: docker exec types-pg pg_isready -U postgres
cd /d/companion-app
for f in supabase/migrations/000{1,2,3,4,5,6,8,9}_*.sql; do
  docker exec -i types-pg psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$f" || { echo "FAILED $f"; break; }
done
cd apps/web
pnpm exec supabase gen types typescript --db-url "postgresql://postgres:postgres@127.0.0.1:55432/postgres" 2>/dev/null > /tmp/types-new.ts
{ head -7 src/shared/db/types.ts; cat /tmp/types-new.ts; } > /tmp/types-final.ts && mv /tmp/types-final.ts src/shared/db/types.ts
docker rm -f types-pg
```
(Não existe 0007 no dir — glob `000{1..6,8,9}` correto. 0008 = ai_response da feature anterior, já mergeada.)

- [ ] **1.3: Verificar diff** — `git diff apps/web/src/shared/db/types.ts` deve ADICIONAR um bloco `user_memory` (Row/Insert/Update com findings: Json, last_synthesized_at: string|null, source_count: number, updated_at: string, user_id: string). Nenhuma remoção. Header das 7 linhas intacto.
- [ ] **1.4:** `pnpm typecheck` → 0.
- [ ] **1.5: Commit**
```bash
git -C "/d/companion-app" add supabase/migrations/0009_user_memory.sql apps/web/src/shared/db/types.ts
git -C "/d/companion-app" commit -m "feat(db): migration 0009 user_memory + types regen (CA-MM-1)"
```

---

### Task 2: Fallback Gemini no classifyHaiku (TDD, sonnet)

**Files:** Modify `apps/web/package.json`, `apps/web/src/shared/ai/client.ts`; Test `apps/web/src/shared/ai/client.test.ts`

- [ ] **2.1: Instalar dep**
```bash
cd "/d/companion-app/apps/web" && pnpm add @google/genai
```
Confirme em package.json. Verifique a API real do pacote instalado em `node_modules/@google/genai` (a SDK unificada usa `new GoogleGenAI({apiKey}).models.generateContent({model, contents, config})` e o texto sai via `result.text`). Se a forma divergir na versão instalada, ajuste o código abaixo ao real e reporte.

- [ ] **2.2: ADD testes em client.test.ts** (mock dos 2 SDKs no topo, junto aos mocks existentes; NÃO modifique testes existentes):

```ts
// --- Mocks fallback Gemini (CA-MM-7) ---
const geminiGenerateMock = vi.fn();
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(() => ({ models: { generateContent: geminiGenerateMock } })),
}));
```
(O mock do `@anthropic-ai/sdk` já existe no arquivo — REUSE o handle existente que controla `messages.create`. Inspecione como os testes atuais de classifyHaiku mockam o Anthropic e use o mesmo handle pra forçar sucesso/erro.)

ADD describe:
```ts
describe('classifyHaiku — fallback Gemini (CA-MM-7)', () => {
  beforeEach(() => {
    geminiGenerateMock.mockReset();
    process.env.GEMINI_API_KEY = 'test-key';
  });

  it('Haiku ok → usa Haiku, não chama Gemini', async () => {
    // configure o mock Anthropic existente p/ retornar content text '{"ok":true}'
    const { classifyHaiku } = await import('./client');
    const out = await classifyHaiku<{ ok: boolean }>({ prompt: 'x', schema: { ok: 'boolean' } });
    expect(out).toEqual({ ok: true });
    expect(geminiGenerateMock).not.toHaveBeenCalled();
  });

  it('Haiku indisponível → cai pro Gemini', async () => {
    // force o mock Anthropic a lançar (ex: throw new Error('APIConnectionError'))
    geminiGenerateMock.mockResolvedValueOnce({ text: '{"ok":true,"via":"gemini"}' });
    const { classifyHaiku } = await import('./client');
    const out = await classifyHaiku<{ ok: boolean; via?: string }>({ prompt: 'x', schema: { ok: 'boolean' } });
    expect(out.ok).toBe(true);
    expect(geminiGenerateMock).toHaveBeenCalledTimes(1);
  });

  it('Haiku e Gemini falham → throw', async () => {
    // Anthropic lança; Gemini também
    geminiGenerateMock.mockRejectedValueOnce(new Error('gemini down'));
    const { classifyHaiku } = await import('./client');
    await expect(
      classifyHaiku({ prompt: 'x', schema: { ok: 'boolean' } }),
    ).rejects.toThrow();
  });
});
```
NOTA: adapte a forma de forçar sucesso/erro do Anthropic ao mock REAL já presente no arquivo (não invente outro mock do @anthropic-ai/sdk — só ADD o do @google/genai).

- [ ] **2.3: RED** — `pnpm test -- src/shared/ai/client.test.ts` → o teste de fallback FALHA (hoje classifyHaiku não tem fallback), existentes PASS.

- [ ] **2.4: Implementar fallback em client.ts**

(a) ADD após o import do Anthropic:
```ts
import { GoogleGenAI } from '@google/genai';

/** Modelo Gemini de fallback — verificar disponibilidade na conta. */
export const GEMINI_FALLBACK_MODEL = 'gemini-flash-latest';
```

(b) ADD helper module-level:
```ts
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
  // Gemini pode embrulhar em code fences mesmo instruído — strip defensivo.
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  return JSON.parse(cleaned) as T;
}
```

(c) ENVOLVER a chamada Anthropic do classifyHaiku em try/catch que cai pro Gemini. O corpo atual cria o client, monta `system`, faz `client.messages.create(...)`, extrai `firstText`, retorna `JSON.parse`. Refatore pra:
```ts
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
```

- [ ] **2.5: GREEN** — `pnpm test -- src/shared/ai/client.test.ts` → todos PASS. `pnpm typecheck` → 0.
- [ ] **2.6: Commit**
```bash
git -C "/d/companion-app" add apps/web/package.json apps/web/pnpm-lock.yaml apps/web/src/shared/ai/client.ts apps/web/src/shared/ai/client.test.ts
git -C "/d/companion-app" commit -m "feat(ai): fallback Gemini no classifyHaiku (CA-MM-7)"
```

---

### Task 3: memory/types + synthesize (TDD, sonnet)

**Files:** Create `apps/web/src/shared/memory/types.ts`, `apps/web/src/shared/ai/prompts/memory-synthesis.ts`, `apps/web/src/shared/memory/synthesize.ts`; Test `apps/web/src/shared/memory/synthesize.test.ts`

- [ ] **3.1: Criar memory/types.ts**
```ts
/**
 * Tipos + validação de shape da micro-memória. findings são abstrações
 * (não conteúdo cru). Validação descarta entries malformadas e trunca em MAX.
 * @module shared/memory/types
 */

export const MAX_FINDINGS = 20;
export const SYNTHESIS_THRESHOLD = 3;

export type MemoryFinding = {
  text: string;
  confidence: number;
  first_seen: string;
  last_seen: string;
  evidence_count: number;
};

function isFinding(v: unknown): v is MemoryFinding {
  if (typeof v !== 'object' || v === null) return false;
  const f = v as Record<string, unknown>;
  return (
    typeof f.text === 'string' && f.text.length > 0 &&
    typeof f.confidence === 'number' &&
    typeof f.first_seen === 'string' &&
    typeof f.last_seen === 'string' &&
    typeof f.evidence_count === 'number'
  );
}

/** Valida e normaliza um array desconhecido de findings (do modelo ou do DB). */
export function sanitizeFindings(raw: unknown): MemoryFinding[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isFinding).slice(0, MAX_FINDINGS);
}
```

- [ ] **3.2: Criar prompts/memory-synthesis.ts**
```ts
/**
 * Prompt de síntese da micro-memória (Haiku). Versionado.
 * Conservador: evidência fraca → confidence baixa, não inventar padrão de 1
 * reflexão. findings são ABSTRAÇÕES, nunca cópia literal de conteúdo sensível.
 * @module shared/ai/prompts/memory-synthesis
 */

export const MEMORY_SYNTHESIS_PROMPT_VERSION = 'v1' as const;

export const MEMORY_SYNTHESIS_PROMPT = `Você sintetiza uma memória cumulativa de padrões de uma pessoa a partir das reflexões dela e das respostas anteriores.

Você recebe (1) os findings atuais (array JSON) e (2) reflexões novas. Devolva o array COMPLETO e ATUALIZADO de findings.

Regras:
- Cada finding é uma ABSTRAÇÃO curta de um padrão ("Padrão de ansiedade antes de reuniões"), NUNCA cópia literal do que a pessoa escreveu, NUNCA dado sensível bruto.
- Reforce findings existentes que reaparecem: suba confidence (0..1), incremente evidence_count, atualize last_seen.
- Adicione padrões genuinamente novos. Funda duplicatas.
- Seja CONSERVADOR: um padrão visto em 1 reflexão só tem confidence baixa (<=0.3). Não invente.
- Máximo 20 findings, ordenados por relevância (confidence * evidence_count desc).
- Responda APENAS o array JSON, sem prosa, sem code fences. Cada item: {"text","confidence","first_seen","last_seen","evidence_count"}.`;
```

- [ ] **3.3: Escrever synthesize.test.ts** (mock classifyHaiku + supabase builder):
```ts
/**
 * Tests for synthesizeMemory + threshold. CA-MM-2..6.
 * @module shared/memory/synthesize.test
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

const classifyHaikuMock = vi.fn();
vi.mock('@/shared/ai/client', () => ({
  classifyHaiku: (...a: unknown[]) => classifyHaikuMock(...a),
}));

// Supabase builder mock: from('user_memory'/'journal_entries') com select/eq/gt/order/limit/single/upsert
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
          upsert: (row: unknown) => { upsertMock(row); return { then: (r: (v: Result) => void) => r(upsertResult) }; },
        };
      }
      // journal_entries: select novas reflexões
      return {
        select: () => ({
          eq: () => ({
            gt: () => ({ order: () => ({ limit: async () => newReflections }) }),
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

describe('synthesizeMemory + threshold', () => {
  it('CA-MM-2: < 3 reflexões novas → no-op (não chama classifyHaiku)', async () => {
    newReflections = { data: reflections(2), error: null };
    const { maybeSynthesizeMemory } = await import('./synthesize');
    await maybeSynthesizeMemory(USER, makeSupabase() as never);
    expect(classifyHaikuMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('CA-MM-3: ≥ 3 → chama classifyHaiku com findings atuais + reflexões', async () => {
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

  it('CA-MM-4: reforça existente + adiciona novo, respeita cap 20', async () => {
    memoryRow = { data: { findings: [{ text: 'velho', confidence: 0.5, first_seen: 'x', last_seen: 'x', evidence_count: 5 }], last_synthesized_at: '2026-06-01T00:00:00Z', source_count: 5 }, error: null };
    newReflections = { data: reflections(3), error: null };
    // modelo devolve 25 itens → sanitize trunca em 20
    classifyHaikuMock.mockResolvedValueOnce(
      Array.from({ length: 25 }, (_, i) => ({ text: `f${i}`, confidence: 0.4, first_seen: 'a', last_seen: 'b', evidence_count: 2 })),
    );
    const { maybeSynthesizeMemory } = await import('./synthesize');
    await maybeSynthesizeMemory(USER, makeSupabase() as never);
    const upserted = upsertMock.mock.calls[0][0] as { findings: unknown[] };
    expect(upserted.findings.length).toBe(20);
  });

  it('CA-MM-5: JSON inválido do modelo → last_synthesized_at NÃO avança (não faz upsert)', async () => {
    memoryRow = { data: { findings: [{ text: 'old', confidence: 0.5, first_seen: 'x', last_seen: 'x', evidence_count: 3 }], last_synthesized_at: '2026-06-01T00:00:00Z', source_count: 3 }, error: null };
    newReflections = { data: reflections(3), error: null };
    classifyHaikuMock.mockRejectedValueOnce(new Error('bad json'));
    const { maybeSynthesizeMemory } = await import('./synthesize');
    await maybeSynthesizeMemory(USER, makeSupabase() as never); // não lança (best-effort interno? NÃO — synthesizeMemory pode lançar, maybe engole)
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('CA-MM-6 ★ALTO: conteúdo da reflexão (sentinel) nunca em logs', async () => {
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
});
```
NOTA: o builder mock acima é uma APROXIMAÇÃO. O implementer DEVE inspecionar como `synthesize.ts` realmente encadeia as queries (select/eq/gt/order/limit/maybeSingle/upsert) e alinhar o mock ao encadeamento real. O contrato dos testes (no-op <3, chama classifyHaiku ≥3, cap 20, sem upsert em erro, sentinel fora dos logs) é o que vale — ajuste a forma do builder, não as asserções.

- [ ] **3.4: RED** — falha (módulo não existe).

- [ ] **3.5: Implementar synthesize.ts**
```ts
/**
 * Síntese incremental da micro-memória (slice B). Lê user_memory + reflexões
 * novas, chama Haiku (com fallback Gemini interno do classifyHaiku), valida e
 * grava. Threshold gate em maybeSynthesizeMemory.
 *
 * Privacy ★ALTO: nunca loga body/ai_response/findings — só metadata.
 * @module shared/memory/synthesize
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { classifyHaiku } from '@/shared/ai/client';
import { MEMORY_SYNTHESIS_PROMPT } from '@/shared/ai/prompts/memory-synthesis';
import { MAX_FINDINGS, SYNTHESIS_THRESHOLD, sanitizeFindings, type MemoryFinding } from './types';

type MemoryRow = { findings: MemoryFinding[]; last_synthesized_at: string | null; source_count: number };

/**
 * Dispara síntese SE houver ≥ SYNTHESIS_THRESHOLD reflexões novas desde a
 * última. Best-effort interno: erros são engolidos com log de metadata.
 */
export async function maybeSynthesizeMemory(userId: string, supabase: SupabaseClient): Promise<void> {
  try {
    const { data: mem } = await supabase
      .from('user_memory')
      .select('findings, last_synthesized_at, source_count')
      .eq('user_id', userId)
      .maybeSingle();

    const current: MemoryRow = {
      findings: sanitizeFindings((mem as MemoryRow | null)?.findings),
      last_synthesized_at: (mem as MemoryRow | null)?.last_synthesized_at ?? null,
      source_count: (mem as MemoryRow | null)?.source_count ?? 0,
    };

    // Reflexões novas desde a última síntese (ou todas se nunca sintetizou).
    let q = supabase
      .from('journal_entries')
      .select('id, body, ai_response, created_at')
      .eq('user_id', userId);
    if (current.last_synthesized_at) {
      q = q.gt('created_at', current.last_synthesized_at);
    }
    const { data: rows } = await q.order('created_at', { ascending: false }).limit(MAX_FINDINGS);
    const newReflections = (rows as Array<{ id: string; body: string; ai_response: string | null; created_at: string }> | null) ?? [];

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
  supabase: SupabaseClient,
  current: MemoryRow,
  newReflections: Array<{ id: string; body: string; ai_response: string | null; created_at: string }>,
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

  const findings = sanitizeFindings(raw).slice(0, MAX_FINDINGS);
  if (findings.length === 0 && current.findings.length > 0) {
    // modelo devolveu vazio mas já tínhamos memória — não destrói; aborta.
    return;
  }

  const { error } = await supabase.from('user_memory').upsert({
    user_id: userId,
    findings,
    last_synthesized_at: new Date().toISOString(),
    source_count: current.source_count + newReflections.length,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    console.error('[memory] upsert_failed', { user_id: userId, error_code: error.code ?? 'unknown' });
  }
}
```
NOTA: se `classifyHaiku` lançar (Haiku+Gemini falham), o throw sobe até o catch de `maybeSynthesizeMemory` → log de metadata + sem upsert (CA-MM-5/CA-MM-6 satisfeitos). Confirme que o tipo `SupabaseClient` importa sem exigir o generic `Database` (use `SupabaseClient` sem parâmetro, ou `SupabaseClient<Database>` se o lint exigir — alinhe ao que o projeto usa em server.ts).

- [ ] **3.6: GREEN** — `pnpm test -- src/shared/memory/synthesize.test.ts` → 5 PASS. `pnpm typecheck` → 0.
- [ ] **3.7: Commit**
```bash
git -C "/d/companion-app" add apps/web/src/shared/memory/types.ts apps/web/src/shared/ai/prompts/memory-synthesis.ts apps/web/src/shared/memory/synthesize.ts apps/web/src/shared/memory/synthesize.test.ts
git -C "/d/companion-app" commit -m "feat(memory): synthesizeMemory incremental + threshold (CA-MM-2..6)"
```

---

### Task 4: read-feedback (TDD, sonnet)

**Files:** Modify `apps/web/src/shared/ai/prompts/reflection-empathic.ts`, `apps/web/src/app/api/reflect/route.ts`; Test `apps/web/src/app/api/reflect/route.test.ts`

- [ ] **4.1: ADD buildReflectionSystemPrompt em reflection-empathic.ts** (após o export do prompt base):
```ts
import type { MemoryFinding } from '@/shared/memory/types';

/**
 * Compõe o system prompt da reflexão com a micro-memória (read-feedback).
 * Sem findings → retorna o prompt base puro. Instrui sensibilidade (tom, não
 * conteúdo; sem citar contagens nem confrontar).
 */
export function buildReflectionSystemPrompt(findings: MemoryFinding[]): string {
  if (!findings || findings.length === 0) return REFLECTION_EMPATHIC_SYSTEM_PROMPT;
  const block = [
    '',
    '[Contexto acumulado sobre quem escreve — use com sensibilidade, não cite',
    'literalmente nem confronte, não despeje contagens:]',
    ...findings.map((f) => `- ${f.text}`),
  ].join('\n');
  return REFLECTION_EMPATHIC_SYSTEM_PROMPT + '\n' + block;
}
```

- [ ] **4.2: ADD teste em route.test.ts** (CA-MM-8). Mock do select user_memory: o teste existente já mocka `createServerClient` com `from`. ADD um handle pro `from('user_memory')` retornar findings, e asserir que `chatStream` recebeu `system` contendo o bloco:
```ts
  it('CA-MM-8: /reflect com findings → chatStream recebe system com bloco de memória', async () => {
    // configure o mock supabase: from('user_memory').select().eq().maybeSingle() → { data: { findings: [{ text: 'padrão X', ... }] } }
    // configure insert journal_entries OK + getUser OK (como nos testes de happy path)
    chatStreamMock.mockImplementation(() => makeAsyncIter(['ok']));
    const { POST } = await import('@/app/api/reflect/route');
    await readStream(await POST(makeJsonRequest({ content: 'minha reflexão' })));
    const systemArg = chatStreamMock.mock.calls[0][0].system as string;
    expect(systemArg).toContain('padrão X');
    expect(systemArg).toContain('Contexto acumulado');
  });

  it('CA-MM-8b: sem findings → chatStream recebe prompt base puro (sem bloco)', async () => {
    // from('user_memory') → { data: null } (sem memória)
    chatStreamMock.mockImplementation(() => makeAsyncIter(['ok']));
    const { POST } = await import('@/app/api/reflect/route');
    await readStream(await POST(makeJsonRequest({ content: 'minha reflexão' })));
    const systemArg = chatStreamMock.mock.calls[0][0].system as string;
    expect(systemArg).not.toContain('Contexto acumulado');
  });
```
NOTA: o mock atual de `createServerClient` no route.test.ts tem `from` único (journal_entries). Você precisa torná-lo table-aware: `from(table)` retorna o builder de user_memory (select/eq/maybeSingle) OU o de journal_entries (insert/select/single) conforme o nome. REUSE os handles existentes (getUserMock, insert) e ADD o de user_memory. NÃO modifique os testes existentes — só estenda o `fromMock.mockImplementation` no beforeEach se ele já existir, ou ADD a lógica table-aware preservando o comportamento dos testes atuais (todos esperam journal_entries funcionando).

- [ ] **4.3: RED**.

- [ ] **4.4: Implementar no route.ts** — entre o auth check (após `userId`) e o INSERT, OU entre o INSERT e o stream (precisa antes do `chatStream`). Ler findings e compor o system:

(a) ADD imports:
```ts
import { buildReflectionSystemPrompt } from '@/shared/ai/prompts/reflection-empathic';
import { sanitizeFindings } from '@/shared/memory/types';
```
(troque o import existente de `REFLECTION_EMPATHIC_SYSTEM_PROMPT` se necessário — mantenha-o também, buildReflectionSystemPrompt o usa internamente.)

(b) ANTES do `new ReadableStream` (após obter reflectionId), leia findings:
```ts
  // Read-feedback: micro-memória no system prompt (best-effort — falha degrada
  // pro prompt base). Leitura com a session do usuário (RLS owner).
  let systemPrompt = REFLECTION_EMPATHIC_SYSTEM_PROMPT;
  try {
    const { data: mem } = await supabase
      .from('user_memory')
      .select('findings')
      .eq('user_id', userId)
      .maybeSingle();
    systemPrompt = buildReflectionSystemPrompt(sanitizeFindings((mem as { findings?: unknown } | null)?.findings));
  } catch {
    // sem memória / erro → prompt base (já default acima)
  }
```

(c) No `chatStream(...)`, troque `system: REFLECTION_EMPATHIC_SYSTEM_PROMPT` por `system: systemPrompt`.

- [ ] **4.5: GREEN** — route.test.ts PASS. Suite + typecheck.
- [ ] **4.6: Commit**
```bash
git -C "/d/companion-app" add apps/web/src/shared/ai/prompts/reflection-empathic.ts apps/web/src/app/api/reflect/route.ts apps/web/src/app/api/reflect/route.test.ts
git -C "/d/companion-app" commit -m "feat(memory): read-feedback dos findings no system prompt do /reflect (CA-MM-8)"
```

---

### Task 5: trigger síntese best-effort (TDD, sonnet)

**Files:** Modify `apps/web/src/app/api/reflect/route.ts`; Test `apps/web/src/app/api/reflect/route.test.ts`

- [ ] **5.1: ADD teste CA-MM-9** (mock de maybeSynthesizeMemory):
No topo, ADD mock:
```ts
const maybeSynthesizeMock = vi.fn();
vi.mock('@/shared/memory/synthesize', () => ({
  maybeSynthesizeMemory: (...a: unknown[]) => maybeSynthesizeMock(...a),
}));
```
ADD teste:
```ts
  it('CA-MM-9: síntese falha/timeout não afeta o stream nem o ai_response', async () => {
    maybeSynthesizeMock.mockRejectedValueOnce(new Error('synth boom'));
    // happy path: getUser OK, insert OK, chatStream yields 'resposta', save OK
    chatStreamMock.mockImplementation(() => makeAsyncIter(['resposta ok']));
    const { POST } = await import('@/app/api/reflect/route');
    const text = await readStream(await POST(makeJsonRequest({ content: 'minha reflexão' })));
    expect(text).toContain('resposta ok'); // stream intacto
    // maybeSynthesize foi chamado (best-effort, no finally) mas sua falha não quebrou nada
    expect(maybeSynthesizeMock).toHaveBeenCalled();
  });
```
NOTA: como a síntese é best-effort com timeout, o teste só garante que a falha NÃO propaga. Se o helper de timeout for `Promise.race`, a rejeição é engolida — confirme que `maybeSynthesizeMemory` é chamado dentro de um wrapper que nunca relança (igual `saveAiResponse`).

- [ ] **5.2: RED** (maybeSynthesize ainda não é chamado no route).

- [ ] **5.3: Implementar trigger no route.ts** — no `finally` do stream, após `saveAiResponse`:

(a) ADD import:
```ts
import { maybeSynthesizeMemory } from '@/shared/memory/synthesize';
```

(b) ADD helper module-level (espelha o timeout do saveAiResponse):
```ts
const SYNTH_TIMEOUT_MS = 5000;

/** Dispara a síntese best-effort com timeout — NUNCA relança. */
async function triggerSynthesis(userId: string, supabase: Awaited<ReturnType<typeof createServerClient>>): Promise<void> {
  try {
    const synth = maybeSynthesizeMemory(userId, supabase);
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
```
(`maybeSynthesizeMemory` já engole erros internamente, mas o wrapper com timeout garante que um hang não segura o close do stream — mesma proteção do save.)

(c) No `finally`, após o `saveAiResponse`:
```ts
      } finally {
        if (aiSucceeded) {
          await saveAiResponse(reflectionId, accumulated);
        }
        await triggerSynthesis(userId, supabase);
        controller.close();
      }
```
(Síntese roda mesmo se a IA falhou — a reflexão nova ainda conta pro threshold; mas só vale se houver ≥3 acumuladas. O threshold gate decide.)

- [ ] **5.4: GREEN** — route.test.ts PASS. Suite completa + typecheck + build.
- [ ] **5.5: Commit**
```bash
git -C "/d/companion-app" add apps/web/src/app/api/reflect/route.ts apps/web/src/app/api/reflect/route.test.ts
git -C "/d/companion-app" commit -m "feat(memory): trigger síntese best-effort no /reflect com timeout (CA-MM-9)"
```

---

### Task 6: QA gate + smoke live (INLINE + HUMAN GATE)

- [ ] **6.1: QA (CA-MM-10).** `pnpm test` + `pnpm typecheck` + `pnpm build` → `record-dispatch --role qa --result done` + `workflow verdict --verdict PASS`.
- [ ] **6.2: Review.** Dispatch reviewer no diff `main..feat/micro-memory` (spec + quality, ★ALTO no privacy CA-MM-6 e no best-effort CA-MM-9). `record-dispatch --role reviewer`. Fixes se houver.
- [ ] **6.3: PAUSA — HUMAN GATE (Pacini):**
  1. Aplicar 0009 no live (Dashboard SQL Editor): conteúdo da migration. `user_memory` é tabela nova — aplica limpo.
  2. Smoke CA-MM-11: escrever ≥3 reflexões no app live → conferir (via SQL Editor ou log) que `user_memory.findings` foi populado; a reflexão seguinte deve responder com awareness sutil dos padrões.
- [ ] **6.4: PR** via `gh pr create --body-file`, bind PR, transition `human-review`. Merge SÓ com aprovação explícita do Pacini.

---

## Self-Review (controller)

- **Spec coverage:** CA-MM-1 (T1), CA-MM-7 (T2), CA-MM-2..6 (T3), CA-MM-8 (T4), CA-MM-9 (T5), CA-MM-10..11 (T6). ✅
- **D-MM-5** (session user, não service role): T3 e T4 usam o `supabase` da session; nenhum `createServiceClient`. ✅
- **Best-effort** (D-MM-1, timeout): T5 `triggerSynthesis` com Promise.race + maybeSynthesize engole erros. ✅
- **Privacy ★ALTO:** sanitizeFindings + logs de metadata; sentinel em T3. ✅
- **Type consistency:** `MemoryFinding`/`sanitizeFindings`/`SYNTHESIS_THRESHOLD`/`MAX_FINDINGS` (T3 types.ts) usados consistentes em synthesize (T3), reflection-empathic (T4), route (T4). `maybeSynthesizeMemory(userId, supabase)` assinatura idêntica em T3 (def), T5 (uso/mock). ✅
- **Riscos sinalizados:** mocks de supabase builder (T3/T4) são aproximações — implementer alinha ao encadeamento real, asserções valem. Forma do `@google/genai` (T2) e modelo Gemini — verificar na versão instalada.
