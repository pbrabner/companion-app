// Verifica que onboarding_baseline existe no live com as colunas canônicas.
// Uso: node supabase/reconcile/verify-onboarding-baseline.mjs
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
const EXPECTED = ['created_at', 'life_areas', 'mood', 'user_id'];

let fail = 0;
const check = (ok, label) => {
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + label);
  if (!ok) fail += 1;
};

const spec = await (await fetch(url + '/rest/v1/', { headers: h })).json();
const t = spec.definitions?.onboarding_baseline;
const cols = t ? Object.keys(t.properties).sort() : [];
check(
  JSON.stringify(cols) === JSON.stringify([...EXPECTED].sort()),
  'colunas == ' + EXPECTED.join(',') + ' (got: ' + cols.join(',') + ')',
);

console.log('\n' + (fail === 0 ? 'TUDO VERDE ✅' : fail + ' FALHA(S) ❌'));
process.exit(fail === 0 ? 0 : 1);
