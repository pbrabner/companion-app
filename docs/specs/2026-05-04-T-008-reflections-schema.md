---
title: "Spec — T-008: Evolução de journal_entries (append-only + processed_at + index timeline)"
type: "Spec Técnica"
purpose: "Evolução do schema journal_entries existente (Marco 0, migration 0001) pra atender PRD captura-reflexao-diaria. Adiciona processed_at, muda RLS pra append-only no body com service_role UPDATE permitido, otimiza index pra timeline. Reaproveita schema/RLS/CASCADE/index existentes. Primeira task do Marco 1 MVP. Prova de fogo do fluxo Dev do Legion."
---

# Spec — T-008: Evolução de `journal_entries` (append-only + processed_at + index timeline)

> **Marco:** 1 (MVP) — feature core "Captura de Reflexão Diária"
> **Status:** ⬜ planejada
> **Owner:** pacini
> **Criada em:** 2026-05-04
> **Versão:** 0.2 (corrigida 2026-05-04 após detectar que `journal_entries` já existe; v0.1 propunha criar tabela `reflections` nova — erro)
> **Concluída em:** —
> **Pré-requisitos:** T-007 ✅ (middleware Supabase auth + redirect /onboarding); 0001 schema base do `journal_entries` ✅; 0003 index single-column ✅; 0004 RLS direct policies ✅
> **Paralelizável com:** nenhuma (T-009 Server Action e T-010 job async dependem desta)

---

## 1. Objetivo

Evoluir o schema da tabela `public.journal_entries` (já existente no Companion desde a migration 0001) pra atender a feature core "Captura de Reflexão Diária" do PRD. As alterações são: (a) adicionar coluna `processed_at timestamptz NULL` pra preparar T-010 (job async de extração de insights); (b) mudar RLS de "fully editable owner" pra "append-only no `body`" — owner perde UPDATE, ganha DELETE (LGPD right-to-delete), e `service_role` ganha UPDATE pra escrever `processed_at`; (c) otimizar index existente `(user_id)` pra composto `(user_id, created_at DESC)` cobrindo timeline query do RF-004. **Não cria tabela nova** — aproveita o schema base, RLS e CASCADE já investidos.

## 2. Capacidade adquirida

Após esta spec fechar, o Companion **passa a ter**: (a) invariante de imutabilidade no `body` da reflexão garantido em nível DB (não só app), suportando análise temporal honesta sem reescrita histórica; (b) coluna `processed_at` pronta pra T-010 popular sem UPDATE policy adicional; (c) DELETE permitido ao owner (atendendo LGPD/GDPR right-to-delete); (d) index timeline-otimizado pra suportar paginação do RF-004 sem seq scan. O privacy gate ★ALTO do PRD (cross-user SELECT bloqueado) **continua** garantido — re-validamos via pgTAP novo cobrindo `journal_entries` no contexto pós-evolução.

## 3. Escopo

### Inclui

- **Migration `supabase/migrations/0006_journal_entries_evolution.sql`** — single migration contendo:
  - `ALTER TABLE public.journal_entries ADD COLUMN processed_at timestamptz NULL` — coluna nova nullable, sem default, populada por T-010
  - `DROP POLICY owner_update ON public.journal_entries` — remove capacidade de UPDATE pelo owner (append-only no body)
  - `CREATE POLICY service_role_update ON public.journal_entries FOR UPDATE TO service_role USING (true) WITH CHECK (true)` — permite que T-010 (job async) escreva `processed_at` via service_role
  - **`owner_delete` já existe** (criado em 0004 junto com as outras 3 policies). Mantém-se intocado — atende LGPD right-to-delete sem nova migration.
  - `DROP INDEX idx_journal_entries_user_id` — single-column index obsoleto pelo composto
  - `CREATE INDEX idx_journal_entries_user_id_created_at_desc ON public.journal_entries (user_id, created_at DESC)` — composto otimizado pra timeline RF-004; cobre queries que usariam o single-column anterior (Postgres usa prefix do composto)
- **Tests `supabase/tests/journal_entries_evolution.test.sql`** — pgTAP cobrindo:
  - Schema assertion: `has_column processed_at` + `col_type_is timestamptz` + `col_is_null processed_at`
  - Index assertion: `has_index idx_journal_entries_user_id_created_at_desc` + `matches indexdef contém 'created_at DESC'`
  - Index removed: `hasnt_index idx_journal_entries_user_id` (substituído pelo composto)
  - RLS shape: `policies_are public.journal_entries` retorna exatamente `[owner_select, owner_insert, owner_delete, service_role_update]` (sem `owner_update`)
  - 6 RLS behavioral assertions com 2 users sintéticos via JWT claim sub:
    - Cross-user SELECT bloqueado (CA-T008-2 ★ALTO mapeia PRD CA-002)
    - Cross-user INSERT bloqueado
    - Owner UPDATE no `body` bloqueado (sem policy → ele falha; verifica via tentativa real ou via `policies_are`)
    - service_role UPDATE em `processed_at` permitido
    - Owner DELETE da própria reflexão permitido (1 row apagada)
    - Cross-user DELETE bloqueado (0 rows apagadas pelo user B)

### Não inclui

- ❌ **Criar tabela nova** — `journal_entries` existente reaproveitada (D-T008-9 nova decisão).
- ❌ `insights_jsonb` + `insights_schema_version` — defer pra **T-010** (job async). YAGNI strict mantém-se.
- ❌ Server Action `submitReflection` (TS) — defer pra **T-009**.
- ❌ UI `/reflect` — defer pra **T-011**.
- ❌ Renomeação de `body` pra `content` — embora PRD use "content", `journal_entries.body` está em uso desde 0001 e renomear quebra zero código (nenhum query existente referencia, mas é mudança gratuita). Mantém `body`. Server Action T-009 traduz UX "content" ↔ DB "body" no boundary.
- ❌ Validação de `prompt_used` — coluna existe (0001), pode ser usada por T-009/T-011 pra capturar prompt sugerido (RF-009). Sem CHECK constraint nem tests específicos nesta spec.
- ❌ CHECK constraint de tamanho de `body` — PRD soft limit 5000 chars é UX; T-009 valida.
- ❌ Constraint "1 reflexão/dia" — guideline UX, app valida em T-009.

## 4. Critérios de aceite

| ID | Critério | Validado em |
|---|---|---|
| CA-T008-1 | Dado ambiente Supabase com migrations 0001-0005 aplicadas, quando aplico `0006_journal_entries_evolution.sql`, então `processed_at` existe + 4 policies (`owner_select`, `owner_insert`, `owner_delete`, `service_role_update`) + index composto `(user_id, created_at DESC)` | pgTAP `has_column`, `policies_are`, `has_index` |
| CA-T008-2 ★ALTO | Dado user A com 1 reflexão e user B autenticado, quando user B executa `SELECT * FROM journal_entries`, então retorna 0 rows (mapeia PRD CA-002 — privacy gate) | `journal_entries_evolution.test.sql` cross-user RLS test |
| CA-T008-3 | Dado user A autenticado, quando tenta `INSERT INTO journal_entries (user_id, body) VALUES (user_B_id, '...')`, então RLS rejeita | test |
| CA-T008-4 | Dado user A autenticado dono de reflexão R, quando tenta `UPDATE journal_entries SET body = '...' WHERE id = R.id`, então 0 rows afetadas (sem policy de UPDATE pra owner — append-only invariant) | test |
| CA-T008-5 | Dado conexão como `service_role`, quando faz `UPDATE journal_entries SET processed_at = now() WHERE id = R.id`, então 1 row atualizada (preparando T-010) | test |
| CA-T008-6 | Dado user A com 1 reflexão R, quando user B autenticado tenta `DELETE FROM journal_entries WHERE id = R.id`, então 0 rows apagadas (RLS bloqueia); quando user A faz mesmo DELETE, então 1 row apagada | test × 2 cases |
| CA-T008-7 | Dado index `idx_journal_entries_user_id_created_at_desc`, quando consulto `pg_indexes`, então existe com `created_at DESC` no `indexdef`. Index antigo `idx_journal_entries_user_id` não existe mais | `has_index` + `hasnt_index` + `matches` |
| CA-T008-8 | Dado RLS de `journal_entries` pós-migration, quando consulto `pg_policies`, então retorna exatamente 4 policies: `owner_select`, `owner_insert`, `owner_delete`, `service_role_update` (sem `owner_update`) | `policies_are` |
| CA-T008-9 | Dado suite pgTAP do Companion, quando rodo `pnpm exec supabase test db`, então todos os tests passam — 101 baseline preservado + N novos da T-008 (esperado entre 12-20 dependendo de granularidade `SELECT has_X(...)`) | manual via WSL |
| CA-T008-10 | Dado suite Vitest do Companion, quando rodo `pnpm test`, então 22/22 testes passam (T-007 baseline preservado, sem regressão) | manual via WSL |
| CA-T008-11 | Dado fluxo TDD do Legion ativo (Sentinel + Marshal + TDD Gate), quando faço commit `feat(T-008): GREEN phase`, então pre-commit hook valida frontmatter de notes/T-008.md + secret scanner OK + Marshal não grita drift | git commit log |

## 5. Plano de implementação

> **TBD** — preenchido pela skill `superpowers:writing-plans` após aprovação desta spec corrigida. Plan mora em `D:/companion-app/docs/plans/2026-05-04-T-008-reflections-schema.md` (slug mantido por consistência com PRD pai; conteúdo reflete realidade ALTER).

Estrutura esperada:
- Task 1: Setup (notes/T-008.md stub + 2 arquivos vazios da migration e test) + commit `chore(T-008): scaffold`
- Task 2: RED phase — pgTAP `journal_entries_evolution.test.sql` falha porque migration 0006 ainda não existe
- Task 3: GREEN phase — `0006_journal_entries_evolution.sql` (single ALTER migration), tests passam
- Task 4: Suite full Companion (pgTAP + Vitest) baseline preservado
- Task 5: Notes T-008 finalizar
- Task 6: Push origin main

## 6. Decisões e ADRs gerados

Decisões fechadas em brainstorming 2026-05-04 (Pacini ↔ Claude). D-T008-9 adicionada na revisão da spec após detectar `journal_entries` existente.

| Data | Decisão | Motivação | Link ADR |
|---|---|---|---|
| 2026-05-04 | D-T008-1 — `insights_jsonb` defer pra T-010 | YAGNI strict; shape v1 indefinido; permite decisão de versionamento informada quando soubermos o uso real | — |
| 2026-05-04 | D-T008-2 — Append-only no `body` (DROP `owner_update`); UPDATE só `service_role` | Reflexão é "memória" pra análise temporal — editar passado quebra invariante; mas T-010 precisa escrever `processed_at` async | — |
| 2026-05-04 | D-T008-3 — `owner_delete` permitido (hard delete) | LGPD/GDPR right-to-delete; precedente FTC vs BetterHelp ($7.8M, 2023). `journal_entries` JÁ TEM `owner_delete` desde 0004 — T-008 mantém intocado. Decisão original sobre append-only assumia tabela nova; com tabela existente, é mais "manter delete + remover update" | — |
| 2026-05-04 | D-T008-4 — Sem constraint DB de "1 reflexão/dia" | PRD §2 trata como guideline UX. App valida em T-009 | — |
| 2026-05-04 | D-T008-5 — Sem CHECK constraint de tamanho de body | PRD soft limit 5000 chars é UX. Auth + RLS já cobrem abuse vector. YAGNI strict | — |
| 2026-05-04 | D-T008-6 — Index composto `(user_id, created_at DESC)`; DROP do single-column antigo | Composto cobre queries que usariam single-column (prefix Postgres) + otimiza timeline RF-004; manter ambos seria duplicado e custo de write 2x | — |
| 2026-05-04 | D-T008-7 — Mantém `id uuid` + `gen_random_uuid()` (já era assim em 0001) | Convenção Postgres moderna; alinha com Supabase auth.users | — |
| 2026-05-04 | D-T008-8 — Mantém `user_id ON DELETE CASCADE` (já era assim em 0001) | Convenção Supabase + Companion existing tables; right-to-delete LGPD em escala | — |
| 2026-05-04 | **D-T008-9** — Reaproveitar `journal_entries` existente (não criar `reflections` nova) | Detectado durante writing-plans que 0001 já tem `journal_entries` com schema 90% idêntico ao proposto. Criar tabela nova seria duplicação + dívida técnica. ALTER existing é correto. Slug do arquivo (`reflections-schema`) mantido por consistência com PRD pai. | — |
| 2026-05-04 | D-T008-10 — Mantém nome `body` (não renomear pra `content`) | `journal_entries.body` em uso desde 0001; renomear é mudança gratuita; T-009 traduz "content" UX ↔ "body" DB no boundary do Server Action | — |

## 7. Referências cruzadas

- **PRD pai:** [`docs/prds/2026-05-02-captura-reflexao-diaria.md`](../prds/2026-05-02-captura-reflexao-diaria.md) — RF-001..010, CA-002 ★ALTO mapeado pra CA-T008-2. PRD usa termo "reflection"/"content"; DB usa `journal_entries.body`. T-009 traduz no boundary.
- **Research:** [`research/captura-reflexao-diaria/sources.md`](../../research/captura-reflexao-diaria/sources.md) — 9 sources externas; FTC vs BetterHelp (S1) precedente que justifica privacy gate ★ALTO; Pennebaker (S5) valida append-only (memória imutável)
- **Validação:** Hermes idea_id=1, status=validada (T:9 M:8 D:7) — VIABLE via `legion validation analyze`
- **Migrations existentes do Companion (base reaproveitada):**
  - [`supabase/migrations/0001_user_data_schema.sql`](../../supabase/migrations/0001_user_data_schema.sql) — `journal_entries` schema base (id, user_id, prompt_used, body, created_at)
  - [`supabase/migrations/0003_secondary_indexes.sql`](../../supabase/migrations/0003_secondary_indexes.sql) — `idx_journal_entries_user_id` (single-column, será dropado e substituído pelo composto)
  - [`supabase/migrations/0004_rls_direct.sql`](../../supabase/migrations/0004_rls_direct.sql) — RLS direct + 4 policies em journal_entries (`owner_select`, `owner_insert`, `owner_update`, `owner_delete`). T-008 dropa `owner_update`, cria `service_role_update`, mantém os outros 3.
- **Tests existentes (modelo de assertions):**
  - [`supabase/tests/rls_direct.test.sql`](../../supabase/tests/rls_direct.test.sql) — modelo de RLS behavioral test com 2 users + JWT claim sub
  - [`supabase/tests/secondary_indexes_and_tz.test.sql`](../../supabase/tests/secondary_indexes_and_tz.test.sql) — modelo de `has_index` + `matches` em `indexdef`
- **Anti-Vibe:** PRD → Spec (este doc, v0.2 corrigida) → Plan → Execute → Review.

## 8. Histórico de status

| Data | Status | Nota |
|---|---|---|
| 2026-05-04 | ⬜ v0.1 | Spec criada após brainstorming Pacini ↔ Claude (5 perguntas: insights_jsonb defer, append-only + owner DELETE, sem 1/dia constraint, sem CHECK size, index na própria migration). Versão original propunha criar tabela `reflections` nova. |
| 2026-05-04 | ⬜ v0.2 (esta) | **Correção:** durante writing-plans, detectado que `public.journal_entries` (migration 0001) já existe com schema 90% idêntico ao proposto. Erro do Claude no brainstorming — não cumpriu regra "Verificar antes de criar" do CLAUDE.md raiz. Spec corrigida pra ALTER em journal_entries. Decisões D-T008-1 a D-T008-8 mantidas (ainda válidas no contexto ALTER); D-T008-9 (reaproveitar journal_entries) e D-T008-10 (manter `body`) adicionadas. |
