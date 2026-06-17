# Evidência — Reconciliação do `profiles` live (CA-PR-2/3)

**Data:** 2026-06-16
**Operador:** Pacini (apply via Supabase SQL Editor)
**Live:** "Midnight Puppies" (ref `fvdmhnxmheblvsdgjoyp`)
**Script:** `supabase/reconcile/2026-06-16-profiles-live-align.sql`

## Backup pré-apply (op 1 — `SELECT * FROM public.profiles`)

1 linha, capturada antes dos DROPs (rollback manual disponível):

```
id           = 5d8d0249-ceac-4127-8c04-52f6e28a94a9
display_name = pbrabner@gmail.com
created_at   = 2026-05-29 00:55:02.708479+00
onboarded_at, privacy_accepted_at, active_track = NULL
```
(As colunas órfãs dropadas — timezone='America/Sao_Paulo', notification_time='20:00:00',
push_subscription=null, updated_at='2026-05-29...' — constam do estado pré-apply
registrado na exploração; confirmadas lixo por Pacini.)

## Colunas pós-apply (op 7)

```
id                   uuid
display_name         text
created_at           timestamp with time zone
onboarded_at         timestamp with time zone
privacy_accepted_at  timestamp with time zone
active_track         text
```
Exatamente a forma canônica das migrations (0001). `tracks_catalog` criada (visível
no Table Editor) e semeada com 3 slugs.

## Verificação (`node supabase/reconcile/verify-profiles.mjs`)

```
PASS — profiles colunas == canônicas (got: active_track,created_at,display_name,id,onboarded_at,privacy_accepted_at)
PASS — tracks_catalog tem 3 linhas (got: 3)
PASS — select de profiles respondeu (onboarded_at acessível)
PASS — linha preexistente preservada (id/created_at intactos)
PASS — onboarded_at null na linha existente (novo campo)

TUDO VERDE ✅
```

## Resultado

`profiles` live == migrations. O `middleware.ts` `.select('onboarded_at')` agora
responde sem erro — onboarding e `/app/*` destravados. Fonte de verdade: migrations.
