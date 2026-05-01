/**
 * Service-role Supabase client. Bypasses RLS — use only for trusted
 * server-side jobs (admin tasks, writes to safety_events). NEVER expose
 * this module to the client bundle. The `import 'server-only'` directive
 * below makes Next.js fail the build if this file is reachable from a
 * Client Component, providing defense in depth alongside the env var
 * boundary (SUPABASE_SERVICE_ROLE_KEY has no NEXT_PUBLIC_ prefix).
 * @module shared/db/service
 */
import 'server-only';

import { createClient } from '@supabase/supabase-js';

import type { Database } from './types';

function readEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function createServiceClient() {
  const url = readEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');

  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
