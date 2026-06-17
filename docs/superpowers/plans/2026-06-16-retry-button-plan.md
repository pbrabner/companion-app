# Retry button — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Botão "Tentar de novo" que re-gera a `ai_response` de reflexões com resposta NULL, via endpoint de stream, aparecendo no `/reflect` (após falha) e no `/reflections`.

**Architecture:** Extrai o corpo do stream do POST `/api/reflect` para um helper compartilhado; um novo endpoint `POST /api/reflect/[id]/retry` reusa o helper (sem síntese); o cliente reusa `parseReflectStream` via um helper `streamRetry`; dois componentes ganham o botão.

**Tech Stack:** Next.js 15.5 (App Router, async `params`), React 19, Supabase (@supabase/ssr), Vitest 2 + Testing Library 16, pnpm.

**Spec:** `docs/superpowers/specs/2026-06-16-retry-button-design.md` (commit a84b141)

**Comandos `pnpm`** rodam de `D:/companion-app/apps/web`.

---

## File Structure

- **Create:** `apps/web/src/app/api/reflect/response-stream.ts` — helper `buildReflectionResponseStream` + `saveAiResponse` (movido do route.ts).
- **Modify:** `apps/web/src/app/api/reflect/route.ts` — passa a usar o helper (síntese via `onComplete`).
- **Create:** `apps/web/src/app/api/reflect/[id]/retry/route.ts` — endpoint de retry.
- **Create:** `apps/web/src/app/api/reflect/[id]/retry/route.test.ts` — testes do endpoint.
- **Create:** `apps/web/src/app/reflect/stream-retry.ts` — helper cliente.
- **Create:** `apps/web/src/app/reflect/stream-retry.test.ts`.
- **Modify:** `apps/web/src/app/reflect/ReflectForm.tsx` (+ `.test.tsx`) — botão no `ai_unavailable`.
- **Modify:** `apps/web/src/app/reflections/ReflectionsList.tsx` (+ `.test.tsx`) — botão no item null.

---

## Task 0: Pre-flight (INLINE — controller)

- [ ] **Step 1: Branch + baseline**

Run: `cd D:/companion-app && git rev-parse --abbrev-ref HEAD`
Expected: `feat/retry-button`.

Run (de `apps/web`): `pnpm test src/app/api/reflect/route.test.ts src/app/reflect/ReflectForm.test.tsx src/app/reflections/ReflectionsList.test.tsx && pnpm typecheck`
Expected: tudo verde, typecheck 0.

---

## Task 1: Helper `buildReflectionResponseStream` + refactor do POST

**Files:**
- Create: `apps/web/src/app/api/reflect/response-stream.ts`
- Modify: `apps/web/src/app/api/reflect/route.ts`

Comportamento do POST permanece idêntico — os testes existentes de `route.test.ts` são a rede de segurança (não devem mudar).

- [ ] **Step 1: Criar o helper**

Conteúdo de `apps/web/src/app/api/reflect/response-stream.ts`:
```ts
/**
 * Constrói o ReadableStream de resposta empática usado por POST /api/reflect e
 * pelo endpoint de retry. Contrato: 1ª linha {reflection_id}, chunks de texto,
 * tail {error:"ai_unavailable"} em falha. Persiste a resposta best-effort em
 * sucesso. Privacy ★ALTO: nunca loga body/ai_response — só metadata + error_code.
 * @module app/api/reflect/response-stream
 */
import { chatStream } from '@/shared/ai/client';
import { createServiceClient } from '@/shared/db/service';

const SAVE_TIMEOUT_MS = 5000;

/**
 * Persiste a resposta completa da IA best-effort. NUNCA lança e resolve em no
 * máximo SAVE_TIMEOUT_MS. Loga só reflection_id + error_code.
 */
async function saveAiResponse(reflectionId: string, text: string): Promise<void> {
  try {
    const service = createServiceClient();
    const save = service
      .from('journal_entries')
      .update({ ai_response: text, ai_response_at: new Date().toISOString() })
      .eq('id', reflectionId)
      .then(({ error }) => (error ? (error.code ?? 'unknown') : null));
    const timeout = new Promise<string>((resolve) => {
      setTimeout(() => resolve('save_timeout'), SAVE_TIMEOUT_MS).unref?.();
    });
    const errorCode = await Promise.race([save, timeout]);
    if (errorCode !== null) {
      console.error('[reflect] ai_response_save_failed', {
        reflection_id: reflectionId,
        error_code: errorCode,
      });
    }
  } catch (err) {
    console.error('[reflect] ai_response_save_failed', {
      reflection_id: reflectionId,
      error_code: err instanceof Error ? err.constructor.name : 'unknown',
    });
  }
}

export interface BuildReflectionResponseStreamArgs {
  reflectionId: string;
  body: string;
  userId: string;
  systemPrompt: string;
  /** Hook pós-stream (ex.: disparar síntese). Só o POST passa. */
  onComplete?: () => Promise<void>;
}

/**
 * Stream da resposta empática: metadata → chatStream (acumula) → saveAiResponse
 * em sucesso, ou trailer ai_unavailable em falha. Roda onComplete no finally.
 */
export function buildReflectionResponseStream(
  args: BuildReflectionResponseStreamArgs,
): ReadableStream<Uint8Array> {
  const { reflectionId, body, userId, systemPrompt, onComplete } = args;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(
        encoder.encode(JSON.stringify({ reflection_id: reflectionId }) + '\n'),
      );
      let accumulated = '';
      let aiSucceeded = false;
      try {
        for await (const chunk of chatStream({
          system: systemPrompt,
          messages: [{ role: 'user', content: body }],
        })) {
          accumulated += chunk;
          controller.enqueue(encoder.encode(chunk));
        }
        aiSucceeded = true;
      } catch (err) {
        // Privacy: só a classe do erro, nunca err.message.
        const errCode = err instanceof Error ? err.constructor.name : 'unknown';
        console.error('[reflect] ai_unavailable', {
          user_id: userId,
          reflection_id: reflectionId,
          content_length: body.length,
          error_code: errCode,
        });
        controller.enqueue(
          encoder.encode(
            '\n' + JSON.stringify({ error: 'ai_unavailable', reflection_id: reflectionId }) + '\n',
          ),
        );
      } finally {
        if (aiSucceeded) await saveAiResponse(reflectionId, accumulated);
        if (onComplete) await onComplete();
        controller.close();
      }
    },
  });
}
```

- [ ] **Step 2: Refatorar o POST pra usar o helper**

Em `apps/web/src/app/api/reflect/route.ts`:
- Remover a função `saveAiResponse` e a const `SAVE_TIMEOUT_MS` (foram pro helper).
- Adicionar import: `import { buildReflectionResponseStream } from './response-stream';`
- Substituir o bloco `const stream = new ReadableStream<Uint8Array>({ ... });` inteiro (o `start(controller)` com o loop do chatStream, catch e finally) por:
```ts
  const stream = buildReflectionResponseStream({
    reflectionId,
    body: trimmed,
    userId,
    systemPrompt,
    onComplete: () => triggerSynthesis(userId, supabase),
  });
```
Manter intactos: parse/validação, auth, INSERT, o bloco read-feedback que monta `systemPrompt`, a função `triggerSynthesis` + `SYNTH_TIMEOUT_MS`, e o `return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });`. As imports de `chatStream` e `createServiceClient` podem sair do route.ts se não forem mais usadas lá (o helper as usa).

- [ ] **Step 3: Rodar os testes do POST (devem continuar verdes sem mudança)**

Run (de `apps/web`): `pnpm test src/app/api/reflect/route.test.ts`
Expected: PASS — todos os ~18 cenários (CA-T009, CA-RH, CA-MM) intactos. Se algum quebrar, é regressão da refatoração a corrigir (não placeholder).

- [ ] **Step 4: Typecheck + commit**

Run (de `apps/web`): `pnpm typecheck` → 0 erros.
```bash
cd D:/companion-app && git add apps/web/src/app/api/reflect/response-stream.ts apps/web/src/app/api/reflect/route.ts
git commit -m "refactor(reflect): extrai buildReflectionResponseStream (CA-RT-1)"
```

---

## Task 2: Endpoint `POST /api/reflect/[id]/retry`

**Files:**
- Create: `apps/web/src/app/api/reflect/[id]/retry/route.ts`
- Test: `apps/web/src/app/api/reflect/[id]/retry/route.test.ts`

- [ ] **Step 1: Escrever os testes que falham**

Conteúdo de `apps/web/src/app/api/reflect/[id]/retry/route.test.ts`:
```ts
/**
 * Tests do POST /api/reflect/[id]/retry. Mocka @/shared/db/server,
 * @/shared/db/service, @/shared/ai/client, prompts. Sem rede/DB real.
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

type Row = { body: string; ai_response: string | null } | null;
let getUserResult: { data: { user: { id: string } | null }; error: unknown } = {
  data: { user: null },
  error: null,
};
let reflectionRow: { data: Row; error: unknown } = { data: null, error: null };
let userMemoryRow: { data: unknown; error: unknown } = { data: null, error: null };

const getUserMock = vi.fn();
const fromMock = vi.fn();

vi.mock('@/shared/db/server', () => ({
  createServerClient: vi.fn(async () => ({ auth: { getUser: getUserMock }, from: fromMock })),
}));

const chatStreamMock = vi.fn();
vi.mock('@/shared/ai/client', () => ({ chatStream: chatStreamMock }));

const serviceUpdateMock = vi.fn();
const serviceEqMock = vi.fn();
const serviceFromMock = vi.fn();
vi.mock('@/shared/db/service', () => ({
  createServiceClient: vi.fn(() => ({ from: serviceFromMock })),
}));

vi.mock('@/shared/ai/prompts/reflection-empathic', () => ({
  REFLECTION_EMPATHIC_SYSTEM_PROMPT: 'TEST_PROMPT',
  buildReflectionSystemPrompt: (f: Array<{ text: string }>) =>
    !f || f.length === 0 ? 'TEST_PROMPT' : 'TEST_PROMPT\nMEM:' + f.map((x) => x.text).join(','),
}));

function makeReq(): Request {
  return new Request('http://localhost:3000/api/reflect/abc/retry', { method: 'POST' });
}
function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}
async function readStream(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let acc = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    acc += dec.decode(value, { stream: true });
  }
  return acc + dec.decode();
}
function makeAsyncIter(chunks: string[]): AsyncIterable<string> {
  return { async *[Symbol.asyncIterator]() { for (const c of chunks) yield c; } };
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserResult = { data: { user: null }, error: null };
  reflectionRow = { data: null, error: null };
  userMemoryRow = { data: null, error: null };
  getUserMock.mockImplementation(async () => getUserResult);
  fromMock.mockImplementation((table: string) => {
    if (table === 'user_memory') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => userMemoryRow }) }) };
    }
    // journal_entries: select('body, ai_response').eq('id', id).maybeSingle()
    return { select: () => ({ eq: () => ({ maybeSingle: async () => reflectionRow }) }) };
  });
  serviceFromMock.mockImplementation(() => ({
    update: serviceUpdateMock.mockImplementation(() => ({
      eq: serviceEqMock.mockImplementation(async () => ({ error: null })),
    })),
  }));
  chatStreamMock.mockImplementation(() => makeAsyncIter([]));
});

describe('POST /api/reflect/[id]/retry', () => {
  it('401 sem sessão', async () => {
    getUserResult = { data: { user: null }, error: null };
    const { POST } = await import('./route');
    const res = await POST(makeReq(), ctx('r1'));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthenticated' });
    expect(chatStreamMock).not.toHaveBeenCalled();
  });

  it('404 quando reflexão não existe (ou RLS bloqueia)', async () => {
    getUserResult = { data: { user: { id: 'u1' } }, error: null };
    reflectionRow = { data: null, error: null };
    const { POST } = await import('./route');
    const res = await POST(makeReq(), ctx('r1'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(chatStreamMock).not.toHaveBeenCalled();
  });

  it('409 already_answered quando ai_response não é null', async () => {
    getUserResult = { data: { user: { id: 'u1' } }, error: null };
    reflectionRow = { data: { body: 'oi', ai_response: 'já respondi' }, error: null };
    const { POST } = await import('./route');
    const res = await POST(makeReq(), ctx('r1'));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'already_answered' });
    expect(chatStreamMock).not.toHaveBeenCalled();
  });

  it('200 stream feliz → UPDATE com texto acumulado + contrato metadata', async () => {
    getUserResult = { data: { user: { id: 'u1' } }, error: null };
    reflectionRow = { data: { body: 'minha reflexão', ai_response: null }, error: null };
    chatStreamMock.mockImplementation(() => makeAsyncIter(['Olá ', 'de novo']));
    const { POST } = await import('./route');
    const res = await POST(makeReq(), ctx('refl-9'));
    expect(res.status).toBe(200);
    const txt = await readStream(res);
    const lines = txt.split('\n');
    expect(JSON.parse(lines[0]!)).toEqual({ reflection_id: 'refl-9' });
    expect(lines.slice(1).join('\n')).toContain('Olá de novo');
    expect(serviceUpdateMock).toHaveBeenCalledWith({
      ai_response: 'Olá de novo',
      ai_response_at: expect.any(String),
    });
    expect(serviceEqMock).toHaveBeenCalledWith('id', 'refl-9');
  });

  it('chatStream lança → trailer ai_unavailable, sem UPDATE', async () => {
    getUserResult = { data: { user: { id: 'u1' } }, error: null };
    reflectionRow = { data: { body: 'oi', ai_response: null }, error: null };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    chatStreamMock.mockImplementation(() => ({
      async *[Symbol.asyncIterator]() { throw new Error('boom'); },
    }));
    const { POST } = await import('./route');
    const res = await POST(makeReq(), ctx('refl-9'));
    const txt = await readStream(res);
    expect(txt).toContain('ai_unavailable');
    expect(serviceUpdateMock).not.toHaveBeenCalled();
  });

  it('★ALTO: body/ai_response nunca em log (sentinel)', async () => {
    const sBody = `<<S_${randomUUID()}_B>>`;
    const sAi = `<<S_${randomUUID()}_A>>`;
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'info').mockImplementation(() => {}),
    ];
    getUserResult = { data: { user: { id: 'u1' } }, error: null };
    reflectionRow = { data: { body: `corpo ${sBody}`, ai_response: null }, error: null };
    // força save a falhar pra exercitar log de save
    serviceFromMock.mockImplementation(() => ({
      update: serviceUpdateMock.mockImplementation(() => ({
        eq: serviceEqMock.mockImplementation(async () => ({ error: { code: 'XX' } })),
      })),
    }));
    chatStreamMock.mockImplementation(() => makeAsyncIter([sAi]));
    const { POST } = await import('./route');
    await readStream(await POST(makeReq(), ctx('refl-9')));
    for (const spy of spies) {
      const all = JSON.stringify(spy.mock.calls);
      expect(all).not.toContain(sBody);
      expect(all).not.toContain(sAi);
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run (de `apps/web`): `pnpm test "src/app/api/reflect/[id]/retry/route.test.ts"`
Expected: FAIL — `./route` não existe ainda.

- [ ] **Step 3: Implementar o endpoint**

Conteúdo de `apps/web/src/app/api/reflect/[id]/retry/route.ts`:
```ts
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

  // Carrega a reflexão sob RLS owner.
  const { data: row } = await supabase
    .from('journal_entries')
    .select('body, ai_response')
    .eq('id', id)
    .maybeSingle();

  if (!row) {
    return jsonResponse(404, { error: 'not_found' });
  }
  if ((row as { ai_response: string | null }).ai_response !== null) {
    return jsonResponse(409, { error: 'already_answered' });
  }
  const body = (row as { body: string }).body;

  // Read-feedback: micro-memória no system prompt (best-effort).
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
```

- [ ] **Step 4: Rodar e ver passar**

Run (de `apps/web`): `pnpm test "src/app/api/reflect/[id]/retry/route.test.ts"`
Expected: PASS — 6 cenários verdes.

- [ ] **Step 5: Typecheck + commit**

Run (de `apps/web`): `pnpm typecheck` → 0.
```bash
cd D:/companion-app && git add "apps/web/src/app/api/reflect/[id]/retry/route.ts" "apps/web/src/app/api/reflect/[id]/retry/route.test.ts"
git commit -m "feat(reflect): endpoint POST /api/reflect/[id]/retry (CA-RT-2)"
```

---

## Task 3: Helper cliente `streamRetry`

**Files:**
- Create: `apps/web/src/app/reflect/stream-retry.ts`
- Test: `apps/web/src/app/reflect/stream-retry.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Conteúdo de `apps/web/src/app/reflect/stream-retry.test.ts`:
```ts
import { describe, expect, it, vi, afterEach } from 'vitest';
import { streamRetry } from './stream-retry';

function streamFrom(text: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      c.enqueue(enc.encode(text));
      c.close();
    },
  });
}

afterEach(() => vi.restoreAllMocks());

describe('streamRetry', () => {
  it('200 → itera eventos do parseReflectStream (metadata + text)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(streamFrom('{"reflection_id":"r9"}\nOlá', ), { status: 200 }),
    );
    const result = await streamRetry('r9');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const events = [];
    for await (const e of result.events) events.push(e);
    expect(events[0]).toEqual({ type: 'metadata', reflection_id: 'r9' });
    expect(events.some((e) => e.type === 'text' && e.chunk.includes('Olá'))).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/reflect/r9/retry', { method: 'POST' });
  });

  it('401 → { ok:false, code:"auth" }', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }));
    const r = await streamRetry('r9');
    expect(r).toEqual({ ok: false, code: 'auth' });
  });

  it('409 → { ok:false, code:"already_answered" }', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 409 }));
    const r = await streamRetry('r9');
    expect(r).toEqual({ ok: false, code: 'already_answered' });
  });

  it('rede cai → { ok:false, code:"network" }', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('net'));
    const r = await streamRetry('r9');
    expect(r).toEqual({ ok: false, code: 'network' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run (de `apps/web`): `pnpm test src/app/reflect/stream-retry.test.ts`
Expected: FAIL — `streamRetry` não existe.

- [ ] **Step 3: Implementar**

Conteúdo de `apps/web/src/app/reflect/stream-retry.ts`:
```ts
/**
 * Cliente: dispara POST /api/reflect/<id>/retry e expõe os eventos do stream via
 * parseReflectStream. Usado por ReflectForm e ReflectionsList.
 * @module app/reflect/stream-retry
 */
import { parseReflectStream, type ReflectStreamEvent } from './parse-stream';

export type RetryResult =
  | { ok: true; events: AsyncGenerator<ReflectStreamEvent> }
  | { ok: false; code: 'auth' | 'not_found' | 'already_answered' | 'network' };

export async function streamRetry(reflectionId: string): Promise<RetryResult> {
  try {
    const res = await fetch(`/api/reflect/${reflectionId}/retry`, { method: 'POST' });
    if (res.status === 401) return { ok: false, code: 'auth' };
    if (res.status === 404) return { ok: false, code: 'not_found' };
    if (res.status === 409) return { ok: false, code: 'already_answered' };
    if (!res.ok || !res.body) return { ok: false, code: 'network' };
    return { ok: true, events: parseReflectStream(res.body.getReader()) };
  } catch {
    return { ok: false, code: 'network' };
  }
}
```

- [ ] **Step 4: Rodar, typecheck, commit**

Run (de `apps/web`): `pnpm test src/app/reflect/stream-retry.test.ts && pnpm typecheck`
Expected: PASS, 0 erros.
```bash
cd D:/companion-app && git add apps/web/src/app/reflect/stream-retry.ts apps/web/src/app/reflect/stream-retry.test.ts
git commit -m "feat(reflect): streamRetry cliente reusa parseReflectStream (CA-RT-3)"
```

---

## Task 4: Botão de retry no `ReflectForm`

**Files:**
- Modify: `apps/web/src/app/reflect/ReflectForm.tsx`
- Test: `apps/web/src/app/reflect/ReflectForm.test.tsx`

- [ ] **Step 1: Escrever o teste que falha**

Adicionar a `apps/web/src/app/reflect/ReflectForm.test.tsx` (mockando `streamRetry`):
```tsx
// no topo do arquivo, junto aos outros vi.mock:
vi.mock('./stream-retry', () => ({ streamRetry: vi.fn() }));
// ... import { streamRetry } from './stream-retry'; (tipado como vi.Mock via cast)

it('CA-RT-4: botão "Tentar de novo" no ai_unavailable re-streama e vira done', async () => {
  // 1) primeiro POST falha com ai_unavailable
  const enc = new TextEncoder();
  const failBody = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode('{"reflection_id":"r1"}\n'));
      c.enqueue(enc.encode('\n{"error":"ai_unavailable","reflection_id":"r1"}\n'));
      c.close();
    },
  });
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(failBody, { status: 200 }));

  // 2) streamRetry devolve sucesso com eventos
  async function* okEvents() {
    yield { type: 'metadata', reflection_id: 'r1' } as const;
    yield { type: 'text', chunk: 'Resposta agora' } as const;
  }
  (streamRetry as unknown as vi.Mock).mockResolvedValue({ ok: true, events: okEvents() });

  const user = userEvent.setup();
  render(<ReflectForm />);
  await user.type(screen.getByPlaceholderText(/Escreva/), 'minha reflexão de teste');
  await user.click(screen.getByRole('button', { name: 'Enviar' }));

  const retryBtn = await screen.findByRole('button', { name: 'Tentar de novo' });
  await user.click(retryBtn);

  expect(await screen.findByText('Resposta agora')).toBeInTheDocument();
  expect(streamRetry).toHaveBeenCalledWith('r1');
});
```
(Usa os mesmos imports de `render`/`screen`/`userEvent` já presentes no arquivo.)

- [ ] **Step 2: Rodar e ver falhar**

Run (de `apps/web`): `pnpm test src/app/reflect/ReflectForm.test.tsx`
Expected: FAIL — não há botão "Tentar de novo".

- [ ] **Step 3: Implementar**

Em `apps/web/src/app/reflect/ReflectForm.tsx`:
- Import: `import { streamRetry } from './stream-retry';`
- Extrair a iteração de eventos numa função interna reutilizável e adicionar `handleRetry`. Após o `resetForm`, adicionar:
```tsx
  async function consumeEvents(events: AsyncGenerator<import('./parse-stream').ReflectStreamEvent>) {
    let accText = '';
    let reflectionId: string | null = null;
    setState({ kind: 'streaming', text: '', reflectionId: null });
    for await (const event of events) {
      if (event.type === 'metadata') {
        reflectionId = event.reflection_id;
        setState({ kind: 'streaming', text: accText, reflectionId });
      } else if (event.type === 'text') {
        accText += event.chunk;
        setState({ kind: 'streaming', text: accText, reflectionId });
      } else if (event.type === 'error') {
        setState({
          kind: 'error',
          code: event.code === 'ai_unavailable' ? 'ai_unavailable' : 'network',
          partial: accText,
          reflectionId: event.reflection_id ?? reflectionId ?? undefined,
        });
        toast({
          variant: 'destructive',
          title: 'IA indisponível',
          description: 'Tua reflexão foi salva. Tenta de novo daqui a pouco.',
        });
        return;
      }
    }
    setState({ kind: 'done', text: accText, reflectionId });
  }

  async function handleRetry(reflectionId: string) {
    const result = await streamRetry(reflectionId);
    if (!result.ok) {
      toast({
        variant: 'destructive',
        title: 'Não deu pra tentar de novo',
        description: result.code === 'auth' ? 'Sessão expirada.' : 'Tenta de novo daqui a pouco.',
      });
      return;
    }
    await consumeEvents(result.events);
  }
```
- No bloco `state.kind === 'error' && state.code === 'ai_unavailable'`, adicionar, após o `<p>` do ID, o botão (só quando há `reflectionId`):
```tsx
          {state.reflectionId && (
            <Button
              type="button"
              variant="outline"
              className="mt-3"
              onClick={() => handleRetry(state.reflectionId!)}
            >
              Tentar de novo
            </Button>
          )}
```
(Opcional, fora de escopo deste passo: refatorar `handleSubmit` pra também usar `consumeEvents`. Não é necessário pro teste — pode deixar a duplicação mínima ou reusar se trivial.)

- [ ] **Step 4: Rodar, typecheck, commit**

Run (de `apps/web`): `pnpm test src/app/reflect/ReflectForm.test.tsx && pnpm typecheck`
Expected: PASS, 0 erros.
```bash
cd D:/companion-app && git add apps/web/src/app/reflect/ReflectForm.tsx apps/web/src/app/reflect/ReflectForm.test.tsx
git commit -m "feat(reflect): botão Tentar de novo no ai_unavailable (CA-RT-4)"
```

---

## Task 5: Botão de retry no `ReflectionsList`

**Files:**
- Modify: `apps/web/src/app/reflections/ReflectionsList.tsx`
- Test: `apps/web/src/app/reflections/ReflectionsList.test.tsx`

- [ ] **Step 1: Escrever o teste que falha**

Adicionar a `apps/web/src/app/reflections/ReflectionsList.test.tsx` (mockando `../reflect/stream-retry`):
```tsx
// topo: vi.mock('../reflect/stream-retry', () => ({ streamRetry: vi.fn() }));
// import { streamRetry } from '../reflect/stream-retry';

it('CA-RT-5: item com ai_response null mostra "Tentar de novo"; click streama no card', async () => {
  // GET inicial: 1 item com ai_response null (fetch mock do arquivo)
  // (segue o padrão já usado nos outros testes pra mockar fetch do GET /api/reflections)
  mockFetchPage([{ id: 'r1', body: 'corpo', created_at: '2026-06-01T10:00:00Z', ai_response: null, ai_response_at: null }], null);

  async function* okEvents() {
    yield { type: 'metadata', reflection_id: 'r1' } as const;
    yield { type: 'text', chunk: 'Resposta nova' } as const;
  }
  (streamRetry as unknown as vi.Mock).mockResolvedValue({ ok: true, events: okEvents() });

  const user = userEvent.setup();
  render(<ReflectionsList />);

  const btn = await screen.findByRole('button', { name: 'Tentar de novo' });
  await user.click(btn);

  expect(await screen.findByText('Resposta nova')).toBeInTheDocument();
  expect(streamRetry).toHaveBeenCalledWith('r1');
});

it('CA-RT-5b: item com ai_response não mostra "Tentar de novo"', async () => {
  mockFetchPage([{ id: 'r2', body: 'corpo', created_at: '2026-06-01T10:00:00Z', ai_response: 'já tem', ai_response_at: '2026-06-01T10:00:05Z' }], null);
  render(<ReflectionsList />);
  expect(await screen.findByText('já tem')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Tentar de novo' })).toBeNull();
});
```
> Nota de implementação do teste: reusar o helper de mock de `fetch` já existente no arquivo (o teste atual monta respostas do GET `/api/reflections`). Se não houver um helper nomeado `mockFetchPage`, inline o mesmo padrão de `vi.spyOn(globalThis,'fetch')` usado nos testes existentes, retornando `{ reflections: [...], next_cursor: null }`.

- [ ] **Step 2: Rodar e ver falhar**

Run (de `apps/web`): `pnpm test src/app/reflections/ReflectionsList.test.tsx`
Expected: FAIL — sem botão.

- [ ] **Step 3: Implementar**

Em `apps/web/src/app/reflections/ReflectionsList.tsx`:
- Imports: `import { streamRetry } from '../reflect/stream-retry';`
- Adicionar estado de streaming por-item: um `useState<Record<string, string>>` (`retryText`, map id→texto parcial) e um `useState<Set<string>>`/objeto pra marcar quais estão em retry (`retrying`). Implementar `handleRetry(id)`:
```tsx
  const [retryText, setRetryText] = useState<Record<string, string>>({});
  const [retrying, setRetrying] = useState<Record<string, boolean>>({});

  async function handleRetry(id: string) {
    setRetrying((m) => ({ ...m, [id]: true }));
    setRetryText((m) => ({ ...m, [id]: '' }));
    const result = await streamRetry(id);
    if (!result.ok) {
      setRetrying((m) => ({ ...m, [id]: false }));
      toast({
        variant: 'destructive',
        title: 'Não deu pra tentar de novo',
        description: result.code === 'auth' ? 'Sessão expirada.' : 'Tenta de novo daqui a pouco.',
      });
      return;
    }
    let acc = '';
    for await (const event of result.events) {
      if (event.type === 'text') {
        acc += event.chunk;
        setRetryText((m) => ({ ...m, [id]: acc }));
      } else if (event.type === 'error') {
        setRetrying((m) => ({ ...m, [id]: false }));
        toast({ variant: 'destructive', title: 'IA indisponível', description: 'Tenta de novo daqui a pouco.' });
        return;
      }
    }
    // sucesso: fixa o ai_response no item e limpa o estado de retry
    setState((s) =>
      s.kind === 'ready' || s.kind === 'loadingMore'
        ? { ...s, items: s.items.map((it) => (it.id === id ? { ...it, ai_response: acc } : it)) }
        : s,
    );
    setRetrying((m) => ({ ...m, [id]: false }));
  }
```
- No JSX do item, substituir o ramo `else` (linha do *"Sem resposta registrada"*) por:
```tsx
          ) : retryText[item.id] !== undefined ? (
            <div className="border-l-2 border-muted pl-4 text-sm text-muted-foreground">
              {retrying[item.id] ? (
                <p className="whitespace-pre-wrap">
                  {retryText[item.id]}
                  <span className="animate-pulse">▊</span>
                </p>
              ) : (
                <MarkdownResponse>{retryText[item.id]!}</MarkdownResponse>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground italic">Sem resposta registrada</p>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleRetry(item.id)}
                disabled={!!retrying[item.id]}
              >
                Tentar de novo
              </Button>
            </div>
          )}
```
> Como em sucesso o item passa a ter `ai_response` (via setState), o ramo `item.ai_response !== null` já renderiza o markdown final; o `retryText` serve pro streaming ao vivo enquanto chega.

- [ ] **Step 4: Rodar, typecheck, commit**

Run (de `apps/web`): `pnpm test src/app/reflections/ReflectionsList.test.tsx && pnpm typecheck`
Expected: PASS, 0 erros.
```bash
cd D:/companion-app && git add apps/web/src/app/reflections/ReflectionsList.tsx apps/web/src/app/reflections/ReflectionsList.test.tsx
git commit -m "feat(reflections): botão Tentar de novo em item sem resposta (CA-RT-5)"
```

---

## Task 6: Regressão BC + typecheck + build (INLINE — controller)

- [ ] **Step 1: Suite completa**

Run (de `apps/web`): `pnpm test`
Expected: PASS — suite inteira verde (101+ anteriores + novos retry). Os testes do POST `/api/reflect` permanecem intactos.

- [ ] **Step 2: Typecheck + build**

Run (de `apps/web`): `pnpm typecheck && pnpm build`
Expected: 0 erros, build Next.js limpo.

- [ ] **Step 3: Smoke gate (HUMAN — opcional)**

Com a app rodando, criar uma reflexão sob falha de IA (ou usar uma já-NULL no live) e clicar "Tentar de novo" em `/reflections` e/ou no `/reflect`. Confirmar que a resposta chega e o card/forma atualiza. PAUSE pra Pacini avaliar.

---

## Self-Review (controller)

**Spec coverage:**
- CA-RT-1 (helper + POST refatorado) → Task 1 ✅
- CA-RT-2 (endpoint 401/404/409/stream/trailer) → Task 2 ✅
- CA-RT-3 (streamRetry cliente) → Task 3 ✅
- CA-RT-4 (ReflectForm) → Task 4 ✅
- CA-RT-5 (ReflectionsList, item respondido sem botão) → Task 5 ✅
- CA-RT-6 (privacy) → Task 2 sentinel test + helper centraliza ✅
- CA-RT-7 (suite/typecheck/build) → Task 6 ✅

**Placeholder scan:** sem TBD/TODO; código completo. (Task 5 Step 1 referencia um helper de mock `mockFetchPage` com nota explícita de inline-fallback se não existir — não é placeholder, é instrução condicional.)

**Type consistency:** `buildReflectionResponseStream`, `streamRetry`, `RetryResult`, `ReflectStreamEvent`, `retryText`/`retrying` consistentes entre tasks. O endpoint emite o contrato que `parseReflectStream` consome.
