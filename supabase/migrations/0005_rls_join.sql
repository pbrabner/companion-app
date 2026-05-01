-- migration: 0005_rls_join
-- purpose: Enable Row-Level Security and create policies for the 3 tables
--          whose authorization model is non-trivial (T-004b of the
--          experimental pipeline). Companion to 0004_rls_direct.sql.
--
-- Tables and policy shape:
--   * conversations  → owner-only direct (auth.uid() = user_id), 4 policies.
--                      Identical pattern to T-004a tables; lives in T-004b
--                      because it is the parent of `messages` and the join
--                      target for that table's policies.
--
--   * messages       → owner via JOIN on conversations.user_id. The table has
--                      no `user_id` column of its own; authorization is
--                      derived by looking up the conversation. 4 policies
--                      mirroring conversations: select/insert/update/delete.
--                      The subquery
--                          conversation_id IN (SELECT id FROM conversations
--                                              WHERE user_id = auth.uid())
--                      itself runs under RLS as the same authenticated user,
--                      so it returns only conversations the caller already
--                      owns — no cross-user leakage even if the inner select
--                      expression were misread.
--
--   * safety_events  → SELECT owner-only (audit visible to its subject only,
--                      future admin role TBD). INSERT only by service_role
--                      (no user_id self-spoof; the Server Action that detects
--                      the safety event runs with service_role and writes the
--                      audit row). NO update/delete policies — the audit log
--                      is append-only via application logic; even the user
--                      whose event it is cannot edit/delete it.
--
-- Service_role nuance: in Supabase the `service_role` role has rolbypassrls=t,
-- so technically it would write to safety_events even without a policy. The
-- explicit `service_only_insert TO service_role WITH CHECK (true)` policy is
-- defense in depth — if rolbypassrls is ever revoked, or if the table is
-- accessed via a wrapper view that re-applies RLS, the policy still grants
-- the audit pipeline what it needs. See notes/T-004b.md.
--
-- Risk: ★ALTO. Same authorization-boundary concern as T-004a, plus the extra
-- fragility of policy-via-JOIN: a malformed subquery could either leak across
-- users (false negatives) or break legitimate access (false positives). The
-- safety_events table is auditable-critical — a wrong policy could let a user
-- hide their own safety events. Manual human SQL review required before merge.

-- ---------------------------------------------------------------------------
-- 1. Enable RLS on all 3 tables
-- ---------------------------------------------------------------------------
ALTER TABLE public.conversations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safety_events  ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. conversations — owner-only direct via user_id (4 policies)
-- ---------------------------------------------------------------------------
CREATE POLICY owner_select ON public.conversations
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY owner_insert ON public.conversations
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY owner_update ON public.conversations
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY owner_delete ON public.conversations
  FOR DELETE
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. messages — owner via JOIN on conversations.user_id (4 policies)
--    The subquery in USING / WITH CHECK runs under the caller's RLS context,
--    so the visible set of conversation ids is already filtered to those the
--    caller owns. Using `IN (SELECT id FROM conversations WHERE user_id =
--    auth.uid())` is equivalent to `EXISTS (SELECT 1 FROM conversations c
--    WHERE c.id = messages.conversation_id AND c.user_id = auth.uid())` —
--    chose IN form because it matches the literal acceptance criterion text.
-- ---------------------------------------------------------------------------
CREATE POLICY owner_select ON public.messages
  FOR SELECT
  USING (
    conversation_id IN (
      SELECT id FROM public.conversations WHERE user_id = auth.uid()
    )
  );

CREATE POLICY owner_insert ON public.messages
  FOR INSERT
  WITH CHECK (
    conversation_id IN (
      SELECT id FROM public.conversations WHERE user_id = auth.uid()
    )
  );

CREATE POLICY owner_update ON public.messages
  FOR UPDATE
  USING (
    conversation_id IN (
      SELECT id FROM public.conversations WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    conversation_id IN (
      SELECT id FROM public.conversations WHERE user_id = auth.uid()
    )
  );

CREATE POLICY owner_delete ON public.messages
  FOR DELETE
  USING (
    conversation_id IN (
      SELECT id FROM public.conversations WHERE user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 4. safety_events — owner_select (any auth user reads own audit) +
--                    service_only_insert (only service_role writes audit).
--    No UPDATE/DELETE policies — append-only.
-- ---------------------------------------------------------------------------
CREATE POLICY owner_select ON public.safety_events
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY service_only_insert ON public.safety_events
  FOR INSERT
  TO service_role
  WITH CHECK (true);
