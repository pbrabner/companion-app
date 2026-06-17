// Verifica que o profiles live bate com a forma canônica das migrations.
// Uso: node supabase/reconcile/verify-profiles.mjs
// Lê apps/web/.env.local (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const env = readFileSync(join(root, 'apps', 'web', '.env.local'), 'utf8');
const get = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
};
const url = get('NEXT_PUBLIC_SUPABASE_URL');
const key = get('SUPABASE_SERVICE_ROLE_KEY');
const h = { apikey: key, Authorization: 'Bearer ' + key };

const CANONICAL = [
  'id',
  'display_name',
  'onboarded_at',
  'privacy_accepted_at',
  'active_track',
  'created_at',
];

let failures = 0;
const check = (ok, label) => {
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + label);
  if (!ok) failures += 1;
};

const spec = await (await fetch(url + '/rest/v1/', { headers: h })).json();
const profiles = spec.definitions?.profiles;
const cols = profiles ? Object.keys(profiles.properties).sort() : [];
check(
  JSON.stringify(cols) === JSON.stringify([...CANONICAL].sort()),
  'profiles colunas == canônicas (got: ' + cols.join(',') + ')',
);

const tracksRes = await fetch(url + '/rest/v1/tracks_catalog?select=slug', {
  headers: { ...h, Prefer: 'count=exact' },
});
const tracks = await tracksRes.json();
check(Array.isArray(tracks) && tracks.length === 3, 'tracks_catalog tem 3 linhas (got: ' + (Array.isArray(tracks) ? tracks.length : 'erro') + ')');

const rowsRes = await fetch(url + '/rest/v1/profiles?select=id,display_name,created_at,onboarded_at', { headers: h });
const rows = await rowsRes.json();
check(Array.isArray(rows), 'select de profiles respondeu (onboarded_at acessível)');
if (Array.isArray(rows) && rows.length) {
  const r = rows[0];
  check(!!r.id && !!r.created_at, 'linha preexistente preservada (id/created_at intactos)');
  check(r.onboarded_at === null, 'onboarded_at null na linha existente (novo campo)');
}

console.log('\n' + (failures === 0 ? 'TUDO VERDE ✅' : failures + ' FALHA(S) ❌'));
process.exit(failures === 0 ? 0 : 1);
