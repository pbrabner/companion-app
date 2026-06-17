# Onboarding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wizard `/onboarding` de 3 passos (privacidade → trilha → baseline) que grava os dados, marca `onboarded_at` e libera o usuário pra `/reflect`; o middleware passa a exigir onboarding antes do produto.

**Architecture:** Migration nova (`onboarding_baseline`) + `POST /api/onboarding` (single-submit atômico, RLS owner) + generalização do gate no middleware + redirect de landing. UI com o design-system existente (Card/Checkbox/Button). Apply da migration no live é human-gated.

**Tech Stack:** Next.js 15.5 (App Router, Server Components, client wizard), React 19, Supabase (@supabase/ssr), Vitest 2 + Testing Library 16, pnpm.

**Spec:** `docs/superpowers/specs/2026-06-17-onboarding-design.md`

**Comandos `pnpm`** rodam de `D:/companion-app/apps/web`.

---

## File Structure

- **Create:** `supabase/migrations/0010_onboarding_baseline.sql`
- **Modify:** `apps/web/src/shared/db/types.ts` (+ tipo `onboarding_baseline`)
- **Create:** `apps/web/src/app/onboarding/life-areas.ts` (constante)
- **Create:** `apps/web/src/app/api/onboarding/route.ts` (+ `route.test.ts`)
- **Modify:** `apps/web/src/middleware.ts` (+ `middleware.test.ts`)
- **Modify:** `apps/web/src/app/auth/callback/route.ts`
- **Create:** `apps/web/src/app/onboarding/page.tsx`, `OnboardingWizard.tsx` (+ `OnboardingWizard.test.tsx`)
- **Create:** `supabase/reconcile/verify-onboarding-baseline.mjs` (verificação do live)

---

## Task 0: Pre-flight (INLINE — controller)

- [ ] **Step 1: Branch + baseline**

Run: `cd D:/companion-app && git rev-parse --abbrev-ref HEAD` → `feat/onboarding`.
Run (de `apps/web`): `pnpm test src/middleware.test.ts && pnpm typecheck` → verde, 0 erros.

---

## Task 1: Migration + tipo + constante de áreas

**Files:**
- Create: `supabase/migrations/0010_onboarding_baseline.sql`
- Modify: `apps/web/src/shared/db/types.ts`
- Create: `apps/web/src/app/onboarding/life-areas.ts`

- [ ] **Step 1: Criar a migration**

`supabase/migrations/0010_onboarding_baseline.sql`:
```sql
-- migration: 0010_onboarding_baseline
-- purpose: baseline emocional capturado uma vez no onboarding (mood 1-5 + áreas
--          de vida). Uma linha por user. RLS owner.
CREATE TABLE public.onboarding_baseline (
  user_id     uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  mood        smallint NOT NULL CHECK (mood BETWEEN 1 AND 5),
  life_areas  text[]   NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.onboarding_baseline ENABLE ROW LEVEL SECURITY;

CREATE POLICY owner_select ON public.onboarding_baseline
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY owner_insert ON public.onboarding_baseline
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY owner_update ON public.onboarding_baseline
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY owner_delete ON public.onboarding_baseline
  FOR DELETE USING (auth.uid() = user_id);
```

- [ ] **Step 2: Adicionar o tipo em types.ts**

Em `apps/web/src/shared/db/types.ts`, logo após o bloco `user_memory: { ... }` (que termina com `Relationships: []\n      }`) e ANTES do `}` que fecha `Tables`, inserir:
```ts
      onboarding_baseline: {
        Row: {
          created_at: string
          life_areas: string[]
          mood: number
          user_id: string
        }
        Insert: {
          created_at?: string
          life_areas?: string[]
          mood: number
          user_id: string
        }
        Update: {
          created_at?: string
          life_areas?: string[]
          mood?: number
          user_id?: string
        }
        Relationships: []
      }
```

- [ ] **Step 3: Criar a constante de áreas**

`apps/web/src/app/onboarding/life-areas.ts`:
```ts
/**
 * Lista fixa de áreas de vida oferecidas no baseline do onboarding.
 * Slugs persistidos em onboarding_baseline.life_areas; labels só pra UI.
 * @module app/onboarding/life-areas
 */
export const LIFE_AREAS = [
  { slug: 'trabalho', label: 'Trabalho' },
  { slug: 'relacionamentos', label: 'Relacionamentos' },
  { slug: 'saude-fisica', label: 'Saúde física' },
  { slug: 'saude-emocional', label: 'Saúde emocional' },
  { slug: 'proposito', label: 'Propósito / sentido' },
  { slug: 'financas', label: 'Finanças' },
  { slug: 'descanso', label: 'Descanso / lazer' },
] as const;

export const LIFE_AREA_SLUGS: string[] = LIFE_AREAS.map((a) => a.slug);
```

- [ ] **Step 4: Typecheck + commit**

Run (de `apps/web`): `pnpm typecheck` → 0 erros.
```bash
cd D:/companion-app && git add supabase/migrations/0010_onboarding_baseline.sql apps/web/src/shared/db/types.ts apps/web/src/app/onboarding/life-areas.ts
git commit -m "feat(db): migration 0010 onboarding_baseline + tipo + áreas (CA-OB-1)"
```

---

## Task 2: `POST /api/onboarding`

**Files:**
- Create: `apps/web/src/app/api/onboarding/route.ts`
- Test: `apps/web/src/app/api/onboarding/route.test.ts`

- [ ] **Step 1: Escrever os testes que falham**

`apps/web/src/app/api/onboarding/route.test.ts`:
```ts
/**
 * Tests do POST /api/onboarding. Mocka @/shared/db/server. Sem rede/DB real.
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

let getUserResult: { data: { user: { id: string } | null }; error: unknown } = {
  data: { user: null },
  error: null,
};
let profileRow: { data: { onboarded_at: string | null } | null; error: unknown } = {
  data: { onboarded_at: null },
  error: null,
};
let tracksRows: { data: Array<{ slug: string }> | null; error: unknown } = {
  data: [{ slug: 'disciplina' }, { slug: 'regulacao-emocional' }, { slug: 'direcao' }],
  error: null,
};
let baselineUpsertResult: { error: { code?: string } | null } = { error: null };
let profileUpdateResult: { error: { code?: string } | null } = { error: null };

const getUserMock = vi.fn();
const fromMock = vi.fn();
const baselineUpsertMock = vi.fn();
const profileUpdateMock = vi.fn();
const profileEqMock = vi.fn();

vi.mock('@/shared/db/server', () => ({
  createServerClient: vi.fn(async () => ({ auth: { getUser: getUserMock }, from: fromMock })),
}));

function makeReq(body: unknown): Request {
  return new Request('http://localhost:3000/api/onboarding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const VALID = { accepted: true, track: 'disciplina', mood: 4, areas: ['trabalho', 'descanso'] };

beforeEach(() => {
  vi.clearAllMocks();
  getUserResult = { data: { user: null }, error: null };
  profileRow = { data: { onboarded_at: null }, error: null };
  tracksRows = { data: [{ slug: 'disciplina' }, { slug: 'regulacao-emocional' }, { slug: 'direcao' }], error: null };
  baselineUpsertResult = { error: null };
  profileUpdateResult = { error: null };
  getUserMock.mockImplementation(async () => getUserResult);
  fromMock.mockImplementation((table: string) => {
    if (table === 'tracks_catalog') {
      return { select: () => Promise.resolve(tracksRows) };
    }
    if (table === 'onboarding_baseline') {
      return { upsert: baselineUpsertMock.mockImplementation(async () => baselineUpsertResult) };
    }
    // profiles: read (select/eq/maybeSingle) e write (update/eq)
    return {
      select: () => ({ eq: () => ({ maybeSingle: async () => profileRow }) }),
      update: profileUpdateMock.mockImplementation(() => ({
        eq: profileEqMock.mockImplementation(async () => profileUpdateResult),
      })),
    };
  });
});

describe('POST /api/onboarding', () => {
  it('401 sem sessão', async () => {
    const { POST } = await import('./route');
    expect((await POST(makeReq(VALID))).status).toBe(401);
  });

  it('400 mood fora de 1-5', async () => {
    getUserResult = { data: { user: { id: 'u1' } }, error: null };
    const { POST } = await import('./route');
    expect((await POST(makeReq({ ...VALID, mood: 7 }))).status).toBe(400);
    expect((await POST(makeReq({ ...VALID, mood: 0 }))).status).toBe(400);
  });

  it('400 track fora do catálogo', async () => {
    getUserResult = { data: { user: { id: 'u1' } }, error: null };
    const { POST } = await import('./route');
    expect((await POST(makeReq({ ...VALID, track: 'inexistente' }))).status).toBe(400);
  });

  it('400 área inválida ou lista vazia', async () => {
    getUserResult = { data: { user: { id: 'u1' } }, error: null };
    const { POST } = await import('./route');
    expect((await POST(makeReq({ ...VALID, areas: ['xxx'] }))).status).toBe(400);
    expect((await POST(makeReq({ ...VALID, areas: [] }))).status).toBe(400);
  });

  it('400 privacidade não aceita', async () => {
    getUserResult = { data: { user: { id: 'u1' } }, error: null };
    const { POST } = await import('./route');
    expect((await POST(makeReq({ ...VALID, accepted: false }))).status).toBe(400);
  });

  it('409 already_onboarded', async () => {
    getUserResult = { data: { user: { id: 'u1' } }, error: null };
    profileRow = { data: { onboarded_at: '2026-01-01T00:00:00Z' }, error: null };
    const { POST } = await import('./route');
    const res = await POST(makeReq(VALID));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'already_onboarded' });
    expect(baselineUpsertMock).not.toHaveBeenCalled();
  });

  it('200 happy → upsert baseline + update profiles com os 3 campos', async () => {
    getUserResult = { data: { user: { id: 'u1' } }, error: null };
    const { POST } = await import('./route');
    const res = await POST(makeReq(VALID));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(baselineUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'u1', mood: 4, life_areas: ['trabalho', 'descanso'] }),
    );
    expect(profileUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        active_track: 'disciplina',
        onboarded_at: expect.any(String),
        privacy_accepted_at: expect.any(String),
      }),
    );
    expect(profileEqMock).toHaveBeenCalledWith('id', 'u1');
  });

  it('500 quando update do profiles falha', async () => {
    getUserResult = { data: { user: { id: 'u1' } }, error: null };
    profileUpdateResult = { error: { code: 'XX' } };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { POST } = await import('./route');
    expect((await POST(makeReq(VALID))).status).toBe(500);
  });

  it('★ALTO: mood/áreas/track nunca em log (sentinel)', async () => {
    const s = `<<S_${randomUUID()}>>`;
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'info').mockImplementation(() => {}),
    ];
    getUserResult = { data: { user: { id: 'u1' } }, error: null };
    profileUpdateResult = { error: { code: s } }; // força log de erro
    const { POST } = await import('./route');
    await POST(makeReq({ ...VALID, areas: ['trabalho'] }));
    // o sentinel está no error.code (que PODE ser logado); garantimos que track/areas/mood não vazam:
    for (const spy of spies) {
      const all = JSON.stringify(spy.mock.calls);
      expect(all).not.toContain('trabalho');
      expect(all).not.toContain('disciplina');
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run (de `apps/web`): `pnpm test src/app/api/onboarding/route.test.ts`
Expected: FAIL — `./route` não existe.

- [ ] **Step 3: Implementar**

`apps/web/src/app/api/onboarding/route.ts`:
```ts
/**
 * POST /api/onboarding — grava o baseline + marca o profile como onboardado.
 * Single-submit atômico-por-design: onboarded_at é o commit lógico (gravado por
 * último). Privacy ★ALTO: nunca loga mood/áreas/track/conteúdo, só metadata.
 * @module app/api/onboarding/route
 */
import { createServerClient } from '@/shared/db/server';
import { LIFE_AREA_SLUGS } from '@/app/onboarding/life-areas';

function jsonResponse(status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

interface OnboardingInput {
  accepted: boolean;
  track: string;
  mood: number;
  areas: string[];
}

function parseInput(raw: unknown, validTracks: Set<string>): OnboardingInput | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (o.accepted !== true) return null;
  if (typeof o.track !== 'string' || !validTracks.has(o.track)) return null;
  if (typeof o.mood !== 'number' || !Number.isInteger(o.mood) || o.mood < 1 || o.mood > 5) return null;
  if (!Array.isArray(o.areas) || o.areas.length === 0) return null;
  if (!o.areas.every((a) => typeof a === 'string' && LIFE_AREA_SLUGS.includes(a))) return null;
  return { accepted: true, track: o.track, mood: o.mood, areas: o.areas as string[] };
}

export async function POST(request: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }

  const supabase = await createServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return jsonResponse(401, { error: 'unauthenticated' });
  }
  const userId = userData.user.id;

  // Trilhas válidas do catálogo.
  const { data: tracks } = await supabase.from('tracks_catalog').select('slug');
  const validTracks = new Set((tracks ?? []).map((t: { slug: string }) => t.slug));

  const input = parseInput(raw, validTracks);
  if (!input) {
    return jsonResponse(400, { error: 'invalid_input' });
  }

  // Já onboardado?
  const { data: profile } = await supabase
    .from('profiles')
    .select('onboarded_at')
    .eq('id', userId)
    .maybeSingle();
  if ((profile as { onboarded_at: string | null } | null)?.onboarded_at) {
    return jsonResponse(409, { error: 'already_onboarded' });
  }

  // 1) baseline (upsert por PK pra idempotência defensiva)
  const { error: baselineError } = await supabase
    .from('onboarding_baseline')
    .upsert({ user_id: userId, mood: input.mood, life_areas: input.areas });
  if (baselineError) {
    console.error('[onboarding] baseline_failed', {
      user_id: userId,
      error_code: baselineError.code ?? 'unknown',
    });
    return jsonResponse(500, { error: 'persistence_failed' });
  }

  // 2) profiles (onboarded_at por último = commit lógico)
  const now = new Date().toISOString();
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ privacy_accepted_at: now, active_track: input.track, onboarded_at: now })
    .eq('id', userId);
  if (profileError) {
    console.error('[onboarding] profile_failed', {
      user_id: userId,
      error_code: profileError.code ?? 'unknown',
    });
    return jsonResponse(500, { error: 'persistence_failed' });
  }

  return jsonResponse(200, { ok: true });
}
```

- [ ] **Step 4: Rodar e ver passar; typecheck; commit**

Run (de `apps/web`): `pnpm test src/app/api/onboarding/route.test.ts && pnpm typecheck`
Expected: 9 PASS, 0 erros.
```bash
cd D:/companion-app && git add apps/web/src/app/api/onboarding/route.ts apps/web/src/app/api/onboarding/route.test.ts
git commit -m "feat(onboarding): POST /api/onboarding grava baseline + profiles (CA-OB-2)"
```

---

## Task 3: Generalizar o gate no middleware

**Files:**
- Modify: `apps/web/src/middleware.ts`
- Test: `apps/web/src/middleware.test.ts`

- [ ] **Step 1: Escrever os testes que falham (estende o existente)**

Adicionar ao final de `apps/web/src/middleware.test.ts` (antes do fim do arquivo):
```ts
describe('middleware — onboarding gate cobre rotas de produto', () => {
  it('autenticado não-onboardado em /reflect → 307 /onboarding', async () => {
    const { middleware } = await import('@/middleware');
    getUserResult = { data: { user: { id: 'u1' } }, error: null };
    profileResult = { data: { onboarded_at: null }, error: null };
    const response = await middleware(makeRequest('/reflect'));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location')!).pathname).toBe('/onboarding');
  });

  it('autenticado não-onboardado em /onboarding → passthrough (sem loop)', async () => {
    const { middleware } = await import('@/middleware');
    getUserResult = { data: { user: { id: 'u1' } }, error: null };
    profileResult = { data: { onboarded_at: null }, error: null };
    const response = await middleware(makeRequest('/onboarding'));
    expect(response.headers.get('location')).toBeNull();
    expect(response.status).toBeLessThan(300);
  });

  it('autenticado onboardado em /reflect → passthrough', async () => {
    const { middleware } = await import('@/middleware');
    getUserResult = { data: { user: { id: 'u1' } }, error: null };
    profileResult = { data: { onboarded_at: '2026-01-01T00:00:00Z' }, error: null };
    const response = await middleware(makeRequest('/reflect'));
    expect(response.headers.get('location')).toBeNull();
    expect(response.status).toBeLessThan(300);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run (de `apps/web`): `pnpm test src/middleware.test.ts`
Expected: FAIL no caso `/reflect` (hoje o gate só cobre `/app`).

- [ ] **Step 3: Implementar**

Em `apps/web/src/middleware.ts`, substituir o bloco `if (pathname.startsWith('/app')) { ... }` (linhas ~71-83) por:
```ts
  // Rotas de produto exigem onboarding completo. /onboarding nunca é gateado
  // por onboarding (evita loop) mas exige sessão (já coberto acima).
  const ONBOARDING_GATED_PREFIXES = ['/app', '/reflect', '/reflections'];
  const needsOnboarding =
    pathname !== '/onboarding' &&
    ONBOARDING_GATED_PREFIXES.some((p) => pathname.startsWith(p));

  if (needsOnboarding) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('onboarded_at')
      .eq('id', user.id)
      .single();

    if (!profile?.onboarded_at) {
      const url = request.nextUrl.clone();
      url.pathname = '/onboarding';
      return NextResponse.redirect(url, 307);
    }
  }
```
Atualizar o JSDoc do topo se mencionar só `/app` (trocar por "rotas de produto").

- [ ] **Step 4: Rodar e ver passar; typecheck; commit**

Run (de `apps/web`): `pnpm test src/middleware.test.ts && pnpm typecheck`
Expected: PASS (clauses 1-3 antigas + 3 novas), 0 erros.
```bash
cd D:/companion-app && git add apps/web/src/middleware.ts apps/web/src/middleware.test.ts
git commit -m "feat(onboarding): gate de onboarding cobre rotas de produto (CA-OB-3)"
```

---

## Task 4: Landing pós-login → `/reflect`

**Files:**
- Modify: `apps/web/src/app/auth/callback/route.ts`

- [ ] **Step 1: Ajustar o redirect final**

Em `apps/web/src/app/auth/callback/route.ts`, trocar a linha do sucesso
`return NextResponse.redirect(`${origin}/`);` por:
```ts
  // Pós-login vai pro produto; o middleware desvia pra /onboarding se necessário.
  return NextResponse.redirect(`${origin}/reflect`);
```
(Manter os redirects de erro `/login?error=...` inalterados.)

- [ ] **Step 2: Verificar testes do callback (se houver) + typecheck**

Run (de `apps/web`): `pnpm test src/app/auth/callback 2>/dev/null; pnpm typecheck`
Expected: typecheck 0; se houver teste do callback que asserta `/`, atualizá-lo pra `/reflect` (mesma mudança). Se não houver teste, seguir.

- [ ] **Step 3: Commit**

```bash
cd D:/companion-app && git add apps/web/src/app/auth/callback/route.ts
git commit -m "feat(onboarding): landing pós-login vai pra /reflect (CA-OB-5)"
```

---

## Task 5: Wizard `/onboarding` (page + component)

**Files:**
- Create: `apps/web/src/app/onboarding/page.tsx`
- Create: `apps/web/src/app/onboarding/OnboardingWizard.tsx`
- Test: `apps/web/src/app/onboarding/OnboardingWizard.test.tsx`

- [ ] **Step 1: Escrever os testes que falham**

`apps/web/src/app/onboarding/OnboardingWizard.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OnboardingWizard } from './OnboardingWizard';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock('../../design-system/components/use-toast', () => ({ toast: vi.fn() }));

const TRACKS = [
  { slug: 'disciplina', title: 'Disciplina', description: 'desc d' },
  { slug: 'regulacao-emocional', title: 'Regulação Emocional', description: 'desc r' },
  { slug: 'direcao', title: 'Direção', description: 'desc dir' },
];

beforeEach(() => {
  vi.clearAllMocks();
  pushMock.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('OnboardingWizard', () => {
  it('CA-OB-4: 3 passos, aceita → trilha → baseline → submit → push /reflect', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const user = userEvent.setup();
    render(<OnboardingWizard tracks={TRACKS} />);

    // passo 1: privacidade
    await user.click(screen.getByRole('button', { name: /Aceito/i }));
    // passo 2: trilha
    await user.click(screen.getByText('Disciplina'));
    await user.click(screen.getByRole('button', { name: /Avançar/i }));
    // passo 3: baseline
    await user.click(screen.getByRole('button', { name: 'Humor 4' }));
    await user.click(screen.getByLabelText('Trabalho'));
    await user.click(screen.getByRole('button', { name: /Concluir/i }));

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/onboarding',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse((globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1].body);
    expect(body).toEqual({ accepted: true, track: 'disciplina', mood: 4, areas: ['trabalho'] });
    expect(pushMock).toHaveBeenCalledWith('/reflect');
  });

  it('não avança da trilha sem escolher uma', async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard tracks={TRACKS} />);
    await user.click(screen.getByRole('button', { name: /Aceito/i }));
    expect(screen.getByRole('button', { name: /Avançar/i })).toBeDisabled();
  });

  it('não conclui sem humor + ao menos 1 área', async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard tracks={TRACKS} />);
    await user.click(screen.getByRole('button', { name: /Aceito/i }));
    await user.click(screen.getByText('Disciplina'));
    await user.click(screen.getByRole('button', { name: /Avançar/i }));
    expect(screen.getByRole('button', { name: /Concluir/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Humor 3' }));
    expect(screen.getByRole('button', { name: /Concluir/i })).toBeDisabled(); // ainda sem área
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run (de `apps/web`): `pnpm test src/app/onboarding/OnboardingWizard.test.tsx`
Expected: FAIL — componente não existe.

- [ ] **Step 3: Implementar o wizard**

`apps/web/src/app/onboarding/OnboardingWizard.tsx`:
```tsx
'use client';

/**
 * Wizard de onboarding (3 passos): privacidade → trilha → baseline.
 * Estado no cliente; grava tudo num único POST /api/onboarding ao concluir.
 * @module app/onboarding/OnboardingWizard
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '../../design-system/components/Button';
import { Card } from '../../design-system/components/Card';
import { Checkbox } from '../../design-system/components/Checkbox';
import { toast } from '../../design-system/components/use-toast';
import { LIFE_AREAS } from './life-areas';

type Track = { slug: string; title: string; description: string };
type Step = 'privacy' | 'track' | 'baseline';

export function OnboardingWizard({ tracks }: { tracks: Track[] }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('privacy');
  const [track, setTrack] = useState<string | null>(null);
  const [mood, setMood] = useState<number | null>(null);
  const [areas, setAreas] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  function toggleArea(slug: string) {
    setAreas((cur) => (cur.includes(slug) ? cur.filter((s) => s !== slug) : [...cur, slug]));
  }

  async function handleSubmit() {
    if (track === null || mood === null || areas.length === 0) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted: true, track, mood, areas }),
      });
      if (!res.ok) {
        setSubmitting(false);
        toast({ variant: 'destructive', title: 'Não deu pra concluir', description: 'Tenta de novo.' });
        return;
      }
      router.push('/reflect');
    } catch {
      setSubmitting(false);
      toast({ variant: 'destructive', title: 'Erro de conexão', description: 'Tenta de novo.' });
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      {step === 'privacy' && (
        <section className="space-y-4">
          <h1 className="text-2xl font-semibold">Antes de começar</h1>
          <p className="text-muted-foreground">
            Tuas reflexões ficam só no teu espaço, protegidas por segurança a nível de linha. O
            conteúdo nunca vai pra analytics ou serviços de terceiros — só você lê o que escreve.
          </p>
          <Button type="button" onClick={() => setStep('track')}>
            Aceito
          </Button>
        </section>
      )}

      {step === 'track' && (
        <section className="space-y-4">
          <h1 className="text-2xl font-semibold">Escolhe uma trilha</h1>
          <div className="space-y-3">
            {tracks.map((t) => (
              <Card
                key={t.slug}
                onClick={() => setTrack(t.slug)}
                className={`cursor-pointer p-4 ${track === t.slug ? 'ring-2 ring-primary' : ''}`}
              >
                <h2 className="font-semibold">{t.title}</h2>
                <p className="text-sm text-muted-foreground">{t.description}</p>
              </Card>
            ))}
          </div>
          <div className="flex justify-between">
            <Button type="button" variant="outline" onClick={() => setStep('privacy')}>
              Voltar
            </Button>
            <Button type="button" disabled={track === null} onClick={() => setStep('baseline')}>
              Avançar
            </Button>
          </div>
        </section>
      )}

      {step === 'baseline' && (
        <section className="space-y-4">
          <h1 className="text-2xl font-semibold">Como você está, no geral?</h1>
          <div>
            <p className="text-sm text-muted-foreground mb-2">Humor (1 = muito baixo, 5 = muito bom)</p>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <Button
                  key={n}
                  type="button"
                  aria-label={`Humor ${n}`}
                  variant={mood === n ? 'default' : 'outline'}
                  onClick={() => setMood(n)}
                >
                  {n}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-2">Áreas que importam pra você agora</p>
            <div className="space-y-2">
              {LIFE_AREAS.map((a) => (
                <label key={a.slug} className="flex items-center gap-2">
                  <Checkbox
                    checked={areas.includes(a.slug)}
                    onCheckedChange={() => toggleArea(a.slug)}
                    aria-label={a.label}
                  />
                  <span>{a.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-between">
            <Button type="button" variant="outline" onClick={() => setStep('track')}>
              Voltar
            </Button>
            <Button
              type="button"
              disabled={mood === null || areas.length === 0 || submitting}
              onClick={handleSubmit}
            >
              {submitting ? 'Concluindo...' : 'Concluir'}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
```
> Nota: confirme a API do `Checkbox` do design-system (prop `onCheckedChange` + `checked` é o padrão shadcn/Radix). Se a assinatura diferir, adapte o handler mantendo o `aria-label={a.label}` (o teste seleciona por ele).

`apps/web/src/app/onboarding/page.tsx`:
```tsx
/**
 * Página /onboarding — carrega trilhas e renderiza o wizard. Se já onboardado,
 * manda pro /reflect (não refaz).
 * @module app/onboarding/page
 */
import { redirect } from 'next/navigation';

import { createServerClient } from '@/shared/db/server';
import { OnboardingWizard } from './OnboardingWizard';

export default async function OnboardingPage() {
  const supabase = await createServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('onboarded_at')
    .eq('id', userData.user.id)
    .maybeSingle();
  if ((profile as { onboarded_at: string | null } | null)?.onboarded_at) {
    redirect('/reflect');
  }

  const { data: tracks } = await supabase
    .from('tracks_catalog')
    .select('slug, title, description');

  return <OnboardingWizard tracks={tracks ?? []} />;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run (de `apps/web`): `pnpm test src/app/onboarding/OnboardingWizard.test.tsx`
Expected: PASS (3 testes). Se o `Checkbox` ou `Card` divergir da assinatura assumida, ajustar e re-rodar.

- [ ] **Step 5: Typecheck + commit**

Run (de `apps/web`): `pnpm typecheck` → 0 erros.
```bash
cd D:/companion-app && git add apps/web/src/app/onboarding/OnboardingWizard.tsx apps/web/src/app/onboarding/OnboardingWizard.test.tsx apps/web/src/app/onboarding/page.tsx
git commit -m "feat(onboarding): wizard 3 passos privacidade/trilha/baseline (CA-OB-4)"
```

---

## Task 6: Regressão + typecheck + build (INLINE — controller)

- [ ] **Step 1: Suite completa**

Run (de `apps/web`): `pnpm test`
Expected: PASS — suite inteira verde (136+ anteriores + novos onboarding).

- [ ] **Step 2: Typecheck + build**

Run (de `apps/web`): `pnpm typecheck && pnpm build`
Expected: 0 erros; build limpo (rota `/onboarding` + `/api/onboarding` aparecem).

---

## Task 7: Apply da migration no live + verify (HUMAN GATE ★)

**Files:**
- Create: `supabase/reconcile/verify-onboarding-baseline.mjs`

- [ ] **Step 1: Criar o verificador**

`supabase/reconcile/verify-onboarding-baseline.mjs`:
```javascript
// Verifica que onboarding_baseline existe no live com as colunas canônicas.
// Uso: node supabase/reconcile/verify-onboarding-baseline.mjs
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
const EXPECTED = ['created_at', 'life_areas', 'mood', 'user_id'];

let fail = 0;
const check = (ok, label) => { console.log((ok ? 'PASS' : 'FAIL') + ' — ' + label); if (!ok) fail += 1; };

const spec = await (await fetch(url + '/rest/v1/', { headers: h })).json();
const t = spec.definitions?.onboarding_baseline;
const cols = t ? Object.keys(t.properties).sort() : [];
check(JSON.stringify(cols) === JSON.stringify([...EXPECTED].sort()), 'colunas == ' + EXPECTED.join(',') + ' (got: ' + cols.join(',') + ')');

console.log('\n' + (fail === 0 ? 'TUDO VERDE ✅' : fail + ' FALHA(S) ❌'));
process.exit(fail === 0 ? 0 : 1);
```

- [ ] **Step 2: Pacini aplica a migration no live (SQL Editor)**

Pacini cola o conteúdo de `supabase/migrations/0010_onboarding_baseline.sql` no SQL
Editor do projeto "Midnight Puppies" e roda (additivo, sem risco). Cola aqui a saída.

- [ ] **Step 3: Claude roda o verify**

Run (de `D:/companion-app`): `node supabase/reconcile/verify-onboarding-baseline.mjs`
Expected: **TUDO VERDE ✅**.

- [ ] **Step 4: Smoke (opcional, com app rodando)**

Login com conta não-onboardada → middleware manda pro `/onboarding` → completar wizard
→ cai no `/reflect`. Conferir no live: `profiles.onboarded_at` setado + 1 linha em
`onboarding_baseline`. PAUSE pra Pacini avaliar.

- [ ] **Step 5: Commit do verify + evidência**

```bash
cd D:/companion-app && git add supabase/reconcile/verify-onboarding-baseline.mjs
git commit -m "test(onboarding): verificador do onboarding_baseline no live (CA-OB-1)"
```

---

## Self-Review (controller)

**Spec coverage:**
- CA-OB-1 (migration + RLS + apply/verify) → Task 1 + Task 7 ✅
- CA-OB-2 (POST /api/onboarding validações + grava) → Task 2 ✅
- CA-OB-3 (middleware gate produto, /onboarding não-gateado) → Task 3 ✅
- CA-OB-4 (wizard 3 passos + submit atômico + /reflect) → Task 5 ✅
- CA-OB-5 (callback → /reflect) → Task 4 ✅
- CA-OB-6 (privacy logs) → Task 2 sentinel ✅
- CA-OB-7 (suite/typecheck/build) → Task 6 ✅

**Placeholder scan:** sem TBD; código completo. Notas condicionais (assinatura do
Checkbox/Card; teste do callback se existir) são instruções de verificação, não placeholders.

**Type consistency:** `onboarding_baseline` (mood/life_areas/user_id), `LIFE_AREA_SLUGS`,
`OnboardingInput`, `Track`, slugs (`disciplina`/`regulacao-emocional`/`direcao`) e
prefixos do gate consistentes entre tasks e com a spec.
