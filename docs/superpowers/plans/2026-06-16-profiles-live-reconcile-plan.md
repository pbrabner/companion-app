# Reconciliação do `profiles` live — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trazer a tabela `profiles` do Supabase live para a forma canônica das migrations (add 3 colunas + `tracks_catalog` + FK, dropar 4 colunas órfãs, RLS owner), via script idempotente aplicado à mão no live.

**Architecture:** Infra, não código. Produz um script SQL idempotente (`reconcile/`), um README de registro, e um script node de verificação. As migrations seguem como fonte de verdade — isto é um catch-up one-way do live. O DROP em live é destrutivo → aplicado por Pacini via SQL Editor (human gate); Claude nunca roda DDL destrutivo no live.

**Tech Stack:** PostgreSQL (Supabase), SQL DDL idempotente, Node 20 (fetch + PostgREST OpenAPI), service-role key.

**Spec:** `docs/superpowers/specs/2026-06-16-profiles-live-reconcile-design.md` (commit 463372d)

---

## File Structure

- **Create:** `supabase/reconcile/2026-06-16-profiles-live-align.sql` — o script idempotente (backup → tracks_catalog → colunas → FK → drops → RLS).
- **Create:** `supabase/reconcile/README.md` — registra migrations=canônico, o que é `reconcile/`, e o log deste apply.
- **Create:** `supabase/reconcile/verify-profiles.mjs` — verificação por introspecção.
- **Sem** mudança de código de produção. **Sem** nova migration.

**Estado atual do live `profiles` (lock do before — confirmado na exploração):**
colunas `{id, display_name, timezone, notification_time, push_subscription, created_at, updated_at}`; 1 linha (`id 5d8d0249-ceac-4127-8c04-52f6e28a94a9`, `display_name "pbrabner@gmail.com"`). `tracks_catalog` **não existe** no live.

---

## Task 0: Pre-flight (INLINE — controller)

**Files:** nenhum.

- [ ] **Step 1: Confirmar branch**

Run: `cd D:/companion-app && git rev-parse --abbrev-ref HEAD && git log --oneline -1`
Expected: `chore/profiles-live-reconcile`, HEAD `463372d` (spec).

- [ ] **Step 2: Re-introspectar o estado atual do live (lock do before)**

Run (de `apps/web`):
```bash
node -e '
const fs=require("fs");
const env=fs.readFileSync(".env.local","utf8");
const get=k=>{const m=env.match(new RegExp("^"+k+"=(.*)$","m"));return m?m[1].trim().replace(/^["\x27]|["\x27]$/g,""):null;};
const url=get("NEXT_PUBLIC_SUPABASE_URL"),key=get("SUPABASE_SERVICE_ROLE_KEY");
(async()=>{
  const r=await fetch(url+"/rest/v1/",{headers:{apikey:key,Authorization:"Bearer "+key}});
  const spec=await r.json();
  const p=spec.definitions&&spec.definitions.profiles;
  console.log("profiles cols:", p?Object.keys(p.properties).join(", "):"AUSENTE");
  console.log("tracks_catalog:", spec.definitions&&spec.definitions.tracks_catalog?"existe":"AUSENTE");
})().catch(e=>console.log("ERRO:",e.message));
'
```
Expected: profiles com as colunas antigas; `tracks_catalog: AUSENTE`. (Se já estiver canônico, o apply é no-op — seguir mesmo assim.)

---

## Task 1: Script SQL de reconciliação + README

**Files:**
- Create: `supabase/reconcile/2026-06-16-profiles-live-align.sql`
- Create: `supabase/reconcile/README.md`

- [ ] **Step 1: Escrever o SQL idempotente**

Conteúdo EXATO de `supabase/reconcile/2026-06-16-profiles-live-align.sql`:
```sql
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
```

- [ ] **Step 2: Escrever o README**

Conteúdo EXATO de `supabase/reconcile/README.md`:
```markdown
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
```

- [ ] **Step 3: Lint de sanidade do SQL (parse local, sem aplicar)**

Run (de `D:/companion-app`):
```bash
node -e "const s=require('fs').readFileSync('supabase/reconcile/2026-06-16-profiles-live-align.sql','utf8'); const must=['CREATE TABLE IF NOT EXISTS public.tracks_catalog','ADD COLUMN IF NOT EXISTS onboarded_at','profiles_active_track_fkey','DROP COLUMN IF EXISTS timezone','ENABLE ROW LEVEL SECURITY','owner_update']; const miss=must.filter(m=>!s.includes(m)); console.log(miss.length?'FALTA: '+miss.join(' | '):'OK: todas as âncoras presentes'); console.log('DROP POLICY count:', (s.match(/DROP POLICY IF EXISTS/g)||[]).length, '(esperado 4)');"
```
Expected: `OK: todas as âncoras presentes` e `DROP POLICY count: 4`.

- [ ] **Step 4: Commit**

```bash
cd D:/companion-app && git add supabase/reconcile/2026-06-16-profiles-live-align.sql supabase/reconcile/README.md
git commit -m "feat(reconcile): SQL idempotente profiles live -> migrations (CA-PR-1,4)"
```

---

## Task 2: Script de verificação `verify-profiles.mjs`

**Files:**
- Create: `supabase/reconcile/verify-profiles.mjs`

- [ ] **Step 1: Escrever o verificador**

Conteúdo EXATO de `supabase/reconcile/verify-profiles.mjs`:
```javascript
// Verifica que o profiles live bate com a forma canônica das migrations.
// Uso: node supabase/reconcile/verify-profiles.mjs
// Lê apps/web/.env.local (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const env = readFileSync(join(root, 'apps', 'web', '.env.local'), 'utf8');
const get = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
};
const url = get('NEXT_PUBLIC_SUPABASE_URL');
const key = get('SUPABASE_SERVICE_ROLE_KEY');
const h = { apikey: key, Authorization: 'Bearer ' + key };

const CANONICAL = [
  'id',
  'display_name',
  'onboarded_at',
  'privacy_accepted_at',
  'active_track',
  'created_at',
];

let failures = 0;
const check = (ok, label) => {
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + label);
  if (!ok) failures += 1;
};

const spec = await (await fetch(url + '/rest/v1/', { headers: h })).json();
const profiles = spec.definitions?.profiles;
const cols = profiles ? Object.keys(profiles.properties).sort() : [];
check(
  JSON.stringify(cols) === JSON.stringify([...CANONICAL].sort()),
  'profiles colunas == canônicas (got: ' + cols.join(',') + ')',
);

const tracksRes = await fetch(url + '/rest/v1/tracks_catalog?select=slug', {
  headers: { ...h, Prefer: 'count=exact' },
});
const tracks = await tracksRes.json();
check(Array.isArray(tracks) && tracks.length === 3, 'tracks_catalog tem 3 linhas (got: ' + (Array.isArray(tracks) ? tracks.length : 'erro') + ')');

const rowsRes = await fetch(url + '/rest/v1/profiles?select=id,display_name,created_at,onboarded_at', { headers: h });
const rows = await rowsRes.json();
check(Array.isArray(rows), 'select de profiles respondeu (onboarded_at acessível)');
if (Array.isArray(rows) && rows.length) {
  const r = rows[0];
  check(!!r.id && !!r.created_at, 'linha preexistente preservada (id/created_at intactos)');
  check(r.onboarded_at === null, 'onboarded_at null na linha existente (novo campo)');
}

console.log('\n' + (failures === 0 ? 'TUDO VERDE ✅' : failures + ' FALHA(S) ❌'));
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Smoke do verificador contra o estado ATUAL (deve FALHAR antes do apply)**

Run (de `D:/companion-app`): `node supabase/reconcile/verify-profiles.mjs`
Expected: **FAIL** nas checagens de colunas e de `tracks_catalog` (ainda não aplicado). Isso confirma que o verificador detecta o estado pré-apply (não é tautológico). Exit code 1.

- [ ] **Step 3: Commit**

```bash
cd D:/companion-app && git add supabase/reconcile/verify-profiles.mjs
git commit -m "test(reconcile): verificador de schema canônico do profiles (CA-PR-2)"
```

---

## Task 3: Sanity local (INLINE — controller)

**Files:** nenhum (não há mudança de código de produção; sanity de não-regressão).

- [ ] **Step 1: Suite + typecheck**

Run (de `apps/web`): `pnpm test src/middleware.test.ts && pnpm typecheck`
Expected: middleware tests verdes (mockam profiles, independem do live) e typecheck 0 erros. Confirma que nada de código mudou/quebrou.

---

## Task 4: Apply no live + verificação (HUMAN GATE ★ALTO)

**Files:** nenhum (apply manual + verificação).

- [ ] **Step 1: Pacini aplica o SQL via SQL Editor**

Pacini abre o Supabase SQL Editor do projeto "Midnight Puppies", cola o conteúdo de
`supabase/reconcile/2026-06-16-profiles-live-align.sql`, roda, e **cola aqui** a
saída do `SELECT * FROM public.profiles` (op 1, backup) e da conferência final (op 7).
Claude NÃO executa esse passo.

- [ ] **Step 2: Claude roda o verificador**

Run (de `D:/companion-app`): `node supabase/reconcile/verify-profiles.mjs`
Expected: **TUDO VERDE ✅** — colunas canônicas, `tracks_catalog` com 3 linhas,
linha preexistente preservada, `onboarded_at` acessível. Exit code 0.

- [ ] **Step 3: Re-rodar o SQL (prova de idempotência)**

Pacini roda o SQL uma 2ª vez no Editor. Expected: sem erro (todas as ops são
`IF [NOT] EXISTS` / guard / `ON CONFLICT` / `DROP POLICY IF EXISTS`). Claude roda o
verificador de novo → continua VERDE.

- [ ] **Step 4: Commit do log de evidência**

Claude cria `docs/superpowers/piloto/2026-06-16-profiles-reconcile-smoke.md` com a
saída do verify + o backup colado, e commita (path explícito).

---

## Self-Review (controller, antes de despachar)

**Spec coverage:**
- CA-PR-1 (SQL idempotente: tracks_catalog+seed, 3 colunas, FK, drops, RLS) → Task 1 ✅
- CA-PR-2 (verify confirma canônico + preservação) → Task 2 ✅
- CA-PR-3 (pós-apply: profiles==migrations, middleware select ok) → Task 4 (verify) ✅
- CA-PR-4 (README documenta canônico + log) → Task 1 Step 2 ✅
- CA-PR-5 (suite verde, types inalterado) → Task 3 ✅

**Placeholder scan:** nenhum "TBD/TODO"; SQL e JS completos e literais.

**Consistência:** nomes de coluna (`onboarded_at`, `privacy_accepted_at`,
`active_track`), constraint (`profiles_active_track_fkey`), policies (owner_*),
slugs (`disciplina`/`regulacao-emocional`/`direcao`) idênticos entre Task 1, Task 2
e a spec. O verificador (Task 2) checa exatamente o conjunto que o SQL (Task 1) produz.

**Segurança:** DROP só no live, human-gated (Task 4); backup no topo do SQL; Claude
nunca roda DDL destrutivo. Idempotência coberta no Task 4 Step 3.
