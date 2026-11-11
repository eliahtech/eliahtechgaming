# Eliahtech Gaming — Express / Bootstrap edition

Node.js + Express, server-rendered public HTML, Bootstrap 5 and plain JavaScript. Supabase remains the database, authentication and storage service. No Next.js, React, Firebase or Cloudflare runtime is required.

## Local setup

1. Install Node.js 22 and run `npm ci`.
2. Copy `.env.example` to `.env`. Set APP_URL=http://localhost:3000, PORT=3000, SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.
3. Back up Supabase. On an existing project, apply only pending migrations, in filename order. New migrations: `20261025100000_gaming_upgrade.sql`, `20261025110000_model_pool.sql` and `20261025120000_reader_improvements.sql`. On a fresh project, apply all migrations once in order. Historical migrations are not universally rerunnable.
4. Run `npm run build`, then `npm start`. Open http://localhost:3000.
5. Use your existing administrator account. For a new project, register/verify your account, then set its profile role to admin in the trusted Supabase SQL editor.

No production migrations have been run. Never put the service-role key in browser code.

## Vercel

See [hosting instructions](docs/hosting-vercel.md). Select Framework Preset **Other**, Node.js 22.x and build command `npm run build:vercel`. Clear old Next.js output/framework overrides. The supplied vercel.json routes public pages and APIs through one Express function.

## Features

- /posts and /posts/:slug: initial HTML, cover cards, pagination, guides, sharing and SEO.
- /admin: responsive Bootstrap CMS, payments, AI, ads, support and settings.
- /community: bookmarks, history, devices, follows, tickets, notifications and tutorial requests.
- /ai: routing, screenshots, optional transcription, downloadable conversation text and saved task resume.
- /premium: plans and existing PesaPal/PayPal checkout.

See [upgrade status](docs/upgrade-status.md), [environment](docs/environment.md) and [content import](docs/content-import.md).

## Checks

`npm test`, `npm run build`, `npm run security:secrets` and `npm run verify:env` are local checks. `npm run test:sql` executes the new migrations twice against an isolated PostgreSQL-compatible fixture; `npm run report` regenerates evidence. Optional live checks: verify:supabase and verify:deployment (set DEPLOY_URL). Tests mock external services; they do not prove live credentials work.

The editor is vendored. Update deliberately with `node scripts/vendor-editor.mjs` (default 4.18.10). Ordinary builds prepare Bootstrap locally and do not download the editor.


## Header slideshow and branding

The latest ETG logo/favicon and 14 category images are included. The header loops every three seconds across every page, with five transitions, readable captions and accessible controls. Images are under `public/slides`; edit `public/slides-data.js` to change text or add up to five per category. See `docs/slides-and-branding.md`. This visual update needs no new SQL migration.

## Game hubs and reader tools

Game hubs, compatibility fields, public update notes, filtered search, Continue learning cards, saved lightweight browsing and a content-quality dashboard are included. The optional scheduler now also checks article/download/image URLs. See [reader improvements](docs/reader-improvements.md) for setup, editing and limits. This update requires the new reader-improvements SQL migration above.

## Promotional pop-ups

Three original linked images rotate randomly, with a close button, a 12-second delay and one display per browser every 24 hours. Admin → Promotions manages visibility, links and schedules. These are owned announcements; paid ads remain posts-only and Premium-excluded. No additional SQL is required for promotions. See [promotions](docs/promotions.md).

Design, fonts, covers and homepage structure: see `docs/design.md`.
Newsletter sending, the daily limit and the scheduler: see `docs/newsletter.md`.
SEO, sitemap, feed, structured data and search-console setup: see `docs/seo.md`.
