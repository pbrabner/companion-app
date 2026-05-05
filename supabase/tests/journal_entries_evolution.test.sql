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

SELECT plan(16);

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
