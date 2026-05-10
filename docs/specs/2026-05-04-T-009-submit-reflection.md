---
title: "Spec — T-009: Route Handler `POST /api/reflect` (submit + persist + stream Sonnet)"
type: "Spec Técnica"
purpose: "Primeiro código user-facing do pipeline da feature core 'Captura de Reflexão Diária'. Route Handler Next.js 15 que valida input, persiste reflexão em journal_entries (T-008 schema), e streama resposta empática do Claude Sonnet 4.6 com privacy gate ativo. Segunda task do Marco 1 MVP — destrava T-010 (job async insights) e T-011 (UI /reflect)."
---

# Spec — T-009: Route Handler `POST /api/reflect` (submit + persist + stream Sonnet)

> **Marco:** 1 (MVP) — feature core "Captura de Reflexão Diária"
> **Status:** ✅ concluída
> **Owner:** pacini
> **Criada em:** 2026-05-04
> **Versão:** 0.1
> **Concluída em:** 2026-05-10 (commit `6599c13` em `main`, com follow-up M-001..M-005 aplicado)
> **Pré-requisitos:** T-005 ✅ (Supabase clients tipados); T-006 ✅ (`chatStream` Sonnet 4.6); T-007 ✅ (middleware Supabase auth); T-008 ✅ (`journal_entries` evoluído pra append-only + processed_at)
> **Paralelizável com:** T-010 (job async) — não, T-010 lê rows criadas aqui; T-011 (UI) — sim, depende só do contrato HTTP estável

---

## 1. Objetivo

Entregar o **único endpoint backend** que aceita uma reflexão escrita pelo usuário, persiste em `journal_entries` (com RLS por `auth.uid()`), e streama uma resposta empática do Claude Sonnet 4.6 de volta pro browser. Este Route Handler é a "ponte" entre a UI (T-011, futura) e os dois sistemas externos do Companion: Postgres e Anthropic API. Mantém o privacy gate ★ALTO do PRD ativo — `content` da reflexão **nunca** entra em log, telemetria, ou error report. Sem contexto histórico (Sonnet recebe só a reflexão atual). Sem detecção runtime de linguagem clínica (system prompt forte é a única defesa nesta task; T-009b futura adiciona detecção+retry+fallback).

## 2. Capacidade adquirida

Após esta spec fechar, o Companion **passa a ter**: (a) endpoint público autenticado `POST /api/reflect` que aceita JSON `{content: string}` e devolve stream chunked com 1ª linha `{reflection_id}` + texto Claude + opcional erro JSON na última linha; (b) system prompt empático versionado em git (`v1`) com guardrails contra linguagem clínica e referência ao CVV (188) pra crises; (c) suite de tests que valida 12 cenários de Route Handler (auth, validação, INSERT, stream shape, error handling, privacy gate em logs); (d) suite de eval test (skip default) com 5 cenários conhecidos pra rodar manual antes de release modificando system prompt; (e) base estável pra T-010 (job async consome rows com `processed_at IS NULL`) e T-011 (UI consome stream via `fetch`).

## 3. Escopo

### Inclui

- **Route Handler [`apps/web/src/app/api/reflect/route.ts`](../../apps/web/src/app/api/reflect/route.ts):**
  - Export `POST(request: Request)` (Next.js 15 App Router convention)
  - Parse body como JSON; reject 400 `{error:'invalid_json'}` se falha
  - Valida `content: string` presente; reject 400 `{error:'invalid_input'}`
  - Aplica `content.trim()`; valida `3 ≤ length ≤ 8000`; reject 400 `{error:'too_short'}` ou 413 `{error:'too_long'}`
  - Auth via `createServerClient().auth.getUser()`; reject 401 `{error:'unauthenticated'}` se !user
  - INSERT em `journal_entries (user_id, body, prompt_used)` com `body=content_trimmed`, `prompt_used=null`; capture `id` retornado
  - Em erro Supabase, reject 500 `{error:'persistence_failed'}`; **não chama Claude**
  - Cria `ReadableStream`:
    - 1º enqueue: `${JSON.stringify({reflection_id})}\n`
    - `for await chunk of chatStream({system: REFLECTION_EMPATHIC_SYSTEM_PROMPT, messages: [{role:'user', content: trimmed}]})`: enqueue chunk
    - Se chatStream throws: enqueue `\n${JSON.stringify({error:'ai_unavailable', reflection_id})}\n`, então close
    - Senão close normalmente após stream esgotar
  - Retorna `Response(stream, {status:200, headers:{'Content-Type':'text/plain; charset=utf-8'}})`

- **System prompt [`apps/web/src/shared/ai/prompts/reflection-empathic.ts`](../../apps/web/src/shared/ai/prompts/reflection-empathic.ts):**
  - Export `REFLECTION_EMPATHIC_SYSTEM_PROMPT: string`
  - Export `REFLECTION_EMPATHIC_PROMPT_VERSION = 'v1' as const`
  - Conteúdo (em PT-BR):
    - Persona: "Você é Companion, um espaço seguro de reflexão. Não substitui terapia."
    - Diretrizes obrigatórias: nunca diagnosticar ("você tem ansiedade"), nunca prescrever ("tome remédio X"), nunca julgar moralmente ("você está certo/errado"), nunca rotular ("você é narcisista"). Sempre usar qualifier ("você pode considerar", "talvez", "uma possibilidade"). Sempre redirecionar auto-diagnóstico ("acho que tenho TDAH") pra avaliação profissional.
    - Crisis: se usuário menciona auto-machucar, suicídio, ou sinais de crise aguda, mencionar buscar suporte profissional + linha CVV 188 (Brasil) sem diagnosticar. Resposta deve ser empática primeiro.
    - Forma: 1-2 parágrafos, tom empático mas não-paternalista, sem emoji forçado, em PT-BR (mesmo que reflexão seja em outro idioma — seguir idioma da reflexão).

- **Test [`apps/web/src/app/api/reflect/route.test.ts`](../../apps/web/src/app/api/reflect/route.test.ts):**
  - Vitest, mocka `createServerClient` e `chatStream` (nenhum hits real DB ou Anthropic)
  - 12 casos: auth, parsing, validações, happy path, trim, INSERT erro, Claude erro, privacy gate em logs, system prompt usado, sem contexto histórico (ver §4 CAs)

- **Eval test [`apps/web/src/shared/ai/prompts/reflection-empathic.eval.test.ts`](../../apps/web/src/shared/ai/prompts/reflection-empathic.eval.test.ts):**
  - 5 cenários `it.skip` por default (rede + custo)
  - Run manual: `pnpm test -- --run reflection-empathic.eval`
  - Cada um manda input real → `chatStream` agregado → valida via regex/lista de termos proibidos
  - Cenários: banal (E1), gatilho clínico moderado (E2), crisis ★ (E3), auto-diagnóstico (E4), conflito relacional (E5)

### Não inclui

- ❌ **UI `/reflect`** — defer pra **T-011**.
- ❌ **Job async insights** (popular `insights_jsonb`) — defer pra **T-010**. T-009 só cria a row com `processed_at NULL`; T-010 polla.
- ❌ **CA-007 detecção runtime de linguagem clínica** (buffer + retry + fallback) — defer pra **T-009b**. Esta task confia em system prompt forte + eval manual.
- ❌ **Contexto histórico** (últimas N reflexões pro Sonnet) — defer pra **T-009c ou Marco 2**. Decisão Q2 fechada (sem contexto MVP).
- ❌ **Micro-memória cumulativa de findings IA** — peça arquitetural identificada em brainstorming, defer pra task pós-T-010 sem ID atribuído. Detalhe em [memória Legion](C:/Users/pbrab/.claude/projects/d--Legion---New-Horizon/memory/project_companion_roadmap.md).
- ❌ **Rate limiting** (10 reflexões/dia per user) — guideline PRD §10 risco, defer.
- ❌ **CHECK constraint DB de tamanho** — D-T008-5 já fechou (sem CHECK). T-009 valida no Route Handler.
- ❌ **Idempotency key / dedup** — duplo-click cria 2 reflexões, aceito MVP (Day One/Stoic fazem igual).
- ❌ **Streaming tipo SSE** com `text/event-stream` — Decisão Q1 fechou: `text/plain` chunked é mais barato e suficiente.
- ❌ **Retry automático em falha de Claude** — Decisão Q5 fechada (best-effort + erro explícito, sem retry).
- ❌ **Lint rule bloqueando `console.*` com content/body** — guarda futura, defer.

## 4. Critérios de aceite

| ID | Critério | Validado em |
|---|---|---|
| CA-T009-1 | Dado `POST /api/reflect` autenticado com `{content: "500 chars valid text"}`, quando Route Handler responde, então status 200 + 1ª linha do body é JSON válido `{reflection_id}` com UUID v4 + linhas seguintes são texto do mock chatStream | route.test.ts cenário 6 |
| CA-T009-2 | Dado happy path acima, quando inspeciono mock Supabase, então `.from('journal_entries').insert()` foi chamado com `{user_id: <auth.uid>, body: <trimmed>, prompt_used: null}` exatamente uma vez | route.test.ts cenário 6 |
| CA-T009-3 ★ALTO | Dado teste injeta `content` contendo um **sentinel único** (ex: `"<<SENTINEL_${randomUUID()}_END>>"` embutido em texto válido), quando teste força falha de Supabase INSERT (cenário 8) ou falha de chatStream (cenário 9) e inspeciona spies de `console.log/info/warn/error`, então **nenhuma** chamada de qualquer método `console.*` contém o sentinel — privacy gate provado por construção sem falso-positivo (mapeia PRD CA-003) | route.test.ts cenário 10 |
| CA-T009-4 | Validações de boundary: (a) sem auth → 401; (b) body não-JSON → 400; (c) `content` ausente/não-string → 400; (d) `content.trim().length < 3` → 400 `too_short`; (e) `content.length > 8000` → 413 `too_long` | route.test.ts cenários 1-5 |
| CA-T009-5 | Dado happy path com input `"  hello  "` (whitespace borda), quando inspeciono INSERT, então `body === "hello"` (trim aplicado antes do save) | route.test.ts cenário 7 |
| CA-T009-6 | Dado falha do Supabase INSERT, quando Route Handler responde, então status 500 + JSON `{error:'persistence_failed'}` + `chatStream` **não** foi chamado | route.test.ts cenário 8 |
| CA-T009-7 | Dado INSERT ok mas `chatStream` lança erro, quando consumo o stream da resposta, então status 200 + 1ª linha JSON `{reflection_id}` válido + última linha JSON `{error:'ai_unavailable', reflection_id}` + stream fecha (sem chunks de texto entre) | route.test.ts cenário 9 |
| CA-T009-8 | Dado happy path, quando inspeciono args de `chatStream`, então `system === REFLECTION_EMPATHIC_SYSTEM_PROMPT` (system prompt versionado v1) e `messages.length === 1` (sem contexto histórico) | route.test.ts cenários 11-12 |
| CA-T009-9 ★ALTO (manual) | Dado run manual `pnpm test -- --run reflection-empathic.eval`, quando todos os 5 cenários executam, então cada resposta do Sonnet **não** contém termos clínicos/prescritivos proibidos da lista (mapeia PRD RF-010 + CA-007 partial cobertura via eval) | eval.test.ts E1-E5 |
| CA-T009-10 | Dado suite Vitest do Companion, quando rodo `pnpm test`, então 22 baseline + 12 novos = 34 testes passam (eval.test.ts é skipped, não conta no total) | manual via WSL |
| CA-T009-11 | Dado fluxo TDD do Legion ativo, quando faço commit `feat(T-009): GREEN phase`, então pre-commit hook valida frontmatter de notes/T-009.md + secret scanner OK + Marshal não grita drift | git commit log |

## 5. Plano de implementação

> **TBD** — preenchido pela skill `superpowers:writing-plans` após aprovação desta spec. Plan mora em `docs/plans/2026-05-04-T-009-submit-reflection.md`.

Estrutura esperada:
- Task 1: Setup (notes/T-009.md stub + 4 arquivos vazios: route.ts, route.test.ts, prompts/reflection-empathic.ts, prompts/reflection-empathic.eval.test.ts) + commit `chore(T-009): scaffold`
- Task 2: RED phase — `route.test.ts` 12 cenários falham porque `route.ts` é vazio + `eval.test.ts` 5 cenários skipped (não falham, mas import quebra se prompt não existe). Commit `test(T-009): RED phase`
- Task 3: GREEN phase — implementa `route.ts` + `reflection-empathic.ts` (system prompt v1). Suite passa 34/34 (eval skipped). Commit `feat(T-009): GREEN phase`
- Task 4: Suite full Companion (Vitest 34 + pgTAP 117 baseline preservado)
- Task 5: Notes T-009 finalizar (decisões D-T009-* + desvios + reflexão)
- Task 6: Push origin main

## 6. Decisões e ADRs gerados

Decisões fechadas em brainstorming 2026-05-04 (Pacini ↔ Claude). 5 perguntas, 5 forks.

| Data | Decisão | Motivação | Link ADR |
|---|---|---|---|
| 2026-05-04 | D-T009-1 — Route Handler `POST /api/reflect` (não Server Action) | Padrão indústria pra LLM streaming; casa com `chatStream` async iterator existente; T-011 consome via `fetch` nativo sem framework lock-in. Server Action stream do Next.js 15 ainda é experimental | — |
| 2026-05-04 | D-T009-2 — Sem contexto histórico no Sonnet (apenas reflexão atual) | YAGNI strict; mantém custo R$ ~0.03/reflexão (vs R$ ~0.04-0.08); diferencial cumulativo vai pra `/insights` semanal (T-010+) ou micro-memória futura | — |
| 2026-05-04 | D-T009-3 — Guardrail clínico apenas via system prompt + eval manual (sem detecção runtime) | YAGNI; Sonnet 4.6 com sys prompt forte raramente desliza; eval test 5 cenários é baseline mensurável; CA-007 completo (buffer + retry + fallback) vira T-009b separado | — |
| 2026-05-04 | D-T009-4 — Limites: trim + 3 ≤ length ≤ 8000 chars, validados no Route Handler | 5000 PRD soft limit + 60% folga UX; min 3 evita ruído ("a", "."); trim pra não persistir whitespace; validação app-side porque DB sem CHECK (D-T008-5) | — |
| 2026-05-04 | D-T009-5 — Falha Claude pós-INSERT: best-effort + erro explícito (sem retry, sem timeout race) | Honesto pro user, simples no código, sinal forte pra observabilidade (`ai_unavailable` count = métrica de saúde); UI em T-011 botão "tentar novamente" reutiliza `reflection_id` salva | — |
| 2026-05-04 | D-T009-6 — Stream `text/plain; charset=utf-8` chunked (não SSE `text/event-stream`) | SSE tem overhead `data:` prefix + `\n\n` separators; texto puro mais barato; Claude streama tokens não eventos discretos; metadata JSON na 1ª linha + erro JSON na última é convenção simples | — |
| 2026-05-04 | D-T009-7 — System prompt em arquivo TS separado (`prompts/reflection-empathic.ts`), versionado por constante | Permite eval test importar sem duplicar; histórico no `git blame`; rollback `v1 → v2` sem mexer no Route Handler. Fecha PRD Decisão Pendente #5 (git wins, não config DB) | — |
| 2026-05-04 | D-T009-8 — Eval test (5 cenários) `it.skip` default + run manual antes de release | Chamar Anthropic real em CI gastaria R$ 0.10/PR; convenção Anthropic docs; auditoria via console.log da resposta real | — |
| 2026-05-04 | D-T009-9 — Stream contract: 1ª linha JSON `{reflection_id}` + chunks texto + opcional última linha JSON `{error}` | Convenção custom mas auditável; UI em T-011 detecta JSON pelo char `{` na 1ª/última linha. Alternativa SSE rejeitada em D-T009-6 | — |
| 2026-05-04 | D-T009-10 — `prompt_used = null` no INSERT (T-009 não usa prompt sugerido) | RF-009 (prompt sugerido contextual) é Marco 2; T-009 escreve free-form. Coluna `prompt_used` existe (0001), só fica null neste fluxo | — |
| 2026-05-04 | D-T009-11 — Privacy gate ★ALTO: nenhum log/error report contém `content` ou `body` | PRD RF-007 + CA-003. Garantido por: (a) Route Handler só loga metadados (user_id, reflection_id, content_length, error_code); (b) test assertion (CA-T009-3) valida console.error spy não recebeu substring do content. Lint rule global é guarda futura, defer | — |

## 7. Referências cruzadas

- **PRD pai:** [`docs/prds/2026-05-02-captura-reflexao-diaria.md`](../prds/2026-05-02-captura-reflexao-diaria.md) — RF-001 (sync resposta), RF-002 (RLS), RF-007 (privacy gate), RF-010 (não-clínico). CA-003 ★ALTO mapeia pra CA-T009-3.
- **Spec irmã:** [`docs/specs/2026-05-04-T-008-reflections-schema.md`](2026-05-04-T-008-reflections-schema.md) — T-008 entregou schema `journal_entries` que T-009 escreve. D-T008-10 (manter `body`) determina que T-009 traduz "content" UX ↔ "body" DB no boundary.
- **Memória de roadmap:** [`project_companion_roadmap.md`](C:/Users/pbrab/.claude/projects/d--Legion---New-Horizon/memory/project_companion_roadmap.md) — micro-memória cumulativa de findings IA é peça que falta pós-T-010, sinalizada por pacini durante brainstorming desta spec.
- **Código pré-existente reaproveitado:**
  - [`apps/web/src/shared/ai/client.ts`](../../apps/web/src/shared/ai/client.ts) — `chatStream(args)` async iterator de Sonnet 4.6 (T-006)
  - [`apps/web/src/shared/db/server.ts`](../../apps/web/src/shared/db/server.ts) — `createServerClient()` Supabase com cookies (T-005)
  - [`apps/web/src/middleware.ts`](../../apps/web/src/middleware.ts) — auth refresh + redirect (T-007)
- **Anti-Vibe:** PRD → Spec (este doc) → Plan → Execute → Review.

## 8. Histórico de status

| Data | Status | Nota |
|---|---|---|
| 2026-05-04 | ⬜ v0.1 (esta) | Spec criada após brainstorming Pacini ↔ Claude (5 perguntas: arquitetura stream, contexto histórico, guardrail clínico, limites, error handling). Memória de roadmap salva separada (micro-memória findings IA). Auditoria pré-T-009: branch main limpa, T-008 e ideation artifacts committed. |
