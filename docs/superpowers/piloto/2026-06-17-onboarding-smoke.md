# Evidência — Onboarding (CA-OB-1)

**Data:** 2026-06-17
**Operador:** Pacini (apply via Supabase SQL Editor)
**Live:** "Midnight Puppies" (ref `fvdmhnxmheblvsdgjoyp`)
**Migration:** `supabase/migrations/0010_onboarding_baseline.sql`

## Apply

Pacini aplicou a migration 0010 no live via SQL Editor (additivo: CREATE TABLE +
RLS owner, sem risco).

## Verificação (`node supabase/reconcile/verify-onboarding-baseline.mjs`)

```
PASS — colunas == created_at,life_areas,mood,user_id (got: created_at,life_areas,mood,user_id)

TUDO VERDE ✅
```

## Resultado

`onboarding_baseline` existe no live com as 4 colunas canônicas. O `POST
/api/onboarding` e o wizard `/onboarding` (PR #16) operam contra a tabela real.
Pré-checks do ciclo: 151 pass, typecheck 0, build limpo; review final APPROVED.

## Smoke E2E (opcional, pós-merge)

Login com conta não-onboardada → middleware → `/onboarding` → completar wizard →
`/reflect`; conferir `profiles.onboarded_at` setado + 1 linha em `onboarding_baseline`.
