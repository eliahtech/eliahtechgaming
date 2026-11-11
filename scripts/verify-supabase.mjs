// Live Supabase verification. Read-only. Prints PASS / FAIL / NOT CONFIGURED; never prints URLs, keys or SQL errors.
import { checkSupabase } from '../src/health/supabase.js';
import { supabaseSettings } from '../src/config/env.js';
if (!supabaseSettings(process.env)) { console.log('NOT CONFIGURED: set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY. No live test was performed.'); process.exit(2); }
const r = await checkSupabase({ detailed: true, useCache: false, timeoutMs: 8000 });
for (const [k, v] of Object.entries(r.checks || {})) console.log(`${k.padEnd(18)} ${v.status.toUpperCase()}${v.reason ? ` (${v.reason})` : ''} ${v.ms}ms`);
console.log(r.status === 'ok' ? 'PASS (live)' : `FAIL (${r.status})`);
process.exit(r.status === 'ok' ? 0 : 1);
