/**
 * Server-side Supabase client factory for the Companion web app.
 * Returns a fresh client per call so that each Server Action / Route
 * Handler sees the current request's cookies and acts under the
 * authenticated user's RLS context.
 * @module shared/db/server
 */

import { createServerClient as createSsrServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

function readEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export async function createServerClient() {
  const url = readEnv('NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const cookieStore = await cookies();

  return createSsrServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies; ignored — middleware
          // takes care of session refresh.
        }
      },
    },
  });
}