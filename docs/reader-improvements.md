# Game hubs and reader improvements

## Database and setup

Back up your database and apply only pending migrations, in filename order. This update adds `supabase/migrations/20261025120000_reader_improvements.sql`, after `20261025100000_gaming_upgrade.sql` and `20261025110000_model_pool.sql`. The expected health marker is now `20261025_reader_improvements`. No production migrations have been run for you.

The new tables and queue RPCs are restricted to the server service role. All dashboard endpoints require an administrator session; browser mutations retain the existing CSRF protection and manual checks have a durable rate limit.

## Game hubs

Visit `/games` for the hub directory. Each `/games/:slug` collects installation, gameplay, settings, textures, update and troubleshooting posts, with type filters and pagination. Admin → Game hubs manages names, covers, introduction, platforms and visibility. Five starter hubs are seeded without inventing posts or tested compatibility. Assign each existing article’s Game hub and Guide type in Admin → Posts to populate the hubs. General posts may remain unassigned.

## Compatibility and search

The post editor now supports platform, RAM in GB, storage in MB, minimum Android version, emulator version, tested devices, actual test date, review date and notes. Enter only requirements you can substantiate. Unknown fields remain unknown on the public page; nothing claims a device was tested unless you enter it. Future testing/review dates are rejected.

`/search` and `/api/v1/search` support query, game UUID, platform, guide type, free/premium access, RAM and storage. RAM/storage filters show declared requirements at or below the reader’s limits and exclude articles with unknown requirements. These matches do not guarantee performance. Search and suggestions expose article metadata, never protected article bodies.

## Public update history and next steps

When saving a real change to an already published/due article, enter a Public change summary for this save. The database records a dated summary. The field starts blank on each editor visit; leave it blank to avoid a new public note. Full revision snapshots remain private admin records. Link scan timestamps do not create revisions or public notes. Change summaries are public editorial metadata through the updates API, so do not place premium instructions or secrets in them.

Unlocked articles display their recorded update history and Continue learning cards. Suggestions prioritize the next guide type within the same game; unassigned articles fall back to category suggestions. This is a content progression recommendation, not a claim that the visitor completed a lesson.

## Browsing preferences

Use Preferences in the slideshow or Browsing preferences in the footer. Lightweight mode suppresses slideshow image loading and autoplay, while retaining text, category links and manual navigation. Separate toggles control autoplay and animation. Preferences persist in this browser using local storage and a preference cookie; the server uses that cookie to omit initial slideshow image sources on later page loads. Article images remain available. Browser data-saver/reduced-motion signals supply defaults until a preference is saved. A first visit without the cookie may fetch the initial server-rendered image before client data-saver detection.

## Link checking and quality dashboard

Admin → Content quality shows published post counts, missing covers, reviews due after 180 days, device guides without testing dates, unresolved reports, broken/pending links and unsuccessful searches from the past 30 days. It links to the relevant editing screens. Review dates are explicit editorial fields; a background job does not silently mark an article reviewed.

Check next link batch or Check links in a saved post inventories article/cover/social images, enabled attached installation guides and active downloads. Each batch scans at most three posts and claims at most six URLs, in groups of three. Weekly re-inventory discovers changed attachments and downloads. Existing scheduled jobs now run the same bounded checker after notification/newsletter work. Automatic runs require your existing external scheduler to POST `/api/v1/jobs/run` with the configured bearer `JOBS_TOKEN` and `SCHEDULER_ENABLED=true`; this update does not provision or enable a scheduler.

The checker uses HTTPS on standard ports, validates each redirect, blocks private/reserved destinations and pins DNS to validated addresses. It reads response headers, using HEAD then a small ranged GET fallback when necessary; it does not download linked files. Each URL has a seven-second budget and a 60-second queue lease. Successful links are rechecked after seven days; other results after one day. A 404/410 is marked broken, authentication/rate-limit responses restricted, connection/server failures temporary, unsafe destinations blocked and HTTP-only URLs unsupported. Anti-bot protection may prevent automated verification. No link or post is automatically deleted or unpublished. Edit the source article/download to fix a URL, then run another scan; removed URLs become inactive.

## Validation and limits

See `reports/verification.md`, `reports/reader-browser.json` and `reports/slideshow-browser.json`. Local automated tests include SSRF and redirect checks, metadata filters, suggestion progression, preference rendering and PostgreSQL-compatible migration fixture checks for reruns, queue leases, update history and restricted RPC grants. Browser evidence uses mocked content/APIs at desktop/mobile widths. It does not verify your live database, external downloads, provider credentials or deployment.

## Migration filenames

The three `20261025_*` migrations previously shared one version prefix, which the Supabase CLI cannot track (version collision). They are now `20261025100000_gaming_upgrade.sql`, `20261025110000_model_pool.sql` and `20261025120000_reader_improvements.sql`, applied in that order. The in-database health marker (`app_health.schema_version`) is unchanged: `20261025_reader_improvements`. If you already applied the old files with `supabase db push`, run `supabase migration repair` for the new versions instead of re-running them.
