# Spec — Histórico de Reflexões: persistência de resposta IA + GET /api/reflections + UI /reflections

Feature: reflections-history
Status: APPROVED em brainstorming Pacini ↔ Legion, 2026-06-11
Workflow: `reflections-history` (Production Playbook, risk desenvolvimento, owner pacini)
Spec anterior relacionada: docs/specs/2026-05-04-T-009-submit-reflection.md (POST /api/reflect)

---

## 1. Objetivo

O usuário consegue rever suas reflexões passadas **com as respostas da IA** numa página de histórico. Hoje a resposta do modelo é streamada e descartada — passa a ser persistida. Decisões de produto (Pacini, brainstorming 2026-06-11):

- **Escopo de dados:** reflexões + respostas IA (não só reflexões)
- **Placement:** página `/reflections` nova, com link a partir do `/reflect`
- **Paginação:** "Carregar mais" por cursor, páginas de 20
- **Abordagem técnica:** A — coluna `ai_response` em `journal_entries` + update via service client (alternativa B, tabela `reflection_responses`, rejeitada: tabela+RLS+join novos pro mesmo resultado de produto; C, localStorage, rejeitada: não sobrevive troca de device)

## 2. Capacidade adquirida

Após esta spec fechar, o Companion **passa a ter**: (a) respostas da IA persistidas por reflexão (best-effort, só stream completo); (b) endpoint autenticado `GET /api/reflections` paginado por cursor; (c) página `/reflections` com lista, "Carregar mais", estados empty/error; (d) navegação reflect ↔ reflections.

## 3. Escopo

### 3.1 Migration `supabase/migrations/0008_journal_entries_ai_response.sql`

```sql
-- migration: 0008_journal_entries_ai_response
-- purpose: persistir resposta da IA por reflexao (feature reflections-history)
ALTER TABLE public.journal_entries
  ADD COLUMN ai_response text NULL,
  ADD COLUMN ai_response_at timestamptz NULL;
```

- `ai_response_at` = quando a resposta foi gravada (insumo futuro pra micro-memória).
- **Zero mudança de RLS:** `service_role_update` (0006) cobre o update; dono continua sem UPDATE (append-only do body preservado).
- **Apply no live:** via Dashboard SQL Editor (pattern 0007 — drift conhecido, NÃO `db push`). A migration entra no repo normalmente.
- `types.ts` regenerado no mesmo PR (container descartável + `gen types --db-url`, pattern do PR #9).

### 3.2 POST /api/reflect — persistência best-effort (MODIFY `apps/web/src/app/api/reflect/route.ts`)

- Acumula os chunks do modelo enquanto streama (contrato do stream com o browser **inalterado**: primeira linha JSON `{reflection_id}` + chunks texto).
- **Só no sucesso completo do stream:** update via service client (`apps/web/src/shared/db/service.ts` existente):
  `update journal_entries set ai_response = <texto completo>, ai_response_at = now() where id = <reflection_id>`
- Falha no update → log estrutural `{event: 'ai_response_save_failed', reflection_id}` **sem conteúdo** (privacy gate ★ALTO, mesmo contrato do body) e resposta ao usuário NÃO afetada (best-effort, princípio D-T009-5).
- Erro do modelo / stream interrompido → não salva nada parcial; `ai_response` permanece NULL.
- Retry futuro (T-011+): nova resposta sobrescreve via mesmo caminho ("última resposta vence").
- Service client usado SÓ neste caminho de escrita — nunca em leitura.

### 3.3 GET /api/reflections (CREATE `apps/web/src/app/api/reflections/route.ts`)

```
GET /api/reflections?limit=20&before=<ISO timestamp>
```

- **Auth:** `createServerClient` + session (padrão do POST). Sem user → `401 {error:'unauthorized'}`.
- **Query:** `select id, body, created_at, ai_response, ai_response_at` com session do usuário — isolamento por RLS `owner_select` (no banco, não em código). Ordenação `created_at desc` (índice composto `user_id, created_at desc` da 0006).
- **Cursor:** `before` exclusivo (`created_at < before`); busca `limit + 1` linhas pra derivar `hasMore` sem segundo round-trip.
- **Validação:** `limit` clampado 1–50 (default 20); `before` não-ISO → `400 {error:'invalid_cursor'}`.
- **200:**
  ```json
  { "reflections": [{"id","body","created_at","ai_response","ai_response_at"}], "next_cursor": "<created_at da última>" | null }
  ```
  `next_cursor: null` ⇒ fim da lista.
- **Erro de banco:** `500 {error:'db_error'}`; log estrutural sem `body`/`ai_response`.

### 3.4 UI /reflections (CREATE)

```
apps/web/src/app/reflections/
  page.tsx                  ← Server Component shell (padrão /reflect, /auth/reset-password)
  ReflectionsList.tsx       ← Client Component
  ReflectionsList.test.tsx
```

State machine (padrão union dos forms existentes):

```ts
type ListState =
  | { kind: 'loading' }
  | { kind: 'ready'; items: Reflection[]; nextCursor: string | null }
  | { kind: 'loadingMore'; items: Reflection[]; nextCursor: string }
  | { kind: 'empty' }
  | { kind: 'error'; code: 'auth' | 'network' };
```

- Item: card design system, `created_at` formatado PT-BR, `body`, resposta IA com distinção visual, `whitespace-pre-wrap` (markdown rendering = item separado do backlog).
- `ai_response` NULL → "Sem resposta registrada" (muted).
- `empty` → convite a refletir + link `/reflect`.
- "Carregar mais" no fim quando `nextCursor != null`; some quando null.
- Navegação: link "Ver histórico" no shell do `/reflect` (MODIFY `apps/web/src/app/reflect/page.tsx` — não no ReflectForm) → `/reflections`; link de volta no shell do `/reflections`.
- Middleware: NENHUMA mudança — `/reflections` já é protegida por default (não-pública).

### 3.5 Não inclui (backlog)

- ❌ Markdown rendering da resposta (item próprio)
- ❌ Toasts de erro transitório (item próprio)
- ❌ Botão retry pra `ai_response` NULL (T-011+/futuro)
- ❌ Busca/filtros no histórico
- ❌ Backfill de respostas pra reflexões antigas (impossível — respostas foram descartadas)

## 4. Critérios de aceite

| CA | Dado/Quando/Então | Verificação |
|---|---|---|
| CA-RH-1 | Stream completa com sucesso → row tem `ai_response` = texto completo + `ai_response_at` preenchido | route.test (mock service) |
| CA-RH-2 | Update falha → stream do usuário intacto + log `ai_response_save_failed` sem conteúdo | route.test |
| CA-RH-3 | Erro do modelo → `ai_response` NULL (nada parcial salvo) | route.test |
| CA-RH-4 ★ALTO | Sentinel único no body/resposta nunca aparece em logs (GET e POST) | route.test sentinel |
| CA-RH-5 | GET sem session → 401 | reflections route.test |
| CA-RH-6 | GET retorna shape `{reflections, next_cursor}` ordenado desc, máx `limit` | reflections route.test |
| CA-RH-7 | `limit+1` rows existem → `next_cursor` = created_at da última; senão null | reflections route.test |
| CA-RH-8 | `before` inválido → 400; `limit` fora de 1–50 → clamp | reflections route.test |
| CA-RH-9 | Lista renderiza loading→ready, empty, error auth/network | ReflectionsList.test |
| CA-RH-10 | "Carregar mais" appenda itens e atualiza cursor; some no fim | ReflectionsList.test |
| CA-RH-11 | `ai_response` NULL renderiza "Sem resposta registrada" | ReflectionsList.test |
| CA-RH-12 | Suite completa + typecheck + build verdes | QA gate playbook |
| CA-RH-13 | Smoke live: refletir → resposta aparece no histórico | gate humano Pacini |

## 5. Decisões

| Data | Decisão | Razão |
|---|---|---|
| 2026-06-11 | D-RH-1 — Persistir resposta IA em coluna (não tabela) | 1:1 natural; service_role_update já existe; migração futura barata |
| 2026-06-11 | D-RH-2 — Salvar só stream completo, best-effort | Parcial não tem valor de releitura; best-effort segue D-T009-5 |
| 2026-06-11 | D-RH-3 — Cursor `before` exclusivo, não offset | Estável com inserções no topo entre páginas |
| 2026-06-11 | D-RH-4 — `limit+1` pra hasMore | Evita count/round-trip extra |
| 2026-06-11 | D-RH-5 — Service client só no caminho de escrita | Leitura via RLS owner_select: isolamento no banco |
| 2026-06-11 | D-RH-6 — ai_response_at junto | Custo ~zero agora, insumo pra micro-memória |

## 6. Sequência de build

1. Migration 0008 + apply live (SQL Editor) + types.ts regen
2. POST update best-effort + testes
3. GET /api/reflections + testes
4. UI /reflections + testes + link no /reflect
5. Smoke E2E live (CA-RH-13, gate humano)

## 7. Riscos

- **Drift live:** apply manual da 0008 no live é passo manual obrigatório ANTES do smoke (CA-RH-13). `journal_entries` é idêntica live↔migrations (verificado 2026-06-11, PR #9), então o ALTER aplica limpo.
- **SUPABASE_SERVICE_ROLE_KEY**: verificado presente em `apps/web/.env.local` (2026-06-11); `createServiceClient()` existente em service.ts. Sem ela o update best-effort loga falha mas nada quebra (por design).
