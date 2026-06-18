/**
 * Tests do POST /api/onboarding. Mocka @/shared/db/server. Sem rede/DB real.
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

let getUserResult: { data: { user: { id: string } | null }; error: unknown } = {
  data: { user: null },
  error: null,
};
let profileRow: { data: { onboarded_at: string | null } | null; error: unknown } = {
  data: { onboarded_at: null },
  error: null,
};
let tracksRows: { data: Array<{ slug: string }> | null; error: unknown } = {
  data: [{ slug: 'disciplina' }, { slug: 'regulacao-emocional' }, { slug: 'direcao' }],
  error: null,
};
let baselineUpsertResult: { error: { code?: string } | null } = { error: null };
let profileUpdateResult: { error: { code?: string } | null } = { error: null };

const getUserMock = vi.fn();
const fromMock = vi.fn();
const baselineUpsertMock = vi.fn();
const profileUpdateMock = vi.fn();
const profileEqMock = vi.fn();

vi.mock('@/shared/db/server', () => ({
  createServerClient: vi.fn(async () => ({ auth: { getUser: getUserMock }, from: fromMock })),
}));

function makeReq(body: unknown): Request {
  return new Request('http://localhost:3000/api/onboarding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const VALID = { accepted: true, track: 'disciplina', mood: 4, areas: ['trabalho', 'descanso'] };

beforeEach(() => {
  vi.clearAllMocks();
  getUserResult = { data: { user: null }, error: null };
  profileRow = { data: { onboarded_at: null }, error: null };
  tracksRows = { data: [{ slug: 'disciplina' }, { slug: 'regulacao-emocional' }, { slug: 'direcao' }], error: null };
  baselineUpsertResult = { error: null };
  profileUpdateResult = { error: null };
  getUserMock.mockImplementation(async () => getUserResult);
  fromMock.mockImplementation((table: string) => {
    if (table === 'tracks_catalog') {
      return { select: () => Promise.resolve(tracksRows) };
    }
    if (table === 'onboarding_baseline') {
      return { upsert: baselineUpsertMock.mockImplementation(async () => baselineUpsertResult) };
    }
    return {
      select: () => ({ eq: () => ({ maybeSingle: async () => profileRow }) }),
      update: profileUpdateMock.mockImplementation(() => ({
        eq: profileEqMock.mockImplementation(async () => profileUpdateResult),
      })),
    };
  });
});

describe('POST /api/onboarding', () => {
  it('401 sem sessão', async () => {
    const { POST } = await import('./route');
    expect((await POST(makeReq(VALID))).status).toBe(401);
  });

  it('400 mood fora de 1-5', async () => {
    getUserResult = { data: { user: { id: 'u1' } }, error: null };
    const { POST } = await import('./route');
    expect((await POST(makeReq({ ...VALID, mood: 7 }))).status).toBe(400);
    expect((await POST(makeReq({ ...VALID, mood: 0 }))).status).toBe(400);
  });

  it('400 track fora do catálogo', async () => {
    getUserResult = { data: { user: { id: 'u1' } }, error: null };
    const { POST } = await import('./route');
    expect((await POST(makeReq({ ...VALID, track: 'inexistente' }))).status).toBe(400);
  });

  it('400 área inválida ou lista vazia', async () => {
    getUserResult = { data: { user: { id: 'u1' } }, error: null };
    const { POST } = await import('./route');
    expect((await POST(makeReq({ ...VALID, areas: ['xxx'] }))).status).toBe(400);
    expect((await POST(makeReq({ ...VALID, areas: [] }))).status).toBe(400);
  });

  it('400 privacidade não aceita', async () => {
    getUserResult = { data: { user: { id: 'u1' } }, error: null };
    const { POST } = await import('./route');
    expect((await POST(makeReq({ ...VALID, accepted: false }))).status).toBe(400);
  });

  it('409 already_onboarded', async () => {
    getUserResult = { data: { user: { id: 'u1' } }, error: null };
    profileRow = { data: { onboarded_at: '2026-01-01T00:00:00Z' }, error: null };
    const { POST } = await import('./route');
    const res = await POST(makeReq(VALID));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'already_onboarded' });
    expect(baselineUpsertMock).not.toHaveBeenCalled();
  });

  it('200 happy → upsert baseline + update profiles com os 3 campos', async () => {
    getUserResult = { data: { user: { id: 'u1' } }, error: null };
    const { POST } = await import('./route');
    const res = await POST(makeReq(VALID));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(baselineUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'u1', mood: 4, life_areas: ['trabalho', 'descanso'] }),
    );
    expect(profileUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        active_track: 'disciplina',
        onboarded_at: expect.any(String),
        privacy_accepted_at: expect.any(String),
      }),
    );
    expect(profileEqMock).toHaveBeenCalledWith('id', 'u1');
  });

  it('500 quando update do profiles falha', async () => {
    getUserResult = { data: { user: { id: 'u1' } }, error: null };
    profileUpdateResult = { error: { code: 'XX' } };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { POST } = await import('./route');
    expect((await POST(makeReq(VALID))).status).toBe(500);
  });

  it('★ALTO: mood/áreas/track nunca em log (sentinel)', async () => {
    const s = `<<S_${randomUUID()}>>`;
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'info').mockImplementation(() => {}),
    ];
    getUserResult = { data: { user: { id: 'u1' } }, error: null };
    profileUpdateResult = { error: { code: s } };
    const { POST } = await import('./route');
    await POST(makeReq({ ...VALID, areas: ['trabalho'] }));
    for (const spy of spies) {
      const all = JSON.stringify(spy.mock.calls);
      expect(all).not.toContain('trabalho');
      expect(all).not.toContain('disciplina');
    }
  });
});
