'use client';

/**
 * ForgotPasswordForm — Client Component que dispara reset password
 * email via Supabase. Renderiza inline em LoginForm quando state.kind
 * === 'forgot'. Não confirma se email existe (anti-enumeration).
 * @module app/login/ForgotPasswordForm
 */

import { useState } from 'react';

import { Button } from '../../design-system/components/Button';
import { createBrowserClient } from '../../shared/db/browser';

type ForgotState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; email: string }
  | { kind: 'error'; message: string };

export interface ForgotPasswordFormProps {
  onBack: () => void;
}

export function ForgotPasswordForm({ onBack }: ForgotPasswordFormProps) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<ForgotState>({ kind: 'idle' });

  const isValid = /^\S+@\S+\.\S+$/.test(email);
  const isBusy = state.kind === 'sending';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid || isBusy) return;

    setState({ kind: 'sending' });

    try {
      const supabase = createBrowserClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/reset-password`,
      });

      if (error) {
        setState({ kind: 'error', message: error.message });
        return;
      }

      setState({ kind: 'sent', email });
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Erro inesperado.',
      });
    }
  }

  if (state.kind === 'sent') {
    return (
      <div className="max-w-md w-full p-6 border rounded-lg bg-card text-card-foreground">
        <h1 className="text-xl font-semibold mb-2">📬 Verifica seu email</h1>
        <p className="text-muted-foreground">
          Se esse email está cadastrado, você receberá um link em instantes pra
          redefinir sua senha.
        </p>
        <p className="text-sm text-muted-foreground mt-4">
          <button
            type="button"
            onClick={onBack}
            className="underline hover:text-foreground"
          >
            Voltar pro login
          </button>
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-md w-full p-6 border rounded-lg bg-card text-card-foreground space-y-4"
    >
      <div>
        <h1 className="text-xl font-semibold">Esqueci minha senha</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Coloca seu email e te mando um link pra redefinir.
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="forgot-email" className="text-sm font-medium block">
          Email
        </label>
        <input
          id="forgot-email"
          type="email"
          autoComplete="email"
          autoFocus
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={isBusy}
          placeholder="seu@email.com"
          className="w-full p-2 border rounded-md bg-background text-foreground disabled:opacity-50"
        />
      </div>

      {state.kind === 'error' && (
        <p className="text-destructive text-sm">{state.message}</p>
      )}

      <Button type="submit" disabled={!isValid || isBusy} className="w-full">
        {isBusy ? 'Enviando...' : 'Enviar link de reset'}
      </Button>

      <div className="text-center">
        <button
          type="button"
          onClick={onBack}
          disabled={isBusy}
          className="text-sm text-muted-foreground underline hover:text-foreground disabled:opacity-50"
        >
          Voltar pro login
        </button>
      </div>
    </form>
  );
}
