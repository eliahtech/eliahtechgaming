import { validateEnv, formatEnvErrors } from '../src/config/env.js';
const r = validateEnv(process.env);
console.log(`mode: ${r.production ? 'production' : 'non-production'}`);
for (const [k, v] of Object.entries(r.integrations)) console.log(`${k.padEnd(9)} ${v}`);
if (!r.ok) { console.error(`\nFAIL\n${formatEnvErrors(r)}`); process.exit(1); }
console.log('PASS');
