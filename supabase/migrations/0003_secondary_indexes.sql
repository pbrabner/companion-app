-- migration: 0003_secondary_indexes
-- purpose: timezone fix on checkins_one_per_day (UTC -> America/Sao_Paulo, Decision D-12) + 4 secondary indexes on FK columns from review parcial 2026-04-30 achados 🟠-1, 🟠-2

DROP INDEX IF EXISTS public.checkins_one_per_day;
CREATE UNIQUE INDEX checkins_one_per_day ON public.checkins (user_id, ((created_at AT TIME ZONE 'America/Sao_Paulo')::date));
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON public.messages (conversation_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_user_id ON public.journal_entries (user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON public.conversations (user_id);
CREATE INDEX IF NOT EXISTS idx_safety_events_user_id ON public.safety_events (user_id);
