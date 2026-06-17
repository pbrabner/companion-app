# supabase/reconcile/

Scripts SQL **one-way** que alinham o Supabase **live** às `migrations/` quando o
live divergiu (drift conhecido — ver memória do projeto). NÃO são migrations: as
`migrations/` continuam sendo a fonte de verdade e um `db reset` a partir delas já
produz o schema correto. Estes scripts existem só para corrigir um live que ficou
para trás, e são aplicados **à mão via Supabase SQL Editor** (apply cirúrgico, NÃO
`db push` em massa).

## Convenção

- Nome: `YYYY-MM-DD-<alvo>.sql`.
- Idempotente sempre que possível (`IF NOT EXISTS` / `IF EXISTS` / guards em
  `pg_constraint` / `DROP POLICY IF EXISTS`).
- Operações destrutivas (DROP) só após um `SELECT` de backup no topo.

## Log de applies

| Data | Script | Alvo | Aplicado por |
|------|--------|------|--------------|
| 2026-06-16 | `2026-06-16-profiles-live-align.sql` | `profiles` → forma canônica (add onboarded_at/privacy_accepted_at/active_track + tracks_catalog + FK; drop timezone/notification_time/push_subscription/updated_at; RLS owner) | Pacini (SQL Editor) |
