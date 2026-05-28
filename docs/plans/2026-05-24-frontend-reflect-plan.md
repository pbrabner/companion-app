---
title: "Frontend /reflect — implementation plan"
type: plan
status: proposed
created: 2026-05-24
owner: pacini
spec: docs/plans/2026-05-24-frontend-reflect-design.md
workflow_id: frontend-reflect-page-form-stream-display
---

# Frontend /reflect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Página `/reflect` com form streaming Sonnet — loop end-to-end T-008 → T-009 → este → fechado.

**Architecture:** Next.js 15 App Router page + Client component + `fetch` + `ReadableStream`. Sem libs novas.

**Tech Stack:** React 19, Next.js 15, Tailwind 4, Vitest, design system Button (existing).

---

## Tasks Overview

| # | Task | Modelo |
|---|---|---|
| 1 | `parseReflectStream` util + tests | sonnet |
| 2 | `<ReflectForm />` component (RED+GREEN) | sonnet |
| 3 | `/reflect` page wrapper | haiku |
| 4 | Smoke local (dev server + UI inspection) | haiku |

---

## Task 1 — `parseReflectStream` utility

**Files:**
- Create: `apps/web/src/app/reflect/parse-stream.ts`
- Create: `apps/web/src/app/reflect/parse-stream.test.ts`

Utility extracts metadata + content + tail-error from POST /api/reflect stream response.

### API
```typescript
export type ReflectStreamEvent =
  | { type: 'metadata'; reflection_id: string }
  | { type: 'text'; chunk: string }
  | { type: 'error'; code: string; reflection_id?: string };

export async function* parseReflectStream(
  reader: ReadableStreamDefaultReader<Uint8Array>
): AsyncGenerator<ReflectStreamEvent>;
```

### Step 1.1 — Failing tests

```typescript
import { describe, it, expect } from 'vitest';
import { parseReflectStream } from './parse-stream';

function makeReader(chunks: string[]) {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    read: async () => {
      if (i >= chunks.length) return { done: true, value: undefined };
      return { done: false, value: encoder.encode(chunks[i++]) };
    },
  } as ReadableStreamDefaultReader<Uint8Array>;
}

async function collect<T>(g: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of g) out.push(v);
  return out;
}

describe('parseReflectStream', () => {
  it('extracts metadata from first line', async () => {
    const reader = makeReader(['{"reflection_id":"abc-123"}\n', 'Hello world']);
    const events = await collect(parseReflectStream(reader));
    expect(events[0]).toEqual({ type: 'metadata', reflection_id: 'abc-123' });
    expect(events.slice(1)).toEqual([{ type: 'text', chunk: 'Hello world' }]);
  });

  it('handles metadata + text split across chunks', async () => {
    const reader = makeReader(['{"reflection_id":"x"', '}\nfoo', 'bar']);
    const events = await collect(parseReflectStream(reader));
    expect(events[0]).toEqual({ type: 'metadata', reflection_id: 'x' });
    const text = events.filter((e) => e.type === 'text').map((e: any) => e.chunk).join('');
    expect(text).toBe('foobar');
  });

  it('emits text chunks as they arrive', async () => {
    const reader = makeReader(['{"reflection_id":"x"}\n', 'one ', 'two ', 'three']);
    const events = await collect(parseReflectStream(reader));
    const texts = events.filter((e) => e.type === 'text').map((e: any) => e.chunk);
    expect(texts).toEqual(['one ', 'two ', 'three']);
  });

  it('detects tail error JSON', async () => {
    const reader = makeReader([
      '{"reflection_id":"x"}\n',
      'partial response',
      '\n{"error":"ai_unavailable","reflection_id":"x"}\n',
    ]);
    const events = await collect(parseReflectStream(reader));
    const last = events[events.length - 1];
    expect(last).toEqual({ type: 'error', code: 'ai_unavailable', reflection_id: 'x' });
  });

  it('treats malformed metadata gracefully (no metadata event)', async () => {
    const reader = makeReader(['not json\n', 'rest']);
    const events = await collect(parseReflectStream(reader));
    expect(events.some((e) => e.type === 'metadata')).toBe(false);
    // Should still emit the malformed first chunk + rest as text
    const text = events.filter((e) => e.type === 'text').map((e: any) => e.chunk).join('');
    expect(text).toContain('rest');
  });

  it('handles empty stream', async () => {
    const reader = makeReader([]);
    const events = await collect(parseReflectStream(reader));
    expect(events).toEqual([]);
  });
});
```

### Step 1.2 — RED

```bash
cd "D:/companion-app/apps/web"
pnpm vitest run src/app/reflect/parse-stream.test.ts 2>&1 | tail -10
```

Expected: 6 FAIL (file missing).

### Step 1.3 — GREEN implementation

`apps/web/src/app/reflect/parse-stream.ts`:

```typescript
/**
 * Parses streaming response from POST /api/reflect.
 *
 * Stream contract (from route.ts):
 *   First line: JSON metadata `{"reflection_id": "<uuid>"}\n`
 *   Body: raw Claude text chunks
 *   Optional tail: `\n{"error":"ai_unavailable","reflection_id":"<uuid>"}\n`
 */

export type ReflectStreamEvent =
  | { type: 'metadata'; reflection_id: string }
  | { type: 'text'; chunk: string }
  | { type: 'error'; code: string; reflection_id?: string };

const TAIL_ERROR_PATTERN = /\n(\{"error":[^\n]+\})\n?$/;

export async function* parseReflectStream(
  reader: ReadableStreamDefaultReader<Uint8Array>
): AsyncGenerator<ReflectStreamEvent> {
  const decoder = new TextDecoder();
  let buffer = '';
  let metadataParsed = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    if (!metadataParsed) {
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx !== -1) {
        const firstLine = buffer.slice(0, newlineIdx);
        try {
          const parsed = JSON.parse(firstLine);
          if (parsed && typeof parsed.reflection_id === 'string') {
            yield { type: 'metadata', reflection_id: parsed.reflection_id };
            buffer = buffer.slice(newlineIdx + 1);
          }
        } catch {
          // Not JSON → treat full first line as text (malformed contract)
        }
        metadataParsed = true;
      } else {
        // Not enough data yet for first newline; wait for more
        continue;
      }
    }

    // Check for tail error pattern
    const tailMatch = buffer.match(TAIL_ERROR_PATTERN);
    if (tailMatch) {
      const textBefore = buffer.slice(0, buffer.length - tailMatch[0].length);
      if (textBefore.length > 0) {
        yield { type: 'text', chunk: textBefore };
      }
      try {
        const err = JSON.parse(tailMatch[1]);
        yield {
          type: 'error',
          code: err.error,
          reflection_id: err.reflection_id,
        };
      } catch {
        yield { type: 'text', chunk: buffer };
      }
      buffer = '';
      // Drain rest of stream (shouldn't be more after tail)
      continue;
    }

    if (buffer.length > 0) {
      yield { type: 'text', chunk: buffer };
      buffer = '';
    }
  }

  // Flush any final buffer
  if (buffer.length > 0) {
    yield { type: 'text', chunk: buffer };
  }
}
```

### Step 1.4 — GREEN check

```bash
pnpm vitest run src/app/reflect/parse-stream.test.ts 2>&1 | tail -5
```

Expected: 6/6 pass.

### Step 1.5 — Commit

```bash
cd "D:/companion-app"
git status -s
git add apps/web/src/app/reflect/parse-stream.ts apps/web/src/app/reflect/parse-stream.test.ts
git diff --cached --stat
git commit -m "feat(reflect): parseReflectStream util — metadata + text + tail error"
```

---

## Task 2 — `<ReflectForm />` component

**Files:**
- Create: `apps/web/src/app/reflect/ReflectForm.tsx`
- Create: `apps/web/src/app/reflect/ReflectForm.test.tsx`

### Step 2.1 — Failing tests

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReflectForm } from './ReflectForm';

const mockFetch = vi.fn();
beforeEach(() => {
  global.fetch = mockFetch;
  mockFetch.mockReset();
});

function streamResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]));
      } else {
        controller.close();
      }
    },
  });
  return new Response(stream, { status, headers: { 'Content-Type': 'text/plain' } });
}

describe('ReflectForm', () => {
  it('renders textarea + submit button', () => {
    render(<ReflectForm />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enviar/i })).toBeInTheDocument();
  });

  it('disables submit when text too short', async () => {
    render(<ReflectForm />);
    const button = screen.getByRole('button', { name: /enviar/i });
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox'), 'ab');
    expect(button).toBeDisabled();
  });

  it('enables submit at 3+ chars', async () => {
    render(<ReflectForm />);
    await userEvent.type(screen.getByRole('textbox'), 'hi!');
    expect(screen.getByRole('button', { name: /enviar/i })).toBeEnabled();
  });

  it('shows char counter', async () => {
    render(<ReflectForm />);
    await userEvent.type(screen.getByRole('textbox'), 'hello');
    expect(screen.getByText(/5 ?\/ ?8000/i)).toBeInTheDocument();
  });

  it('submits and displays streamed text', async () => {
    mockFetch.mockResolvedValueOnce(streamResponse([
      '{"reflection_id":"abc-123"}\n',
      'Hello ',
      'world',
    ]));
    render(<ReflectForm />);
    await userEvent.type(screen.getByRole('textbox'), 'My reflection here');
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }));
    await waitFor(() => {
      expect(screen.getByText(/Hello world/i)).toBeInTheDocument();
    });
  });

  it('shows auth error card on 401', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{"error":"unauthenticated"}', { status: 401 }));
    render(<ReflectForm />);
    await userEvent.type(screen.getByRole('textbox'), 'My reflection');
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }));
    await waitFor(() => {
      expect(screen.getByText(/autenticado/i)).toBeInTheDocument();
    });
  });

  it('shows too_long error on 413', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{"error":"too_long"}', { status: 413 }));
    render(<ReflectForm />);
    await userEvent.type(screen.getByRole('textbox'), 'My reflection');
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }));
    await waitFor(() => {
      expect(screen.getByText(/longa/i)).toBeInTheDocument();
    });
  });

  it('shows ai_unavailable note when stream emits tail error', async () => {
    mockFetch.mockResolvedValueOnce(streamResponse([
      '{"reflection_id":"abc-123"}\n',
      'Partial...',
      '\n{"error":"ai_unavailable","reflection_id":"abc-123"}\n',
    ]));
    render(<ReflectForm />);
    await userEvent.type(screen.getByRole('textbox'), 'My reflection');
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }));
    await waitFor(() => {
      expect(screen.getByText(/indispon/i)).toBeInTheDocument();
      expect(screen.getByText(/abc-123/i)).toBeInTheDocument();
    });
  });

  it('disables form during streaming', async () => {
    let resolveStream: () => void = () => {};
    const pauseStream = new Promise<void>((r) => (resolveStream = r));
    mockFetch.mockReturnValueOnce(new Promise((res) => {
      pauseStream.then(() => res(streamResponse(['{"reflection_id":"x"}\n', 'done'])));
    }));
    render(<ReflectForm />);
    await userEvent.type(screen.getByRole('textbox'), 'My reflection');
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }));
    expect(screen.getByRole('button')).toBeDisabled();
    resolveStream();
  });
});
```

### Step 2.2 — RED

```bash
cd "D:/companion-app/apps/web"
pnpm vitest run src/app/reflect/ReflectForm.test.tsx 2>&1 | tail -10
```

Expected: 9 FAIL.

### Step 2.3 — GREEN component

`apps/web/src/app/reflect/ReflectForm.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Button } from '../../design-system/components/Button';
import { parseReflectStream } from './parse-stream';

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

      {(state.kind === 'streaming' || state.kind === 'done') && (
        <div className="border-t pt-4">
          <h2 className="text-lg font-semibold mb-2">✨ Resposta</h2>
          <p className="whitespace-pre-wrap text-foreground">{state.text}{state.kind === 'streaming' && <span className="animate-pulse">▊</span>}</p>
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
```

### Step 2.4 — GREEN

```bash
pnpm vitest run src/app/reflect/ReflectForm.test.tsx 2>&1 | tail -5
```

Expected: 9/9 pass.

### Step 2.5 — Commit

```bash
cd "D:/companion-app"
git status -s
git add apps/web/src/app/reflect/ReflectForm.tsx apps/web/src/app/reflect/ReflectForm.test.tsx
git diff --cached --stat
git commit -m "feat(reflect): ReflectForm component (form + stream + 7 estados)"
```

---

## Task 3 — `/reflect` page wrapper

**Files:**
- Create: `apps/web/src/app/reflect/page.tsx`

### Step 3.1 — Create page

`apps/web/src/app/reflect/page.tsx`:

```tsx
/**
 * /reflect — daily reflection journaling page.
 * Stream-based form that posts to /api/reflect (T-009 backend).
 *
 * PRD: docs/plans/2026-05-24-frontend-reflect-design.md
 */

import { ReflectForm } from './ReflectForm';

export default function ReflectPage() {
  return (
    <main className="min-h-screen py-12">
      <ReflectForm />
    </main>
  );
}
```

### Step 3.2 — Verify build

```bash
cd "D:/companion-app/apps/web"
pnpm typecheck 2>&1 | tail -5
pnpm build 2>&1 | tail -10
```

Expected: typecheck + build green.

### Step 3.3 — Commit

```bash
cd "D:/companion-app"
git add apps/web/src/app/reflect/page.tsx
git diff --cached --stat
git commit -m "feat(reflect): /reflect page wrapper"
```

---

## Task 4 — Smoke local (dev server)

- [ ] **Step 4.1** — Start dev server
  ```bash
  cd "D:/companion-app/apps/web"
  pnpm dev
  ```

- [ ] **Step 4.2** — Open `http://localhost:3000/reflect` no browser
  - Verifica form renderiza
  - Digita 50 chars, button habilita
  - Submit → vê erro 401 (não logado) com card "Autenticação necessária"

- [ ] **Step 4.3** — (Optional, requires Supabase seed user)
  - Login via magic link
  - Submit valid reflection
  - Confirma stream chega + persiste

- [ ] **Step 4.4** — Documentar resultado em `docs/reports/2026-05-24-frontend-reflect-smoke.md`

---

## Final

- [ ] Push branch
- [ ] `legion workflow evidence add ...`
- [ ] `legion workflow verdict PASS ...`
- [ ] Close + transition to learned
