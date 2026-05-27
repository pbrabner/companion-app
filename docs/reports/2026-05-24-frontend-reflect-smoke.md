---
title: "Smoke real — Frontend /reflect"
type: report
created: 2026-05-24
spec: docs/plans/2026-05-24-frontend-reflect-design.md
plan: docs/plans/2026-05-24-frontend-reflect-plan.md
workflow_id: frontend-reflect-page-form-stream-display
verdict: PASS_WITH_NOTE
---

# Smoke /reflect — resultado

## TL;DR

Tasks 1-3 entregues (parseReflectStream util + ReflectForm component + page wrapper). Build green, 15/15 tests pass. Smoke real expôs limite esperado: middleware Companion (T-007) protege todas rotas exceto `/`, `/login`, `/auth/callback` — `/reflect` redireciona pra `/login` que ainda não existe. Validação end-to-end com Supabase session real requer login UI (deliverable separado).

## Tasks entregues

| # | Task | Commit | Tests |
|---|---|---|---|
| 1 | parseReflectStream util | `da04a40` | 6/6 |
| 2 | ReflectForm component | `5297019` | 9/9 |
| 3 | /reflect page + .eslintignore | `26d4f01` | typecheck + build green |

## Build output

```
Route (app)                                Size  First Load JS
├ ○ /                                      126 B         102 kB
├ ƒ /api/reflect                           126 B         102 kB
└ ○ /reflect                             9.47 kB         112 kB
```

`/reflect` é static (sem server data fetching no render), 9.47kB.

## Smoke — comportamento esperado

```bash
$ curl -sI http://localhost:3000/reflect
HTTP/1.1 307 Temporary Redirect
location: /login

$ curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/login
404
```

Middleware (`src/middleware.ts`) protege rotas não-públicas. Fluxo esperado:
1. Usuário anônimo → `/reflect` → 307 → `/login` → 404 (login UI não existe)
2. Usuário autenticado (cookie Supabase) → `/reflect` → 200 (página renderiza)
3. Submit POST → backend valida session via cookie → 200 stream OR 401 → frontend mostra error.auth card

Estados 2-3 não validados end-to-end nesta entrega (depende de login UI ou seed manual de cookie).

## Cobertura via tests

| Estado | Coberto por |
|---|---|
| `idle` | ReflectForm.test (render textarea + button disabled) |
| `valid` (3+ chars) | ReflectForm.test (button enabled) |
| `submitting` | ReflectForm.test (button disabled during fetch) |
| `streaming` (chunks chegam) | ReflectForm.test (stream display "Hello world") |
| `error.auth` (401) | ReflectForm.test (card "autenticad") |
| `error.too_long` (413) | ReflectForm.test (mensagem "longa") |
| `error.ai_unavailable` (tail JSON) | ReflectForm.test (partial + reflection_id) |
| Stream contract metadata + text + tail error | parse-stream.test (6 cases) |

## Gaps descobertos

### G-RF-1 — Login UI ausente bloqueia E2E real

**Impact:** Médio. Frontend está pronto mas usuário não consegue chegar nele em modo prod. Tests cobrem lógica, mas nenhum smoke real com Supabase session foi feito.

**Workaround manual (para teste futuro):**
1. Criar usuário via Supabase dashboard
2. Gerar magic link OR cookie de session manualmente
3. Setar cookie no browser via DevTools
4. Acessar `/reflect`

**Fix sugerido (próximo PRD):** Construir página `/login` com magic link Supabase. Pequena (~1h se simples).

### G-RF-2 — Dead file `apps/web/src/design-system/lost-pixel.config.js` aparece como deleted

Working tree mostra `D apps/web/src/design-system/lost-pixel.config.js` (deleted, not staged). Esse era o arquivo dead da Task 2 do Lost Pixel (nome errado com hífen). Foi deletado on disk mas ainda está rastreado em algum commit. Não bloqueia, mas vale `git rm` + commit separado.

### G-RF-3 — `apps/web/src/design-system/storybook-static/` precisa de gitignore mais alto

Lost Pixel Task 2 criou `.gitignore` no design-system pra ignorar `storybook-static/`. Mas o Next.js lint estava varrendo esse path mesmo assim (`.eslintignore` corrigiu nesta entrega). Considerar mover `storybook-static/` pra gitignore do root também.

## Próximos passos sugeridos

1. **Login UI** (G-RF-1) — desbloqueia smoke real e fecha loop journaling
2. **GET /api/reflections** + histórico no UI — complementa POST com listar passadas
3. **Markdown rendering** da resposta — Claude às vezes retorna formatação
4. **Toast notifications** — usar design system Toast pra erros transitórios
