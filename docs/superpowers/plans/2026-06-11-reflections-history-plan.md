# Reflections History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persistir respostas da IA por reflexão e expor histórico paginado em `/reflections` (GET + UI).

**Architecture:** Coluna `ai_response`/`ai_response_at` em `journal_entries` gravada best-effort via service client pós-stream; GET paginado por cursor lendo com session do usuário (RLS `owner_select`); página `/reflections` Client Component com state machine union. Spec: `docs/superpowers/specs/2026-06-11-reflections-history-design.md` (commit 4e8fa6d).

**Tech Stack:** Next.js 15 App Router, Supabase (`@supabase/ssr` + service role), Vitest + Testing Library, pnpm. App em `apps/web`.

**Workflow playbook:** `reflections-history` (risk desenvolvimento) ativo — controller registra `legion workflow record-dispatch` por executor/qa/reviewer.

**Regras transversais:**
- NUNCA `git add .` — paths explícitos.
- Privacy gate ★ALTO: `body`/`ai_response` NUNCA em logs (testes sentinel).
- Testes existentes em `route.test.ts`: NÃO modificar casos existentes, só ADD.
- Comandos de teste rodam em `D:\companion-app\apps\web`.

---

### Task 0: Pre-flight (INLINE controller, não subagent)

- [ ] **Step 0.1:** `git -C "D:\companion-app" branch --show-current` → esperado `feat/reflections-history` (já existe, spec commitada em 4e8fa6d).
- [ ] **Step 0.2:** Baseline: `pnpm test` em apps/web → esperado `71 passed | 5 skipped`.
- [ ] **Step 0.3:** Workflow → `legion workflow transition --to planned --note "Plano commitado"` e depois `--to approved` + `--to executing` quando Pacini autorizar execução.

---

### Task 1: Migration 0008 + types.ts regen (model: haiku)

**Files:**
- Create: `supabase/migrations/0008_journal_entries_ai_response.sql`
- Modify: `apps/web/src/shared/db/types.ts` (regen, não manual)

- [ ] **Step 1.1: Criar migration**

```sql
-- migration: 0008_journal_entries_ai_response
-- purpose: persistir resposta da IA por reflexao (feature reflections-history).
-- spec: docs/superpowers/specs/2026-06-11-reflections-history-design.md
--
-- ai_response: texto completo da resposta (so stream completo, best-effort
--   via service_role — policy service_role_update da 0006 ja cobre).
-- ai_response_at: quando a resposta foi gravada (insumo micro-memoria).
--
-- RLS: ZERO mudanca. Dono continua sem UPDATE (append-only preservado).
-- Apply no live: MANUAL via Dashboard SQL Editor (drift conhecido — ver
-- memoria project-companion-supabase-schema-drift). NAO usar db push.

ALTER TABLE public.journal_entries
  ADD COLUMN ai_response text NULL,
  ADD COLUMN ai_response_at timestamptz NULL;
```

- [ ] **Step 1.2: Regenerar types.ts** (pattern validado no PR #9 — `supabase start` do CLI 2.98 é bugado em DB fresca; usar container descartável):

```bash
docker run -d --name types-pg -e POSTGRES_PASSWORD=postgres -p 55432:5432 public.ecr.aws/supabase/postgres:17.6.1.084
# aguardar: docker exec types-pg pg_isready -U postgres (loop até READY)
cd /d/companion-app
for f in supabase/migrations/000{1,2,3,4,5,6,8}_*.sql; do
  docker exec -i types-pg psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$f"
done
cd apps/web
pnpm exec supabase gen types typescript --db-url "postgresql://postgres:postgres@127.0.0.1:55432/postgres" 2>/dev/null > /tmp/types-new.ts
# prepend o header de 7 linhas existente (Auto-generated... DO NOT EDIT BY HAND)
{ head -7 src/shared/db/types.ts; cat /tmp/types-new.ts; } > src/shared/db/types.ts.tmp && mv src/shared/db/types.ts.tmp src/shared/db/types.ts
docker rm -f types-pg
```

(Não existe 0007 no diretório — range `000{1..6,8}` correto.)

- [ ] **Step 1.3: Verificar diff** — `git diff apps/web/src/shared/db/types.ts` deve mostrar SÓ +6 linhas: `ai_response: string | null` + `ai_response_at: string | null` no Row e variantes `?` em Insert/Update de `journal_entries`. Nenhuma remoção.

- [ ] **Step 1.4: Typecheck** — `pnpm typecheck` → exit 0.

- [ ] **Step 1.5: Commit**

```bash
git add supabase/migrations/0008_journal_entries_ai_response.sql apps/web/src/shared/db/types.ts
git commit -m "feat(db): migration 0008 ai_response/ai_response_at + types regen"
```

---

### Task 2: POST /api/reflect — save best-effort (TDD, model: sonnet)

**Files:**
- Modify: `apps/web/src/app/api/reflect/route.ts`
- Test: `apps/web/src/app/api/reflect/route.test.ts` (ADD: 1 bloco de mock no topo + 1 describe novo; NÃO tocar nos casos existentes)

- [ ] **Step 2.1: ADD mock do service client no topo do route.test.ts** (junto aos vi.mock existentes, após o mock de prompts ~linha 49):

```ts
// --- Mocks reflections-history (service client, caminho de escrita) ---
type ServiceUpdateResult = { error: { code?: string } | null };
let serviceUpdateResult: ServiceUpdateResult = { error: null };

const serviceUpdateMock = vi.fn();
const serviceEqMock = vi.fn();
const serviceFromMock = vi.fn();

vi.mock('@/shared/db/service', () => ({
  createServiceClient: vi.fn(() => ({ from: serviceFromMock })),
}));
```

- [ ] **Step 2.2: ADD describe novo no fim do arquivo** (com beforeEach próprio pros handles de service — o beforeEach global existente NÃO é tocado; `vi.clearAllMocks()` global já limpa os novos mocks):

```ts
// ---------------------------------------------------------------------------
// reflections-history: persistencia best-effort da resposta IA (CA-RH-1..4)
// ---------------------------------------------------------------------------

describe('POST /api/reflect — ai_response save (reflections-history)', () => {
  const USER = { id: 'user-rh' };
  const REFLECTION_ID = 'rh-reflection-1';

  beforeEach(() => {
    serviceUpdateResult = { error: null };
    serviceFromMock.mockImplementation(() => ({
      update: serviceUpdateMock.mockImplementation(() => ({
        eq: serviceEqMock.mockImplementation(async () => serviceUpdateResult),
      })),
    }));
    getUserResult = { data: { user: USER }, error: null };
    insertSingleResult = { data: { id: REFLECTION_ID }, error: null };
  });

  it('CA-RH-1: stream completo → service update com texto completo + ai_response_at', async () => {
    chatStreamMock.mockImplementation(() => makeAsyncIter(['Olá', ' mundo']));
    const { POST } = await import('@/app/api/reflect/route');

    const response = await POST(makeJsonRequest({ content: 'minha reflexão' }));
    await readStream(response);

    expect(serviceFromMock).toHaveBeenCalledWith('journal_entries');
    expect(serviceUpdateMock).toHaveBeenCalledWith({
      ai_response: 'Olá mundo',
      ai_response_at: expect.any(String),
    });
    expect(serviceEqMock).toHaveBeenCalledWith('id', REFLECTION_ID);
  });

  it('CA-RH-2: update falha → stream do usuário intacto + log sem conteúdo', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    serviceUpdateResult = { error: { code: '42P01' } };
    chatStreamMock.mockImplementation(() => makeAsyncIter(['resposta ok']));
    const { POST } = await import('@/app/api/reflect/route');

    const response = await POST(makeJsonRequest({ content: 'minha reflexão' }));
    const text = await readStream(response);

    expect(text).toContain('resposta ok'); // stream não afetado
    expect(text).not.toContain('ai_unavailable');
    const saveLog = consoleSpy.mock.calls.find(
      (c) => c[0] === '[reflect] ai_response_save_failed',
    );
    expect(saveLog).toBeDefined();
    expect(JSON.stringify(saveLog)).not.toContain('resposta ok');
    expect(JSON.stringify(saveLog)).not.toContain('minha reflexão');
  });

  it('CA-RH-3: erro do modelo → nada salvo (nem parcial)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    chatStreamMock.mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        yield 'parcial';
        throw new Error('boom');
      },
    }));
    const { POST } = await import('@/app/api/reflect/route');

    const response = await POST(makeJsonRequest({ content: 'minha reflexão' }));
    const text = await readStream(response);

    expect(text).toContain('ai_unavailable');
    expect(serviceUpdateMock).not.toHaveBeenCalled();
  });

  it('CA-RH-4 ★ALTO: sentinel (body + resposta IA) nunca em logs, mesmo com save falhando', async () => {
    const sentinelBody = `<<SENTINEL_${randomUUID()}_BODY>>`;
    const sentinelAi = `<<SENTINEL_${randomUUID()}_AI>>`;
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'info').mockImplementation(() => {}),
    ];
    serviceUpdateResult = { error: { code: 'XX' } };
    chatStreamMock.mockImplementation(() => makeAsyncIter([sentinelAi]));
    const { POST } = await import('@/app/api/reflect/route');

    const response = await POST(makeJsonRequest({ content: `reflexão com ${sentinelBody}` }));
    await readStream(response);

    for (const spy of spies) {
      const all = JSON.stringify(spy.mock.calls);
      expect(all).not.toContain(sentinelBody);
      expect(all).not.toContain(sentinelAi);
    }
  });
});
```

- [ ] **Step 2.3: Rodar — RED.** `pnpm test -- src/app/api/reflect/route.test.ts` → 4 novos FAIL (serviceUpdateMock não chamado / log inexistente), 12 existentes PASS.

- [ ] **Step 2.4: Implementar em route.ts.** Mudanças exatas:

(a) ADD import (junto aos imports existentes):
```ts
import { createServiceClient } from '@/shared/db/service';
```

(b) ADD helper module-level (após `jsonResponse`):
```ts
/**
 * Persiste a resposta completa da IA best-effort (D-RH-2). NUNCA lança —
 * falha aqui não pode afetar o stream já entregue ao usuário.
 * Privacy gate: loga só reflection_id + error_code, nunca o texto.
 */
async function saveAiResponse(reflectionId: string, text: string): Promise<void> {
  try {
    const service = createServiceClient();
    const { error } = await service
      .from('journal_entries')
      .update({ ai_response: text, ai_response_at: new Date().toISOString() })
      .eq('id', reflectionId);
    if (error) {
      console.error('[reflect] ai_response_save_failed', {
        reflection_id: reflectionId,
        error_code: error.code ?? 'unknown',
      });
    }
  } catch (err) {
    console.error('[reflect] ai_response_save_failed', {
      reflection_id: reflectionId,
      error_code: err instanceof Error ? err.constructor.name : 'unknown',
    });
  }
}
```

(c) MODIFY o corpo do `start(controller)` — acumular + flag + save no finally (contrato do stream INALTERADO):
```ts
    async start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(
        encoder.encode(JSON.stringify({ reflection_id: reflectionId }) + '\n'),
      );
      let accumulated = '';
      let aiSucceeded = false;
      try {
        for await (const chunk of chatStream({
          system: REFLECTION_EMPATHIC_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: trimmed }],
        })) {
          accumulated += chunk;
          controller.enqueue(encoder.encode(chunk));
        }
        aiSucceeded = true;
      } catch (err) {
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
        if (aiSucceeded) {
          await saveAiResponse(reflectionId, accumulated);
        }
        controller.close();
      }
    },
```
(Comentários existentes do catch sobre privacy podem ser preservados — só o corpo do try e o finally mudam.)

- [ ] **Step 2.5: Rodar — GREEN.** `pnpm test -- src/app/api/reflect/route.test.ts` → 16 PASS (12 antigos + 4 novos).

- [ ] **Step 2.6: Commit**
```bash
git add apps/web/src/app/api/reflect/route.ts apps/web/src/app/api/reflect/route.test.ts
git commit -m "feat(reflect): persiste resposta IA best-effort pos-stream (CA-RH-1..4)"
```

---

### Task 3: GET /api/reflections (TDD, model: sonnet)

**Files:**
- Create: `apps/web/src/app/api/reflections/route.ts`
- Test: `apps/web/src/app/api/reflections/route.test.ts`

- [ ] **Step 3.1: Escrever testes (arquivo novo completo)**

```ts
/**
 * Tests for GET /api/reflections — historico paginado por cursor.
 * Mocks @/shared/db/server. CA-RH-5..8 + privacy sentinel.
 * @module app/api/reflections/route.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

type GetUserResult = {
  data: { user: { id: string } | null };
  error: { code?: string } | null;
};
type QueryResult = {
  data: Array<Record<string, unknown>> | null;
  error: { code?: string } | null;
};

let getUserResult: GetUserResult = { data: { user: null }, error: null };
let queryResult: QueryResult = { data: [], error: null };

const getUserMock = vi.fn();
const fromMock = vi.fn();
const selectMock = vi.fn();
const orderMock = vi.fn();
const limitMock = vi.fn();
const ltMock = vi.fn();

function makeBuilder() {
  const builder: Record<string, unknown> = {};
  builder.select = selectMock.mockImplementation(() => builder);
  builder.order = orderMock.mockImplementation(() => builder);
  builder.limit = limitMock.mockImplementation(() => builder);
  builder.lt = ltMock.mockImplementation(() => builder);
  builder.then = (resolve: (v: QueryResult) => void) => resolve(queryResult);
  return builder;
}

vi.mock('@/shared/db/server', () => ({
  createServerClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
    from: fromMock,
  })),
}));

function makeRow(i: number): Record<string, unknown> {
  return {
    id: `id-${i}`,
    body: `reflexão ${i}`,
    created_at: `2026-06-${String(30 - i).padStart(2, '0')}T12:00:00Z`,
    ai_response: i % 2 === 0 ? `resposta ${i}` : null,
    ai_response_at: i % 2 === 0 ? `2026-06-${String(30 - i).padStart(2, '0')}T12:00:05Z` : null,
  };
}

function makeRequest(query = ''): Request {
  return new Request(`http://localhost:3000/api/reflections${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserResult = { data: { user: { id: 'user-1' } }, error: null };
  queryResult = { data: [], error: null };
  getUserMock.mockImplementation(async () => getUserResult);
  fromMock.mockImplementation(() => makeBuilder());
});

describe('GET /api/reflections', () => {
  it('CA-RH-5: sem session → 401', async () => {
    getUserResult = { data: { user: null }, error: null };
    const { GET } = await import('@/app/api/reflections/route');
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it('CA-RH-6: shape {reflections, next_cursor} com select/order corretos', async () => {
    queryResult = { data: [makeRow(1), makeRow(2)], error: null };
    const { GET } = await import('@/app/api/reflections/route');
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reflections).toHaveLength(2);
    expect(body.next_cursor).toBeNull();
    expect(fromMock).toHaveBeenCalledWith('journal_entries');
    expect(selectMock).toHaveBeenCalledWith('id, body, created_at, ai_response, ai_response_at');
    expect(orderMock).toHaveBeenCalledWith('created_at', { ascending: false });
  });

  it('CA-RH-7: limit+1 rows → next_cursor = created_at da última da página', async () => {
    queryResult = { data: Array.from({ length: 21 }, (_, i) => makeRow(i)), error: null };
    const { GET } = await import('@/app/api/reflections/route');
    const res = await GET(makeRequest('?limit=20'));
    const body = await res.json();
    expect(body.reflections).toHaveLength(20);
    expect(body.next_cursor).toBe(body.reflections[19].created_at);
    expect(limitMock).toHaveBeenCalledWith(21);
  });

  it('CA-RH-7b: cursor before vira filtro lt exclusivo', async () => {
    queryResult = { data: [makeRow(5)], error: null };
    const { GET } = await import('@/app/api/reflections/route');
    await GET(makeRequest('?before=2026-06-25T12:00:00Z'));
    expect(ltMock).toHaveBeenCalledWith('created_at', '2026-06-25T12:00:00Z');
  });

  it('CA-RH-8: before inválido → 400 invalid_cursor', async () => {
    const { GET } = await import('@/app/api/reflections/route');
    const res = await GET(makeRequest('?before=nao-e-data'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_cursor' });
  });

  it('CA-RH-8b: limit fora de 1-50 → clamp (0→1, 999→50, lixo→default 20)', async () => {
    queryResult = { data: [], error: null };
    const { GET } = await import('@/app/api/reflections/route');
    await GET(makeRequest('?limit=999'));
    expect(limitMock).toHaveBeenLastCalledWith(51);
    await GET(makeRequest('?limit=0'));
    expect(limitMock).toHaveBeenLastCalledWith(2);
    await GET(makeRequest('?limit=abc'));
    expect(limitMock).toHaveBeenLastCalledWith(21);
  });

  it('db error → 500 db_error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    queryResult = { data: null, error: { code: '42P01' } };
    const { GET } = await import('@/app/api/reflections/route');
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'db_error' });
  });

  it('CA-RH-4 ★ALTO: body/ai_response (sentinel) nunca em logs no caminho de erro', async () => {
    const sentinel = `<<SENTINEL_${randomUUID()}_END>>`;
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
    ];
    queryResult = { data: null, error: { code: sentinel } as { code?: string } };
    const { GET } = await import('@/app/api/reflections/route');
    await GET(makeRequest());
    // error_code é metadata permitida; o teste real: rows com sentinel no
    // happy path não aparecem em log nenhum.
    queryResult = { data: [{ ...makeRow(1), body: sentinel, ai_response: sentinel }], error: null };
    await GET(makeRequest());
    for (const spy of spies) {
      const all = JSON.stringify(spy.mock.calls);
      expect(all).not.toContain(`"body":"${sentinel}"`);
      expect(all).not.toContain(`reflexão ${sentinel}`);
    }
  });
});
```

- [ ] **Step 3.2: RED.** `pnpm test -- src/app/api/reflections/route.test.ts` → FAIL (module not found).

- [ ] **Step 3.3: Implementar route.ts**

```ts
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
  const nextCursor = hasMore ? (page[page.length - 1].created_at as string) : null;

  return jsonResponse(200, { reflections: page, next_cursor: nextCursor });
}
```

Nota de tipo: com types.ts regenerado (Task 1), o `select` tipado resolve `created_at` como string — se o builder mockado confundir a inferência nos testes, manter o cast `as string` acima (já incluso).

- [ ] **Step 3.4: GREEN.** 8 PASS.
- [ ] **Step 3.5: Suite + typecheck.** `pnpm test` (sem regressão) + `pnpm typecheck` exit 0.
- [ ] **Step 3.6: Commit**
```bash
git add apps/web/src/app/api/reflections/route.ts apps/web/src/app/api/reflections/route.test.ts
git commit -m "feat(reflections): GET /api/reflections paginado por cursor (CA-RH-5..8)"
```

---

### Task 4: UI /reflections + link (TDD, model: sonnet)

**Files:**
- Create: `apps/web/src/app/reflections/page.tsx`
- Create: `apps/web/src/app/reflections/ReflectionsList.tsx`
- Test: `apps/web/src/app/reflections/ReflectionsList.test.tsx`
- Modify: `apps/web/src/app/reflect/page.tsx` (link "Ver histórico")

- [ ] **Step 4.1: Escrever testes (arquivo novo completo)** — fetch stubado; padrão Testing Library dos forms existentes:

```tsx
/**
 * Tests for ReflectionsList — historico com Carregar mais.
 * CA-RH-9..11. Mock de fetch global (vi.stubGlobal).
 * @module app/reflections/ReflectionsList.test
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReflectionsList } from './ReflectionsList';

type ApiPage = {
  reflections: Array<{
    id: string;
    body: string;
    created_at: string;
    ai_response: string | null;
    ai_response_at: string | null;
  }>;
  next_cursor: string | null;
};

const fetchMock = vi.fn();

function jsonOk(page: ApiPage): Response {
  return new Response(JSON.stringify(page), { status: 200 });
}

function makeItem(i: number, ai: string | null = `resposta ${i}`): ApiPage['reflections'][0] {
  return {
    id: `id-${i}`,
    body: `reflexão número ${i}`,
    created_at: `2026-06-0${i}T12:00:00Z`,
    ai_response: ai,
    ai_response_at: ai ? `2026-06-0${i}T12:00:05Z` : null,
  };
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('ReflectionsList', () => {
  it('CA-RH-9: loading → ready com itens (body + resposta IA)', async () => {
    fetchMock.mockResolvedValueOnce(jsonOk({ reflections: [makeItem(1)], next_cursor: null }));
    render(<ReflectionsList />);
    expect(screen.getByText('Carregando...')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('reflexão número 1')).toBeTruthy());
    expect(screen.getByText('resposta 1')).toBeTruthy();
  });

  it('CA-RH-9b: zero reflexões → estado empty com link pro /reflect', async () => {
    fetchMock.mockResolvedValueOnce(jsonOk({ reflections: [], next_cursor: null }));
    render(<ReflectionsList />);
    await waitFor(() => expect(screen.getByText(/Nenhuma reflexão ainda/)).toBeTruthy());
    expect(screen.getByRole('link', { name: /refletir/i })).toBeTruthy();
  });

  it('CA-RH-9c: 401 → error auth; falha de rede → error network', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    const { unmount } = render(<ReflectionsList />);
    await waitFor(() => expect(screen.getByText(/Sessão expirada/)).toBeTruthy());
    unmount();

    fetchMock.mockRejectedValueOnce(new Error('offline'));
    render(<ReflectionsList />);
    await waitFor(() => expect(screen.getByText(/Não foi possível carregar/)).toBeTruthy());
  });

  it('CA-RH-10: Carregar mais appenda itens e some no fim da lista', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonOk({ reflections: [makeItem(1)], next_cursor: '2026-06-01T12:00:00Z' }),
    );
    render(<ReflectionsList />);
    const btn = await screen.findByRole('button', { name: 'Carregar mais' });

    fetchMock.mockResolvedValueOnce(jsonOk({ reflections: [makeItem(2)], next_cursor: null }));
    await userEvent.click(btn);

    await waitFor(() => expect(screen.getByText('reflexão número 2')).toBeTruthy());
    expect(screen.getByText('reflexão número 1')).toBeTruthy(); // append, não replace
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).toBeNull(); // fim
    const secondCallUrl = String(fetchMock.mock.calls[1][0]);
    expect(secondCallUrl).toContain('before=2026-06-01T12%3A00%3A00Z');
  });

  it('CA-RH-11: ai_response NULL → "Sem resposta registrada"', async () => {
    fetchMock.mockResolvedValueOnce(jsonOk({ reflections: [makeItem(1, null)], next_cursor: null }));
    render(<ReflectionsList />);
    await waitFor(() => expect(screen.getByText('Sem resposta registrada')).toBeTruthy());
  });
});
```

- [ ] **Step 4.2: RED.** `pnpm test -- src/app/reflections/ReflectionsList.test.tsx` → FAIL (module not found).

- [ ] **Step 4.3: Implementar ReflectionsList.tsx**

```tsx
'use client';

/**
 * ReflectionsList — historico paginado de reflexoes com resposta IA.
 * Consome GET /api/reflections (cursor `before`, paginas de 20).
 *
 * State machine (padrao union do projeto):
 *   loading → ready | empty | error
 *   ready --Carregar mais--> loadingMore → ready (append) | error
 *
 * @module app/reflections/ReflectionsList
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Button } from '../../design-system/components/Button';

const PAGE_SIZE = 20;

type Reflection = {
  id: string;
  body: string;
  created_at: string;
  ai_response: string | null;
  ai_response_at: string | null;
};

type ListState =
  | { kind: 'loading' }
  | { kind: 'ready'; items: Reflection[]; nextCursor: string | null }
  | { kind: 'loadingMore'; items: Reflection[]; nextCursor: string }
  | { kind: 'empty' }
  | { kind: 'error'; code: 'auth' | 'network' };

type PageResult =
  | { reflections: Reflection[]; next_cursor: string | null }
  | { errorCode: 'auth' | 'network' };

async function fetchPage(before: string | null): Promise<PageResult> {
  try {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (before !== null) params.set('before', before);
    const res = await fetch(`/api/reflections?${params.toString()}`);
    if (res.status === 401) return { errorCode: 'auth' };
    if (!res.ok) return { errorCode: 'network' };
    return (await res.json()) as { reflections: Reflection[]; next_cursor: string | null };
  } catch {
    return { errorCode: 'network' };
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ReflectionsList() {
  const [state, setState] = useState<ListState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await fetchPage(null);
      if (cancelled) return;
      if ('errorCode' in result) {
        setState({ kind: 'error', code: result.errorCode });
      } else if (result.reflections.length === 0) {
        setState({ kind: 'empty' });
      } else {
        setState({ kind: 'ready', items: result.reflections, nextCursor: result.next_cursor });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLoadMore() {
    if (state.kind !== 'ready' || state.nextCursor === null) return;
    const { items, nextCursor } = state;
    setState({ kind: 'loadingMore', items, nextCursor });
    const result = await fetchPage(nextCursor);
    if ('errorCode' in result) {
      setState({ kind: 'error', code: result.errorCode });
      return;
    }
    setState({
      kind: 'ready',
      items: [...items, ...result.reflections],
      nextCursor: result.next_cursor,
    });
  }

  if (state.kind === 'loading') {
    return <p className="text-muted-foreground text-center">Carregando...</p>;
  }

  if (state.kind === 'empty') {
    return (
      <div className="max-w-2xl mx-auto p-6 border rounded-lg bg-card text-card-foreground text-center">
        <p className="text-muted-foreground">Nenhuma reflexão ainda.</p>
        <p className="mt-2">
          <Link href="/reflect" className="underline hover:text-foreground">
            Que tal refletir agora?
          </Link>
        </p>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <p className="text-destructive text-center">
        {state.code === 'auth'
          ? 'Sessão expirada. Entra de novo pra ver teu histórico.'
          : 'Não foi possível carregar o histórico. Tenta de novo.'}
      </p>
    );
  }

  const { items, nextCursor } = state;
  const isLoadingMore = state.kind === 'loadingMore';

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {items.map((item) => (
        <article
          key={item.id}
          className="p-6 border rounded-lg bg-card text-card-foreground space-y-3"
        >
          <time className="text-xs text-muted-foreground block" dateTime={item.created_at}>
            {formatDate(item.created_at)}
          </time>
          <p className="whitespace-pre-wrap">{item.body}</p>
          {item.ai_response !== null ? (
            <div className="border-l-2 border-muted pl-4">
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {item.ai_response}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">Sem resposta registrada</p>
          )}
        </article>
      ))}
      {nextCursor !== null && (
        <div className="text-center">
          <Button type="button" onClick={handleLoadMore} disabled={isLoadingMore}>
            {isLoadingMore ? 'Carregando...' : 'Carregar mais'}
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4.4: Implementar page.tsx (shell)**

```tsx
/**
 * /reflections — historico de reflexoes do usuario com respostas da IA.
 * Rota protegida (middleware redireciona sem session por default).
 *
 * Spec: docs/superpowers/specs/2026-06-11-reflections-history-design.md
 */

import Link from 'next/link';

import { ReflectionsList } from './ReflectionsList';

export default function ReflectionsPage() {
  return (
    <main className="min-h-screen py-12 px-4">
      <div className="max-w-2xl mx-auto mb-8 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Histórico de reflexões</h1>
        <Link
          href="/reflect"
          className="text-sm text-muted-foreground underline hover:text-foreground"
        >
          Refletir
        </Link>
      </div>
      <ReflectionsList />
    </main>
  );
}
```

- [ ] **Step 4.5: MODIFY reflect/page.tsx — link "Ver histórico"**

```tsx
/**
 * /reflect — daily reflection journaling page.
 * Stream-based form that posts to /api/reflect (T-009 backend).
 *
 * PRD: docs/plans/2026-05-24-frontend-reflect-design.md
 */

import Link from 'next/link';

import { ReflectForm } from './ReflectForm';

export default function ReflectPage() {
  return (
    <main className="min-h-screen py-12">
      <ReflectForm />
      <p className="text-center mt-6">
        <Link
          href="/reflections"
          className="text-sm text-muted-foreground underline hover:text-foreground"
        >
          Ver histórico
        </Link>
      </p>
    </main>
  );
}
```

- [ ] **Step 4.6: GREEN.** `pnpm test -- src/app/reflections/ReflectionsList.test.tsx` → 6 PASS.
- [ ] **Step 4.7: Suite completa + typecheck + build.** `pnpm test` (zero regressão) + `pnpm typecheck` + `pnpm build` (rota `/reflections` na tabela de output).
- [ ] **Step 4.8: Commit**
```bash
git add apps/web/src/app/reflections/page.tsx apps/web/src/app/reflections/ReflectionsList.tsx apps/web/src/app/reflections/ReflectionsList.test.tsx apps/web/src/app/reflect/page.tsx
git commit -m "feat(reflections): pagina /reflections com Carregar mais + link no /reflect (CA-RH-9..11)"
```

---

### Task 5: QA gate + smoke live (INLINE controller + HUMAN GATE)

- [ ] **Step 5.1: QA completo (CA-RH-12).** `pnpm test` + `pnpm typecheck` + `pnpm build` → registrar `record-dispatch --role qa --result done` + `workflow verdict --verdict PASS`.
- [ ] **Step 5.2: Review.** Dispatch reviewer subagent no diff `main..feat/reflections-history` (spec compliance + quality), `record-dispatch --role reviewer`. Fixes se houver.
- [ ] **Step 5.3: PAUSA — HUMAN GATE (Pacini):**
  1. Aplicar 0008 no live via Dashboard SQL Editor (conteúdo da migration; `journal_entries` é idêntica live↔repo, verificado 2026-06-11, então o ALTER aplica limpo)
  2. Smoke CA-RH-13: refletir no app live → abrir /reflections → reflexão + resposta visíveis
- [ ] **Step 5.4: PR** com `gh pr create` (body via `--body-file`), bind PR no workflow, transition `human-review`. Merge SÓ com aprovação explícita do Pacini.
