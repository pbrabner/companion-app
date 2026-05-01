/**
 * Helper script for `pnpm db:types`. Runs the Supabase CLI to regenerate
 * TypeScript bindings for the local database, prepends the project TSDoc
 * header, and writes the result atomically to apps/web/src/shared/db/types.ts.
 * Stderr from the Supabase CLI (status banners) is suppressed so the file
 * never contains banner noise.
 * @module scripts/gen-db-types
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HEADER = [
  '/**',
  ' * Auto-generated Supabase database types. DO NOT EDIT BY HAND.',
  ' * Regenerate via `pnpm db:types`.',
  ' * @module shared/db/types',
  ' */',
  '',
  '',
].join('\n');

const result = spawnSync(
  'pnpm',
  ['exec', 'supabase', 'gen', 'types', 'typescript', '--local'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: true },
);

if (result.status !== 0 || !result.stdout) {
  console.error('supabase gen types failed (exit', result.status, ')');
  if (result.stderr) console.error(result.stderr);
  process.exit(result.status ?? 1);
}

const target = resolve(process.cwd(), 'src/shared/db/types.ts');
writeFileSync(target, HEADER + result.stdout, 'utf8');
console.log('wrote', target);
