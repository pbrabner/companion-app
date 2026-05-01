-- migration: rls_direct (test)
-- purpose: pgTAP assertions for T-004a — owner-only RLS on the 6 tables that
--          have a direct user identifier column (auth.uid() = user_id, except
--          profiles where the column is `id`). Validates structural RLS state
--          (enabled + 4 policies/table) AND semantic behavior (cross-user
--          queries blocked under role 'authenticated' with simulated JWT sub).
--
-- Tables in scope:
--   * profiles         (key column: id)
--   * checkins         (key column: user_id)
--   * journal_entries  (key column: user_id)
--   * track_progress   (key column: user_id, composite PK with track_slug)
--   * user_insights    (key column: user_id)
--   * usage_counters   (key column: user_id, composite PK with day_bucket)
--
-- Acceptance criterion (binary, T-004a):
--   a. SELECT FROM checkins as A returns only A's rows.
--   b. INSERT INTO checkins (user_id=B) as A fails (RLS).
--   c. UPDATE profiles SET ... WHERE id=B as A affects 0 rows.
--
-- Technique: auth.uid() reads current_setting('request.jwt.claim.sub'). We
-- impersonate users by SET LOCAL "request.jwt.claim.sub" + SET LOCAL ROLE
-- 'authenticated' (which does NOT bypass RLS, unlike the default postgres
-- role). auth.users rows are pre-created as superuser before switching role.

BEGIN;

SELECT plan(32);

-- ---------------------------------------------------------------------------
-- Setup: create two mock auth users as superuser. Only `id` is required; all
-- other columns either nullable or have defaults. is_sso_user / is_anonymous
-- are NOT NULL but default to false at table level (added by Supabase).
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, is_sso_user, is_anonymous)
VALUES
  ('00000000-0000-0000-0000-00000000000a', false, false),
  ('00000000-0000-0000-0000-00000000000b', false, false);

-- Pre-seed one row per table for each user, AS SUPERUSER, so behavioral asserts
-- can rely on rows existing regardless of insert policy. service_role/postgres
-- bypass RLS so these inserts always go through.
INSERT INTO public.profiles (id, display_name)
VALUES
  ('00000000-0000-0000-0000-00000000000a', 'A'),
  ('00000000-0000-0000-0000-00000000000b', 'B');

INSERT INTO public.checkins (user_id, mood)
VALUES
  ('00000000-0000-0000-0000-00000000000a', 4),
  ('00000000-0000-0000-0000-00000000000b', 3);

INSERT INTO public.journal_entries (user_id, body)
VALUES
  ('00000000-0000-0000-0000-00000000000a', 'A entry'),
  ('00000000-0000-0000-0000-00000000000b', 'B entry');

INSERT INTO public.track_progress (user_id, track_slug, current_step)
VALUES
  ('00000000-0000-0000-0000-00000000000a', 'disciplina', 1),
  ('00000000-0000-0000-0000-00000000000b', 'disciplina', 2);

INSERT INTO public.user_insights (user_id, patterns_json)
VALUES
  ('00000000-0000-0000-0000-00000000000a', '[{"k":"a"}]'::jsonb),
  ('00000000-0000-0000-0000-00000000000b', '[{"k":"b"}]'::jsonb);

INSERT INTO public.usage_counters (user_id, day_bucket, hour_bucket, chat_msgs_day, chat_msgs_hour)
VALUES
  ('00000000-0000-0000-0000-00000000000a', '2026-04-30', '2026-04-30 00:00:00+00', 1, 1),
  ('00000000-0000-0000-0000-00000000000b', '2026-04-30', '2026-04-30 00:00:00+00', 1, 1);

-- ---------------------------------------------------------------------------
-- Structural assertions (12): RLS enabled + 4 policies per table
-- These fail in RED phase because 0004 hasn't been applied yet.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.profiles'::regclass),
  true,
  'RLS enabled on profiles'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.checkins'::regclass),
  true,
  'RLS enabled on checkins'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.journal_entries'::regclass),
  true,
  'RLS enabled on journal_entries'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.track_progress'::regclass),
  true,
  'RLS enabled on track_progress'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_insights'::regclass),
  true,
  'RLS enabled on user_insights'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.usage_counters'::regclass),
  true,
  'RLS enabled on usage_counters'
);

SELECT is(
  (SELECT count(*)::int FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'profiles'
       AND policyname IN ('owner_select','owner_insert','owner_update','owner_delete')),
  4,
  'profiles has 4 owner_* policies'
);
SELECT is(
  (SELECT count(*)::int FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'checkins'
       AND policyname IN ('owner_select','owner_insert','owner_update','owner_delete')),
  4,
  'checkins has 4 owner_* policies'
);
SELECT is(
  (SELECT count(*)::int FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'journal_entries'
       AND policyname IN ('owner_select','owner_insert','owner_update','owner_delete')),
  4,
  'journal_entries has 4 owner_* policies'
);
SELECT is(
  (SELECT count(*)::int FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'track_progress'
       AND policyname IN ('owner_select','owner_insert','owner_update','owner_delete')),
  4,
  'track_progress has 4 owner_* policies'
);
SELECT is(
  (SELECT count(*)::int FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'user_insights'
       AND policyname IN ('owner_select','owner_insert','owner_update','owner_delete')),
  4,
  'user_insights has 4 owner_* policies'
);
SELECT is(
  (SELECT count(*)::int FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'usage_counters'
       AND policyname IN ('owner_select','owner_insert','owner_update','owner_delete')),
  4,
  'usage_counters has 4 owner_* policies'
);

-- ---------------------------------------------------------------------------
-- Behavioral assertions: impersonate user A as role 'authenticated'.
-- 'authenticated' does NOT bypass RLS (rolbypassrls=f), so policies apply.
-- auth.uid() reads current_setting('request.jwt.claim.sub').
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" TO '00000000-0000-0000-0000-00000000000a';

-- Sanity: auth.uid() returns A
SELECT is(
  auth.uid(),
  '00000000-0000-0000-0000-00000000000a'::uuid,
  'auth.uid() returns user A under simulated JWT'
);

-- Clause (a): A only sees own checkins
SELECT is(
  (SELECT count(*)::int FROM public.checkins),
  1,
  'A sees exactly 1 checkin (own) — clause (a)'
);
SELECT is(
  (SELECT count(*)::int FROM public.checkins WHERE user_id = '00000000-0000-0000-0000-00000000000b'::uuid),
  0,
  'A sees 0 checkins of B'
);

-- Same for the other 4 user_id-keyed tables (defense in depth)
SELECT is(
  (SELECT count(*)::int FROM public.journal_entries),
  1,
  'A sees exactly 1 journal_entry (own)'
);
SELECT is(
  (SELECT count(*)::int FROM public.track_progress),
  1,
  'A sees exactly 1 track_progress row (own)'
);
SELECT is(
  (SELECT count(*)::int FROM public.user_insights),
  1,
  'A sees exactly 1 user_insights row (own)'
);
SELECT is(
  (SELECT count(*)::int FROM public.usage_counters),
  1,
  'A sees exactly 1 usage_counters row (own)'
);
-- profiles uses id, not user_id
SELECT is(
  (SELECT count(*)::int FROM public.profiles),
  1,
  'A sees exactly 1 profile (own — auth.uid()=id)'
);

-- Clause (b): A cannot insert a checkin pretending to be B
-- We need a fresh day to avoid the unique-per-day index colliding instead.
SELECT throws_ok(
  $$ INSERT INTO public.checkins (user_id, mood, created_at)
     VALUES ('00000000-0000-0000-0000-00000000000b'::uuid, 5,
             '2026-04-29 12:00:00+00') $$,
  '42501',
  NULL,
  'A cannot INSERT checkin with user_id=B (RLS WITH CHECK) — clause (b)'
);
-- And A CAN insert own checkin (positive path, different day to avoid unique)
SELECT lives_ok(
  $$ INSERT INTO public.checkins (user_id, mood, created_at)
     VALUES ('00000000-0000-0000-0000-00000000000a'::uuid, 5,
             '2026-04-29 12:00:00+00') $$,
  'A can INSERT checkin with user_id=A (own)'
);

-- Clause (c): A's UPDATE of B's profile affects 0 rows (silently filtered by USING)
-- An UPDATE with no rows matched (because RLS USING hides them) is not an error,
-- just 0 rows affected. We execute the mutations as A, then RESET ROLE and
-- verify B's rows are intact (display_name, body, mood) and B's rows still exist.
UPDATE public.profiles SET display_name = 'hacked'
  WHERE id = '00000000-0000-0000-0000-00000000000b'::uuid;
UPDATE public.journal_entries SET body = 'hacked'
  WHERE user_id = '00000000-0000-0000-0000-00000000000b'::uuid;
UPDATE public.checkins SET mood = 1
  WHERE user_id = '00000000-0000-0000-0000-00000000000b'::uuid;
DELETE FROM public.checkins
  WHERE user_id = '00000000-0000-0000-0000-00000000000b'::uuid;
DELETE FROM public.profiles
  WHERE id = '00000000-0000-0000-0000-00000000000b'::uuid;

-- ---------------------------------------------------------------------------
-- Switch identity to user B and verify symmetric isolation.
-- ---------------------------------------------------------------------------
SET LOCAL "request.jwt.claim.sub" TO '00000000-0000-0000-0000-00000000000b';

SELECT is(
  auth.uid(),
  '00000000-0000-0000-0000-00000000000b'::uuid,
  'auth.uid() returns user B under switched JWT'
);

SELECT is(
  (SELECT count(*)::int FROM public.checkins WHERE user_id = '00000000-0000-0000-0000-00000000000a'::uuid),
  0,
  'B sees 0 checkins of A (symmetric isolation)'
);
SELECT is(
  (SELECT count(*)::int FROM public.profiles WHERE id = '00000000-0000-0000-0000-00000000000a'::uuid),
  0,
  'B sees 0 profile rows of A (symmetric isolation)'
);

-- B cannot insert a checkin pretending to be A
SELECT throws_ok(
  $$ INSERT INTO public.checkins (user_id, mood, created_at)
     VALUES ('00000000-0000-0000-0000-00000000000a'::uuid, 1,
             '2026-04-28 12:00:00+00') $$,
  '42501',
  NULL,
  'B cannot INSERT checkin with user_id=A'
);

-- ---------------------------------------------------------------------------
-- Restore role and verify B's rows are intact (clause c — UPDATE/DELETE by A
-- did not mutate B's data) and superuser still has full access.
-- ---------------------------------------------------------------------------
RESET ROLE;
RESET "request.jwt.claim.sub";

-- B's profile still has original display_name (UPDATE was filtered by USING)
SELECT is(
  (SELECT display_name FROM public.profiles WHERE id = '00000000-0000-0000-0000-00000000000b'::uuid),
  'B',
  'B profile display_name unchanged after A UPDATE attempt — clause (c)'
);
-- B's journal_entries body unchanged
SELECT is(
  (SELECT body FROM public.journal_entries WHERE user_id = '00000000-0000-0000-0000-00000000000b'::uuid),
  'B entry',
  'B journal_entries body unchanged after A UPDATE attempt'
);
-- B's checkin mood unchanged (still 3, not 1)
SELECT is(
  (SELECT mood FROM public.checkins WHERE user_id = '00000000-0000-0000-0000-00000000000b'::uuid),
  3::smallint,
  'B checkin mood unchanged after A UPDATE attempt'
);
-- B's profile and checkin still exist (DELETE was filtered)
SELECT is(
  (SELECT count(*)::int FROM public.profiles WHERE id = '00000000-0000-0000-0000-00000000000b'::uuid),
  1,
  'B profile still exists after A DELETE attempt'
);
SELECT is(
  (SELECT count(*)::int FROM public.checkins WHERE user_id = '00000000-0000-0000-0000-00000000000b'::uuid),
  1,
  'B checkin still exists after A DELETE attempt'
);

-- Superuser sanity (RLS bypass for postgres role)
SELECT is(
  (SELECT count(*)::int FROM public.checkins),
  3,
  'superuser sees all checkins (2 seeded + 1 inserted by A on different day)'
);

SELECT * FROM finish();

ROLLBACK;
