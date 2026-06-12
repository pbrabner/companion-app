# Spec: Logout Button
**Branch:** feat/logout-button
**Status:** DESIGN — awaiting impl dispatch
**Date:** 2026-06-04

---

## 1. Components to Create

### `apps/web/src/app/components/Header.tsx`
- **Kind:** Server Component (async, no `'use client'`)
- **Responsibility:** Fetch the authenticated user server-side, render app-level header bar, render `LogoutButton` only when user is present
- **Data source:** `createServerClient()` from `shared/db/server` → `supabase.auth.getUser()` (uses getClaims internally in @supabase/ssr — safe for server rendering)
- **Props:** none (self-contained, reads from cookies)
- **Renders:** horizontal bar with app name left-aligned, `<LogoutButton userEmail={user.email} />` right-aligned when user !== null; nothing (returns null or minimal fragment) when user is null so the login page is unaffected

### `apps/web/src/app/components/LogoutButton.tsx`
- **Kind:** Client Component (`'use client'`)
- **Responsibility:** Render a button that calls `signOut`, manages its own loading/error state, redirects on success
- **Props:** `{ userEmail?: string }` (display only — shown as subdued label beside button)
- **State machine** (matches existing pattern from LoginForm.tsx):
  ```ts
  type LogoutState =
    | { kind: 'idle' }
    | { kind: 'signing_out' }
    | { kind: 'error'; message: string }
  ```
- **Behavior:**
  1. On click: set `{ kind: 'signing_out' }`, call `createBrowserClient().auth.signOut({ scope: 'local' })`
  2. On success: `router.push('/login')` (via `useRouter` from `next/navigation`)
  3. On error: set `{ kind: 'error', message: error.message }`, re-enable button
- **Button label:** `'Sair'` (idle) / `'Saindo...'` (signing_out)
- **Button disabled:** when `state.kind === 'signing_out'`
- **Button variant:** `ghost` (matches header context — low visual weight)
- **Error display:** inline `<p className="text-destructive text-sm">` below the button
- **Imports:** `Button` from `'../../design-system/components/Button'`, `createBrowserClient` from `'../../shared/db/browser'`

---

## 2. Auth State Propagation

```
RootLayout (Server Component)
  └── <Header />               ← async Server Component, self-contained
        ├── await createServerClient()
        ├── await supabase.auth.getUser()   ← reads httpOnly session cookie
        └── <LogoutButton userEmail={user.email} />  ← Client Component
```

**Chosen pattern:** Header is a self-contained async Server Component that calls `createServerClient()` internally. No prop drilling from layout — layout stays simple. This mirrors how the callback route and middleware already call `createServerClient()` independently per request.

`layout.tsx` is modified only to import and render `<Header />` above `{children}`. No new context providers, no `'use client'` on layout.

---

## 3. signOut Flow

```
User clicks "Sair"
  → LogoutButton sets state { kind: 'signing_out' }
  → createBrowserClient().auth.signOut({ scope: 'local' })
      • @supabase/ssr clears the sb-* session cookies via its setAll callback
      • clears localStorage auth entries
  → if error: set { kind: 'error', message: error.message }, return
  → router.push('/login')
      • Next.js client navigation to /login
      • Middleware on /login is in PUBLIC_ROUTES — passes through
      • No stale user data remains in layout because /login is a full navigation
```

No manual `document.cookie` manipulation. No manual localStorage clearing. `@supabase/ssr` handles both automatically via the `createBrowserClient` instance.

---

## 4. Loading and Error Handling

| State | Button text | Button disabled | Error UI |
|---|---|---|---|
| `idle` | `Sair` | false | — |
| `signing_out` | `Saindo...` | true | — |
| `error` | `Sair` | false | `<p className="text-destructive text-sm">{message}</p>` |

Error recovery: button becomes clickable again. User can retry. No auto-redirect on error — stay on current page.

---

## 5. Tests

**Framework:** Vitest + @testing-library/react + userEvent (already configured, see `ReflectForm.test.tsx` pattern)

**File:** `apps/web/src/app/components/LogoutButton.test.tsx`

Test cases:
1. Renders button with label "Sair" in idle state
2. Shows user email when provided
3. Button is disabled during signing_out (mock fetch hanging)
4. On successful signOut: calls `router.push('/login')`
5. On signOut error: shows error message, re-enables button
6. Does NOT test Header (Server Component — no RTL support for async RSC; skip or defer to E2E)

**Mocking approach** (mirrors `middleware.test.ts`):
```typescript
vi.mock('../../shared/db/browser', () => ({
  createBrowserClient: vi.fn(() => ({
    auth: { signOut: vi.fn() }
  }))
}));
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ push: vi.fn() }))
}));
```

---

## 6. Files to Touch

| Action | Path |
|---|---|
| CREATE | `apps/web/src/app/components/Header.tsx` |
| CREATE | `apps/web/src/app/components/LogoutButton.tsx` |
| CREATE | `apps/web/src/app/components/LogoutButton.test.tsx` |
| MODIFY | `apps/web/src/app/layout.tsx` |

**Modification to `layout.tsx`:**
- Import `Header` from `'./components/Header'`
- Insert `<Header />` as first child inside `<body>`, above `{children}`
- No other changes — globals.css import and metadata stay untouched

---

## 7. Build Sequence

1. **`LogoutButton.tsx`** — pure client component, no deps on Header; write first
2. **`LogoutButton.test.tsx`** — write immediately after, run `pnpm test` to confirm baseline
3. **`Header.tsx`** — async server component wrapping LogoutButton
4. **`layout.tsx`** (modify) — one-liner: import Header, add `<Header />` to body

---

## 8. Critical Design Notes

- **`scope: 'local'` is mandatory** — default `'global'` would log the user out of all devices
- **`getUser()` not `getSession()`** — `@supabase/ssr` validates JWT against Supabase public keys server-side
- **Header returns null for unauthenticated routes** — `/login`, `/auth/callback`, `/` need to render without a header
- **No React context needed** — user only consumed by Header/LogoutButton; pass via prop
- **`lucide-react` available** — `LogOut` icon optional/secondary to text label for accessibility
