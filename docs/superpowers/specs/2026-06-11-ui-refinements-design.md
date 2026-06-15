# Spec — Refinos de UI: markdown rendering + toast pra erros transitórios

Feature: ui-refinements
Status: APPROVED em brainstorming Pacini ↔ Legion, 2026-06-11
Workflow: `ui-refinements` (Production Playbook, risk desenvolvimento, owner pacini)
Specs relacionadas: 2026-06-11-reflections-history-design.md (UI base), docs/specs/2026-05-04-T-009-submit-reflection.md (contrato do stream)

---

## 1. Objetivo

Dois refinos de UI no fluxo de reflexão:
1. **Markdown rendering** da resposta da IA (hoje texto plano `whitespace-pre-wrap`) no `/reflect` (ao completar) e no `/reflections` (histórico).
2. **Toast** pra erros transitórios (rede, IA indisponível), substituindo mensagens inline onde o erro é passageiro/recuperável.

**Fora de escopo (decisão Pacini):** botão retry pra `ai_response` NULL — é feature de backend (POST só faz INSERT, retry exige re-stream + UPDATE em row existente), conceitualmente acoplada à micro-memória. Fica pra ciclo próprio.

## 2. Decisões de produto (brainstorming 2026-06-11)

- **D-UI-1:** Escopo = markdown + toast; retry adiado.
- **D-UI-2:** Markdown durante streaming = texto plano + cursor enquanto streama; markdown só ao completar (`done`). Evita flicker de markdown parcial. Histórico sempre markdown completo.
- **D-UI-3:** Toast só pra erros transitórios (network, ai_unavailable). Validação (too_long/too_short) e auth ficam inline.
- **D-UI-4:** Biblioteca = `react-markdown` sem `rehype-raw`/`remark-gfm`. Default escapa HTML cru (sem XSS), sem sanitizador extra. YAGNI: Sonnet gera markdown básico.

## 3. Escopo

### 3.1 Markdown rendering

**Dependência nova:** `react-markdown` (apps/web).

**CREATE `apps/web/src/app/reflect/MarkdownResponse.tsx`** (Client Component):
- Wrapper fino sobre `<ReactMarkdown>` com `components` mapeando elementos a classes Tailwind herdando o look atual: `p` (`text-foreground`), `ul`/`ol` (listas com indent), `li`, `strong`, `em`, `code` (`bg-muted px-1 rounded`), `a` (underline; mas links são raros — sem target/rel especial por ora).
- Props: `{ children: string }`. Um componente, dois consumidores.

**MODIFY `apps/web/src/app/reflect/ReflectForm.tsx`:**
- `streaming` → INALTERADO (`whitespace-pre-wrap` + cursor `▊`).
- `done` → resposta via `<MarkdownResponse>{state.text}</MarkdownResponse>` (era `<p whitespace-pre-wrap>`).
- `ai_unavailable` → `partial` continua plano (resposta incompleta não vale markdown).

**MODIFY `apps/web/src/app/reflections/ReflectionsList.tsx`:**
- `item.ai_response` (não-NULL) → `<MarkdownResponse>{item.ai_response}</MarkdownResponse>`.
- `item.body` (texto do usuário) → continua `whitespace-pre-wrap` plano (não é markdown).
- NULL → "Sem resposta registrada" (inalterado).

### 3.2 Toast pra erros transitórios

**Infra (não existe — só primitivas Radix em design-system/components/Toast.tsx):**

**CREATE `apps/web/src/design-system/components/use-toast.ts`** — hook + store padrão shadcn:
- Reducer com fila (`ADD_TOAST`/`DISMISS_TOAST`/`REMOVE_TOAST`), `TOAST_LIMIT = 3`, auto-dismiss configurável.
- Export `toast({ title?, description?, variant? })` e `useToast()` (retorna `{ toasts, dismiss }`).

**CREATE `apps/web/src/design-system/components/Toaster.tsx`** (Client Component):
- Monta `ToastProvider` + mapeia `useToast().toasts` em `<Toast variant>` com `ToastTitle`/`ToastDescription`/`ToastClose` + `ToastViewport`.

**MODIFY `apps/web/src/app/layout.tsx`:**
- Adicionar `<Toaster />` no `<body>` (após `{children}`). Uma vez, envolve o app.

**Wiring (D-UI-3 — só transitórios):**

`ReflectForm` (`/reflect`):
- `network` → `toast({ variant: 'destructive', title: 'Erro de conexão', description: 'Tenta de novo.' })`; remove o `<p>` inline de network.
- `ai_unavailable` → o aviso "IA falhou, tenta de novo" vira toast; o `partial` + ID **continuam inline** (é conteúdo, não erro transitório).
- **Mantêm inline:** `too_long`, `too_short` (perto do campo), `auth` (bloco de tela cheia).

`ReflectionsList` (`/reflections`):
- Falha no **"Carregar mais"** (network) → toast + componente **volta ao estado `ready` anterior** (preserva itens já carregados; NÃO troca a lista por mensagem de erro de tela cheia).
- Falha no **load inicial** → continua inline com `role="alert"` (não há lista pra preservar; toast em tela vazia confunde).
- **D-UI-5:** Isso muda o comportamento atual do "Carregar mais" (hoje troca tudo por mensagem de erro) — melhoria deliberada.

### 3.3 Não inclui

- ❌ Botão retry (ciclo próprio, ver §1)
- ❌ `remark-gfm` (tabelas, ~~strike~~, task lists) — adicionar se/quando o prompt gerar
- ❌ `rehype-raw` (HTML cru) — risco XSS sem ganho
- ❌ Toast pra sucesso/info — só erro transitório por ora

## 4. Critérios de aceite

| CA | Dado/Quando/Então | Verificação |
|---|---|---|
| CA-UI-1 | `**negrito**` na resposta → renderiza `<strong>` | MarkdownResponse.test |
| CA-UI-2 | Lista markdown (`- a\n- b`) → `<ul><li>` | MarkdownResponse.test |
| CA-UI-3 ★ALTO | `<script>alert(1)</script>` na resposta → texto escapado, NÃO tag script | MarkdownResponse.test |
| CA-UI-4 | /reflect `done` usa MarkdownResponse; `streaming` continua plano | ReflectForm.test |
| CA-UI-5 | /reflections card com ai_response usa MarkdownResponse; body fica plano | ReflectionsList.test |
| CA-UI-6 | `toast()` adiciona à fila; dismiss remove; TOAST_LIMIT respeitado | use-toast.test |
| CA-UI-7 | ReflectForm erro network → dispara toast, NÃO renderiza `<p>` network inline | ReflectForm.test |
| CA-UI-8 | ReflectForm too_long/too_short → continua inline (sem toast) | ReflectForm.test |
| CA-UI-9 | ReflectionsList falha "Carregar mais" → toast + preserva itens (volta a ready) | ReflectionsList.test |
| CA-UI-10 | Suite completa + typecheck + build verdes | QA gate |
| CA-UI-11 | Smoke live: refletir → resposta com markdown; erro de rede → toast | gate humano Pacini |

## 5. Sequência de build

1. Dep `react-markdown` + MarkdownResponse + testes
2. Aplicar MarkdownResponse no ReflectForm (`done`) e ReflectionsList (`ai_response`)
3. use-toast + Toaster + montar no layout + testes
4. Wiring toast: ReflectForm (network/ai_unavailable) + ReflectionsList (Carregar mais)
5. QA + review + PR + smoke live (gate humano)

## 6. Riscos

- **Streaming vs markdown:** garantido pela D-UI-2 — markdown só no `done`, sem reflow mid-stream.
- **react-markdown bundle:** ~40KB gz; aceitável (já carregamos Radix). Sem SSR issue (componente é client; resposta chega client-side).
- **Toast no layout:** `<Toaster />` é Client Component dentro de Server layout — padrão Next suportado (boundary no próprio Toaster com 'use client').
- **Testes existentes:** asserts que pegam texto da resposta por `getByText('resposta 1')` continuam válidos (markdown de texto puro = mesmo texto no DOM). Se algum assert pegar a tag `<p>` específica, ajustar no mesmo commit.
