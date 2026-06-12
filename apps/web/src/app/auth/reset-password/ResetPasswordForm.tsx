'use client';

/**
 * ResetPasswordForm — Client Component que processa o reset password
 * callback. Escuta PASSWORD_RECOVERY event do Supabase (chega via hash
 * fragment), aceita nova senha + confirmação, e chama updateUser.
 *
 * State machine:
 *   waiting     → aguardando PASSWORD_RECOVERY (timeout 5s → invalid_link)
 *   ready       → form habilitado
 *   submitting  → updateUser em curso
 *   success     → redirect /
 *   error       → exibe message, permite retry
 *   invalid_link → link expirado ou hash não chegou
 *
 * @module app/auth/reset-password/ResetPasswordForm
 */

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { Button } from '../../../design-system/components/Button';
import { createBrowserClient } from '../../../shared/db/browser';

const WAITING_TIMEOUT_MS = 5000;
const MIN_PASSWORD_LENGTH = 8;

type ResetState =
  | { kind: 'waiting' }
  | { kind: 'ready' }
  | { kind: 'submitting' }
  | { kind: 'success' }
  | { kind: 'error'; message: string }
  | { kind: 'invalid_link' };

export function ResetPasswordForm() {
  const router = useRouter();
  const [state, setState] = useState<ResetState>({ kind: 'waiting' });
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  // A sessão de recovery é estabelecida no client que recebe o evento
  // PASSWORD_RECOVERY; updateUser PRECISA rodar nesse mesmo client.
  const supabaseRef = useRef<ReturnType<typeof createBrowserClient> | null>(
    null,
  );

  useEffect(() => {
    const supabase = createBrowserClient();
    supabaseRef.current = supabase;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setState((prev) => (prev.kind === 'waiting' ? { kind: 'ready' } : prev));
      }
    });

    const timeoutId = window.setTimeout(() => {
      setState((prev) =>
        prev.kind === 'waiting' ? { kind: 'invalid_link' } : prev,
      );
    }, WAITING_TIMEOUT_MS);

    return () => {
      subscription.unsubscribe();
      window.clearTimeout(timeoutId);
      supabaseRef.current = null;
    };
  }, []);

  const passwordTooShort =
    password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const passwordsDontMatch =
    confirmPassword.length > 0 && password !== confirmPassword;
  const canSubmit =
    password.length >= MIN_PASSWORD_LENGTH &&
    password === confirmPassword &&
    (state.kind === 'ready' || state.kind === 'error');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setState({ kind: 'submitting' });

    try {
      const supabase = supabaseRef.current;
      if (!supabase) return;
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        setState({ kind: 'error', message: error.message });
        return;
      }

      setState({ kind: 'success' });
      router.replace('/');
    } catch (err) {
      setState({
        kind: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Não foi possível atualizar a senha. Tenta de novo.',
      });
    }
  }

  if (state.kind === 'waiting') {
    return (
      <div className="max-w-md w-full p-6 border rounded-lg bg-card text-card-foreground">
        <p className="text-muted-foreground">Verificando link...</p>
      </div>
    );
  }

  if (state.kind === 'invalid_link') {
    return (
      <div className="max-w-md w-full p-6 border rounded-lg bg-card text-card-foreground">
        <h1 className="text-xl font-semibold mb-2">Link inválido ou expirado</h1>
        <p className="text-muted-foreground">
          Esse link de redefinição não é mais válido. Volta pro login e pede
          outro.
        </p>
        <p className="text-sm text-muted-foreground mt-4">
          <button
            type="button"
            onClick={() => router.replace('/login')}
            className="underline hover:text-foreground"
          >
            Voltar pro login
          </button>
        </p>
      </div>
    );
  }

  if (state.kind === 'success') {
    return (
      <div className="max-w-md w-full p-6 border rounded-lg bg-card text-card-foreground">
        <p className="text-muted-foreground">Senha atualizada. Redirecionando...</p>
      </div>
    );
  }

  const isBusy = state.kind === 'submitting';

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-md w-full p-6 border rounded-lg bg-card text-card-foreground space-y-4"
    >
      <div>
        <h1 className="text-xl font-semibold">Nova senha</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Escolhe uma senha de pelo menos {MIN_PASSWORD_LENGTH} caracteres.
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="new-password" className="text-sm font-medium block">
          Nova senha
        </label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          autoFocus
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={isBusy}
          className="w-full p-2 border rounded-md bg-background text-foreground disabled:opacity-50"
        />
        {passwordTooShort && (
          <p className="text-destructive text-sm">
            Senha precisa ter pelo menos {MIN_PASSWORD_LENGTH} caracteres.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <label htmlFor="confirm-password" className="text-sm font-medium block">
          Confirmar senha
        </label>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          disabled={isBusy}
          className="w-full p-2 border rounded-md bg-background text-foreground disabled:opacity-50"
        />
        {passwordsDontMatch && (
          <p className="text-destructive text-sm">As senhas não conferem.</p>
        )}
      </div>

      {state.kind === 'error' && (
        <p className="text-destructive text-sm">{state.message}</p>
      )}

      <Button type="submit" disabled={!canSubmit || isBusy} className="w-full">
        {isBusy ? 'Atualizando...' : 'Atualizar senha'}
      </Button>
    </form>
  );
}
