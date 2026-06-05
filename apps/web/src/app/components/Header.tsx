/**
 * Header — App-level header bar (async Server Component).
 * Reads the authenticated user server-side via Supabase SSR and renders
 * the LogoutButton only when a user is present. Returns null for
 * unauthenticated requests so public routes (/login, /auth/callback, /)
 * remain visually unaffected.
 * @module app/components/Header
 */

import { createServerClient } from '../../shared/db/server';
import { LogoutButton } from './LogoutButton';

export async function Header() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  return (
    <header className="w-full border-b bg-background">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <span className="text-base font-semibold">Companion</span>
        <LogoutButton userEmail={user.email ?? undefined} />
      </div>
    </header>
  );
}
