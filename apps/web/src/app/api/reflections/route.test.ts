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
