# Retry button — re-gerar `ai_response` — Design

**Data:** 2026-06-16
**Operador:** Pacini
**Repo:** D:/companion-app (`apps/web`)
**Branch:** `feat/retry-button`

## Problema

Reflexões são salvas (INSERT em `journal_entries`) mesmo quando a resposta da IA
falha no momento do POST — `ai_response` fica NULL. Casos: os dois provedores
(Sonnet + fallback Gemini) fora, erro de rede, ou `save_timeout`. Com o fallback do
PR #13 isso ficou raro, mas ainda ocorre. Hoje não há como re-gerar a resposta: o
`/reflections` mostra *"Sem resposta registrada"* e o `/reflect` mostra o aviso de
"IA indisponível" — ambos becos sem saída.

## Objetivo

Um botão **"Tentar de novo"** que re-gera a resposta empática de uma reflexão com
`ai_response` NULL e faz UPDATE na linha, com streaming. Aparece em **dois lugares**
(decisão Pacini): inline no `/reflect` após a falha, e no card do `/reflections`.

## Não-objetivos (YAGNI)

- Re-gerar resposta de reflexões que JÁ têm `ai_response` (só NULL).
- Editar o `body` da reflexão.
- Migration (usa `ai_response`/`ai_response_at` já existentes).
- Retry automático/silencioso — é ação explícita do usuário.

## Princípio

O retry é **recombinação** do que existe. O endpoint produz o **mesmo contrato de
stream** do POST `/api/reflect`, então `parseReflectStream` (já existente) serve aos
dois consumidores sem alteração.

**Contrato de stream (de `parse-stream.ts`):** 1ª linha `{"reflection_id":"<uuid>"}\n`,
depois chunks de texto, tail opcional `\n{"error":"ai_unavailable","reflection_id":"<uuid>"}\n`.

## Arquitetura

### Backend

**1. Helper compartilhado** — extrair o corpo do stream do POST `/api/reflect` para
um módulo reusável: `apps/web/src/app/api/reflect/response-stream.ts`.

```ts
buildReflectionResponseStream(args: {
  reflectionId: string;
  body: string;
  userId: string;                 // só pra log de metadata no caminho de erro
  systemPrompt: string;           // já com read-feedback aplicado
  onComplete?: () => Promise<void>; // hook pós-stream (só o POST passa a síntese)
}): ReadableStream<Uint8Array>
```

Faz: 1ª linha metadata → `chatStream` (loop, acumula) → em sucesso
`saveAiResponse(reflectionId, accumulated)` → em erro o trailer `ai_unavailable`
(log só metadata + `error_code` classe) → `finally`: `await onComplete?.()` então
`controller.close()`. **A síntese fica FORA**: o POST passa
`onComplete: () => triggerSynthesis(...)`; o retry não passa nada (a reflexão já
existe e já foi contada — re-sintetizar seria desperdício).

O POST `/api/reflect` é refatorado para construir o stream via esse helper (mesmo
comportamento; coberto pelos testes existentes da rota).

**2. Novo endpoint** `POST /api/reflect/[id]/retry`
(`apps/web/src/app/api/reflect/[id]/retry/route.ts`):
1. Auth → `supabase.auth.getUser()`; sem user → 401 `unauthenticated`.
2. Carrega a reflexão pelo id (session client, RLS owner):
   `.from('journal_entries').select('body, ai_response').eq('id', id).maybeSingle()`.
3. Não encontrada (ou RLS bloqueia) → 404 `not_found`.
4. `ai_response !== null` → 409 `already_answered` (anti-clobber / race entre abas).
5. Read-feedback: lê `user_memory.findings` → `buildReflectionSystemPrompt(...)`
   (best-effort, igual ao POST).
6. Retorna `buildReflectionResponseStream({ reflectionId: id, body, systemPrompt })`
   (sem `onComplete`) como `text/plain`.

### Frontend

**3. Helper cliente** `streamRetry(reflectionId)`
(`apps/web/src/app/reflect/stream-retry.ts`): faz `POST /api/reflect/<id>/retry`,
trata status (401/404/409/!ok → erro tipado), e em sucesso retorna o
`AsyncGenerator` de `parseReflectStream(response.body.getReader())`. Usado pelos
dois componentes.

**4. `ReflectForm`** — no bloco `state.code === 'ai_unavailable'` (que já tem
`reflectionId`), adicionar botão **"Tentar de novo"**. Ao clicar: consome
`streamRetry(reflectionId)` reusando a mesma máquina de estado (error → streaming →
done). Em nova falha → volta a `ai_unavailable` + toast.

**5. `ReflectionsList`** — quando `ai_response === null`, trocar o texto
*"Sem resposta registrada"* por um botão **"Tentar de novo"**. Estado de streaming
**por item** (Map id→{streaming text} ou um campo no item). Ao clicar: consome
`streamRetry(id)`, streama dentro daquele card; sucesso preenche `ai_response` do
item (vira `MarkdownResponse`); falha → toast + mantém o botão. Itens já
respondidos não têm botão.

## Privacy gate (★ALTO)

Idêntico ao POST: nunca logar `body`/`ai_response`; só metadata (`user_id`,
`reflection_id`, `content_length`) e `error_code` = nome da classe do erro
(`err.constructor.name`), nunca `err.message`. O helper centraliza esse cuidado.

## Tratamento de erros

| Cenário | Resposta |
|---|---|
| Sem sessão | 401 `unauthenticated` |
| Reflexão não existe / não é do user (RLS) | 404 `not_found` |
| Reflexão já tem `ai_response` | 409 `already_answered` |
| IA falha no retry | trailer `ai_unavailable` (texto parcial), reflexão intacta |
| Sucesso | stream + UPDATE `ai_response`/`ai_response_at` |

## Testes

**Backend** (`[id]/retry/route.test.ts`, `@vitest-environment node`):
- 401 sem sessão; 404 não encontrada; 409 `already_answered` quando `ai_response`
  não-null; stream feliz → UPDATE chamado com o texto acumulado; trailer
  `ai_unavailable` quando `chatStream` lança; ★ALTO: body/ai_response nunca em log.
- POST `/api/reflect` existente permanece verde (refatorado p/ usar o helper).

**Frontend:**
- `ReflectForm`: botão "Tentar de novo" aparece no `ai_unavailable`; click streama e
  vira `done`; nova falha volta pro aviso.
- `ReflectionsList`: botão aparece só em item com `ai_response` null; click streama no
  card; sucesso renderiza markdown; falha → toast + botão permanece.

## Critérios de aceite

- **CA-RT-1:** helper `buildReflectionResponseStream` produz o contrato de stream e
  faz UPDATE em sucesso; POST refatorado mantém comportamento (síntese via `onComplete`).
- **CA-RT-2:** `POST /api/reflect/[id]/retry` — 401/404/409 corretos; stream feliz
  faz UPDATE; trailer em falha.
- **CA-RT-3:** `streamRetry` cliente trata status e expõe o iterator de eventos.
- **CA-RT-4:** `ReflectForm` mostra retry no `ai_unavailable` e re-streama.
- **CA-RT-5:** `ReflectionsList` mostra retry em item null e streama no card; item
  respondido não tem botão.
- **CA-RT-6:** privacy — nenhum `body`/`ai_response` em log; só metadata + error_code.
- **CA-RT-7:** suite verde, typecheck + build limpos.
