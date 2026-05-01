-- migration: secondary_indexes_and_tz (test)
-- purpose: pgTAP assertions for mini-fix-001 — verifies that migration
--          0003_secondary_indexes.sql (a) recreates checkins_one_per_day
--          using 'America/Sao_Paulo' timezone instead of UTC (Achado 🟠-1,
--          Decisão D-12), and (b) adds 4 secondary indexes on FK columns
--          that lacked them (Achado 🟠-2). Naming convention: idx_<table>_<column>.
--
-- Source achados:
--   * 🟠-1: reviews/2026-04-30-fundacao-tecnica.md (Code Reviewer parcial 2026-04-30)
--   * 🟠-2: reviews/2026-04-30-fundacao-tecnica.md (Code Reviewer parcial 2026-04-30)
-- Decisão owner: D-12 (PROGRESS.md) — MVP é PT-BR-only, índice usa America/Sao_Paulo.

BEGIN;

SELECT plan(6);

-- 4 índices secundários em colunas FK críticas (Achado 🟠-2)
SELECT has_index(
  'public', 'messages', 'idx_messages_conversation_id',
  'idx_messages_conversation_id exists on messages.conversation_id'
);
SELECT has_index(
  'public', 'journal_entries', 'idx_journal_entries_user_id',
  'idx_journal_entries_user_id exists on journal_entries.user_id'
);
SELECT has_index(
  'public', 'conversations', 'idx_conversations_user_id',
  'idx_conversations_user_id exists on conversations.user_id'
);
SELECT has_index(
  'public', 'safety_events', 'idx_safety_events_user_id',
  'idx_safety_events_user_id exists on safety_events.user_id'
);

-- checkins_one_per_day continua existindo após DROP+CREATE (Achado 🟠-1)
SELECT has_index(
  'public', 'checkins', 'checkins_one_per_day',
  'checkins_one_per_day index still exists after DROP+CREATE'
);

-- Expressão do índice usa America/Sao_Paulo (Decisão D-12)
SELECT matches(
  (SELECT indexdef FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'checkins_one_per_day'),
  'America/Sao_Paulo',
  'checkins_one_per_day uses America/Sao_Paulo timezone (Decisão D-12)'
);

SELECT * FROM finish();

ROLLBACK;
