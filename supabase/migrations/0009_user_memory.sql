-- migration: 0009_user_memory
-- purpose: micro-memoria cumulativa de findings da IA por usuario (slice A).
-- spec: docs/superpowers/specs/2026-06-11-micro-memory-design.md
-- Apply no live: MANUAL via SQL Editor (drift conhecido). NAO db push.
CREATE TABLE public.user_memory (
  user_id             uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  findings            jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_synthesized_at timestamptz NULL,
  source_count        integer NOT NULL DEFAULT 0,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY owner_select ON public.user_memory
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY owner_insert ON public.user_memory
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY owner_update ON public.user_memory
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY owner_delete ON public.user_memory
  FOR DELETE TO authenticated USING (user_id = auth.uid());
