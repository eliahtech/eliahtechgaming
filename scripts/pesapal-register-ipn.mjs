// One-time PesaPal IPN registration (API 3.0 URLSetup/RegisterIPN). Run it once per environment, NOT per payment:
//   PESAPAL_IPN_URL=https://your-domain/api/v1/payments/pesapal/ipn npm run pesapal:register-ipn
// Reads PESAPAL_CONSUMER_KEY / PESAPAL_CONSUMER_SECRET / PESAPAL_ENV from the environment, prints the ipn_id, and lists what is
// already registered so you do not register the same URL twice. Put the printed id in PESAPAL_IPN_ID. Nothing secret is printed.
import { createPesaPalProvider, pesapalConfig } from '../src/payments/pesapal.js';

const config = pesapalConfig(process.env);
if (!config.ok) { console.error(config.reason); process.exit(1); }
const url = process.env.PESAPAL_IPN_URL;
if (!url || !/^https:\/\//.test(url)) { console.error('Set PESAPAL_IPN_URL to your public https IPN endpoint (APP_URL/api/v1/payments/pesapal/ipn).'); process.exit(1); }

const pesapal = createPesaPalProvider();
try {
  console.log(`Environment: ${config.environment}`);
  const existing = (await pesapal.listIpns()).find((i) => i.url === url);
  if (existing) { console.log(`Already registered. PESAPAL_IPN_ID=${existing.ipnId} (${existing.method}, ${existing.status})`); process.exit(0); }
  const created = await pesapal.registerIpn({ url, method: 'POST' });
  console.log(`Registered ${created.url} as ${created.method}.\nPESAPAL_IPN_ID=${created.ipnId}`);
} catch (error) {
  console.error(`Registration failed: ${error.message}`);
  process.exit(1);
}
