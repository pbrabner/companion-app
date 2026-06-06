/**
 * /auth/reset-password — landing page do reset password callback.
 *
 * Server Component shell mínimo: o hash fragment com access_token NÃO
 * chega ao server, então toda lógica de auth roda no ResetPasswordForm
 * (Client Component) via supabase.auth.onAuthStateChange.
 *
 * Rota é pública (ver middleware PUBLIC_ROUTES) — user chega sem
 * cookie session porque o token vem no fragment.
 */

import { Suspense } from 'react';

import { ResetPasswordForm } from './ResetPasswordForm';

export default function ResetPasswordPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <Suspense fallback={<div className="text-muted-foreground">Carregando...</div>}>
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
