-- migration: 0002_support_schema
-- purpose: Create the 3 support tables (tracks_catalog, safety_events,
--          usage_counters), seed tracks_catalog with the 3 MVP slugs, and
--          close the 3 foreign keys to tracks_catalog that T-003a deferred
--          (profiles.active_track, conversations.track_slug,
--          track_progress.track_slug). T-003b of the experimental pipeline.
--
-- Notes:
--   * Seed uses ON CONFLICT (slug) DO NOTHING for idempotency.
--   * RLS policies are out of scope; T-004a/T-004b own authorization.
--   * Editorial content (titles/descriptions) is placeholder; final copy
--     is the owner's responsibility (Orchestrator Decisão §2). steps_total
--     hardcoded at 3, aligned with the 3 MDX placeholders T-016 will produce.

-- ---------------------------------------------------------------------------
-- tracks_catalog — referência ao conteúdo MDX (hardcoded, 3 trilhas no MVP)
-- ---------------------------------------------------------------------------
CREATE TABLE public.tracks_catalog (
  slug         text PRIMARY KEY,
  title        text NOT NULL,
  description  text NOT NULL,
  steps_total  int  NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- safety_events — auditoria de decisões da Safety Layer (insert via service_role)
-- ---------------------------------------------------------------------------
CREATE TABLE public.safety_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  trigger_text  text NOT NULL,
  classifier    text,
  action_taken  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.safety_events IS
  'Auditoria ética da Safety Layer (T-018, T-021a). Apenas usuário e admin (futuro) leem; insert via service_role.';
COMMENT ON COLUMN public.safety_events.action_taken IS
  '''handoff'' | ''caution_response'' — ação tomada pela Safety Layer.';

-- ---------------------------------------------------------------------------
-- usage_counters — rate limit horário (hard, custo) + diário soft (anti-dependência)
-- ---------------------------------------------------------------------------
CREATE TABLE public.usage_counters (
  user_id          uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  day_bucket       date NOT NULL,
  hour_bucket      timestamptz NOT NULL,
  chat_msgs_day    int  NOT NULL DEFAULT 0,
  chat_msgs_hour   int  NOT NULL DEFAULT 0,
  last_warning_at  timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day_bucket)
);

COMMENT ON TABLE public.usage_counters IS
  'Architecture A5 / T-019. Uma linha por user-dia (UTC). hour_bucket guarda a hora UTC corrente para reset do contador horário.';

-- ---------------------------------------------------------------------------
-- Seed: 3 trilhas iniciais do MVP (Decisão §2 do Orchestrator: Pacini é owner do conteúdo)
-- ---------------------------------------------------------------------------
INSERT INTO public.tracks_catalog (slug, title, description, steps_total)
VALUES
  ('disciplina',
   'Disciplina',
   'Construir consistência de pequenas ações que sustentam progresso visível ao longo do tempo. Sair do ciclo empolgação→queda.',
   3),
  ('regulacao-emocional',
   'Regulação Emocional',
   'Nomear o que se sente, separar fato de impulso, responder com clareza ao invés de reagir. Reduzir o ruído interno.',
   3),
  ('direcao',
   'Direção',
   'Trazer foco para o que importa de fato. Identificar próximos passos concretos e remover atritos contra eles.',
   3)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Close 3 FKs deferred by T-003a, now that tracks_catalog exists
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_active_track_fkey
  FOREIGN KEY (active_track) REFERENCES public.tracks_catalog (slug);

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_track_slug_fkey
  FOREIGN KEY (track_slug) REFERENCES public.tracks_catalog (slug);

ALTER TABLE public.track_progress
  ADD CONSTRAINT track_progress_track_slug_fkey
  FOREIGN KEY (track_slug) REFERENCES public.tracks_catalog (slug);