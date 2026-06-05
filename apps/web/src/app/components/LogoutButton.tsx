'use client';

/**
 * LogoutButton — Client Component for signing out via Supabase.
 * Uses scope: 'local' to only sign out current device (not all sessions).
 * On success, navigates to /login. On error, surfaces message and re-enables button.
 * @module app/components/LogoutButton
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '../../design-system/components/Button';
import { createBrowserClient } from '../../shared/db/browser';

type LogoutState =
  | { kind: 'idle' }
  | { kind: 'signing_out' }
  | { kind: 'error'; message: string };

export interface LogoutButtonProps {
  userEmail?: string;
}

export function LogoutButton({ userEmail }: LogoutButtonProps) {
  const router = useRouter();
  const [state, setState] = useState<LogoutState>({ kind: 'idle' });

  const isBusy = state.kind === 'signing_out';

  async function handleClick() {
    if (isBusy) return;

    setState({ kind: 'signing_out' });

    try {
      const supabase = createBrowserClient();
      const { error } = await supabase.auth.signOut({ scope: 'local' });

      if (error) {
        setState({ kind: 'error', message: error.message });
        return;
      }

      router.push('/login');
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Erro inesperado ao sair.',
      });
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-3">
        {userEmail && (
          <span className="text-sm text-muted-foreground">{userEmail}</span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleClick}
          disabled={isBusy}
        >
          {isBusy ? 'Saindo...' : 'Sair'}
        </Button>
      </div>
      {state.kind === 'error' && (
        <p className="text-destructive text-sm">{state.message}</p>
      )}
    </div>
  );
}
