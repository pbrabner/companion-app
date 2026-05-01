-- migration: 0001_user_data_schema
-- purpose: Create the 7 tables that hold per-user data for the Companion MVP
--          (profiles, checkins, journal_entries, conversations, messages,
--          track_progress, user_insights) plus the unique index that enforces
--          one check-in per user per day. T-003a of the experimental pipeline.
--
-- Notes:
--   * Foreign keys to tracks_catalog are intentionally omitted here — that
--     table is created in 0002_support_schema.sql (T-003b), which then ALTERs
--     these tables to add the constraints.
--   * RLS policies are out of scope for this migration; T-004a/T-004b own
--     authorization. Tables are created with RLS disabled by default —
--     they will be enabled and policies attached in those later migrations.

-- ---------------------------------------------------------------------------
-- profiles — extends auth.users with display data + onboarding state
-- ---------------------------------------------------------------------------
CREATE TABLE public.profiles (
  id                   uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  display_name         text,
  onboarded_at         timestamptz,
  privacy_accepted_at  timestamptz,
  active_track         text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.profiles.privacy_accepted_at IS
  'Set by T-031 acceptPrivacy() when the user accepts the pilot privacy notice.';
COMMENT ON COLUMN public.profiles.active_track IS
  'Slug of the currently-active track. FK to tracks_catalog(slug) is added in 0002_support_schema.sql.';

-- ---------------------------------------------------------------------------
-- checkins — daily mood/intent capture (one per user per day, enforced below)
-- ---------------------------------------------------------------------------
CREATE TABLE public.checkins (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  mood        smallint CHECK (mood BETWEEN 1 AND 5),
  weight      text,
  focus       text,
  intent      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Index expression must be IMMUTABLE. timestamptz::date depends on the
-- session TimeZone, so we anchor the bucket to UTC explicitly. Product
-- semantics: "one check-in per UTC calendar day per user". Localized
-- display-time bucketing is the app's responsibility.
CREATE UNIQUE INDEX checkins_one_per_day
  ON public.checkins (user_id, (((created_at AT TIME ZONE 'UTC'))::date));

-- ---------------------------------------------------------------------------
-- journal_entries — guided/free-form journal text
-- ---------------------------------------------------------------------------
CREATE TABLE public.journal_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  prompt_used  text,
  body         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- conversations — Companion IA chat sessions
-- ---------------------------------------------------------------------------
CREATE TABLE public.conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  track_slug  text,
  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz
);

COMMENT ON COLUMN public.conversations.track_slug IS
  'Optional slug of the track providing context. FK to tracks_catalog(slug) added in 0002_support_schema.sql.';

-- ---------------------------------------------------------------------------
-- messages — individual user/assistant turns inside a conversation
-- ---------------------------------------------------------------------------
CREATE TABLE public.messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES public.conversations (id) ON DELETE CASCADE,
  role             text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content          text NOT NULL,
  tokens_in        int,
  tokens_out       int,
  model            text,
  safety_flag      text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.messages.safety_flag IS
  'NULL | ''caution'' | ''crisis_handoff'' — populated by the Safety Layer (T-018, T-021a).';

-- ---------------------------------------------------------------------------
-- track_progress — per-user progress through each track
-- ---------------------------------------------------------------------------
CREATE TABLE public.track_progress (
  user_id       uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  track_slug    text NOT NULL,
  current_step  int NOT NULL DEFAULT 0,
  completed_at  timestamptz,
  PRIMARY KEY (user_id, track_slug)
);

COMMENT ON COLUMN public.track_progress.track_slug IS
  'FK to tracks_catalog(slug) added in 0002_support_schema.sql.';

-- ---------------------------------------------------------------------------
-- user_insights — cached patterns regenerated by the insights job (Haiku)
-- ---------------------------------------------------------------------------
CREATE TABLE public.user_insights (
  user_id        uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  patterns_json  jsonb NOT NULL DEFAULT '[]'::jsonb,
  generated_at   timestamptz NOT NULL DEFAULT now()
);