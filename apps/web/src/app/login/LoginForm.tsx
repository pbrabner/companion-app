'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { Button } from '../../design-system/components/Button';
import { createBrowserClient } from '../../shared/db/browser';
import { ForgotPasswordForm } from './ForgotPasswordForm';

const CALLBACK_ERROR_MESSAGES: Record<string, string> = {
  missing_code: 'Link inválido ou expirado. Tenta gerar um novo.',
  exchange_failed: 'Não foi possível validar o link. Tenta gerar um novo.',
};

type FormState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; email: string }
  | { kind: 'error'; message: string }
  | { kind: 'forgot' };

export function LoginForm() {
  const searchParams = useSearchParams();
  const callbackError = searchParams.get('error');
  const callbackMessage = callbackError ? CALLBACK_ERROR_MESSAGES[callbackError] : null;

  const [email, setEmail] = useState('');
  const [state, setState] = useState<FormState>({ kind: 'idle' });

  const isValid = /^\S+@\S+\.\S+$/.test(email);
  const isBusy = state.kind === 'sending';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid || isBusy) return;

    setState({ kind: 'sending' });

    try {
      const supabase = createBrowserClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
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

  if (state.kind === 'forgot') {
    return <ForgotPasswordForm onBack={() => setState({ kind: 'idle' })} />;
  }

  if (state.kind === 'sent') {
    return (
      <div className="max-w-md w-full p-6 border rounded-lg bg-card text-card-foreground">
        <h1 className="text-xl font-semibold mb-2">📬 Link enviado</h1>
        <p className="text-muted-foreground">
          Mandei um magic link pra <strong>{state.email}</strong>. Abre o email
          e clica no link pra entrar.
        </p>
        <p className="text-sm text-muted-foreground mt-4">
          Não chegou em 1-2 min?{' '}
          <button
            type="button"
            onClick={() => setState({ kind: 'idle' })}
            className="underline hover:text-foreground"
          >
            Tentar de novo
          </button>
          .
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
        <h1 className="text-xl font-semibold">Entrar no Companion</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Vou te mandar um magic link no email. Sem senha.
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="email" className="text-sm font-medium block">
          Email
        </label>
        <input
          id="email"
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
      {state.kind === 'idle' && callbackMessage && (
        <p className="text-destructive text-sm">{callbackMessage}</p>
      )}

      <Button type="submit" disabled={!isValid || isBusy} className="w-full">
        {isBusy ? 'Enviando...' : 'Enviar link'}
      </Button>

      <div className="text-center">
        <button
          type="button"
          onClick={() => setState({ kind: 'forgot' })}
          disabled={isBusy}
          className="text-sm text-muted-foreground underline hover:text-foreground disabled:opacity-50"
        >
          Esqueci minha senha
        </button>
      </div>
    </form>
  );
}
