/**
 * Tests for the POST /api/reflect Route Handler. Mocks @/shared/db/server
 * and @/shared/ai/client — no real network/DB calls. Covers 12 scenarios
 * mapping CA-T009-1..8 from the spec, including privacy gate (sentinel
 * injection in console spies).
 * @module app/api/reflect/route.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Mocks. Closed-over handles let each test set per-call behavior without
// rebuilding the factory.
// ---------------------------------------------------------------------------

type GetUserResult = {
  data: { user: { id: string } | null };
  error: { code?: string; message?: string } | null;
};

type InsertSingleResult = {
  data: { id: string } | null;
  error: { code?: string; message?: string } | null;
};

let getUserResult: GetUserResult = { data: { user: null }, error: null };
let insertSingleResult: InsertSingleResult = { data: null, error: null };

const insertMock = vi.fn();
const fromMock = vi.fn();
const getUserMock = vi.fn();

vi.mock('@/shared/db/server', () => ({
  createServerClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
    from: fromMock,
  })),
}));

const chatStreamMock = vi.fn();
vi.mock('@/shared/ai/client', () => ({
  chatStream: chatStreamMock,
}));

vi.mock('@/shared/ai/prompts/reflection-empathic', () => ({
  REFLECTION_EMPATHIC_SYSTEM_PROMPT: 'TEST_PROMPT',
  REFLECTION_EMPATHIC_SYSTEM_PROMPT_STRICT: 'TEST_PROMPT_STRICT',
  REFLECTION_EMPATHIC_PROMPT_VERSION: 'v1',
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJsonRequest(body: unknown): Request {
  return new Request('http://localhost:3000/api/reflect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function readStream(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let acc = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    acc += decoder.decode(value, { stream: true });
  }
  acc += decoder.decode();
  return acc;
}

function makeAsyncIter(chunks: string[]): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
  };
}

// ---------------------------------------------------------------------------
// Per-test reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  getUserResult = { data: { user: null }, error: null };
  insertSingleResult = { data: null, error: null };

  getUserMock.mockImplementation(async () => getUserResult);

  // from('journal_entries').insert(...).select('id').single() chain
  fromMock.mockImplementation(() => ({
    insert: insertMock.mockImplementation(() => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => insertSingleResult),
      })),
    })),
  }));

  // Default chatStream: yields nothing (will be overridden per test)
  chatStreamMock.mockImplementation(() => makeAsyncIter([]));
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Cenário 1: 401 sem auth (CA-T009-4)
// ---------------------------------------------------------------------------

describe('POST /api/reflect — auth', () => {
  it('returns 401 with {error:"unauthenticated"} when no user session', async () => {
    getUserResult = { data: { user: null }, error: null };
    const { POST } = await import('@/app/api/reflect/route');

    const response = await POST(makeJsonRequest({ content: 'reflexão válida aqui' }));

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ error: 'unauthenticated' });
    expect(insertMock).not.toHaveBeenCalled();
    expect(chatStreamMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Cenários 2-5: validação de input (CA-T009-4)
// ---------------------------------------------------------------------------

describe('POST /api/reflect — input validation', () => {
  it('returns 400 invalid_json when body is not valid JSON', async () => {
    getUserResult = { data: { user: { id: 'user-1' } }, error: null };
    const { POST } = await import('@/app/api/reflect/route');

    const response = await POST(makeJsonRequest('not-a-json{'));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_json' });
  });

  it('returns 400 invalid_input when content is missing or non-string', async () => {
    getUserResult = { data: { user: { id: 'user-1' } }, error: null };
    const { POST } = await import('@/app/api/reflect/route');

    const r1 = await POST(makeJsonRequest({}));
    expect(r1.status).toBe(400);
    expect(await r1.json()).toEqual({ error: 'invalid_input' });

    const r2 = await POST(makeJsonRequest({ content: 42 }));
    expect(r2.status).toBe(400);
    expect(await r2.json()).toEqual({ error: 'invalid_input' });
  });

  it('returns 400 too_short when trimmed content has fewer than 3 chars', async () => {
    getUserResult = { data: { user: { id: 'user-1' } }, error: null };
    const { POST } = await import('@/app/api/reflect/route');

    const r1 = await POST(makeJsonRequest({ content: 'ab' }));
    expect(r1.status).toBe(400);
    expect(await r1.json()).toEqual({ error: 'too_short' });

    // Whitespace-only counts as too_short after trim.
    const r2 = await POST(makeJsonRequest({ content: '   \n  ' }));
    expect(r2.status).toBe(400);
    expect(await r2.json()).toEqual({ error: 'too_short' });
  });

  it('returns 413 too_long when content length exceeds 8000', async () => {
    getUserResult = { data: { user: { id: 'user-1' } }, error: null };
    const { POST } = await import('@/app/api/reflect/route');

    const big = 'x'.repeat(8001);
    const response = await POST(makeJsonRequest({ content: big }));

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'too_long' });
  });
});

// ---------------------------------------------------------------------------
// Cenário 6: happy path 500 chars (CA-T009-1, CA-T009-2)
// ---------------------------------------------------------------------------

describe('POST /api/reflect — happy path', () => {
  it('returns 200 with first-line {reflection_id} JSON + streamed Claude chunks', async () => {
    getUserResult = { data: { user: { id: 'user-1' } }, error: null };
    insertSingleResult = {
      data: { id: '11111111-1111-4111-8111-111111111111' },
      error: null,
    };
    chatStreamMock.mockImplementation(() =>
      makeAsyncIter(['Olá ', 'Pacini, ', 'obrigado por compartilhar.']),
    );

    const content = 'a'.repeat(500);
    const { POST } = await import('@/app/api/reflect/route');
    const response = await POST(makeJsonRequest({ content }));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^text\/plain/);

    const stream = await readStream(response);
    const lines = stream.split('\n');
    const firstLine = lines[0] ?? '';
    const meta = JSON.parse(firstLine) as { reflection_id: string };
    expect(meta.reflection_id).toBe('11111111-1111-4111-8111-111111111111');
    // Remaining lines (joined) contain the Claude chunks
    const remainder = lines.slice(1).join('\n');
    expect(remainder).toContain('Olá ');
    expect(remainder).toContain('Pacini');
    expect(remainder).toContain('obrigado por compartilhar.');

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledWith({
      user_id: 'user-1',
      body: content,
      prompt_used: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Cenário 7: trim aplicado (CA-T009-5)
// ---------------------------------------------------------------------------

describe('POST /api/reflect — trim', () => {
  it('persists body without leading/trailing whitespace', async () => {
    getUserResult = { data: { user: { id: 'user-1' } }, error: null };
    insertSingleResult = {
      data: { id: '22222222-2222-4222-8222-222222222222' },
      error: null,
    };
    chatStreamMock.mockImplementation(() => makeAsyncIter(['ok']));

    const { POST } = await import('@/app/api/reflect/route');
    await POST(makeJsonRequest({ content: '  hello  ' }));

    expect(insertMock).toHaveBeenCalledWith({
      user_id: 'user-1',
      body: 'hello',
      prompt_used: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Cenário 8: 500 INSERT erro (CA-T009-6)
// ---------------------------------------------------------------------------

describe('POST /api/reflect — persistence failure', () => {
  it('returns 500 persistence_failed and does not call chatStream', async () => {
    getUserResult = { data: { user: { id: 'user-1' } }, error: null };
    insertSingleResult = {
      data: null,
      error: { code: '23502', message: 'null value in column' },
    };

    const { POST } = await import('@/app/api/reflect/route');
    const response = await POST(makeJsonRequest({ content: 'reflexão válida' }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'persistence_failed' });
    expect(chatStreamMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Cenário 9: chatStream throws → último chunk JSON erro (CA-T009-7)
// ---------------------------------------------------------------------------

describe('POST /api/reflect — Claude failure post-INSERT', () => {
  it('returns 200 with first-line metadata + last-line ai_unavailable JSON', async () => {
    getUserResult = { data: { user: { id: 'user-1' } }, error: null };
    insertSingleResult = {
      data: { id: '33333333-3333-4333-8333-333333333333' },
      error: null,
    };
    chatStreamMock.mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        throw new Error('upstream Anthropic 503');
      },
    }));

    const { POST } = await import('@/app/api/reflect/route');
    const response = await POST(makeJsonRequest({ content: 'reflexão válida' }));

    expect(response.status).toBe(200);
    const body = await readStream(response);
    const lines = body.split('\n').filter((l) => l.length > 0);
    expect(lines.length).toBe(2); // M-003: exactly metadata + error, no intermediate chunks when chatStream throws on 1st iter

    const first = JSON.parse(lines[0] ?? '') as { reflection_id: string };
    expect(first.reflection_id).toBe('33333333-3333-4333-8333-333333333333');

    const last = JSON.parse(lines[lines.length - 1] ?? '') as {
      error: string;
      reflection_id: string;
    };
    expect(last.error).toBe('ai_unavailable');
    expect(last.reflection_id).toBe('33333333-3333-4333-8333-333333333333');
  });
});

// ---------------------------------------------------------------------------
// Cenário 10: privacy gate sentinel não está em console.* (CA-T009-3 ★ALTO)
// ---------------------------------------------------------------------------

describe('POST /api/reflect — privacy gate', () => {
  it('never logs content/body via any console method (sentinel injection)', async () => {
    const SENTINEL = `<<SENTINEL_${randomUUID()}_END>>`;
    const content = `Reflexão de teste contendo ${SENTINEL} no meio do texto.`;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // Force both INSERT failure AND Claude failure paths to exercise the
    // error-logging branches. Two requests, one per failure mode.
    getUserResult = { data: { user: { id: 'user-1' } }, error: null };
    const { POST } = await import('@/app/api/reflect/route');

    // 1) INSERT failure
    insertSingleResult = {
      data: null,
      error: { code: '40001', message: 'serialization failure' },
    };
    chatStreamMock.mockImplementation(() => makeAsyncIter([]));
    await POST(makeJsonRequest({ content }));

    // 2) Claude failure post-INSERT
    insertSingleResult = {
      data: { id: '44444444-4444-4444-8444-444444444444' },
      error: null,
    };
    chatStreamMock.mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        throw new Error('upstream Anthropic 500');
      },
    }));
    const r = await POST(makeJsonRequest({ content }));
    await readStream(r); // drain so the controller runs the catch+close

    // Aggregate every console.* call into a single string and assert sentinel
    // is absent. randomUUID makes false positives statistically impossible
    // (a real log line cannot contain this exact 16-byte string by accident).
    const allCalls = JSON.stringify([
      logSpy.mock.calls,
      infoSpy.mock.calls,
      warnSpy.mock.calls,
      errorSpy.mock.calls,
    ]);
    expect(allCalls).not.toContain(SENTINEL);
  });
});

// ---------------------------------------------------------------------------
// Cenários 11-12: system prompt + sem contexto histórico (CA-T009-8)
// ---------------------------------------------------------------------------

describe('POST /api/reflect — Sonnet invocation shape', () => {
  it('passes REFLECTION_EMPATHIC_SYSTEM_PROMPT and exactly 1 user message', async () => {
    getUserResult = { data: { user: { id: 'user-1' } }, error: null };
    insertSingleResult = {
      data: { id: '55555555-5555-4555-8555-555555555555' },
      error: null,
    };
    chatStreamMock.mockImplementation(() => makeAsyncIter(['ok']));

    const content = 'reflexão de teste para verificar args do chatStream';
    const { POST } = await import('@/app/api/reflect/route');
    const r = await POST(makeJsonRequest({ content }));
    await readStream(r);

    expect(chatStreamMock).toHaveBeenCalledTimes(1);
    const firstCall = chatStreamMock.mock.calls[0] ?? [];
    const args = firstCall[0] as {
      system: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(args.system).toBe('TEST_PROMPT');
    expect(args.messages).toHaveLength(1);
    expect(args.messages[0]).toEqual({ role: 'user', content });
  });
});

// ---------------------------------------------------------------------------
// T-009b: Clinical guard (buffer → detect → retry → fallback)
// The clinical-guard module is NOT mocked — the real hasClinicalLanguage and
// CLINICAL_SAFE_FALLBACK run against the mocked chatStream output.
// ---------------------------------------------------------------------------

describe('POST /api/reflect — clinical guard (T-009b)', () => {
  async function streamBody(response: Response): Promise<string> {
    // Strip the first metadata line; return the remaining buffered text.
    const full = await readStream(response);
    const nl = full.indexOf('\n');
    return nl >= 0 ? full.slice(nl + 1) : full;
  }

  it('CA-6: clean response streams through without retry', async () => {
    getUserResult = { data: { user: { id: 'user-1' } }, error: null };
    insertSingleResult = {
      data: { id: '66666666-6666-4666-8666-666666666666' },
      error: null,
    };
    chatStreamMock.mockImplementation(() =>
      makeAsyncIter(['Parece que você ', 'está passando por um momento difícil.']),
    );

    const { POST } = await import('@/app/api/reflect/route');
    const r = await POST(makeJsonRequest({ content: 'reflexão válida aqui' }));
    const text = await streamBody(r);

    expect(text).toBe('Parece que você está passando por um momento difícil.');
    expect(chatStreamMock).toHaveBeenCalledTimes(1); // no retry
  });

  it('CA-7: clinical response triggers retry; clean retry text is sent', async () => {
    getUserResult = { data: { user: { id: 'user-1' } }, error: null };
    insertSingleResult = {
      data: { id: '77777777-7777-4777-8777-777777777777' },
      error: null,
    };
    // 1st call: clinical (contains "você tem ansiedade"). 2nd call: clean.
    chatStreamMock
      .mockImplementationOnce(() => makeAsyncIter(['Você tem ansiedade, sem dúvida.']))
      .mockImplementationOnce(() => makeAsyncIter(['Percebo que tem sido difícil pra você.']));

    const { POST } = await import('@/app/api/reflect/route');
    const r = await POST(makeJsonRequest({ content: 'reflexão válida aqui' }));
    const text = await streamBody(r);

    expect(text).toBe('Percebo que tem sido difícil pra você.');
    expect(chatStreamMock).toHaveBeenCalledTimes(2);
  });

  it('CA-8: clinical response + clinical retry → CLINICAL_SAFE_FALLBACK', async () => {
    const { CLINICAL_SAFE_FALLBACK } = await import('@/shared/ai/clinical-guard');
    getUserResult = { data: { user: { id: 'user-1' } }, error: null };
    insertSingleResult = {
      data: { id: '88888888-8888-4888-8888-888888888888' },
      error: null,
    };
    chatStreamMock
      .mockImplementationOnce(() => makeAsyncIter(['Você tem depressão.']))
      .mockImplementationOnce(() => makeAsyncIter(['Tome um antidepressivo.']));

    const { POST } = await import('@/app/api/reflect/route');
    const r = await POST(makeJsonRequest({ content: 'reflexão válida aqui' }));
    const text = await streamBody(r);

    expect(text).toBe(CLINICAL_SAFE_FALLBACK);
    expect(chatStreamMock).toHaveBeenCalledTimes(2);
  });

  it('CA-9: clinical response + retry throws → CLINICAL_SAFE_FALLBACK', async () => {
    const { CLINICAL_SAFE_FALLBACK } = await import('@/shared/ai/clinical-guard');
    getUserResult = { data: { user: { id: 'user-1' } }, error: null };
    insertSingleResult = {
      data: { id: '99999999-9999-4999-8999-999999999999' },
      error: null,
    };
    chatStreamMock
      .mockImplementationOnce(() => makeAsyncIter(['Você sofre de transtorno bipolar.']))
      .mockImplementationOnce(() => ({
        async *[Symbol.asyncIterator]() {
          throw new Error('upstream 503 on retry');
        },
      }));

    const { POST } = await import('@/app/api/reflect/route');
    const r = await POST(makeJsonRequest({ content: 'reflexão válida aqui' }));
    const text = await streamBody(r);

    expect(text).toBe(CLINICAL_SAFE_FALLBACK);
    expect(chatStreamMock).toHaveBeenCalledTimes(2);
  });

  it('CA-10: retry uses REFLECTION_EMPATHIC_SYSTEM_PROMPT_STRICT', async () => {
    getUserResult = { data: { user: { id: 'user-1' } }, error: null };
    insertSingleResult = {
      data: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      error: null,
    };
    chatStreamMock
      .mockImplementationOnce(() => makeAsyncIter(['Você é narcisista.']))
      .mockImplementationOnce(() => makeAsyncIter(['Obrigado por confiar isso a mim.']));

    const { POST } = await import('@/app/api/reflect/route');
    const r = await POST(makeJsonRequest({ content: 'reflexão válida aqui' }));
    await readStream(r);

    expect(chatStreamMock).toHaveBeenCalledTimes(2);
    const firstArgs = chatStreamMock.mock.calls[0]?.[0] as { system: string };
    const retryArgs = chatStreamMock.mock.calls[1]?.[0] as { system: string };
    expect(firstArgs.system).toBe('TEST_PROMPT');
    expect(retryArgs.system).toBe('TEST_PROMPT_STRICT');
  });

  it('CA-11 ★ALTO: guard warn never logs the flagged AI response text', async () => {
    const SENTINEL = `<<AISENTINEL_${randomUUID()}_END>>`;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    getUserResult = { data: { user: { id: 'user-1' } }, error: null };
    insertSingleResult = {
      data: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      error: null,
    };
    // Both responses clinical AND carry the sentinel — forces full guard path
    // (trigger → retry → fallback), exercising every console.warn branch.
    chatStreamMock
      .mockImplementationOnce(() => makeAsyncIter([`Você tem ansiedade ${SENTINEL}`]))
      .mockImplementationOnce(() => makeAsyncIter([`Tome remédio ${SENTINEL}`]));

    const { POST } = await import('@/app/api/reflect/route');
    const r = await POST(makeJsonRequest({ content: 'reflexão válida aqui' }));
    await readStream(r);

    const allCalls = JSON.stringify([
      warnSpy.mock.calls,
      logSpy.mock.calls,
      errorSpy.mock.calls,
    ]);
    expect(allCalls).not.toContain(SENTINEL);
  });
});
