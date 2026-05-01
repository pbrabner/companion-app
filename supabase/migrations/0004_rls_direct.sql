-- migration: 0004_rls_direct
-- purpose: Enable Row-Level Security and create owner-only policies for the 6
--          tables that hold per-user data with a *direct* user identifier
--          column. Implements T-004a of the experimental pipeline. Joined-key
--          tables (conversations, messages, safety_events) are out of scope —
--          T-004b owns those (migration 0005_rls_join.sql).
--
-- Key column per table:
--   * profiles         → id        (PK references auth.users(id))
--   * checkins         → user_id
--   * journal_entries  → user_id
--   * track_progress   → user_id   (composite PK with track_slug)
--   * user_insights    → user_id   (PK)
--   * usage_counters   → user_id   (composite PK with day_bucket)
--
-- Policy set (4 per table): owner_select, owner_insert, owner_update,
-- owner_delete. UPDATE has both USING and WITH CHECK to prevent re-assigning
-- the row to another user.
--
-- Numbering note: the backlog originally suggested 0003_rls_direct.sql, but
-- mini-fix-001 consumed slot 0003 (0003_secondary_indexes.sql) on 2026-04-30.
-- This migration uses 0004; T-004b will use 0005. See notes/T-004a.md for
-- the full rationale.
--
-- Risk: ★ALTO. RLS is the only authorization boundary between users in the
-- Companion (Architecture decision A2). A bug here would leak emotional
-- reflections across users (Risk #2 of the EDD). Manual human review required
-- before merge to remote (Phase 2b human gate).

-- ---------------------------------------------------------------------------
-- 1. Enable RLS on all 6 tables
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkins         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.track_progress   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_insights    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_counters   ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. profiles — key column is `id`, not `user_id`
-- ---------------------------------------------------------------------------
CREATE POLICY owner_select ON public.profiles
  FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY owner_insert ON public.profiles
  FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY owner_update ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY owner_delete ON public.profiles
  FOR DELETE
  USING (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- 3. checkins
-- ---------------------------------------------------------------------------
CREATE POLICY owner_select ON public.checkins
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY owner_insert ON public.checkins
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY owner_update ON public.checkins
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY owner_delete ON public.checkins
  FOR DELETE
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 4. journal_entries
-- ---------------------------------------------------------------------------
CREATE POLICY owner_select ON public.journal_entries
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY owner_insert ON public.journal_entries
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY owner_update ON public.journal_entries
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY owner_delete ON public.journal_entries
  FOR DELETE
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 5. track_progress (composite PK: user_id + track_slug)
-- ---------------------------------------------------------------------------
CREATE POLICY owner_select ON public.track_progress
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY owner_insert ON public.track_progress
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY owner_update ON public.track_progress
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY owner_delete ON public.track_progress
  FOR DELETE
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 6. user_insights (user_id is the PK)
-- ---------------------------------------------------------------------------
CREATE POLICY owner_select ON public.user_insights
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY owner_insert ON public.user_insights
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY owner_update ON public.user_insights
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY owner_delete ON public.user_insights
  FOR DELETE
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 7. usage_counters (composite PK: user_id + day_bucket)
--    Same 4-policy set as the other user_id-keyed tables — composite PK does
--    not change the authorization model. The hour_bucket / counter columns
--    are mutated by the rate-limiter (T-019) running with auth.uid() of the
--    end user; service_role-driven cron jobs bypass RLS by design.
-- ---------------------------------------------------------------------------
CREATE POLICY owner_select ON public.usage_counters
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY owner_insert ON public.usage_counters
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY owner_update ON public.usage_counters
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY owner_delete ON public.usage_counters
  FOR DELETE
  USING (auth.uid() = user_id);
