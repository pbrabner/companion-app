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
