/**
 * Public Supabase browser client factory. Uses the anon key, so all
 * queries are subject to RLS. Safe to import from Client Components
 * and Pages Router client code.
 * @module shared/db/browser
 */

import { createBrowserClient as createSsrBrowserClient } from '@supabase/ssr';

import type { Database } from './types';

function readEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function createBrowserClient() {
  const url = readEnv('NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');

  return createSsrBrowserClient<Database>(url, anonKey);
}
