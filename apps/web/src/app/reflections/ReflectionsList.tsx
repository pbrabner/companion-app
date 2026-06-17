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
import { useEffect, useRef, useState } from 'react';

import { Button } from '../../design-system/components/Button';
import { toast } from '../../design-system/components/use-toast';
import { MarkdownResponse } from '../reflect/MarkdownResponse';
import { streamRetry } from '../reflect/stream-retry';

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
  const cancelledRef = useRef(false);
  const [retryText, setRetryText] = useState<Record<string, string>>({});
  const [retrying, setRetrying] = useState<Record<string, boolean>>({});

  useEffect(() => {
    cancelledRef.current = false;
    (async () => {
      const result = await fetchPage(null);
      if (cancelledRef.current) return;
      if ('errorCode' in result) {
        setState({ kind: 'error', code: result.errorCode });
      } else if (result.reflections.length === 0) {
        setState({ kind: 'empty' });
      } else {
        setState({ kind: 'ready', items: result.reflections, nextCursor: result.next_cursor });
      }
    })();
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  async function handleLoadMore() {
    if (state.kind !== 'ready' || state.nextCursor === null) return;
    const { items, nextCursor } = state;
    setState({ kind: 'loadingMore', items, nextCursor });
    const result = await fetchPage(nextCursor);
    if (cancelledRef.current) return;
    if ('errorCode' in result) {
      if (result.errorCode === 'auth') {
        setState({ kind: 'error', code: 'auth' });
      } else {
        toast({
          variant: 'destructive',
          title: 'Não foi possível carregar mais',
          description: 'Tenta de novo.',
        });
        setState({ kind: 'ready', items, nextCursor });
      }
      return;
    }
    setState({
      kind: 'ready',
      items: [...items, ...result.reflections],
      nextCursor: result.next_cursor,
    });
  }

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
    setState((s) =>
      s.kind === 'ready' || s.kind === 'loadingMore'
        ? { ...s, items: s.items.map((it) => (it.id === id ? { ...it, ai_response: acc } : it)) }
        : s,
    );
    setRetrying((m) => ({ ...m, [id]: false }));
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
      <p role="alert" className="text-destructive text-center">
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
            <div className="border-l-2 border-muted pl-4 text-sm text-muted-foreground">
              <MarkdownResponse>{item.ai_response}</MarkdownResponse>
            </div>
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
