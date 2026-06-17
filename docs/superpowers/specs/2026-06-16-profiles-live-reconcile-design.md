# Reconciliação do `profiles` live ↔ migrations — Design

**Data:** 2026-06-16
**Operador:** Pacini
**Repo:** D:/companion-app
**Branch:** `chore/profiles-live-reconcile`
**Supabase live:** "Midnight Puppies" (ref `fvdmhnxmheblvsdgjoyp`)

## Problema

A tabela `profiles` no Supabase live diverge **estruturalmente** das migrations do
repo. As migrations (fonte de verdade, alvo do código) definem:

- `id, display_name, onboarded_at, privacy_accepted_at, active_track, created_at`
  (migration 0001)
- FK `active_track → tracks_catalog(slug)` (migration 0002)
- RLS owner_select/insert/update/delete keyed em `id = auth.uid()` (migration 0004)

O live, porém, tem `id, display_name, timezone, notification_time,
push_subscription, created_at, updated_at` — colunas de notificação/push que **não
existem em migration nenhuma e não são referenciadas por código no `src`**. E
**falta** as 3 colunas que o código precisa.

**Risco concreto:** `middleware.ts:73-78` faz `.from('profiles').select('onboarded_at')`
para gatear `/app` → `/onboarding`. Contra o live atual isso **quebra** (coluna
inexistente). Onboarding e `/app/*` não podem entrar até `profiles` ser reconciliada.

**Confirmado por Pacini:** o projeto live é exclusivo do Companion; as colunas
extras e as tabelas órfãs (`habits`, `daily_checkins`, `reflections`, `adjustments`,
`final_reviews`, `user_commitments`, `event_logs`) são resíduo de um protótipo
antigo — podem ser tratadas como lixo.

## Decisão de fonte de verdade

**As migrations são canônicas e já estão corretas.** Um `supabase db reset` a
partir das migrations produz o `profiles` certo. Portanto isto **não é uma nova
migration** (adicionar uma migration que ALTERa colunas que o 0001 já define seria
incoerente contra um DB novo). É um **catch-up one-way do live**, registrado como
script de reconciliação e aplicado à mão via SQL Editor (apply cirúrgico — o
padrão estabelecido para o drift conhecido, NÃO `db push` em massa).

## Escopo (Opção B — profiles canônico completo)

Reconciliar `profiles` para a forma canônica das migrations, incluindo sua única
dependência declarada (`tracks_catalog` + a FK). **Fora de escopo:** dropar as 7
tabelas órfãs (follow-up separado).

## Artefatos

1. `supabase/reconcile/2026-06-16-profiles-live-align.sql` — script idempotente.
2. `supabase/reconcile/README.md` — registra: migrations = canônico; `reconcile/`
   = catch-ups one-way aplicados à mão no live; documenta este apply e seu motivo.
3. `supabase/reconcile/verify-profiles.mjs` — script node de verificação por
   introspecção (PostgREST OpenAPI + selects com service role).

## O SQL — operações (ordem importa pela FK)

1. **Backup defensivo:** `SELECT *` da(s) linha(s) atuais de `profiles` (inclui as
   colunas a dropar) — a saída no SQL Editor serve de rollback manual antes de
   qualquer DROP.
2. `CREATE TABLE IF NOT EXISTS public.tracks_catalog (slug text PRIMARY KEY, title
   text NOT NULL, description text NOT NULL, steps_total int NOT NULL, created_at
   timestamptz NOT NULL DEFAULT now())` — igual 0002. Seed com `INSERT ... VALUES
   ('disciplina',...),('regulacao-emocional',...),('direcao',...) ON CONFLICT
   (slug) DO NOTHING` (títulos/descrições copiados literalmente do 0002).
3. `ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS onboarded_at timestamptz`;
   idem `privacy_accepted_at timestamptz`, `active_track text`.
4. Adicionar a FK `profiles_active_track_fkey (active_track → tracks_catalog.slug)`,
   guardada por checagem de existência em `pg_constraint` (idempotência). A(s)
   linha(s) atual(is) têm `active_track` null → adição segura.
5. `ALTER TABLE public.profiles DROP COLUMN IF EXISTS timezone`,
   `notification_time`, `push_subscription`, `updated_at` — as 4 órfãs.

## RLS idempotente

`ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY`. Para cada policy
(owner_select FOR SELECT USING `auth.uid() = id`; owner_insert FOR INSERT WITH
CHECK `auth.uid() = id`; owner_update FOR UPDATE USING+WITH CHECK `auth.uid() =
id`; owner_delete FOR DELETE USING `auth.uid() = id`): `DROP POLICY IF EXISTS <n>
ON public.profiles; CREATE POLICY <n> ...`. Garante o estado das migrations
independente do que o live tem hoje (onboarding escreve `profiles` sob a sessão do
user → RLS owner obrigatória).

## Verificação (`verify-profiles.mjs`)

- Colunas de `profiles` no live == exatamente `{id, display_name, onboarded_at,
  privacy_accepted_at, active_track, created_at}` (nenhuma a mais, nenhuma a menos).
- `tracks_catalog` existe com 3 linhas (`disciplina`, `regulacao-emocional`,
  `direcao`).
- A(s) linha(s) preexistente(s) de `profiles` preservada(s): `id`, `display_name`,
  `created_at` intactos; `onboarded_at`/`privacy_accepted_at`/`active_track` null.
- Smoke: `.from('profiles').select('onboarded_at').limit(1)` no live responde sem
  erro (o que o `middleware.ts` faz).
- Suite local verde (middleware.test mocka profiles — sem mudança de código).
- `types.ts` inalterado (já bate com as migrations).

## Modelo de apply (human gate ★ALTO)

DROP de coluna em live é destrutivo e difícil de reverter. Fluxo:
1. Claude produz o SQL e o verify; review independente do SQL (correção,
   idempotência, ordem, segurança).
2. **Pacini aplica o SQL via SQL Editor** e cola a saída do backup + resultado.
3. Claude roda `verify-profiles.mjs` e confirma o estado canônico.

Claude **não** executa DDL destrutivo no live por conta própria.

## Critérios de aceite

- **CA-PR-1:** script SQL idempotente cria+semeia `tracks_catalog`, adiciona as 3
  colunas + FK, dropa as 4 órfãs, e garante RLS owner — rodável 2x sem erro.
- **CA-PR-2:** `verify-profiles.mjs` confirma o schema canônico e a preservação da
  linha existente.
- **CA-PR-3:** após o apply, `profiles` live == migrations; `middleware` select de
  `onboarded_at` responde sem erro.
- **CA-PR-4:** README documenta migrations=canônico e o registro do apply.
- **CA-PR-5:** suite local verde; `types.ts` inalterado.
