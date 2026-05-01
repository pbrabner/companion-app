-- migration: rls_join (test)
-- purpose: pgTAP assertions for T-004b — RLS for the 3 tables whose authorization
--          model is non-trivial:
--            * conversations  — owner-only direct via user_id (4 policies)
--            * messages       — owner via JOIN on conversations.user_id (no
--                               direct user_id column on messages itself)
--            * safety_events  — owner-only SELECT; INSERT only by service_role
--                               (no UPDATE/DELETE policies, audit append-only)
--
-- Acceptance criterion (binary, T-004b):
--   a. SELECT m.* FROM messages m WHERE conversation_id IN
--      (SELECT id FROM conversations WHERE user_id = B) returns 0 rows when
--      executed as user A (cross-user join leak blocked).
--   b. INSERT INTO safety_events (user_id, ...) VALUES (A, ...) executed as
--      authenticated A fails (RLS denies — no INSERT policy for authenticated).
--   c. INSERT same row as service_role succeeds.
--
-- Technique: same as rls_direct.test.sql.
--   * Pre-seed auth.users + per-user data as superuser (postgres bypasses RLS).
--   * SET LOCAL ROLE authenticated + SET LOCAL "request.jwt.claim.sub" to
--     impersonate users; then RLS applies and auth.uid() returns the JWT sub.
--   * SET LOCAL ROLE service_role for the positive insert path on safety_events
--     (service_role has rolbypassrls=t, so technically the RLS policy is
--     redundant defense in depth — see notes/T-004b.md).
--   * RESET ROLE to verify post-mutation state from a superuser context.

BEGIN;

SELECT plan(31);

-- ---------------------------------------------------------------------------
-- Setup: 2 mock auth users + per-user data (conversations, messages,
-- safety_events). Service_role / postgres bypass RLS, so this seed always
-- succeeds even after 0005 is applied.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, is_sso_user, is_anonymous)
VALUES
  ('00000000-0000-0000-0000-00000000000a', false, false),
  ('00000000-0000-0000-0000-00000000000b', false, false);

-- One conversation per user, fixed UUIDs so we can reference them in messages
INSERT INTO public.conversations (id, user_id)
VALUES
  ('11111111-1111-1111-1111-11111111111a', '00000000-0000-0000-0000-00000000000a'),
  ('11111111-1111-1111-1111-11111111111b', '00000000-0000-0000-0000-00000000000b');

-- One message per conversation
INSERT INTO public.messages (conversation_id, role, content)
VALUES
  ('11111111-1111-1111-1111-11111111111a', 'user', 'A hello'),
  ('11111111-1111-1111-1111-11111111111b', 'user', 'B hello');

-- One safety_event per user (seeded via superuser bypass — represents what the
-- Server Action would have written via service_role in production).
INSERT INTO public.safety_events (user_id, trigger_text, action_taken)
VALUES
  ('00000000-0000-0000-0000-00000000000a', 'A trigger', 'caution_response'),
  ('00000000-0000-0000-0000-00000000000b', 'B trigger', 'caution_response');

-- ---------------------------------------------------------------------------
-- Structural assertions (10): RLS enabled + correct policy set per table
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.conversations'::regclass),
  true,
  'RLS enabled on conversations'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.messages'::regclass),
  true,
  'RLS enabled on messages'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.safety_events'::regclass),
  true,
  'RLS enabled on safety_events'
);

SELECT is(
  (SELECT count(*)::int FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'conversations'
       AND policyname IN ('owner_select','owner_insert','owner_update','owner_delete')),
  4,
  'conversations has 4 owner_* policies'
);
SELECT is(
  (SELECT count(*)::int FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'messages'
       AND policyname IN ('owner_select','owner_insert','owner_update','owner_delete')),
  4,
  'messages has 4 owner_* policies (via JOIN on conversations)'
);
SELECT is(
  (SELECT count(*)::int FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'safety_events'
       AND policyname = 'owner_select'),
  1,
  'safety_events has 1 owner_select policy'
);
SELECT is(
  (SELECT count(*)::int FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'safety_events'
       AND policyname = 'service_only_insert'),
  1,
  'safety_events has 1 service_only_insert policy'
);
-- safety_events must NOT have update/delete policies (audit append-only)
SELECT is(
  (SELECT count(*)::int FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'safety_events'
       AND cmd IN ('UPDATE','DELETE')),
  0,
  'safety_events has 0 UPDATE/DELETE policies (audit append-only)'
);
-- service_only_insert must be scoped TO service_role (not the default PUBLIC)
SELECT is(
  (SELECT roles::text[] FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'safety_events'
       AND policyname = 'service_only_insert'),
  ARRAY['service_role']::text[],
  'service_only_insert policy is scoped TO service_role'
);
-- Total policy count for safety_events: exactly 2 (owner_select + service_only_insert)
SELECT is(
  (SELECT count(*)::int FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'safety_events'),
  2,
  'safety_events has exactly 2 policies total'
);

-- ---------------------------------------------------------------------------
-- Behavioral assertions: impersonate user A as role 'authenticated'.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" TO '00000000-0000-0000-0000-00000000000a';

-- Sanity
SELECT is(
  auth.uid(),
  '00000000-0000-0000-0000-00000000000a'::uuid,
  'auth.uid() returns user A under simulated JWT'
);

-- A sees only own conversation
SELECT is(
  (SELECT count(*)::int FROM public.conversations),
  1,
  'A sees exactly 1 conversation (own)'
);
SELECT is(
  (SELECT count(*)::int FROM public.conversations WHERE user_id = '00000000-0000-0000-0000-00000000000b'::uuid),
  0,
  'A sees 0 conversations of B'
);

-- A sees only own message (via JOIN — messages has no user_id column)
SELECT is(
  (SELECT count(*)::int FROM public.messages),
  1,
  'A sees exactly 1 message (own — via JOIN policy)'
);

-- Clause (a): cross-user JOIN attempt returns 0 rows
SELECT is(
  (SELECT count(*)::int FROM public.messages m
     WHERE m.conversation_id IN (
       SELECT id FROM public.conversations
        WHERE user_id = '00000000-0000-0000-0000-00000000000b'::uuid
     )),
  0,
  'A cannot read messages of B via cross-user JOIN — clause (a)'
);

-- A sees only own safety_event
SELECT is(
  (SELECT count(*)::int FROM public.safety_events),
  1,
  'A sees exactly 1 safety_event (own)'
);
SELECT is(
  (SELECT count(*)::int FROM public.safety_events WHERE user_id = '00000000-0000-0000-0000-00000000000b'::uuid),
  0,
  'A sees 0 safety_events of B'
);

-- Clause (b): A cannot insert safety_event even with own user_id (no INSERT
-- policy exists for role authenticated; only service_role can insert)
SELECT throws_ok(
  $$ INSERT INTO public.safety_events (user_id, trigger_text, action_taken)
     VALUES ('00000000-0000-0000-0000-00000000000a'::uuid, 'A self-insert', 'caution_response') $$,
  '42501',
  NULL,
  'A cannot INSERT own safety_event as authenticated (audit is service_role only) — clause (b)'
);

-- A also cannot insert one for B (defense in depth — same denial)
SELECT throws_ok(
  $$ INSERT INTO public.safety_events (user_id, trigger_text, action_taken)
     VALUES ('00000000-0000-0000-0000-00000000000b'::uuid, 'A->B forge', 'caution_response') $$,
  '42501',
  NULL,
  'A cannot INSERT safety_event spoofing user_id=B'
);

-- A can insert message into OWN conversation (positive path — WITH CHECK
-- subquery in conversations succeeds for user_id = auth.uid())
SELECT lives_ok(
  $$ INSERT INTO public.messages (conversation_id, role, content)
     VALUES ('11111111-1111-1111-1111-11111111111a', 'user', 'A second msg') $$,
  'A can INSERT message into own conversation'
);

-- A cannot insert a message into B's conversation (WITH CHECK subquery fails)
SELECT throws_ok(
  $$ INSERT INTO public.messages (conversation_id, role, content)
     VALUES ('11111111-1111-1111-1111-11111111111b', 'user', 'A->B forged msg') $$,
  '42501',
  NULL,
  'A cannot INSERT message into B''s conversation (WITH CHECK on JOIN)'
);

-- ---------------------------------------------------------------------------
-- Switch to user B; verify symmetric isolation.
-- ---------------------------------------------------------------------------
SET LOCAL "request.jwt.claim.sub" TO '00000000-0000-0000-0000-00000000000b';

SELECT is(
  (SELECT count(*)::int FROM public.conversations WHERE user_id = '00000000-0000-0000-0000-00000000000a'::uuid),
  0,
  'B sees 0 conversations of A (symmetric)'
);
SELECT is(
  (SELECT count(*)::int FROM public.messages m
     WHERE m.conversation_id IN (
       SELECT id FROM public.conversations
        WHERE user_id = '00000000-0000-0000-0000-00000000000a'::uuid
     )),
  0,
  'B cannot read messages of A via cross-user JOIN (symmetric clause a)'
);
SELECT is(
  (SELECT count(*)::int FROM public.safety_events WHERE user_id = '00000000-0000-0000-0000-00000000000a'::uuid),
  0,
  'B sees 0 safety_events of A (symmetric)'
);

-- ---------------------------------------------------------------------------
-- Clause (c): switch to service_role and insert safety_event successfully.
-- service_role has rolbypassrls=t, so the policy is technically defense in
-- depth — but the policy explicitly allows INSERT for service_role (TO
-- service_role WITH CHECK true), so even if bypass were disabled, this works.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE service_role;
RESET "request.jwt.claim.sub";

SELECT lives_ok(
  $$ INSERT INTO public.safety_events (user_id, trigger_text, action_taken)
     VALUES ('00000000-0000-0000-0000-00000000000a'::uuid, 'service insert', 'handoff') $$,
  'service_role can INSERT safety_event — clause (c)'
);

-- ---------------------------------------------------------------------------
-- Restore role and verify final state from superuser.
-- ---------------------------------------------------------------------------
RESET ROLE;

-- service_role insert above is visible to superuser
SELECT is(
  (SELECT count(*)::int FROM public.safety_events
     WHERE user_id = '00000000-0000-0000-0000-00000000000a'::uuid
       AND trigger_text = 'service insert'),
  1,
  'service_role insert persisted (visible to superuser)'
);

-- A's own message INSERT (positive path under authenticated) also persisted
SELECT is(
  (SELECT count(*)::int FROM public.messages
     WHERE conversation_id = '11111111-1111-1111-1111-11111111111a'::uuid
       AND content = 'A second msg'),
  1,
  'A INSERT into own conversation persisted'
);

-- B's data fully intact (no cross-user mutation occurred)
SELECT is(
  (SELECT count(*)::int FROM public.conversations
     WHERE user_id = '00000000-0000-0000-0000-00000000000b'::uuid),
  1,
  'B conversation still exists'
);
SELECT is(
  (SELECT count(*)::int FROM public.messages
     WHERE conversation_id = '11111111-1111-1111-1111-11111111111b'::uuid),
  1,
  'B message still exists (no forged inserts from A)'
);
SELECT is(
  (SELECT count(*)::int FROM public.safety_events
     WHERE user_id = '00000000-0000-0000-0000-00000000000b'::uuid),
  1,
  'B safety_event still exists'
);

-- Superuser sees all data (RLS bypass for postgres role)
SELECT is(
  (SELECT count(*)::int FROM public.safety_events),
  3,
  'superuser sees all safety_events (2 seeded + 1 inserted by service_role)'
);

SELECT * FROM finish();

ROLLBACK;
