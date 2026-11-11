# Cloudflare Workers hosting

Current setup: vinext (Next.js on Vite) + `@cloudflare/vite-plugin`, configured by `cloudflare.config.ts` and `vite.config.ts`. **This is the only Cloudflare configuration in the repo.** It has not been built or deployed in this repair (no network); see `reports/verification.md`. vinext is a third-party reimplementation; the alternative, `@opennextjs/cloudflare`, is the commonly used route. Decide after a real build on a networked machine — do not run both.

**Architecture limit:** the Worker serves the Next.js app only. The Express API (`server.js`) does not run on Workers, so `SITE_API_URL` must point to a separately hosted API (e.g. the Vercel deployment's Express function). Cloudflare therefore does **not** host the complete application.

## Variables and secrets
Names identical to Vercel. Required in production: `APP_URL`, `SITE_API_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY   # repeat for every `secret` in docs/environment.md
npx wrangler secret put SUPABASE_ANON_KEY
# non-secret values: add under [vars] / dashboard → Settings → Variables
```
`nodejs_compat` plus a compatibility date ≥ 2025-04-01 exposes bindings through `process.env`, which is what the code reads. This must be confirmed at runtime via `/api/health/supabase` after deploy.
## Build & deploy
```bash
npm ci && npx vinext check && npm run build:vinext
npm run deploy:vinext
```
## Verification (real Worker URL)
```bash
DEPLOY_URL=https://eliah-tech.<account>.workers.dev HEALTH_DIAGNOSTICS_TOKEN=... npm run verify:deployment -- --platform cloudflare
```
## Duplicate-run safety
Only one deployment should own scheduled work. No scheduled jobs exist today; `SCHEDULER_ENABLED` is reserved for that purpose. Active production domain: **choose one and record it here** (default recommendation: Vercel, because it runs the Express API).
