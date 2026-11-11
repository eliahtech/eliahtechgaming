# Environment variables

Use `.env` locally and Vercel Project Settings → Environment Variables in production. Never upload a real `.env`. `SITE_API_URL` is a retained optional legacy setting, unused by the Express frontend.

| Variable | Scope | Required | Format |
|---|---|---|---|
| `JOBS_TOKEN` | secret | optional (`JOBS_TOKEN` or `CRON_SECRET` required when `SCHEDULER_ENABLED=true`) | random secret, 32+ characters |
| `CRON_SECRET` | secret | optional | random secret, 32+ characters (Vercel Cron sends it automatically) |
| `AD_ALLOWED_ORIGINS` | config | optional | comma-separated exact https origins |
| `AI_VOICE_ENABLED` | config | optional | true  /  false |
| `OPENROUTER_API_KEY` | secret | optional | provider API key |
| `NODE_ENV` | config | optional | development  /  test  /  production |
| `APP_URL` | config | production | absolute URL; https:// in production |
| `SITE_API_URL` | config | optional | absolute URL of the Express API (…/api/v1); https:// in production |
| `ALLOWED_ORIGINS` | config | optional | comma-separated https:// origins |
| `HEALTH_DIAGNOSTICS_TOKEN` | secret | optional | random string, 24+ characters, no whitespace |
| `GOOGLE_AUTH_ENABLED` | config | optional | true  /  false (true only after enabling the Google provider in Supabase) |
| `SCHEDULER_ENABLED` | config | optional | true  /  false (true on exactly ONE deployment) |
| `SUPABASE_URL` | config | production | https://<project-ref>.supabase.co |
| `SUPABASE_ANON_KEY` | secret | production | anon/publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | secret | production | service-role/secret key (server only) |
| `SUPABASE_AUTH_HOOK_SECRET` | secret | optional | webhook signing secret |
| `RESEND_API_KEY` | secret | optional | re_… API key |
| `EMAIL_FROM` | config | optional | Name <address@domain> or address@domain |
| `EMAIL_TIMEOUT_MS` | config | optional | integer 1000–60000 |
| `GOOGLE_SITE_VERIFICATION` | config | optional | token from Google Search Console (HTML tag method) |
| `BING_SITE_VERIFICATION` | config | optional | token from Bing Webmaster Tools (HTML meta tag method) |
| `NEWSLETTER_BATCH_SIZE` | config | optional | integer 1–50 (emails claimed per request; default 50) |
| `NEWSLETTER_DAILY_LIMIT` | config | optional | integer 1–1000 (newsletter emails per UTC day; default 30; the admin setting overrides it) |
| `PESAPAL_ENV` | config | optional | sandbox  /  live |
| `PESAPAL_CONSUMER_KEY` | secret | optional | non-empty string |
| `PESAPAL_CONSUMER_SECRET` | secret | optional | non-empty string |
| `PESAPAL_IPN_ID` | config | optional | IPN id from `npm run pesapal:register-ipn` |
| `PESAPAL_IPN_URL` | config | optional | https URL |
| `PESAPAL_CALLBACK_URL` | config | optional | https URL |
| `PESAPAL_CANCELLATION_URL` | config | optional | https URL |
| `PESAPAL_BASE_URL` | config | optional | https URL |
| `PESAPAL_CURRENCY` | config | optional | ISO 4217 code, e.g. KES |
| `PAYPAL_BASE_URL` | config | optional | https://api-m.sandbox.paypal.com or https://api-m.paypal.com |
| `PAYPAL_CLIENT_ID` | secret | optional | non-empty string |
| `PAYPAL_CLIENT_SECRET` | secret | optional | non-empty string |
| `PAYPAL_WEBHOOK_ID` | config | optional | webhook id |
| `PAYPAL_CURRENCY` | config | optional | ISO 4217 code, e.g. USD |
| `PAYMENT_TIMEOUT_MS` | config | optional | integer 1000–60000 |
| `GROQ_API_KEY` | secret | optional | provider API key |
| `GEMINI_API_KEY` | secret | optional | provider API key |
| `AI_MAX_INPUT_CHARS` | config | optional | integer 1–100000 |
| `AI_MAX_OUTPUT_TOKENS` | config | optional | integer 1–32768 |
| `AI_MAX_RETRIES` | config | optional | integer 0–5 |
| `AI_REQUEST_TIMEOUT_MS` | config | optional | integer 1000–120000 |
| `AI_DEFAULT_MODEL` | config | optional | model key from ai_models |
| `AI_DEFAULT_CAPABILITY` | config | optional | capability name, e.g. general |
| `AI_ALLOWED_BASE_HOSTS` | config | optional | comma-separated hostnames |
| `CORS_ORIGIN` | config | optional | legacy alias of ALLOWED_ORIGINS |
| `PORT` | config | optional | integer 1–65535 (Express only) |
| `JODIT_VERSION` | config | optional | semver, used by `npm run vendor` |
