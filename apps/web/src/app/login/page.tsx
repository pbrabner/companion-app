/**
 * /login — magic link authentication via Supabase signInWithOtp.
 *
 * Flow:
 *   1. User digita email + clica "Enviar link"
 *   2. Browser client chama signInWithOtp com emailRedirectTo apontando
 *      pra `/auth/callback`
 *   3. Supabase envia magic link no email
 *   4. User clica link -> /auth/callback troca code por session -> /
 *
 * PRD: G-RF-1 do smoke report 2026-05-24-frontend-reflect-smoke.md
 */

import { Suspense } from 'react';

import { LoginForm } from './LoginForm';

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <Suspense fallback={<div className="text-muted-foreground">Carregando...</div>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
