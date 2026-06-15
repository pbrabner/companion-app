'use client';

import { useState } from 'react';
import { Button } from '../../design-system/components/Button';
import { parseReflectStream } from './parse-stream';
import { MarkdownResponse } from './MarkdownResponse';

const MIN_LEN = 3;
const MAX_LEN = 8000;

type FormState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'streaming'; text: string; reflectionId: string | null }
  | { kind: 'done'; text: string; reflectionId: string | null }
  | { kind: 'error'; code: 'auth' | 'too_long' | 'too_short' | 'network' | 'ai_unavailable'; partial?: string; reflectionId?: string };

export function ReflectForm() {
  const [content, setContent] = useState('');
  const [state, setState] = useState<FormState>({ kind: 'idle' });

  const trimmedLen = content.trim().length;
  const validInput = trimmedLen >= MIN_LEN && content.length <= MAX_LEN;
  const isBusy = state.kind === 'submitting' || state.kind === 'streaming';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validInput || isBusy) return;
    setState({ kind: 'submitting' });

    try {
      const response = await fetch('/api/reflect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });

      if (!response.ok) {
        if (response.status === 401) {
          setState({ kind: 'error', code: 'auth' });
        } else if (response.status === 413) {
          setState({ kind: 'error', code: 'too_long' });
        } else if (response.status === 400) {
          setState({ kind: 'error', code: 'too_short' });
        } else {
          setState({ kind: 'error', code: 'network' });
        }
        return;
      }

      if (!response.body) {
        setState({ kind: 'error', code: 'network' });
        return;
      }

      const reader = response.body.getReader();
      let accText = '';
      let reflectionId: string | null = null;

      setState({ kind: 'streaming', text: '', reflectionId: null });

      for await (const event of parseReflectStream(reader)) {
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
          return;
        }
      }

      setState({ kind: 'done', text: accText, reflectionId });
    } catch {
      setState({ kind: 'error', code: 'network' });
    }
  }

  function resetForm() {
    setContent('');
    setState({ kind: 'idle' });
  }

  if (state.kind === 'error' && state.code === 'auth') {
    return (
      <div className="max-w-2xl mx-auto p-6 border rounded-lg bg-card text-card-foreground">
        <h2 className="text-xl font-semibold mb-2">Autenticação necessária</h2>
        <p className="text-muted-foreground">
          Você precisa estar autenticado pra registrar reflexões. Login UI em breve.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Como você está se sentindo agora?</h1>

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={8}
        autoFocus
        disabled={isBusy}
        placeholder="Escreva o que está na sua cabeça..."
        className="w-full p-3 border rounded-md bg-background text-foreground resize-y disabled:opacity-50"
      />

      <div className="flex justify-between items-center text-sm">
        <span className="text-muted-foreground">
          {content.length} / {MAX_LEN} chars
        </span>
        <div className="flex gap-2">
          {state.kind === 'done' && (
            <Button type="button" variant="outline" onClick={resetForm}>
              Nova reflexão
            </Button>
          )}
          <Button type="submit" disabled={!validInput || isBusy}>
            {state.kind === 'submitting' ? 'Enviando...' : state.kind === 'streaming' ? 'Recebendo...' : 'Enviar'}
          </Button>
        </div>
      </div>

      {state.kind === 'error' && state.code === 'too_long' && (
        <p className="text-destructive text-sm">Sua reflexão está muito longa (máx 8000 chars).</p>
      )}
      {state.kind === 'error' && state.code === 'too_short' && (
        <p className="text-destructive text-sm">Escreve pelo menos {MIN_LEN} caracteres.</p>
      )}
      {state.kind === 'error' && state.code === 'network' && (
        <p className="text-destructive text-sm">Erro de conexão. Tenta de novo.</p>
      )}

      {state.kind === 'streaming' && (
        <div className="border-t pt-4">
          <h2 className="text-lg font-semibold mb-2">✨ Resposta</h2>
          <p className="whitespace-pre-wrap text-foreground">
            {state.text}
            <span className="animate-pulse">▊</span>
          </p>
        </div>
      )}

      {state.kind === 'done' && (
        <div className="border-t pt-4">
          <h2 className="text-lg font-semibold mb-2">✨ Resposta</h2>
          <MarkdownResponse>{state.text}</MarkdownResponse>
        </div>
      )}

      {state.kind === 'error' && state.code === 'ai_unavailable' && (
        <div className="border-t pt-4">
          <h2 className="text-lg font-semibold mb-2">⚠ IA indisponível</h2>
          <p className="whitespace-pre-wrap text-foreground">{state.partial}</p>
          <p className="text-sm text-muted-foreground mt-2">
            Sua reflexão foi salva (ID: <code>{state.reflectionId}</code>) mas a resposta da IA falhou.
            Tenta de novo daqui a pouco.
          </p>
        </div>
      )}
    </form>
  );
}
