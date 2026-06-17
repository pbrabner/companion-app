-- =====================================================================
-- Reconciliação one-way: profiles (live "Midnight Puppies") -> migrations
-- Fonte de verdade: supabase/migrations/0001+0002+0004. NÃO é migration.
-- Aplicar via Supabase SQL Editor (Pacini). Idempotente: rodável 2x.
-- Spec: docs/superpowers/specs/2026-06-16-profiles-live-reconcile-design.md
-- =====================================================================

-- (1) BACKUP DEFENSIVO — copie a saída ANTES de prosseguir (rollback manual).
SELECT * FROM public.profiles;

-- (2) tracks_catalog (igual migration 0002) + seed dos 3 slugs MVP.
CREATE TABLE IF NOT EXISTS public.tracks_catalog (
  slug         text PRIMARY KEY,
  title        text NOT NULL,
  description  text NOT NULL,
  steps_total  int  NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

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

-- (3) Colunas canônicas que faltam no live.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS onboarded_at        timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS privacy_accepted_at timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS active_track        text;

-- (4) FK active_track -> tracks_catalog(slug), guardada por pg_constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_active_track_fkey'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_active_track_fkey
      FOREIGN KEY (active_track) REFERENCES public.tracks_catalog (slug);
  END IF;
END $$;

-- (5) Dropar as 4 colunas órfãs (resíduo de protótipo — confirmado lixo por Pacini).
ALTER TABLE public.profiles DROP COLUMN IF EXISTS timezone;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS notification_time;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS push_subscription;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS updated_at;

-- (6) RLS owner (igual migration 0004), idempotente.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS owner_select ON public.profiles;
CREATE POLICY owner_select ON public.profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS owner_insert ON public.profiles;
CREATE POLICY owner_insert ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS owner_update ON public.profiles;
CREATE POLICY owner_update ON public.profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS owner_delete ON public.profiles;
CREATE POLICY owner_delete ON public.profiles
  FOR DELETE USING (auth.uid() = id);

-- (7) Conferência rápida no próprio Editor.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'profiles'
ORDER BY ordinal_position;
