/**
 * Public Supabase browser client factory. Uses the anon key, so all
 * queries are subject to RLS. Safe to import from Client Components
 * and Pages Router client code.
 * @module shared/db/browser
 */

import { createBrowserClient as createSsrBrowserClient } from '@supabase/ssr';

import type { Database } from './types';

// NEXT_PUBLIC_* vars precisam ser acessadas ESTATICAMENTE (process.env.FOO)
// pro Next.js inline-las no bundle client em build time. Acesso dinamico
// (process.env[name]) NÃO é inlined → vira undefined no browser.
export function createBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'Missing Supabase env vars (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY). ' +
        'Verifique apps/web/.env.local e reinicie o dev server.',
    );
  }

  return createSsrBrowserClient<Database>(url, anonKey);
}
