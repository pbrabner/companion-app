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
