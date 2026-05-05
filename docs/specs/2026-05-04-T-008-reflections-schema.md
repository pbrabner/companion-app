---
title: "Spec — T-008: Schema reflections + RLS + pgTAP"
type: "Spec Técnica"
purpose: "Definir contratos do schema reflections (Postgres) + RLS append-only com owner DELETE + service_role UPDATE + index para timeline + pgTAP cross-user privacy gate. Primeira task do Marco 1 MVP do PRD captura-reflexao-diaria. Prova de fogo do fluxo Dev do Legion (Spec→Plan→Execute end-to-end)."
---

# Spec — T-008: Schema `reflections` + RLS

> **Marco:** 1 (MVP) — feature core "Captura de Reflexão Diária"
> **Status:** ⬜ planejada
> **Owner:** pacini
> **Criada em:** 2026-05-04
> **Concluída em:** —
> **Pré-requisitos:** T-007 ✅ (middleware Supabase auth + redirect /onboarding)
> **Paralelizável com:** nenhuma (T-009 Server Action e T-010 job async dependem desta)

---

## 1. Objetivo

Entregar o schema Postgres da entidade central da feature core do Companion: a `reflections`. Schema mínimo (id, user_id, content, created_at, processed_at), RLS append-only com owner DELETE permitido (LGPD-friendly) e UPDATE restrito a `service_role` (preparando o consumer T-010 que vai popular `processed_at` async). Index para query de timeline (RF-004 do PRD). pgTAP cross-user test cobrindo CA-002 ★ALTO do PRD (privacy gate — reflexão de user A nunca aparece em SELECT de user B).

## 2. Capacidade adquirida

Após esta spec fechar, o Companion **passa a ser capaz de** persistir reflexões de usuários autenticados com isolamento estrito por `user_id`, suportando query de timeline (paginação por created_at) e fornecendo a base que T-009 (Server Action de submit) e T-010 (job async de extração de insights) consomem. O privacy gate ★ALTO do PRD passa a ser **demonstrável via pgTAP cross-user test** — não é promessa, é invariante testado.

## 3. Escopo

### Inclui

- **Migration `supabase/migrations/0006_reflections_table.sql`** — single migration contendo:
  - `CREATE TABLE public.reflections` com 5 colunas (`id uuid PK`, `user_id uuid NOT NULL`, `content text NOT NULL`, `created_at timestamptz DEFAULT now()`, `processed_at timestamptz NULL`)
  - FK `user_id REFERENCES auth.users(id) ON DELETE CASCADE`
  - `id` default `gen_random_uuid()`
  - `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
  - 4 policies RLS:
    - `owner_select` — `FOR SELECT USING (auth.uid() = user_id)`
    - `owner_insert` — `FOR INSERT WITH CHECK (auth.uid() = user_id)`
    - `owner_delete` — `FOR DELETE USING (auth.uid() = user_id)`
    - `service_role_update` — `FOR UPDATE TO service_role USING (true) WITH CHECK (true)`
  - **Sem UPDATE policy para owner** (conteúdo imutável — append-only)
  - **Sem INSERT policy para service_role** (só user autenticado cria reflexão)
  - Index `idx_reflections_user_id_created_at_desc` em `(user_id, created_at DESC)`
- **Tests `supabase/tests/reflections.test.sql`** — pgTAP cobrindo:
  - Schema assertions (`has_table`, `has_column` × 5, `col_type_is` × 5, `col_not_null` × 4, defaults, FK)
  - Index assertion (`has_index` + verificação de DESC order)
  - 5 RLS assertions (cross-user SELECT, cross-user INSERT, owner UPDATE blocked, service_role UPDATE allowed, owner DELETE allowed e cross-user DELETE blocked)
  - CASCADE on user delete (FK comportamento)

### Não inclui

- **`insights_jsonb` + `insights_schema_version`** — coluna jsonb pra resultado de extração async. Defer pra **T-010** quando o job async for implementado e shape v1 dos insights for definido. Adicionar agora seria YAGNI (decidido em brainstorming 2026-05-04).
- **Server Action `submitReflection`** — TypeScript que recebe content do client e insere via Supabase. Defer pra **T-009**.
- **UI `/reflect`** (Next.js page com form + textarea) — Defer pra **T-011**.
- **CHECK constraint de tamanho de content** — PRD trata "soft limit ~5000 chars" como diretriz UX. Validação fica em T-009 (Server Action). Sem safety net DB no MVP.
- **Constraint "1 reflexão/dia"** — PRD trata como guideline UX, não invariante. App valida em T-009 ("você já refletiu hoje, criar nova mesmo assim?"). Diferente de `checkins_one_per_day` (Decisão D-12 do Companion) que faz sentido pra mood-rating quick.
- **Trigger pra atualizar `processed_at`** — T-010 escreve direto via `service_role`. Sem trigger pra evitar magia indireta.
- **Audit log de inserts/deletes** — sem trail histórico no MVP. Hard delete via `owner_delete` é definitivo.

## 4. Critérios de aceite

Formato: **Dado X, quando Y, então Z.** Cada critério é binário e testável.

| ID | Critério | Validado em |
|---|---|---|
| CA-T008-1 | Dado um ambiente Supabase fresh (sem migrations 0006), quando aplico `0006_reflections_table.sql`, então `public.reflections` existe com schema correto e RLS habilitado | pgTAP `has_table`, `has_column`, `col_type_is`, manual `\d reflections` |
| CA-T008-2 ★ALTO | Dado user A com 1 reflexão e user B autenticado, quando user B executa `SELECT * FROM reflections`, então retorna 0 rows (mapeia PRD CA-002 — privacy gate) | `reflections.test.sql` cross-user RLS test |
| CA-T008-3 | Dado user A autenticado, quando tenta `INSERT INTO reflections (user_id, content) VALUES (user_B_id, '...')`, então RLS rejeita (`new row violates row-level security policy`) | `reflections.test.sql` |
| CA-T008-4 | Dado user A autenticado dono de uma reflexão R, quando tenta `UPDATE reflections SET content = '...' WHERE id = R.id`, então RLS rejeita (sem policy de UPDATE pra owner — append-only invariant) | `reflections.test.sql` |
| CA-T008-5 | Dado conexão como `service_role`, quando faz `UPDATE reflections SET processed_at = now() WHERE id = R.id`, então UPDATE sucede (preparando T-010) | `reflections.test.sql` |
| CA-T008-6 | Dado user A com 1 reflexão R, quando user B autenticado tenta `DELETE FROM reflections WHERE id = R.id`, então RLS rejeita; quando user A faz mesmo DELETE, então 1 row apagada | `reflections.test.sql` × 2 cases |
| CA-T008-7 | Dado user A com 3 reflexões e a row em `auth.users` é deletada, quando consulto `reflections WHERE user_id = old_A_id`, então 0 rows (FK CASCADE comportamento) | `reflections.test.sql` |
| CA-T008-8 | Dado index `idx_reflections_user_id_created_at_desc`, quando consulto via `pg_indexes`, então existe com `created_at DESC` no `indexdef` | `reflections.test.sql` `has_index` + `matches` em `indexdef` |
| CA-T008-9 | Dado suite de testes do Companion, quando rodo `pnpm exec supabase test db`, então todos os pgTAP tests passam — 101 baseline + N novos da T-008 (N depende de granularidade final dos `SELECT has_X(...)`, esperado entre 15-25) | manual via WSL bash |
| CA-T008-10 | Dado suite Vitest do Companion, quando rodo `pnpm test`, então 22/22 testes passam (T-007 baseline preservado, sem regressão) | manual via WSL bash |
| CA-T008-11 | Dado fluxo TDD do Legion ativo (Sentinel + Marshal + TDD Gate), quando faço commit `feat(T-008): GREEN phase`, então pre-commit hook valida frontmatter de notes/T-008.md + secret scanner OK + Marshal não grita drift | git commit log |

## 5. Plano de implementação

> **TBD** — preenchido pela skill `superpowers:writing-plans` após aprovação desta spec. Plan mora em `D:/companion-app/docs/plans/2026-05-04-T-008-reflections-schema.md`.

Estrutura esperada do plan:
- Task 1: Setup (criar `notes/T-008.md` stub, criar arquivo de migration vazio, criar arquivo de test pgTAP vazio)
- Task 2: RED phase — pgTAP test falhando (tabela não existe ainda)
- Task 3: GREEN phase — escrever migration, testes passam
- Task 4: Validação cross-user RLS específica (CA-002 ★ALTO) — test isolado com 2 users sintéticos
- Task 5: Validação CASCADE + index assertions
- Task 6: Suite full Companion (pgTAP + Vitest) → preserved baselines
- Task 7: Notes + commit + push

## 6. Decisões e ADRs gerados

Decisões fechadas em brainstorming 2026-05-04 (Pacini ↔ Claude):

| Data | Decisão | Motivação | Link ADR |
|---|---|---|---|
| 2026-05-04 | D-T008-1 — `insights_jsonb` defer pra T-010 | YAGNI strict; shape v1 indefinido; permite decisão de versionamento informada quando soubermos o uso real | — |
| 2026-05-04 | D-T008-2 — Append-only no `content` (sem UPDATE pra owner); UPDATE só `service_role` | Reflexão é "memória" pra análise temporal — editar passado quebra invariante; mas T-010 precisa escrever `processed_at` async | — |
| 2026-05-04 | D-T008-3 — `owner_delete` permitido (hard delete) | LGPD/GDPR right-to-delete; mental health apps têm padrão regulatório forte; precedente FTC vs BetterHelp ($7.8M, 2023) | — |
| 2026-05-04 | D-T008-4 — Sem constraint DB de "1 reflexão/dia" | PRD §2 trata como guideline UX, não invariante. Diferente de `checkins_one_per_day` (D-12 do Companion). App valida em T-009 | — |
| 2026-05-04 | D-T008-5 — Sem CHECK constraint de tamanho de content | PRD soft limit 5000 chars é UX. Auth + RLS já cobrem abuse vector. YAGNI strict | — |
| 2026-05-04 | D-T008-6 — Index na própria 0006 (single migration) | Index é cheap, RF-004 (timeline) já é Marco 1 MVP. Convenção 0001 schema + 0003 indexes do Companion era refactor legacy, não regra eterna | — |
| 2026-05-04 | D-T008-7 — `id uuid` + `gen_random_uuid()` | Convenção Postgres moderna; alinhamento com Supabase auth.users (uuid); evita exposição de cardinalidade via bigint serial | — |
| 2026-05-04 | D-T008-8 — `user_id ON DELETE CASCADE` | Convenção Supabase + Companion existing tables; right-to-delete LGPD em escala (deletar conta apaga reflexões automaticamente) | — |

## 7. Referências cruzadas

- **PRD pai:** [`docs/prds/2026-05-02-captura-reflexao-diaria.md`](../prds/2026-05-02-captura-reflexao-diaria.md) — RF-001..010, CA-002 ★ALTO mapeado pra CA-T008-2
- **Research:** [`research/captura-reflexao-diaria/sources.md`](../../research/captura-reflexao-diaria/sources.md) — 9 sources externas; FTC vs BetterHelp (S1) é precedente que justifica privacy gate como ★ALTO
- **Validação:** Hermes idea_id=1, status=validada (T:9 M:8 D:7) — VIABLE via `legion validation analyze`
- **Convenção Companion:**
  - Migrations existentes 0001-0005 (RLS direct + RLS join patterns em `0004_rls_direct.sql` e `0005_rls_join.sql`) — modelo das policies
  - Tests pgTAP existentes 5 arquivos (`schema_*`, `rls_*`, `secondary_indexes_and_tz.test.sql`) — modelo de assertions
  - `safety_events` (em 0001) — modelo de append-only com `service_role` distinção
- **Anti-Vibe:** PRD → Spec (este doc) → Plan → Execute (TDD red→green) → Review. Mudança >2 arquivos exige a sequência completa (CLAUDE.md regra absoluta #2).

## 8. Histórico de status

| Data | Status | Nota |
|---|---|---|
| 2026-05-04 | ⬜ | Spec criada após brainstorming Pacini ↔ Claude (5 perguntas: insights_jsonb defer, append-only + owner DELETE, sem 1/dia constraint, sem CHECK size, index na própria migration). PRD validado com VIABLE T:9 M:8 D:7 via validation-lab. Pronto pra writing-plans. |
