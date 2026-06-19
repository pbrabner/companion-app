-- migration: 0010_onboarding_baseline
-- purpose: baseline emocional capturado uma vez no onboarding (mood 1-5 + áreas
--          de vida). Uma linha por user. RLS owner.
CREATE TABLE public.onboarding_baseline (
  user_id     uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  mood        smallint NOT NULL CHECK (mood BETWEEN 1 AND 5),
  life_areas  text[]   NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.onboarding_baseline ENABLE ROW LEVEL SECURITY;

CREATE POLICY owner_select ON public.onboarding_baseline
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY owner_insert ON public.onboarding_baseline
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY owner_update ON public.onboarding_baseline
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY owner_delete ON public.onboarding_baseline
  FOR DELETE USING (auth.uid() = user_id);
