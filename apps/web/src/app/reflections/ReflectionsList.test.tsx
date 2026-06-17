/**
 * Tests for ReflectionsList — historico com Carregar mais.
 * CA-RH-9..11. Mock de fetch global (vi.stubGlobal).
 * @module app/reflections/ReflectionsList.test
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReflectionsList } from './ReflectionsList';

vi.mock('../reflect/stream-retry', () => ({ streamRetry: vi.fn() }));
import { streamRetry } from '../reflect/stream-retry';

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

const toastMock = vi.fn();
vi.mock('../../design-system/components/use-toast', () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}));

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
  toastMock.mockClear();
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
    const secondCallUrl = String(fetchMock.mock.calls[1]?.[0]);
    expect(secondCallUrl).toContain('before=2026-06-01T12%3A00%3A00Z');
  });

  it('CA-UI-9: falha no Carregar mais → toast + preserva itens (não cai pra erro tela cheia)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonOk({ reflections: [makeItem(1)], next_cursor: '2026-06-01T12:00:00Z' }),
    );
    render(<ReflectionsList />);
    const btn = await screen.findByRole('button', { name: 'Carregar mais' });
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await userEvent.click(btn);
    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(screen.getByText('reflexão número 1')).toBeTruthy();
    expect(screen.queryByText('Não foi possível carregar o histórico. Tenta de novo.')).toBeNull();
  });

  it('CA-UI-5: ai_response renderiza markdown (**x** → strong); body fica plano', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonOk({ reflections: [makeItem(1, '**resposta forte**')], next_cursor: null }),
    );
    const { container } = render(<ReflectionsList />);
    await waitFor(() => expect(container.querySelector('strong')).not.toBeNull());
    expect(container.querySelector('strong')?.textContent).toBe('resposta forte');
    expect(screen.getByText('reflexão número 1')).toBeTruthy();
  });

  it('CA-RH-11: ai_response NULL → "Sem resposta registrada"', async () => {
    fetchMock.mockResolvedValueOnce(jsonOk({ reflections: [makeItem(1, null)], next_cursor: null }));
    render(<ReflectionsList />);
    await waitFor(() => expect(screen.getByText('Sem resposta registrada')).toBeTruthy());
  });

  it('CA-RT-5: item com ai_response null mostra "Tentar de novo"; click streama no card', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonOk({
        reflections: [
          {
            id: 'r1',
            body: 'corpo',
            created_at: '2026-06-01T10:00:00Z',
            ai_response: null,
            ai_response_at: null,
          },
        ],
        next_cursor: null,
      }),
    );

    async function* okEvents() {
      yield { type: 'metadata', reflection_id: 'r1' } as const;
      yield { type: 'text', chunk: 'Resposta nova' } as const;
    }
    (streamRetry as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, events: okEvents() });

    const user = userEvent.setup();
    render(<ReflectionsList />);

    const btn = await screen.findByRole('button', { name: 'Tentar de novo' });
    await user.click(btn);

    expect(await screen.findByText('Resposta nova')).toBeInTheDocument();
    expect(streamRetry).toHaveBeenCalledWith('r1');
  });

  it('CA-RT-5b: item com ai_response não mostra "Tentar de novo"', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonOk({
        reflections: [
          {
            id: 'r2',
            body: 'corpo 2',
            created_at: '2026-06-02T10:00:00Z',
            ai_response: 'já tem',
            ai_response_at: '2026-06-02T10:00:05Z',
          },
        ],
        next_cursor: null,
      }),
    );
    render(<ReflectionsList />);
    expect(await screen.findByText('já tem')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).toBeNull();
  });
});
