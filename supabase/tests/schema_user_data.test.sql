-- migration: schema_user_data (test)
-- purpose: pgTAP assertions for the 7 user-data tables created by 0001_user_data_schema.sql
--          (T-003a). Validates table existence, key columns, the unique index
--          checkins_one_per_day, and its enforcement against duplicate inserts.

BEGIN;

SELECT plan(15);

-- bypass FK constraints to auth.users for the behavioral assertions only
-- (transaction-local; production migration still enforces them).
SET LOCAL session_replication_role = 'replica';

-- 7 tables exist under public schema
SELECT has_table('public', 'profiles', 'profiles table exists');
SELECT has_table('public', 'checkins', 'checkins table exists');
SELECT has_table('public', 'journal_entries', 'journal_entries table exists');
SELECT has_table('public', 'conversations', 'conversations table exists');
SELECT has_table('public', 'messages', 'messages table exists');
SELECT has_table('public', 'track_progress', 'track_progress table exists');
SELECT has_table('public', 'user_insights', 'user_insights table exists');

-- key columns
SELECT has_column('public', 'profiles', 'privacy_accepted_at',
  'profiles.privacy_accepted_at exists (T-031 prerequisite)');
SELECT has_column('public', 'profiles', 'onboarded_at',
  'profiles.onboarded_at exists');
SELECT has_column('public', 'profiles', 'active_track',
  'profiles.active_track exists');
SELECT has_column('public', 'checkins', 'mood', 'checkins.mood exists');

-- unique index
SELECT has_index('public', 'checkins', 'checkins_one_per_day',
  'checkins_one_per_day index exists');

-- behavior: unique constraint on (user_id, created_at::date)
SELECT lives_ok(
  $$ INSERT INTO public.checkins (user_id, mood)
     VALUES ('00000000-0000-0000-0000-000000000001'::uuid, 4) $$,
  'first checkin of the day succeeds'
);

SELECT throws_ok(
  $$ INSERT INTO public.checkins (user_id, mood)
     VALUES ('00000000-0000-0000-0000-000000000001'::uuid, 5) $$,
  '23505',
  NULL,
  'second checkin same user same day fails (unique_violation 23505)'
);

SELECT lives_ok(
  $$ INSERT INTO public.checkins (user_id, mood)
     VALUES ('00000000-0000-0000-0000-000000000002'::uuid, 3) $$,
  'different user same day succeeds (per-user unique)'
);

SELECT * FROM finish();

ROLLBACK;