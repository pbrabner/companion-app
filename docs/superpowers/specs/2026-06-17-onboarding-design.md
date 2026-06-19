# Onboarding — privacidade → trilha → baseline — Design

**Data:** 2026-06-17
**Operador:** Pacini
**Repo:** D:/companion-app (`apps/web`)
**Branch:** `feat/onboarding`

## Problema

O middleware (T-007) já redireciona usuário autenticado sem `profiles.onboarded_at`
para `/onboarding`, mas **a rota `/onboarding` não existe** e o gate só cobre `/app`
(que também não existe). O `profiles` tem `onboarded_at`/`privacy_accepted_at`/
`active_track` (reconciliado no PR #14) e o `tracks_catalog` tem 3 trilhas semeadas,
mas falta o fluxo que coleta esses dados e marca o usuário como onboardado. Sem ele,
não há porta de entrada estruturada para o produto.

## Objetivo

Um wizard `/onboarding` de 3 passos — **privacidade → trilha → baseline** — que, ao
final, grava os dados e marca `onboarded_at`, liberando o usuário para `/reflect`.
O middleware passa a exigir onboarding antes do produto real (`/reflect`,
`/reflections`).

## Decisões (aprovadas no brainstorm)

- Coleta v1: privacidade + trilha + **baseline emocional** (humor 1-5 + áreas de vida).
- Gate cobre o **produto real** (`/reflect`/`/reflections`/`/app`), não só `/app`
  (alinha ao PRD 2026-05-02 linha 88: "/reflect é o landing pós-onboarding").
- **Single-submit atômico:** o wizard mantém estado no cliente e grava tudo numa
  server action no passo final. Abandono no meio não persiste nada → `onboarded_at`
  continua null → re-gateado.

## Não-objetivos (YAGNI)

- Editar/revisitar onboarding depois de concluído (sem tela de "refazer").
- Áreas de vida como tabela configurável (lista fixa em constante).
- Tela de baseline histórico / comparação ao longo do tempo.
- Coletar mais que humor + áreas no baseline.

## Modelo de dados

**`profiles`** (colunas já existentes): o wizard grava `privacy_accepted_at`,
`active_track` e, por último, `onboarded_at`.

**Nova tabela `public.onboarding_baseline`** (migration `0010_onboarding_baseline.sql`):
```sql
CREATE TABLE public.onboarding_baseline (
  user_id     uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  mood        smallint NOT NULL CHECK (mood BETWEEN 1 AND 5),
  life_areas  text[]   NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.onboarding_baseline ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_select ON public.onboarding_baseline FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY owner_insert ON public.onboarding_baseline FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY owner_update ON public.onboarding_baseline FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY owner_delete ON public.onboarding_baseline FOR DELETE USING (auth.uid() = user_id);
```
Aplicada ao live por Pacini via SQL Editor (additivo, sem risco — padrão dos PRs
0008/0009). `types.ts` regenerado depois (ou estendido à mão consistente com a
migration).

**Lista fixa de áreas** — `apps/web/src/app/onboarding/life-areas.ts`:
```ts
export const LIFE_AREAS = [
  { slug: 'trabalho', label: 'Trabalho' },
  { slug: 'relacionamentos', label: 'Relacionamentos' },
  { slug: 'saude-fisica', label: 'Saúde física' },
  { slug: 'saude-emocional', label: 'Saúde emocional' },
  { slug: 'proposito', label: 'Propósito / sentido' },
  { slug: 'financas', label: 'Finanças' },
  { slug: 'descanso', label: 'Descanso / lazer' },
] as const;
export const LIFE_AREA_SLUGS = LIFE_AREAS.map((a) => a.slug);
```

## Arquitetura

### Rota `/onboarding` (server component + client wizard)
- `app/onboarding/page.tsx` (server): auth check; carrega `tracks_catalog` (slug,
  title, description) via session client; passa pro client wizard. Se já onboardado,
  redireciona pra `/reflect` (evita refazer).
- `app/onboarding/OnboardingWizard.tsx` (client): máquina de estado de 3 passos
  (`privacy` → `track` → `baseline`), Avançar/Voltar, estado acumulado
  `{ accepted: boolean; track: string | null; mood: number | null; areas: string[] }`.
  Submit final → `fetch POST /api/onboarding` → em sucesso `router.push('/reflect')`;
  em erro → toast. (API route, não server action — consistente com `/api/reflect`,
  mais testável no padrão do projeto.)

### Persistência — `POST /api/onboarding` (`app/api/onboarding/route.ts`)
1. Auth → 401 se sem sessão.
2. Parse + valida: `accepted === true`; `track` ∈ slugs do `tracks_catalog`;
   `mood` inteiro 1-5; `areas` ⊆ `LIFE_AREA_SLUGS` e `length ≥ 1`. Inválido → 400
   com `error` tipado.
3. Já onboardado (`profiles.onboarded_at` não-null) → 409 `already_onboarded`.
4. Grava (RLS owner, session client):
   - `INSERT onboarding_baseline { user_id, mood, life_areas }` (upsert por PK pra
     idempotência defensiva).
   - `UPDATE profiles SET privacy_accepted_at = now(), active_track = <track>,
     onboarded_at = now() WHERE id = user_id`.
   - Se o update do profiles falhar → 500 (o baseline órfão é tolerável; sem
     `onboarded_at` o user é re-gateado e o upsert reescreve).
5. 200 `{ ok: true }`.

> Ordem: baseline primeiro, profiles (com `onboarded_at`) por último — o
> `onboarded_at` é o commit lógico do onboarding.

### Middleware (gate)
Generalizar o gate de onboarding: hoje só `pathname.startsWith('/app')`. Passar a
cobrir as rotas de produto. Definir `ONBOARDING_GATED_PREFIXES = ['/app', '/reflect',
'/reflections']`; para usuário autenticado, se o pathname casa um prefixo gated **e**
não é `/onboarding`, checar `profiles.onboarded_at`; se null → redirect `/onboarding`.
`/onboarding` nunca é gateado por onboarding (evita loop), mas exige sessão (já
coberto pelo gate de auth). Rotas públicas inalteradas.

### Landing pós-login
`app/auth/callback/route.ts`: trocar o redirect final de `${origin}/` para
`${origin}/reflect`. O middleware desvia pra `/onboarding` se `onboarded_at` null.
Fecha login → onboarding → reflect.

## Privacy gate (★ALTO)

O baseline (mood/áreas) é dado pessoal, mas não é "conteúdo de reflexão" emocional
livre. Ainda assim: a server action **nunca** loga mood/áreas/track — só metadata
(`user_id`, `error_code` = classe). Sem telemetria third-party. O aviso de
privacidade na tela 1 reflete o contrato: reflexões ficam só no banco do usuário,
nada vai pra analytics externa.

## Tratamento de erros

| Cenário | Resposta |
|---|---|
| Sem sessão na action | 401 `unauthenticated` |
| Payload inválido (mood/track/áreas/accepted) | 400 `invalid_input` |
| Já onboardado | 409 `already_onboarded` |
| Falha ao gravar profiles | 500 `persistence_failed` |
| Sucesso | 200 `{ ok: true }` → client redireciona `/reflect` |

## Testes

**Migration:** apply + verify no live (script de verificação como no PR #14:
`onboarding_baseline` existe com as colunas + RLS).

**`POST /api/onboarding`** (`route.test.ts`, `@vitest-environment node`): 401 sem
sessão; 400 mood fora de 1-5; 400 track fora do catálogo; 400 área inválida; 400 sem
área; 409 already_onboarded; happy → upsert baseline + update profiles com os 3
campos; ★ALTO privacy (mood/áreas/track nunca em log via sentinel).

**Middleware** (`middleware.test.ts`, estende o existente): autenticado não-onboardado
em `/reflect` → 307 `/onboarding`; autenticado não-onboardado em `/onboarding` →
passthrough (sem loop); onboardado em `/reflect` → passthrough.

**Wizard** (`OnboardingWizard.test.tsx`): navegação 3 passos; não avança sem aceitar
privacidade / sem escolher trilha / sem humor / sem ≥1 área; submit chama a API com o
payload acumulado e redireciona em sucesso; toast em erro.

## Critérios de aceite

- **CA-OB-1:** migration `0010_onboarding_baseline` cria a tabela + RLS owner;
  aplicada e verificada no live.
- **CA-OB-2:** `POST /api/onboarding` valida (mood/track/áreas/accepted),
  401/400/409/500/200, grava baseline + os 3 campos do profiles.
- **CA-OB-3:** middleware redireciona não-onboardado das rotas de produto pra
  `/onboarding`, sem gatear o próprio `/onboarding`.
- **CA-OB-4:** wizard de 3 passos com validação por passo; submit único atômico;
  redireciona `/reflect`.
- **CA-OB-5:** `/auth/callback` passa a landar em `/reflect`.
- **CA-OB-6:** privacy — nenhum mood/área/track/conteúdo em log; só metadata.
- **CA-OB-7:** suite verde, typecheck + build limpos.
