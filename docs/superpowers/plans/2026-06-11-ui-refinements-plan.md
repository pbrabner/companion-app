# UI Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Renderizar markdown na resposta da IA e mover erros transitórios pra toast no fluxo de reflexão do Companion.

**Architecture:** Componente `MarkdownResponse` (wrapper `react-markdown`) aplicado em `/reflect` (estado `done`) e `/reflections` (histórico). Camada de toast (`use-toast` store + `Toaster` montado no root layout) consumida imperativamente por `toast()` nos pontos de erro transitório. Spec: `docs/superpowers/specs/2026-06-11-ui-refinements-design.md` (commit 3811bee).

**Tech Stack:** Next.js 15 App Router, React 19, react-markdown v10, Radix Toast (já vendorado), Vitest 2 + Testing Library 16, pnpm. App em `apps/web`.

**Workflow playbook:** `ui-refinements` (risk desenvolvimento) ativo — controller registra `legion workflow record-dispatch` por executor/qa/reviewer (MESMO target string em started e done).

**Regras transversais:**
- NUNCA `git add .` — paths explícitos.
- Privacy/segurança ★ALTO: CA-UI-3 (XSS escapado) é o teste de segurança da feature.
- Comandos de teste rodam em `D:\companion-app\apps\web`.
- `'use client'` em MarkdownResponse, Toaster, use-toast.
- NÃO modificar casos de teste existentes além do necessário pra markdown.

---

### Task 0: Pre-flight (INLINE controller)

- [ ] **Step 0.1:** `git -C "D:\companion-app" branch --show-current` → `feat/ui-refinements` (HEAD 3811bee = spec).
- [ ] **Step 0.2:** Baseline: `pnpm test` em apps/web → `89 passed | 5 skipped`.
- [ ] **Step 0.3:** Confirmar React 19 em `apps/web/package.json` (`"react": "^19.0.0"`) → react-markdown major compatível é **v10**.
- [ ] **Step 0.4:** Workflow → `legion workflow transition --to planned` (já), depois `--to approved` + `--to executing` ao autorizar.

---

### Task 1: react-markdown + MarkdownResponse (TDD, sonnet)

**Files:**
- Modify: `apps/web/package.json` (dep)
- Create: `apps/web/src/app/reflect/MarkdownResponse.tsx`
- Test: `apps/web/src/app/reflect/MarkdownResponse.test.tsx`

- [ ] **Step 1.1: Instalar dep**

```bash
cd "/d/companion-app/apps/web" && pnpm add react-markdown@^10
```
Confirme em package.json que entrou `"react-markdown": "^10..."`. Se o pnpm resolver peerDeps de React 19 sem warning fatal, ok. Se v10 não existir/incompatível, use a maior major que liste `react: >=18` nos peerDeps e reporte qual.

- [ ] **Step 1.2: Escrever testes (arquivo novo)**

```tsx
/**
 * Tests for MarkdownResponse — renderiza markdown da resposta IA com
 * HTML cru ESCAPADO (sem rehype-raw). CA-UI-1..3.
 * @module app/reflect/MarkdownResponse.test
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MarkdownResponse } from './MarkdownResponse';

describe('MarkdownResponse', () => {
  it('CA-UI-1: **negrito** → <strong>', () => {
    const { container } = render(<MarkdownResponse>{'Isso é **importante** sim'}</MarkdownResponse>);
    const strong = container.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe('importante');
  });

  it('CA-UI-2: lista markdown → <ul><li>', () => {
    const { container } = render(<MarkdownResponse>{'- primeiro\n- segundo'}</MarkdownResponse>);
    const items = container.querySelectorAll('ul li');
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toBe('primeiro');
  });

  it('CA-UI-3 ★ALTO: <script> na resposta → texto escapado, NÃO elemento script', () => {
    const { container } = render(
      <MarkdownResponse>{'Antes <script>alert(1)</script> depois'}</MarkdownResponse>,
    );
    expect(container.querySelector('script')).toBeNull();
    // o texto literal aparece (escapado), provando que não virou tag executável
    expect(screen.getByText(/alert\(1\)/)).toBeTruthy();
  });

  it('renderiza parágrafo simples com a classe do tema', () => {
    const { container } = render(<MarkdownResponse>{'Oi mundo'}</MarkdownResponse>);
    const p = container.querySelector('p');
    expect(p?.textContent).toBe('Oi mundo');
    expect(p?.className).toContain('text-foreground');
  });
});
```

- [ ] **Step 1.3: RED** — `pnpm test -- src/app/reflect/MarkdownResponse.test.tsx` → FAIL (module not found).

- [ ] **Step 1.4: Implementar MarkdownResponse.tsx**

```tsx
'use client';

/**
 * MarkdownResponse — renderiza a resposta da IA como markdown.
 * Sem rehype-raw: HTML cru é escapado (default do react-markdown),
 * fechando o vetor XSS (CA-UI-3 ★ALTO). Sem remark-gfm: o prompt gera
 * markdown básico (parágrafos, ênfase, listas, código inline). YAGNI.
 *
 * Classes Tailwind herdam o look do tema (text-foreground etc.).
 * @module app/reflect/MarkdownResponse
 */

import ReactMarkdown, { type Components } from 'react-markdown';

const components: Components = {
  p: ({ children }) => <p className="text-foreground whitespace-pre-wrap">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-5 space-y-1 text-foreground">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1 text-foreground">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ children }) => (
    <code className="bg-muted px-1 py-0.5 rounded text-sm">{children}</code>
  ),
  a: ({ children, href }) => (
    <a href={href} className="underline hover:text-foreground">
      {children}
    </a>
  ),
};

export function MarkdownResponse({ children }: { children: string }) {
  return (
    <div className="space-y-2">
      <ReactMarkdown components={components}>{children}</ReactMarkdown>
    </div>
  );
}
```

Nota typing: em react-markdown v10 `Components` é exportado do pacote. Se o nome do tipo divergir na versão instalada, importe o tipo correto (cheque `node_modules/react-markdown/index.d.ts`) ou tipe `components` como `Record<string, React.FC<{ children?: React.ReactNode; href?: string }>>` — mantenha o comportamento.

- [ ] **Step 1.5: GREEN** — `pnpm test -- src/app/reflect/MarkdownResponse.test.tsx` → 4 PASS. Depois `pnpm typecheck` → 0.

- [ ] **Step 1.6: Commit**
```bash
git -C "/d/companion-app" add apps/web/package.json apps/web/pnpm-lock.yaml apps/web/src/app/reflect/MarkdownResponse.tsx apps/web/src/app/reflect/MarkdownResponse.test.tsx
git -C "/d/companion-app" commit -m "feat(ui): MarkdownResponse com react-markdown (XSS escapado, CA-UI-1..3)"
```
(Se o lockfile do pnpm estiver na raiz do monorepo e não em apps/web, ajuste o path do lock — verifique `git status` antes do add.)

---

### Task 2: Aplicar MarkdownResponse (TDD, sonnet)

**Files:**
- Modify: `apps/web/src/app/reflect/ReflectForm.tsx`
- Modify: `apps/web/src/app/reflections/ReflectionsList.tsx`
- Test: `apps/web/src/app/reflect/ReflectForm.test.tsx`, `apps/web/src/app/reflections/ReflectionsList.test.tsx` (ADD asserts; ajustar só se algum quebrar)

- [ ] **Step 2.1: ADD teste no ReflectForm.test.tsx** (confirma markdown no `done`). Localize o describe existente; adicione um `it`:

```tsx
  it('CA-UI-4: resposta no estado done renderiza markdown (**x** → strong)', async () => {
    // Usa o mesmo setup dos testes existentes de happy path:
    // mock fetch retornando stream com metadata + chunk '**forte**' e fechando.
    // (Replique o helper de stream usado pelos testes de done já presentes
    //  no arquivo; o ponto do teste é: após done, existe um <strong> com 'forte'.)
    // ... montar response stream com texto '**forte**' ...
    // após aguardar o done:
    // const strong = container.querySelector('strong');
    // expect(strong?.textContent).toBe('forte');
  });
```

IMPORTANTE: o ReflectForm.test.tsx já tem testes de `done` com mock de stream. REUTILIZE exatamente o mesmo padrão de mock desses testes (não invente outro). Se o assert mais simples for adaptar um teste de done existente pra usar texto `'**forte**'` e checar `<strong>`, faça via um `it` NOVO (não modifique o existente). Se o setup de stream for complexo, o assert mínimo aceitável: renderizar o componente em estado done não é trivial sem o stream — então o teste deve dirigir pelo fluxo real de submit+stream como os testes de done existentes fazem.

- [ ] **Step 2.2: RED** — rode o novo teste, deve falhar (hoje `done` usa `<p whitespace-pre-wrap>`, sem `<strong>`).

- [ ] **Step 2.3: Modificar ReflectForm.tsx**

(a) ADD import:
```tsx
import { MarkdownResponse } from './MarkdownResponse';
```

(b) No bloco `{(state.kind === 'streaming' || state.kind === 'done') && (...)}` (atual ~linhas 141-149), SEPARAR streaming de done:
```tsx
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
```
(O bloco `ai_unavailable` com `state.partial` continua `<p whitespace-pre-wrap>` — INALTERADO.)

- [ ] **Step 2.4: GREEN** ReflectForm.

- [ ] **Step 2.5: ADD teste no ReflectionsList.test.tsx** (markdown no card de histórico):

```tsx
  it('CA-UI-5: ai_response renderiza markdown (**x** → strong); body fica plano', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonOk({ reflections: [makeItem(1, '**resposta forte**')], next_cursor: null }),
    );
    const { container } = render(<ReflectionsList />);
    await waitFor(() => expect(container.querySelector('strong')).not.toBeNull());
    expect(container.querySelector('strong')?.textContent).toBe('resposta forte');
    // body do usuário continua texto plano (sem markdown aplicado a ele)
    expect(screen.getByText('reflexão número 1')).toBeTruthy();
  });
```

- [ ] **Step 2.6: RED** — falha (hoje ai_response é `<p whitespace-pre-wrap>`).

- [ ] **Step 2.7: Modificar ReflectionsList.tsx**

(a) ADD import:
```tsx
import { MarkdownResponse } from '../reflect/MarkdownResponse';
```

(b) No card, o ramo `item.ai_response !== null` (atual `<div className="border-l-2 ..."><p ...>{item.ai_response}</p></div>`) passa a:
```tsx
          {item.ai_response !== null ? (
            <div className="border-l-2 border-muted pl-4 text-sm text-muted-foreground">
              <MarkdownResponse>{item.ai_response}</MarkdownResponse>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">Sem resposta registrada</p>
          )}
```
(O `body` da reflexão — `<p className="whitespace-pre-wrap">{item.body}</p>` — fica INALTERADO.)

- [ ] **Step 2.8: GREEN + regressão + typecheck**
- `pnpm test -- src/app/reflect/ReflectForm.test.tsx src/app/reflections/ReflectionsList.test.tsx` → todos PASS (incl. os existentes de texto puro, que continuam válidos)
- `pnpm test` → ZERO fail
- `pnpm typecheck` → 0

- [ ] **Step 2.9: Commit**
```bash
git -C "/d/companion-app" add apps/web/src/app/reflect/ReflectForm.tsx apps/web/src/app/reflect/ReflectForm.test.tsx apps/web/src/app/reflections/ReflectionsList.tsx apps/web/src/app/reflections/ReflectionsList.test.tsx
git -C "/d/companion-app" commit -m "feat(ui): aplica MarkdownResponse no /reflect done e /reflections (CA-UI-4,5)"
```

---

### Task 3: use-toast + Toaster infra (TDD, sonnet)

**Files:**
- Create: `apps/web/src/design-system/components/use-toast.ts`
- Create: `apps/web/src/design-system/components/Toaster.tsx`
- Test: `apps/web/src/design-system/components/use-toast.test.ts`
- Modify: `apps/web/src/app/layout.tsx`

- [ ] **Step 3.1: Escrever testes (arquivo novo)**

```ts
/**
 * Tests for use-toast store — fila, dismiss, TOAST_LIMIT. CA-UI-6.
 * @module design-system/components/use-toast.test
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useToast, toast, TOAST_LIMIT } from './use-toast';

afterEach(() => {
  // limpa a fila global entre testes dispensando tudo
  act(() => {
    const { dismiss } = useToastDirect();
    dismiss();
  });
});

// helper: lê o estado atual sem renderHook quando preciso
function useToastDirect() {
  const { result } = renderHook(() => useToast());
  return result.current;
}

describe('use-toast', () => {
  it('CA-UI-6a: toast() adiciona à fila', () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      toast({ title: 'Oi', description: 'desc' });
    });
    expect(result.current.toasts.length).toBeGreaterThanOrEqual(1);
    expect(result.current.toasts[0]?.title).toBe('Oi');
  });

  it('CA-UI-6b: dismiss marca o toast como fechado (open=false)', () => {
    const { result } = renderHook(() => useToast());
    let id = '';
    act(() => {
      id = toast({ title: 'Some' }).id;
    });
    act(() => {
      result.current.dismiss(id);
    });
    const t = result.current.toasts.find((x) => x.id === id);
    // após dismiss, ou sumiu da fila ou está open=false
    expect(t === undefined || t.open === false).toBe(true);
  });

  it('CA-UI-6c: TOAST_LIMIT respeitado (fila não cresce além do limite)', () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      for (let i = 0; i < TOAST_LIMIT + 3; i++) toast({ title: `t${i}` });
    });
    expect(result.current.toasts.length).toBeLessThanOrEqual(TOAST_LIMIT);
  });
});
```

- [ ] **Step 3.2: RED** — `pnpm test -- src/design-system/components/use-toast.test.ts` → FAIL (module not found).

- [ ] **Step 3.3: Implementar use-toast.ts** (shadcn vendorado, enxuto):

```ts
'use client';

/**
 * use-toast — store global de toasts (padrão shadcn vendorado).
 * Fila com TOAST_LIMIT, dispatch via reducer, subscribers React.
 * @module design-system/components/use-toast
 */

import * as React from 'react';

export const TOAST_LIMIT = 3;
const TOAST_REMOVE_DELAY = 5000;

export type ToasterToast = {
  id: string;
  title?: string;
  description?: string;
  variant?: 'default' | 'destructive';
  open: boolean;
};

type Action =
  | { type: 'ADD'; toast: ToasterToast }
  | { type: 'DISMISS'; id?: string }
  | { type: 'REMOVE'; id?: string };

let count = 0;
function genId(): string {
  count = (count + 1) % Number.MAX_SAFE_INTEGER;
  return String(count);
}

let memoryState: { toasts: ToasterToast[] } = { toasts: [] };
const listeners: Array<(s: { toasts: ToasterToast[] }) => void> = [];
const removeTimers = new Map<string, ReturnType<typeof setTimeout>>();

function reducer(state: { toasts: ToasterToast[] }, action: Action): { toasts: ToasterToast[] } {
  switch (action.type) {
    case 'ADD':
      return { toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT) };
    case 'DISMISS':
      return {
        toasts: state.toasts.map((t) =>
          action.id === undefined || t.id === action.id ? { ...t, open: false } : t,
        ),
      };
    case 'REMOVE':
      return {
        toasts: action.id === undefined ? [] : state.toasts.filter((t) => t.id !== action.id),
      };
    default:
      return state;
  }
}

function dispatch(action: Action): void {
  memoryState = reducer(memoryState, action);
  for (const l of listeners) l(memoryState);
}

function scheduleRemove(id: string): void {
  if (removeTimers.has(id)) return;
  const timer = setTimeout(() => {
    removeTimers.delete(id);
    dispatch({ type: 'REMOVE', id });
  }, TOAST_REMOVE_DELAY);
  timer.unref?.();
  removeTimers.set(id, timer);
}

export function toast(opts: { title?: string; description?: string; variant?: 'default' | 'destructive' }): { id: string } {
  const id = genId();
  dispatch({ type: 'ADD', toast: { ...opts, id, open: true } });
  scheduleRemove(id);
  return { id };
}

export function useToast() {
  const [state, setState] = React.useState(memoryState);
  React.useEffect(() => {
    listeners.push(setState);
    return () => {
      const i = listeners.indexOf(setState);
      if (i > -1) listeners.splice(i, 1);
    };
  }, []);
  return {
    toasts: state.toasts,
    dismiss: (id?: string) => dispatch({ type: 'DISMISS', id }),
  };
}
```

- [ ] **Step 3.4: GREEN** use-toast → 3 PASS.

- [ ] **Step 3.5: Implementar Toaster.tsx**

```tsx
'use client';

/**
 * Toaster — monta o ToastProvider e renderiza a fila do use-toast store.
 * Montado uma vez no root layout.
 * @module design-system/components/Toaster
 */

import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from './Toast';
import { useToast } from './use-toast';

export function Toaster() {
  const { toasts, dismiss } = useToast();
  return (
    <ToastProvider>
      {toasts.map((t) => (
        <Toast
          key={t.id}
          variant={t.variant}
          open={t.open}
          onOpenChange={(open) => {
            if (!open) dismiss(t.id);
          }}
        >
          <div className="grid gap-1">
            {t.title && <ToastTitle>{t.title}</ToastTitle>}
            {t.description && <ToastDescription>{t.description}</ToastDescription>}
          </div>
          <ToastClose />
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  );
}
```

- [ ] **Step 3.6: Montar no layout** — MODIFY `apps/web/src/app/layout.tsx`:

(a) ADD import:
```tsx
import { Toaster } from '../design-system/components/Toaster';
```
(b) No `<body>`, após `{children}`:
```tsx
      <body>
        <Header />
        {children}
        <Toaster />
      </body>
```

- [ ] **Step 3.7: typecheck + build** — `pnpm typecheck` → 0; `pnpm build` → sucesso (Toaster é client dentro de layout server — boundary no próprio 'use client' do Toaster).

- [ ] **Step 3.8: Commit**
```bash
git -C "/d/companion-app" add apps/web/src/design-system/components/use-toast.ts apps/web/src/design-system/components/use-toast.test.ts apps/web/src/design-system/components/Toaster.tsx apps/web/src/app/layout.tsx
git -C "/d/companion-app" commit -m "feat(ui): infra de toast (use-toast store + Toaster no layout, CA-UI-6)"
```

---

### Task 4: Wiring toast nos erros transitórios (TDD, sonnet)

**Files:**
- Modify: `apps/web/src/app/reflect/ReflectForm.tsx`
- Modify: `apps/web/src/app/reflections/ReflectionsList.tsx`
- Test: `apps/web/src/app/reflect/ReflectForm.test.tsx`, `apps/web/src/app/reflections/ReflectionsList.test.tsx`

- [ ] **Step 4.1: Mock do toast nos testes** — em AMBOS os test files, ADD no topo (junto aos vi.mock existentes):

```ts
const toastMock = vi.fn();
vi.mock('../../design-system/components/use-toast', () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}));
```
(Ajuste o caminho relativo: de `src/app/reflect/ReflectForm.test.tsx` o módulo é `../../design-system/components/use-toast`; de `src/app/reflections/ReflectionsList.test.tsx` idem `../../design-system/components/use-toast`. Confirme contando os níveis.)
Adicione `beforeEach(() => toastMock.mockClear())` se não houver clear global.

- [ ] **Step 4.2: ADD testes ReflectForm** (CA-UI-7, CA-UI-8):

```tsx
  it('CA-UI-7: erro de rede → dispara toast destructive e NÃO renderiza <p> inline de network', async () => {
    // mock fetch lançando (catch → network), como nos testes de erro existentes
    // ... disparar submit que cai em network ...
    // após o erro:
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' }),
    );
    expect(screen.queryByText('Erro de conexão. Tenta de novo.')).toBeNull();
  });

  it('CA-UI-8: too_short continua inline (sem toast)', async () => {
    // submit com conteúdo < MIN_LEN dispara validação client-side; se o fluxo
    // de too_short for server-side no projeto, replique o mock de status 400
    // dos testes existentes. Assert:
    expect(screen.queryByText(/pelo menos/i)).toBeTruthy();
    expect(toastMock).not.toHaveBeenCalled();
  });
```
REUTILIZE o padrão de mock de erro dos testes existentes do arquivo (network via fetch reject; too_short via o mecanismo já testado). Não invente fluxo novo.

- [ ] **Step 4.3: RED** ReflectForm wiring.

- [ ] **Step 4.4: Modificar ReflectForm.tsx**

(a) ADD import:
```tsx
import { toast } from '../../design-system/components/use-toast';
```

(b) No `catch` do handleSubmit e nos pontos que setam `code: 'network'`, ADICIONE o toast junto ao setState:
```tsx
    } catch {
      setState({ kind: 'error', code: 'network' });
      toast({ variant: 'destructive', title: 'Erro de conexão', description: 'Tenta de novo.' });
    }
```
E no ramo `!response.ok` que mapeia pro `else { setState({ kind: 'error', code: 'network' }); }` — adicione o mesmo `toast(...)`.

(c) No ramo do stream `event.type === 'error'` (ai_unavailable), ADICIONE toast junto ao setState existente:
```tsx
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
            description: 'Tua reflexão foi salva. Tenta a resposta de novo daqui a pouco.',
          });
          return;
        }
```

(d) REMOVER o `<p>` inline de network (atual `{state.kind === 'error' && state.code === 'network' && (<p ...>Erro de conexão...</p>)}`). MANTER os de `too_long`/`too_short`. No bloco `ai_unavailable`, REMOVER a linha de aviso "Tenta de novo daqui a pouco" (agora no toast) mas MANTER o `partial` + "Sua reflexão foi salva (ID: ...)".

- [ ] **Step 4.5: GREEN** ReflectForm.

- [ ] **Step 4.6: ADD teste ReflectionsList** (CA-UI-9):

```tsx
  it('CA-UI-9: falha no Carregar mais → toast + preserva itens (não cai pra erro tela cheia)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonOk({ reflections: [makeItem(1)], next_cursor: '2026-06-01T12:00:00Z' }),
    );
    render(<ReflectionsList />);
    const btn = await screen.findByRole('button', { name: 'Carregar mais' });

    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await userEvent.click(btn);

    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    // itens já carregados continuam visíveis (não trocou por erro de tela cheia)
    expect(screen.getByText('reflexão número 1')).toBeTruthy();
    // NÃO mostra a mensagem de erro full-screen do load inicial
    expect(screen.queryByText('Não foi possível carregar o histórico. Tenta de novo.')).toBeNull();
  });
```

- [ ] **Step 4.7: RED** ReflectionsList wiring.

- [ ] **Step 4.8: Modificar ReflectionsList.tsx**

(a) ADD import:
```tsx
import { toast } from '../../design-system/components/use-toast';
```

(b) No `handleLoadMore`, o ramo de erro passa de cair pro estado `error` global pra: toast + volta ao `ready` anterior preservando itens:
```tsx
    if ('errorCode' in result) {
      if (result.errorCode === 'auth') {
        setState({ kind: 'error', code: 'auth' });
      } else {
        toast({
          variant: 'destructive',
          title: 'Erro ao carregar',
          description: 'Não foi possível carregar mais. Tenta de novo.',
        });
        setState({ kind: 'ready', items, nextCursor });
      }
      return;
    }
```
(`auth` no meio da paginação ainda vale tela cheia — sessão morreu. Só `network` vira toast + preserva. O erro de **load inicial** no `useEffect` continua setando `error` → tela cheia inline, INALTERADO.)

- [ ] **Step 4.9: GREEN + regressão + typecheck**
- `pnpm test` → ZERO fail
- `pnpm typecheck` → 0

- [ ] **Step 4.10: Commit**
```bash
git -C "/d/companion-app" add apps/web/src/app/reflect/ReflectForm.tsx apps/web/src/app/reflect/ReflectForm.test.tsx apps/web/src/app/reflections/ReflectionsList.tsx apps/web/src/app/reflections/ReflectionsList.test.tsx
git -C "/d/companion-app" commit -m "feat(ui): erros transitorios (network/ai_unavailable) viram toast (CA-UI-7,8,9)"
```

---

### Task 5: QA gate + smoke live (INLINE controller + HUMAN GATE)

- [ ] **Step 5.1: QA (CA-UI-10).** `pnpm test` + `pnpm typecheck` + `pnpm build` → registrar `record-dispatch --role qa --result done` + `workflow verdict --verdict PASS`.
- [ ] **Step 5.2: Review.** Dispatch reviewer subagent no diff `main..feat/ui-refinements` (spec + quality). `record-dispatch --role reviewer`. Fixes se houver.
- [ ] **Step 5.3: PAUSA — HUMAN GATE (Pacini):** smoke CA-UI-11 no app live:
  1. Refletir → ao completar, a resposta aparece formatada (negrito/listas se o Sonnet gerar)
  2. Forçar erro de rede (devtools offline ou similar) → toast destructive aparece, some sozinho
- [ ] **Step 5.4: PR** via `gh pr create --body-file`, bind PR, transition `human-review`. Merge SÓ com aprovação explícita do Pacini.

---

## Self-Review (controller)

- **Spec coverage:** CA-UI-1..3 (Task 1), CA-UI-4..5 (Task 2), CA-UI-6 (Task 3), CA-UI-7..9 (Task 4), CA-UI-10..11 (Task 5). ✅ Todos mapeados.
- **D-UI-2** (markdown só no done): Task 2 Step 2.3 separa streaming (plano) de done (markdown). ✅
- **D-UI-3** (só transitórios): Task 4 — network/ai_unavailable → toast; too_long/too_short/auth inline. ✅
- **D-UI-5** (Carregar mais preserva itens): Task 4 Step 4.8. ✅
- **Type consistency:** `toast({title,description,variant})` e `useToast().toasts/dismiss` consistentes entre use-toast (T3) e consumidores (T3 Toaster, T4 wiring). ✅
- **Nota:** os testes de markdown em estado `done` (T2) e erro (T4) dependem do padrão de mock de stream já presente em ReflectForm.test.tsx — o implementer DEVE reusar o helper existente, não criar outro. Flag explícita nos steps.
