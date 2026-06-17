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
