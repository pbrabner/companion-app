-- migration: schema_support (test)
-- purpose: pgTAP assertions for the 3 support tables created by
--          0002_support_schema.sql (T-003b): tracks_catalog, safety_events,
--          usage_counters. Validates structure, the 3-row seed of
--          tracks_catalog, and the 3 ALTER TABLE FKs that close
--          carry-over from T-003a (profiles.active_track,
--          conversations.track_slug, track_progress.track_slug).

BEGIN;

SELECT plan(17);

-- 3 support tables exist
SELECT has_table('public', 'tracks_catalog', 'tracks_catalog table exists');
SELECT has_table('public', 'safety_events', 'safety_events table exists');
SELECT has_table('public', 'usage_counters', 'usage_counters table exists');

-- key columns of tracks_catalog
SELECT has_column('public', 'tracks_catalog', 'slug', 'tracks_catalog.slug exists');
SELECT has_column('public', 'tracks_catalog', 'title', 'tracks_catalog.title exists');
SELECT has_column('public', 'tracks_catalog', 'steps_total', 'tracks_catalog.steps_total exists');

-- key columns of safety_events (per EDD, no conversation_id/message_id)
SELECT has_column('public', 'safety_events', 'user_id', 'safety_events.user_id exists');
SELECT has_column('public', 'safety_events', 'trigger_text', 'safety_events.trigger_text exists');

-- key columns of usage_counters (per Architecture A5 + T-019 backlog hour bucket)
SELECT has_column('public', 'usage_counters', 'day_bucket', 'usage_counters.day_bucket exists');
SELECT has_column('public', 'usage_counters', 'chat_msgs_day', 'usage_counters.chat_msgs_day exists');
SELECT has_column('public', 'usage_counters', 'chat_msgs_hour', 'usage_counters.chat_msgs_hour exists');
SELECT has_column('public', 'usage_counters', 'last_warning_at', 'usage_counters.last_warning_at exists');

-- seed: tracks_catalog populated with exactly 3 rows
SELECT is(
  (SELECT count(*)::int FROM public.tracks_catalog),
  3,
  'tracks_catalog seed inserts exactly 3 rows'
);

-- seed: alphabetical slugs match expected set
SELECT results_eq(
  $$ SELECT slug FROM public.tracks_catalog ORDER BY slug $$,
  $$ VALUES ('direcao'), ('disciplina'), ('regulacao-emocional') $$,
  'tracks_catalog slugs are direcao | disciplina | regulacao-emocional'
);

-- 3 FKs deferred from T-003a, closed by ALTER TABLE in 0002
SELECT fk_ok(
  'public', 'profiles', 'active_track',
  'public', 'tracks_catalog', 'slug',
  'profiles.active_track has FK to tracks_catalog(slug)'
);
SELECT fk_ok(
  'public', 'conversations', 'track_slug',
  'public', 'tracks_catalog', 'slug',
  'conversations.track_slug has FK to tracks_catalog(slug)'
);
SELECT fk_ok(
  'public', 'track_progress', 'track_slug',
  'public', 'tracks_catalog', 'slug',
  'track_progress.track_slug has FK to tracks_catalog(slug)'
);

SELECT * FROM finish();

ROLLBACK;