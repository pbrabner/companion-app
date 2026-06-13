-- migration: 0008_journal_entries_ai_response
-- purpose: persistir resposta da IA por reflexao (feature reflections-history).
-- spec: docs/superpowers/specs/2026-06-11-reflections-history-design.md
--
-- ai_response: texto completo da resposta (so stream completo, best-effort
--   via service_role — policy service_role_update da 0006 ja cobre).
-- ai_response_at: quando a resposta foi gravada (insumo micro-memoria).
--
-- RLS: ZERO mudanca. Dono continua sem UPDATE (append-only preservado).
-- Apply no live: MANUAL via Dashboard SQL Editor (drift conhecido — ver
-- memoria project-companion-supabase-schema-drift). NAO usar db push.

ALTER TABLE public.journal_entries
  ADD COLUMN ai_response text NULL,
  ADD COLUMN ai_response_at timestamptz NULL;
