---
title: "Plan — T-008: Evolução de journal_entries (append-only + processed_at + index timeline)"
type: "Plano de Implementação"
purpose: "Plan TDD bite-sized da T-008. Implementa migration 0006 ALTER em journal_entries existente + pgTAP test cobrindo 11 CAs da spec v0.2. Reaproveita schema/RLS/CASCADE/index do Companion. Prova de fogo do fluxo Dev do Legion."
---

# T-008 — `journal_entries` Evolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Hooks Legion ATIVOS durante execução (Sentinel L1, Marshal F1-F21, TDD Gate F3, Secret Scanner) — frontmatter obrigatório em todo `.md`, docstring em `.py`.

**Goal:** Evoluir o schema `public.journal_entries` (existente desde Companion 0001) com `ADD COLUMN processed_at` + DROP `owner_update` + CREATE `service_role_update` + index composto `(user_id, created_at DESC)` substituindo single-column antigo. Validar via pgTAP cobrindo 11 CAs da spec v0.2 incluindo CA-T008-2 ★ALTO (cross-user privacy gate).

**Architecture:** Single ALTER migration `0006_journal_entries_evolution.sql` (não cria tabela nova). Single pgTAP test file `journal_entries_evolution.test.sql` com asserções estruturais + behavioral RLS via 2 users sintéticos + JWT claim sub (mesma técnica do `rls_direct.test.sql`). Notes T-008 com decisões/desvios. 6 commits sequenciais na `main` direto.

**Tech Stack:** PostgreSQL 16 (Supabase) + pgTAP + Supabase CLI (rodado via WSL Ubuntu, nativo Windows não suporta) + git no Windows.

**Pré-requisitos:**
- Spec v0.2: `D:/companion-app/docs/specs/2026-05-04-T-008-reflections-schema.md` ✅ aprovada
- T-007 ✅ fechada (suite Vitest 22/22 baseline)
- Suite pgTAP baseline: 5 arquivos existing
- Hooks Legion ativos no Companion (`.claude/settings.json` referencia `D:/Legion - New Horizon/legion/scripts/hooks/*`)

**Working dir:** `D:/companion-app`

**Branch:** `main` (convenção Companion: trabalha direto, sem feature branches)

---

## File Structure

### A criar

| Arquivo | Responsabilidade | LOC ~ |
|---|---|---|
| `supabase/migrations/0006_journal_entries_evolution.sql` | ALTER migration: ADD processed_at + DROP/CREATE policy update + DROP/CREATE index | 50 |
| `supabase/tests/journal_entries_evolution.test.sql` | pgTAP cobrindo CAs 1-8 da spec (asserts estruturais + behavioral RLS) | 180 |
| `notes/T-008.md` | Executor notes — decisões/desvios do TDD | 80 |

### A modificar

Nenhum arquivo modificado fora de `supabase/migrations/` e `supabase/tests/` (que ganham arquivos novos).

### Não tocar

- `supabase/migrations/0001..0005` — base existente reaproveitada
- `supabase/tests/rls_direct.test.sql` e outros 4 tests — baseline preservado
- `apps/web/**` — nenhum código TypeScript modificado nesta task
- `notes/T-001..T-007.md`, `notes/mini-fix-001.md` — histórico preservado

---

## Convenções importantes

**Comandos Supabase precisam WSL** (Supabase CLI no Windows nativo é instável):
```bash
wsl -d Ubuntu -- bash -c "cd /mnt/d/companion-app && pnpm exec supabase db reset"
wsl -d Ubuntu -- bash -c "cd /mnt/d/companion-app && pnpm exec supabase test db"
```

**Vitest também via WSL pra paridade com CI:**
```bash
wsl -d Ubuntu -- bash -c "cd /mnt/d/companion-app/apps/web && pnpm test"
```

**Commit convention Companion:** `<tipo>(T-XXX): <fase>` — `chore(T-008): scaffold` / `test(T-008): RED phase` / `feat(T-008): GREEN phase` / `docs(T-008): notes`.

**Frontmatter obrigatório** em `notes/T-008.md` (validate_headers hook bloqueia commit sem).

---

## Tasks

### Task 1: Scaffold (3 arquivos vazios + commit chore)

**Files:**
- Create: `notes/T-008.md` (stub com frontmatter)
- Create: `supabase/migrations/0006_journal_entries_evolution.sql` (header SQL apenas, sem statements)
- Create: `supabase/tests/journal_entries_evolution.test.sql` (header SQL apenas, sem assertions)

- [ ] **Step 1.1: Criar `notes/T-008.md` com frontmatter mínimo + stub**

```markdown
---
title: "Notes — T-008 (Evolução journal_entries)"
type: "Executor Notes"
purpose: "Registro de decisões/desvios durante a execução de T-008 — evolução do schema journal_entries pra suportar PRD captura-reflexao-diaria. Plan: docs/plans/2026-05-04-T-008-reflections-schema.md. Spec v0.2: docs/specs/2026-05-04-T-008-reflections-schema.md."
---

# T-008 — Notes do Executor

> **Task:** T-008 — Evolução de journal_entries (append-only + processed_at + index timeline)
> **Stack adapter:** PostgreSQL 16 + pgTAP + Supabase CLI (via WSL)
> **Status:** 🔄 em execução

## Decisões executadas

(preencher ao fechar GREEN phase com decisões tomadas durante a implementação)

## Desvios da spec

(preencher ao fechar — ex: descobrir que pgTAP versão X não suporta `policies_are`)

## Comandos reproduzíveis

(preencher ao fechar)
```

- [ ] **Step 1.2: Criar `supabase/migrations/0006_journal_entries_evolution.sql` com header SQL apenas**

```sql
-- migration: 0006_journal_entries_evolution
-- purpose: T-008 — evolução de public.journal_entries pra atender PRD
--          captura-reflexao-diaria (Marco 1 MVP).
-- spec: docs/specs/2026-05-04-T-008-reflections-schema.md (v0.2)
-- plan: docs/plans/2026-05-04-T-008-reflections-schema.md
--
-- Changes (preenchido na GREEN phase):
--   1. ADD COLUMN processed_at timestamptz NULL
--   2. DROP POLICY owner_update + CREATE POLICY service_role_update
--   3. DROP INDEX idx_journal_entries_user_id + CREATE composto (user_id, created_at DESC)
--
-- RLS post-migration (4 policies): owner_select, owner_insert, owner_delete, service_role_update.
-- owner_update intencionalmente removida — body imutável (D-T008-2 da spec).

-- (statements adicionados em GREEN phase)
```

- [ ] **Step 1.3: Criar `supabase/tests/journal_entries_evolution.test.sql` com header**

```sql
-- migration: journal_entries_evolution (test)
-- purpose: pgTAP assertions para T-008 — schema + RLS + index pós-evolução
--          de journal_entries. Cobre CAs 1-8 da spec v0.2.
-- spec: docs/specs/2026-05-04-T-008-reflections-schema.md
-- plan: docs/plans/2026-05-04-T-008-reflections-schema.md
--
-- Acceptance criteria validated (binary):
--   CA-T008-1: schema + RLS + index post-migration shape
--   CA-T008-2 ★ALTO: cross-user SELECT bloqueado
--   CA-T008-3: cross-user INSERT bloqueado
--   CA-T008-4: owner UPDATE no body bloqueado (append-only)
--   CA-T008-5: service_role UPDATE em processed_at permitido
--   CA-T008-6: owner DELETE permitido + cross-user DELETE bloqueado
--   CA-T008-7: index composto present + single-column antigo absent
--   CA-T008-8: policies_are exato pós-evolução
--
-- Technique: same as rls_direct.test.sql (BEGIN/ROLLBACK + 2 mock users +
-- SET LOCAL request.jwt.claim.sub + SET LOCAL ROLE 'authenticated').

-- (assertions adicionados em RED phase)
```

- [ ] **Step 1.4: Verificar arquivos criados**

```bash
ls -la notes/T-008.md supabase/migrations/0006_journal_entries_evolution.sql supabase/tests/journal_entries_evolution.test.sql
```
Expected: 3 arquivos listados, sizes ≥ 200 bytes cada (não vazios).

- [ ] **Step 1.5: Commit scaffold**

```bash
git add notes/T-008.md supabase/migrations/0006_journal_entries_evolution.sql supabase/tests/journal_entries_evolution.test.sql
git commit -m "chore(T-008): scaffold (notes + migration stub + test stub)"
```

Expected: commit succeeded; pre-commit hook valida frontmatter de notes/T-008.md OK; sem secret scanner alertas.

---

### Task 2: RED phase — pgTAP test completo, suite falha

**Files:**
- Modify: `supabase/tests/journal_entries_evolution.test.sql` (adiciona assertions)

- [ ] **Step 2.1: Escrever pgTAP test completo**

Substituir o conteúdo do arquivo (preservar header) por:

```sql
-- migration: journal_entries_evolution (test)
-- purpose: pgTAP assertions para T-008 — schema + RLS + index pós-evolução
--          de journal_entries. Cobre CAs 1-8 da spec v0.2.
-- spec: docs/specs/2026-05-04-T-008-reflections-schema.md
-- plan: docs/plans/2026-05-04-T-008-reflections-schema.md
--
-- Acceptance criteria validated (binary):
--   CA-T008-1: schema + RLS + index post-migration shape
--   CA-T008-2 ★ALTO: cross-user SELECT bloqueado
--   CA-T008-3: cross-user INSERT bloqueado
--   CA-T008-4: owner UPDATE no body bloqueado (append-only)
--   CA-T008-5: service_role UPDATE em processed_at permitido
--   CA-T008-6: owner DELETE permitido + cross-user DELETE bloqueado
--   CA-T008-7: index composto present + single-column antigo absent
--   CA-T008-8: policies_are exato pós-evolução
--
-- Technique: same as rls_direct.test.sql (BEGIN/ROLLBACK + 2 mock users +
-- SET LOCAL request.jwt.claim.sub + SET LOCAL ROLE 'authenticated').

BEGIN;

SELECT plan(15);

-- ---------------------------------------------------------------------------
-- Setup: 2 mock auth users + 1 reflexão pre-seed por user (como superuser pra
-- contornar RLS de INSERT durante setup).
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, is_sso_user, is_anonymous)
VALUES
  ('00000000-0000-0000-0000-00000000000a', false, false),
  ('00000000-0000-0000-0000-00000000000b', false, false);

INSERT INTO public.journal_entries (id, user_id, body)
VALUES
  ('11111111-1111-1111-1111-11111111111a', '00000000-0000-0000-0000-00000000000a', 'A entry'),
  ('11111111-1111-1111-1111-11111111111b', '00000000-0000-0000-0000-00000000000b', 'B entry');

-- ---------------------------------------------------------------------------
-- 1. Schema assertions (CA-T008-1)
-- ---------------------------------------------------------------------------
SELECT has_column(
  'public', 'journal_entries', 'processed_at',
  'CA-T008-1: column processed_at exists on journal_entries'
);

SELECT col_type_is(
  'public', 'journal_entries', 'processed_at', 'timestamp with time zone',
  'CA-T008-1: processed_at is timestamptz'
);

SELECT col_is_null(
  'public', 'journal_entries', 'processed_at',
  'CA-T008-1: processed_at is nullable'
);

-- ---------------------------------------------------------------------------
-- 2. Index assertions (CA-T008-7)
-- ---------------------------------------------------------------------------
SELECT has_index(
  'public', 'journal_entries', 'idx_journal_entries_user_id_created_at_desc',
  'CA-T008-7: composite index idx_journal_entries_user_id_created_at_desc exists'
);

SELECT matches(
  (SELECT indexdef FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'idx_journal_entries_user_id_created_at_desc'),
  'created_at DESC',
  'CA-T008-7: composite index uses created_at DESC order'
);

SELECT hasnt_index(
  'public', 'journal_entries', 'idx_journal_entries_user_id',
  'CA-T008-7: single-column index idx_journal_entries_user_id removed (substituído pelo composto)'
);

-- ---------------------------------------------------------------------------
-- 3. RLS shape assertion (CA-T008-8) — exatamente 4 policies pós-evolução
-- ---------------------------------------------------------------------------
SELECT bag_eq(
  $$SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'journal_entries'$$,
  $$VALUES ('owner_select'::name), ('owner_insert'::name),
           ('owner_delete'::name), ('service_role_update'::name)$$,
  'CA-T008-8: journal_entries has exactly 4 policies (sem owner_update)'
);

-- ---------------------------------------------------------------------------
-- 4. Behavioral RLS — cross-user SELECT (CA-T008-2 ★ALTO mapeia PRD CA-002)
-- ---------------------------------------------------------------------------
SET LOCAL ROLE 'authenticated';
SET LOCAL "request.jwt.claim.sub" TO '00000000-0000-0000-0000-00000000000a';

SELECT results_eq(
  $$SELECT count(*)::int FROM public.journal_entries WHERE user_id = '00000000-0000-0000-0000-00000000000b'$$,
  $$VALUES (0)$$,
  'CA-T008-2 ★ALTO: user A NOT able to SELECT user B reflections (privacy gate)'
);

SELECT results_eq(
  $$SELECT count(*)::int FROM public.journal_entries WHERE user_id = '00000000-0000-0000-0000-00000000000a'$$,
  $$VALUES (1)$$,
  'CA-T008-2: user A able to SELECT own reflections (sanity check)'
);

-- ---------------------------------------------------------------------------
-- 5. Behavioral RLS — cross-user INSERT bloqueado (CA-T008-3)
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$INSERT INTO public.journal_entries (user_id, body)
    VALUES ('00000000-0000-0000-0000-00000000000b', 'A trying to write as B')$$,
  '42501',
  'new row violates row-level security policy for table "journal_entries"',
  'CA-T008-3: cross-user INSERT rejected by RLS'
);

-- ---------------------------------------------------------------------------
-- 6. Behavioral — owner UPDATE no body bloqueado (CA-T008-4 — append-only)
--    Sem policy de UPDATE pra owner: query roda mas afeta 0 rows.
-- ---------------------------------------------------------------------------
SELECT results_eq(
  $$WITH u AS (
      UPDATE public.journal_entries
      SET body = 'tampering'
      WHERE id = '11111111-1111-1111-1111-11111111111a'
      RETURNING 1
    )
    SELECT count(*)::int FROM u$$,
  $$VALUES (0)$$,
  'CA-T008-4: owner UPDATE on body affects 0 rows (append-only — sem owner_update policy)'
);

SELECT results_eq(
  $$SELECT body FROM public.journal_entries
    WHERE id = '11111111-1111-1111-1111-11111111111a'$$,
  $$VALUES ('A entry'::text)$$,
  'CA-T008-4 corollary: body unchanged after owner UPDATE attempt'
);

-- ---------------------------------------------------------------------------
-- 7. Behavioral — owner DELETE OK + cross-user DELETE bloqueado (CA-T008-6)
-- ---------------------------------------------------------------------------
-- Cross-user DELETE: user A tenta apagar reflexão de B → 0 rows
SELECT results_eq(
  $$WITH d AS (
      DELETE FROM public.journal_entries
      WHERE id = '11111111-1111-1111-1111-11111111111b'
      RETURNING 1
    )
    SELECT count(*)::int FROM d$$,
  $$VALUES (0)$$,
  'CA-T008-6: cross-user DELETE returns 0 rows (RLS bloqueia)'
);

-- Owner DELETE: user A apaga própria reflexão → 1 row
SELECT results_eq(
  $$WITH d AS (
      DELETE FROM public.journal_entries
      WHERE id = '11111111-1111-1111-1111-11111111111a'
      RETURNING 1
    )
    SELECT count(*)::int FROM d$$,
  $$VALUES (1)$$,
  'CA-T008-6: owner DELETE returns 1 row (LGPD right-to-delete)'
);

-- ---------------------------------------------------------------------------
-- 8. Behavioral — service_role UPDATE em processed_at OK (CA-T008-5)
--    Reset role pra postgres (que tem BYPASSRLS) — proxy pra service_role
--    no contexto de teste local. Em prod seria service_role real.
-- ---------------------------------------------------------------------------
RESET ROLE;
RESET "request.jwt.claim.sub";

SELECT results_eq(
  $$WITH u AS (
      UPDATE public.journal_entries
      SET processed_at = '2026-05-04 10:00:00+00'::timestamptz
      WHERE id = '11111111-1111-1111-1111-11111111111b'
      RETURNING 1
    )
    SELECT count(*)::int FROM u$$,
  $$VALUES (1)$$,
  'CA-T008-5: superuser/service_role UPDATE on processed_at affects 1 row'
);

SELECT results_eq(
  $$SELECT processed_at FROM public.journal_entries
    WHERE id = '11111111-1111-1111-1111-11111111111b'$$,
  $$VALUES ('2026-05-04 10:00:00+00'::timestamptz)$$,
  'CA-T008-5 corollary: processed_at value persisted'
);

SELECT * FROM finish();

ROLLBACK;
```

- [ ] **Step 2.2: Rodar pgTAP suite e confirmar falhas esperadas**

```bash
wsl -d Ubuntu -- bash -c "cd /mnt/d/companion-app && pnpm exec supabase test db 2>&1" | tail -40
```

Expected: pgTAP file `journal_entries_evolution.test.sql` falha em **maioria das assertions** (column processed_at não existe; index composto não existe; index single-column ainda existe; policies_are inclui owner_update). Outros 5 arquivos pgTAP existentes continuam passando (101 baseline preservado).

Resultado típico esperado:
```
journal_entries_evolution.test.sql ... FAIL (15 assertions, ~10 fail)
rls_direct.test.sql ............... ok
rls_join.test.sql ................. ok
schema_support.test.sql ........... ok
schema_user_data.test.sql ......... ok
secondary_indexes_and_tz.test.sql . ok
```

Se o test file é detectado como erro de compilação SQL (não erro de assertion) — STOP, debug syntax. Esperado: assertions executam mas dão FAIL claro tipo "expected has_column to exist but does not".

- [ ] **Step 2.3: Commit RED phase**

```bash
git add supabase/tests/journal_entries_evolution.test.sql
git commit -m "test(T-008): RED phase — pgTAP cobrindo 11 CAs da spec v0.2"
```

Expected: commit succeed (test sozinho não é considerado código de produção pelo TDD Gate F3 — checkpoint legítimo).

---

### Task 3: GREEN phase — Migration aplicada, suite passa

**Files:**
- Modify: `supabase/migrations/0006_journal_entries_evolution.sql` (adiciona statements ALTER)

- [ ] **Step 3.1: Escrever migration completa**

Substituir conteúdo do arquivo (preservar header) por:

```sql
-- migration: 0006_journal_entries_evolution
-- purpose: T-008 — evolução de public.journal_entries pra atender PRD
--          captura-reflexao-diaria (Marco 1 MVP).
-- spec: docs/specs/2026-05-04-T-008-reflections-schema.md (v0.2)
-- plan: docs/plans/2026-05-04-T-008-reflections-schema.md
--
-- Changes:
--   1. ADD COLUMN processed_at timestamptz NULL
--   2. DROP POLICY owner_update + CREATE POLICY service_role_update
--   3. DROP INDEX idx_journal_entries_user_id + CREATE composto (user_id, created_at DESC)
--
-- RLS post-migration (4 policies): owner_select, owner_insert, owner_delete, service_role_update.
-- owner_update intencionalmente removida — body imutável (D-T008-2 da spec).

-- ---------------------------------------------------------------------------
-- 1. Schema evolution: nova coluna processed_at (preparar T-010 async insights)
-- ---------------------------------------------------------------------------
ALTER TABLE public.journal_entries
  ADD COLUMN processed_at timestamptz NULL;

-- ---------------------------------------------------------------------------
-- 2. RLS evolution: append-only no body + service_role pode escrever processed_at
-- ---------------------------------------------------------------------------
DROP POLICY owner_update ON public.journal_entries;

CREATE POLICY service_role_update ON public.journal_entries
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 3. Index evolution: composto otimiza timeline RF-004 (paginação por created_at desc)
--    Composto cobre queries que usariam single-column anterior (Postgres usa prefix).
-- ---------------------------------------------------------------------------
DROP INDEX public.idx_journal_entries_user_id;

CREATE INDEX idx_journal_entries_user_id_created_at_desc
  ON public.journal_entries (user_id, created_at DESC);
```

- [ ] **Step 3.2: Aplicar migration via supabase db reset**

```bash
wsl -d Ubuntu -- bash -c "cd /mnt/d/companion-app && pnpm exec supabase db reset 2>&1" | tail -30
```

Expected: output mostra "Applying migration 0006_journal_entries_evolution.sql..." sem erros. Se erro de sintaxe SQL: STOP, fix migration, retry.

- [ ] **Step 3.3: Rodar pgTAP suite e confirmar passes**

```bash
wsl -d Ubuntu -- bash -c "cd /mnt/d/companion-app && pnpm exec supabase test db 2>&1" | tail -30
```

Expected:
```
journal_entries_evolution.test.sql ... ok (15/15)
rls_direct.test.sql ............... ok
rls_join.test.sql ................. ok
schema_support.test.sql ........... ok
schema_user_data.test.sql ......... ok
secondary_indexes_and_tz.test.sql . ok

# Total: 116/116 passing (101 baseline + 15 T-008)
```

Se algum baseline falhar (101 → <101): STOP, investigate. Provavel causa: migration 0006 quebrou index ou policy que outro test depende. Common pitfalls:
- `DROP INDEX` falhou porque outro index não existe (verificar nome exato)
- `rls_direct.test.sql` re-roda asserts em journal_entries (4 policies original) — pode falhar pq agora tem `service_role_update` em vez de `owner_update`. Se sim: rls_direct.test.sql precisa ser atualizado pra refletir nova realidade. Adicionar como Task 3.5 se aparecer.

- [ ] **Step 3.4: Se rls_direct.test.sql quebrar — atualizar pra refletir 4 policies novas**

Apenas se Step 3.3 falhar em `rls_direct.test.sql`. Caso contrário, pular pra Step 3.5.

`grep -n "journal_entries" supabase/tests/rls_direct.test.sql` pra encontrar asserts a atualizar. Tipicamente terá `policies_are` ou `is(policyname)` listando `owner_update`. Substituir `owner_update` por `service_role_update` nas linhas correspondentes.

(Se essa modificação for necessária, incluir no commit da Task 3 com mensagem ampliada: `feat(T-008): GREEN phase + atualização rls_direct.test.sql pra refletir nova RLS`.)

- [ ] **Step 3.5: Commit GREEN phase**

```bash
git add supabase/migrations/0006_journal_entries_evolution.sql
# (Step 3.4 pode ter incluído supabase/tests/rls_direct.test.sql)
git commit -m "feat(T-008): GREEN phase — migration 0006 ALTER journal_entries (processed_at + append-only RLS + index composto)"
```

Expected: commit succeed; hooks Legion não bloqueiam (migration SQL é arquivo de produção legítimo, TDD Gate F3 vê test commitado em Task 2 = OK).

---

### Task 4: Suite full Companion (Vitest 22/22 + pgTAP all preserved)

- [ ] **Step 4.1: Vitest baseline preservation**

```bash
wsl -d Ubuntu -- bash -c "cd /mnt/d/companion-app/apps/web && pnpm test 2>&1" | tail -15
```

Expected: `Tests  22 passed (22)` ou similar. T-008 não toca código TS, mas baseline merece confirmação.

Se baseline regredir: STOP, investigar. T-008 é puramente DB-level — regressão TS aqui seria bug não-relacionado e merece sua própria mini-fix.

- [ ] **Step 4.2: pgTAP final — confirma preservation total**

```bash
wsl -d Ubuntu -- bash -c "cd /mnt/d/companion-app && pnpm exec supabase test db 2>&1" | tail -5
```

Expected: total ≥ 116 passing (101 baseline + 15+ novos da T-008). 0 failures.

- [ ] **Step 4.3: Typecheck + lint sanity**

```bash
wsl -d Ubuntu -- bash -c "cd /mnt/d/companion-app/apps/web && pnpm typecheck && pnpm lint 2>&1" | tail -10
```

Expected: 0 errors em ambos. T-008 é DB; TS unchanged; sanity OK.

---

### Task 5: Notes T-008 finalizar

**Files:**
- Modify: `notes/T-008.md` (preencher seções com decisões reais)

- [ ] **Step 5.1: Substituir stub por notes finalizadas**

```markdown
---
title: "Notes — T-008 (Evolução journal_entries)"
type: "Executor Notes"
purpose: "Registro de decisões/desvios durante a execução de T-008 — evolução do schema journal_entries pra suportar PRD captura-reflexao-diaria. Plan: docs/plans/2026-05-04-T-008-reflections-schema.md. Spec v0.2: docs/specs/2026-05-04-T-008-reflections-schema.md."
---

# T-008 — Notes do Executor

> **Task:** T-008 — Evolução de journal_entries (append-only + processed_at + index timeline)
> **Stack adapter:** PostgreSQL 16 + pgTAP + Supabase CLI (via WSL)
> **Status:** ✅ DONE
> **Commits:** scaffold (chore) → RED phase (test) → GREEN phase (feat) → notes (docs)

## Decisões executadas

- **D-T008-1 a D-T008-10** documentadas em §6 da spec v0.2 — todas mantidas durante implementação.
- **Migration ALTER vs CREATE TABLE:** detectado durante writing-plans que `journal_entries` (0001) já existe com schema 90% idêntico. Spec corrigida v0.1 → v0.2 antes de codificar (sem `reflections` table nova).

## Desvios da spec

(preencher conforme execução real revelar — ex:
- "rls_direct.test.sql precisou ser atualizado em Task 3.4 porque tinha asserção sobre policy owner_update, agora removida" — se aplicável
- "pgTAP versão local não suporta `bag_eq`; substituí por `set_eq` que é equivalente pra esta verificação" — se aplicável)

## Reflexão sobre o fluxo

T-008 foi prova de fogo do fluxo Dev do Legion (Spec→Plan→Execute). Caminho:
1. PRD aprovado em validation-lab (idea_id=1, VIABLE T:9 M:8 D:7)
2. Brainstorming com 5 perguntas sequenciais (insights_jsonb defer, append-only, sem 1/dia, sem CHECK size, index unificado)
3. Spec v0.1 escrita
4. Erro detectado durante writing-plans: `journal_entries` já existia
5. Spec v0.2 corrigida (D-T008-9, D-T008-10 adicionadas)
6. Plan escrito com código literal
7. TDD red → green → suite full → notes
8. 4 commits em main: chore → test → feat → docs

Aprendizado: **"Verificar antes de criar" não é opcional**. Brainstorming devia ter feito grep em migrations existentes antes de propor schema novo. Spec v0.1 falhou nessa regra; v0.2 corrigida sem perda significativa de tempo porque writing-plans atuou como gate.

## Comandos reproduzíveis

```bash
# Aplicar migrations + rodar pgTAP completo
wsl -d Ubuntu -- bash -c "cd /mnt/d/companion-app && pnpm exec supabase db reset"
wsl -d Ubuntu -- bash -c "cd /mnt/d/companion-app && pnpm exec supabase test db"

# Vitest baseline preservation
wsl -d Ubuntu -- bash -c "cd /mnt/d/companion-app/apps/web && pnpm test"

# Typecheck + lint
wsl -d Ubuntu -- bash -c "cd /mnt/d/companion-app/apps/web && pnpm typecheck && pnpm lint"
```

## Próximas tasks

- **T-009**: Server Action `submitReflection(content)` — chama Supabase INSERT (com auth), retorna resposta empática via Claude Sonnet (chatStream). Traduz "content" UX ↔ "body" DB. Valida tamanho 5000 chars no boundary.
- **T-010**: Job async (Vercel Edge Function ou Supabase Edge Function) que consome reflexões com `processed_at IS NULL`, chama Claude Haiku pra extrair insights, escreve `insights_jsonb` (precisa migration 0007 adicionando coluna) + `processed_at = now()`.
- **T-011**: Tela `/reflect` (Next.js page) — textarea + form + chamada Server Action T-009.
```

- [ ] **Step 5.2: Commit notes**

```bash
git add notes/T-008.md
git commit -m "docs(T-008): notes — Evolução journal_entries (append-only + processed_at + index timeline)"
```

---

### Task 6: Push origin main

- [ ] **Step 6.1: Verificar log de commits desta task**

```bash
git log --oneline -5
```

Expected: 4 commits novos da T-008 mais recente:
```
<sha> docs(T-008): notes — ...
<sha> feat(T-008): GREEN phase — ...
<sha> test(T-008): RED phase — ...
<sha> chore(T-008): scaffold ...
```

- [ ] **Step 6.2: Push**

```bash
git push origin main
```

Expected: push succeed; remote ganha 4 commits novos.

- [ ] **Step 6.3: Verificar estado remoto**

```bash
git status
git log origin/main..HEAD
```

Expected: working tree clean; segundo comando retorna vazio (local == remote).

---

## Self-Review checklist

Antes de invocar subagent-driven-development:

**1. Spec coverage:** cada CA da spec v0.2 (CA-T008-1 a CA-T008-11) tem task implementando?

| CA | Mapeado em |
|---|---|
| CA-T008-1 schema/RLS/index post-migration | Task 3 (migration) + Task 2 (asserts has_column, has_index, bag_eq policies) |
| CA-T008-2 ★ALTO cross-user SELECT | Task 2 (results_eq count(*)=0 cross-user) |
| CA-T008-3 cross-user INSERT bloqueado | Task 2 (throws_ok 42501) |
| CA-T008-4 owner UPDATE body bloqueado | Task 2 (results_eq count=0 + body unchanged) |
| CA-T008-5 service_role UPDATE OK | Task 2 (RESET ROLE + UPDATE processed_at + corollary) |
| CA-T008-6 owner DELETE OK + cross-user DELETE bloqueado | Task 2 (2 results_eq) |
| CA-T008-7 index composto present + single-column absent | Task 2 (has_index + matches + hasnt_index) |
| CA-T008-8 policies_are exato | Task 2 (bag_eq sobre pg_policies) |
| CA-T008-9 suite pgTAP all passing | Task 4.2 |
| CA-T008-10 Vitest 22/22 baseline preservado | Task 4.1 |
| CA-T008-11 hooks Legion não bloqueiam | Task 1.5, 2.3, 3.5, 5.2 (cada commit) |

**2. Placeholder scan:** nenhum "TBD"/"TODO" no plan; código SQL completo em cada step que requer mudança; comandos exatos com WSL prefix.

**3. Type consistency:** nomes consistentes — `idx_journal_entries_user_id_created_at_desc` é o mesmo no migration, no test, e no plan. UUIDs sintéticos `00000000-0000-0000-0000-00000000000a/b` consistentes em todo o test. Policy `service_role_update` consistente.

---

## Rollback

Se Task 3 (GREEN phase) falhar com problemas que não dá pra fix rapidamente:

```bash
# Reset migration via Supabase
wsl -d Ubuntu -- bash -c "cd /mnt/d/companion-app && pnpm exec supabase db reset"

# Revert commits T-008 (em ordem, sem -f a menos que push fez)
git log --oneline -10  # confirma commits da T-008
git reset --hard <sha-anterior-ao-chore-scaffold>
# se já fez push (não deveria antes da Task 6):
git push --force-with-lease origin main
```

Estado pós-rollback: T-007 baseline preservado; nenhum arquivo da T-008 no repo; Companion volta ao estado pré-T-008.
