-- =====================================================================
-- 0007_journal_entries_apply_remote.sql
--
-- Apply mínimo da tabela journal_entries no projeto Supabase remoto
-- "Midnight Puppies / Primal Core" (fvdmhnxmheblvsdgjoyp), que tem
-- schema diferente do repo (tabelas habits/daily_checkins/reflections/
-- user_commitments existem; journal_entries não).
--
-- Esta migration consolida 0001 + 0006 num único snippet idempotente,
-- aplicável via SQL Editor sem mexer em tabelas existentes (profiles
-- já existe lá; assumimos compatibilidade ou que será reconciliada
-- depois).
--
-- Schema final = post-0006 (append-only no body, service_role update,
-- composto index timeline RF-004, processed_at pra T-010).
--
-- Risk: ★ALTO. RLS é única barreira entre usuários. Revisar manualmente.
-- =====================================================================

-- 1. Tabela
CREATE TABLE IF NOT EXISTS public.journal_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  prompt_used   text,
  body          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz NULL
);

-- 2. Index composto pra timeline (RF-004 paginação por created_at desc)
CREATE INDEX IF NOT EXISTS idx_journal_entries_user_created
  ON public.journal_entries (user_id, created_at DESC);

-- 3. RLS
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;

-- 4. Policies (set post-0006: select/insert/delete owner, update service_role)
DROP POLICY IF EXISTS owner_select ON public.journal_entries;
CREATE POLICY owner_select ON public.journal_entries
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS owner_insert ON public.journal_entries;
CREATE POLICY owner_insert ON public.journal_entries
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS owner_delete ON public.journal_entries;
CREATE POLICY owner_delete ON public.journal_entries
  FOR DELETE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS service_role_update ON public.journal_entries;
CREATE POLICY service_role_update ON public.journal_entries
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);
