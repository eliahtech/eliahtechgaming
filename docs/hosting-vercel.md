# Vercel deployment

1. Import the source repository. Exclude .env, node_modules and Git internals from ZIPs.
2. Select Other, Node.js 22.x and build command npm run build:vercel. Clear Next.js framework/output-directory overrides. The supplied vercel.json defines the Express function and 60-second limit; confirm your account supports it.
3. Set APP_URL to the production HTTPS domain, SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY. SITE_API_URL is optional/obsolete; there is no separate backend host.
4. Back up the database and apply only pending migrations. Do not rerun initialization migrations on an existing project.
5. Configure Supabase Auth Site URL and allowed redirects for /login, /reset-password and /api/auth/google/callback. Enable Google in Supabase before setting GOOGLE_AUTH_ENABLED=true.
6. Preserve/configure the existing media bucket (see src/admin/media.js and the CMS migration). Uploads go to Supabase, never persistent Vercel disk.
7. Configure Resend/PesaPal/PayPal credentials for integrations you use. PesaPal: /api/v1/payments/pesapal/ipn and /api/v1/payments/pesapal/callback. PayPal: /api/v1/payments/webhooks/paypal. Test sandbox transactions first.
8. Configure GROQ_API_KEY, GEMINI_API_KEY and optionally OPENROUTER_API_KEY as server secrets. Test account access and verify free-tier eligibility before enabling new model candidates.
9. For ads, set AD_ALLOWED_ORIGINS to comma-separated exact HTTPS origins documented by your platform (scripts, frames and connections). Blank disables ad-code execution. Add placements and enable the global ads switch. Do not weaken the whole-site security policy.
10. Check /api/v1/health/supabase, direct post visits, login, uploads, premium protection and provider sandbox flows before launch.

## Scheduled work

Future published_at dates control visibility without a running server process. A scheduled job sends the day's share of the active newsletter campaign and creates due followed-game notifications.

`vercel.json` already contains a daily Vercel Cron entry (`30 3 * * *` UTC, 06:30 in Kenya, shortly after the mail quota resets at 00:00 UTC). To enable it, set `SCHEDULER_ENABLED=true` and a random 32+ character `CRON_SECRET` on the production deployment (Vercel then sends it as `Authorization: Bearer <CRON_SECRET>` with a GET request to `/api/v1/jobs/run`). Cron runs only on production deployments. On the free Hobby plan Vercel runs a cron job once a day, at some point inside the scheduled hour.

An external scheduler works too: set `JOBS_TOKEN` and call `POST /api/v1/jobs/run` with `Authorization: Bearer <JOBS_TOKEN>`, or run `scripts/jobs-runner.mjs` with `APP_URL` and `JOBS_TOKEN` set. Extra calls are harmless: newsletters never exceed the daily limit and a short database lease prevents overlap.

See `docs/newsletter.md` for how the daily limit works.

AI tasks are durable, user-driven jobs with explicit resume. They execute bounded provider calls within requests; this is not an always-running background agent.

Personalized articles are private, no-store. Supabase, Vercel and AI provider quotas remain independent.


## Mobile

All pages load `/mobile.css` last (44px touch targets, 16px form fields to prevent iOS zoom, safe-area insets, full-width toasts, scrollable tables) and declare `viewport-fit=cover`. After deploying, spot-check a post, `/games`, `/ai`, `/login` and `/admin` at 360px and 390px widths on a real phone or browser device mode.
