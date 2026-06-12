# Reset Password — Technical Design

Feature: F3 (branch feat/reset-password)
Status: DRAFT 2026-06-05
Author: Legion (piloto live Fase 3)

---

## 1. Components a criar/modificar

### MODIFY
- `apps/web/src/app/login/LoginForm.tsx`
- `apps/web/src/middleware.ts`

### CREATE
- `apps/web/src/app/login/ForgotPasswordForm.tsx`
- `apps/web/src/app/login/ForgotPasswordForm.test.tsx`
- `apps/web/src/app/login/LoginForm.test.tsx`
- `apps/web/src/app/auth/reset-password/page.tsx`
- `apps/web/src/app/auth/reset-password/ResetPasswordForm.tsx`
- `apps/web/src/app/auth/reset-password/ResetPasswordForm.test.tsx`

---

## 2. Reset Password Flow

### Step 1 — Request reset (browser)
```
LoginForm renders "Esqueci minha senha?" link
  └─ click → setState({ kind: 'forgot' })
       └─ renders <ForgotPasswordForm /> inline (replaces form body)
            └─ user types email → submit
                 └─ supabase.auth.resetPasswordForEmail(email, {
                      redirectTo: `${window.location.origin}/auth/reset-password`
                    })
                 └─ success → FormState { kind: 'reset_sent'; email }
                 └─ error   → FormState { kind: 'reset_error'; message }
```

### Step 2 — Supabase email delivery
Supabase envia email. Após verificação no server Supabase, redireciona para `<origin>/auth/reset-password#access_token=...&type=recovery`. O fragment `#access_token` é parseado client-side via `supabase.auth.onAuthStateChange`.

**Importante:** não há `code=` neste flow. O callback é `/auth/reset-password` (page, não route handler).

### Step 3 — New password form (client)
`/auth/reset-password/page.tsx` Server Component mínimo renderiza `<ResetPasswordForm />` Client Component.

ResetPasswordForm escuta `supabase.auth.onAuthStateChange((event) => if (event === 'PASSWORD_RECOVERY') ...)` e habilita form. Submit chama `supabase.auth.updateUser({ password: newPassword })`. Pós-sucesso: `router.replace('/')`.

---

## 3. UI Changes em LoginForm.tsx

### Inserção do link (após linha ~120, antes do `</form>`)

```tsx
<div className="text-center">
  <button
    type="button"
    onClick={() => setState({ kind: 'forgot' })}
    className="text-sm text-muted-foreground underline hover:text-foreground"
  >
    Esqueci minha senha
  </button>
</div>
```

Usar `<button type="button">` inline (igual ao "Tentar de novo" linha 70-75) em vez de `<Button variant="link">` — ação secundária, não CTA.

### Extensão do FormState

```ts
type FormState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; email: string }
  | { kind: 'error'; message: string }
  | { kind: 'forgot' };              // NOVO: mostra ForgotPasswordForm
```

Quando `state.kind === 'forgot'` renderizar `<ForgotPasswordForm onBack={() => setState({ kind: 'idle' })} />`.

---

## 4. State Management — Decision

**Separar em `ForgotPasswordForm` component, não estender inline o LoginForm.**

Razão: misturar reset states no mesmo `useState` do LoginForm polui union e dificulta teste. `ForgotPasswordForm` tem state isolado:

```ts
type ForgotState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; email: string }
  | { kind: 'error'; message: string };
```

---

## 5. Reset Callback Route

**Não é Route Handler — é Page.**

```
apps/web/src/app/auth/reset-password/
  page.tsx              ← Server Component (shell mínimo)
  ResetPasswordForm.tsx ← Client Component (state machine)
  ResetPasswordForm.test.tsx
```

### page.tsx
Server Component, sem lógica de auth (o hash não chega ao server). Renderiza `<ResetPasswordForm />` com shell similar a `/login/page.tsx`.

### ResetPasswordForm.tsx — state machine

```ts
type ResetState =
  | { kind: 'waiting' }        // aguardando PASSWORD_RECOVERY
  | { kind: 'ready' }          // session OK, pode submeter
  | { kind: 'submitting' }
  | { kind: 'success' }
  | { kind: 'error'; message: string }
  | { kind: 'invalid_link' };  // timeout 5s
```

**Inicial waiting:** mostrar "Verificando link..." com timeout 5s → invalid_link se PASSWORD_RECOVERY não chegou.

**Validação:** password mínimo 8 chars + confirmar senha (segundo campo) inline antes do submit.

**Pós-sucesso:** `router.replace('/')` (replace evita back voltar pra reset page com sessão consumida).

---

## 6. Middleware

`apps/web/src/middleware.ts:13`:

```ts
// ANTES
const PUBLIC_ROUTES = new Set(['/', '/login', '/auth/callback']);
// DEPOIS
const PUBLIC_ROUTES = new Set(['/', '/login', '/auth/callback', '/auth/reset-password']);
```

`/auth/reset-password` é pública porque user chega sem session (token está no hash, não cookie).

---

## 7. Build Sequence

### Phase 1 — Middleware
1. **MODIFY** `apps/web/src/middleware.ts` — adicionar `/auth/reset-password` em PUBLIC_ROUTES

### Phase 2 — ForgotPasswordForm
2. **CREATE** `apps/web/src/app/login/ForgotPasswordForm.tsx`
3. **CREATE** `apps/web/src/app/login/ForgotPasswordForm.test.tsx`

### Phase 3 — LoginForm
4. **MODIFY** `apps/web/src/app/login/LoginForm.tsx`
5. **CREATE** `apps/web/src/app/login/LoginForm.test.tsx`

### Phase 4 — Reset page
6. **CREATE** `apps/web/src/app/auth/reset-password/ResetPasswordForm.tsx`
7. **CREATE** `apps/web/src/app/auth/reset-password/page.tsx`
8. **CREATE** `apps/web/src/app/auth/reset-password/ResetPasswordForm.test.tsx`

---

## 8. Test Cases

### ForgotPasswordForm.test.tsx
- renders email input + submit button disabled (empty)
- enables button com email válido
- transitions to `sent` após `resetPasswordForEmail` success
- shows error message on error
- disables button during sending
- calls `onBack` ao clicar voltar

### LoginForm.test.tsx
- renders "Esqueci minha senha" link
- click link mostra ForgotPasswordForm
- onBack retorna ao idle login

### ResetPasswordForm.test.tsx
- renders "Verificando link..." em waiting
- transitions to `ready` após PASSWORD_RECOVERY event
- shows invalid_link após timeout
- disables submit when passwords don't match
- disables submit when password < 8 chars
- calls `updateUser({ password })` on submit
- success → `router.replace('/')`
- shows error on updateUser fail
- disables button during submitting

**Mock pattern:**
```ts
vi.mock('../../shared/db/browser', () => ({
  createBrowserClient: vi.fn(() => ({
    auth: {
      resetPasswordForEmail: mockResetPasswordForEmail,
      onAuthStateChange: mockOnAuthStateChange,
      updateUser: mockUpdateUser,
    },
  })),
}));
```

---

## 9. Critical Design Notes

### Security
- **Token expiry:** Recovery token Supabase expira 1h (default). Timeout 5s client-side é só UX.
- **Sem rate limiting próprio:** Supabase já limita `resetPasswordForEmail` no nível plataforma.
- **Brute force:** `updateUser` requer session válida (PASSWORD_RECOVERY event), não atacável sem token email.
- **PKCE:** Supabase SSR usa PKCE pra magic link, mas recovery usa hash fragment (documented).

### UX
- **Mensagem reset_sent:** NÃO confirmar se email existe. Texto: "Se esse email está cadastrado, você receberá um link em instantes." (previne user enumeration).
- **Waiting timeout:** 5000ms suficiente pra hash parsing. Se não chegou em 5s → "Link inválido ou expirado".
- **Confirmar senha:** segundo campo com validação inline (onChange).

### Error Handling
- `resetPasswordForEmail`: usar `error.message` direto (igual LoginForm linha 46-48).
- `updateUser`: `error.message` ou fallback "Não foi possível atualizar a senha. Tenta de novo."

---

## Supabase API Reference

```ts
// Step 1: request
const { error } = await supabase.auth.resetPasswordForEmail(email, {
  redirectTo: `${window.location.origin}/auth/reset-password`,
});

// Step 3: listen for recovery
const { data: { subscription } } = supabase.auth.onAuthStateChange(
  (event, session) => {
    if (event === 'PASSWORD_RECOVERY') { /* enable form */ }
  }
);
// cleanup: subscription.unsubscribe()

// Step 3: update password
const { error } = await supabase.auth.updateUser({ password: newPassword });
```
