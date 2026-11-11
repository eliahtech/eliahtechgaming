# Website promotional pop-ups

Three original promotional images are included in `public/promotions/`:

- `premium.webp` → `/premium`, hidden from active Premium members (including trials/admin entitlements).
- `guides.webp` → `/games`.
- `latest.webp` → the newest published, due post. Omitted if no published posts exist.

These are owned Eliahtech announcements, separate from paid ad placements. Paid ads remain posts-only and hidden from Premium members. Promotional pop-ups are allowed on the homepage, posts index/articles, game hub directory/detail, categories directory/detail. Contact, services, login/register, search, Premium/checkout, account, support and admin pages do not show them.

## Display behavior

The default delay is 12 seconds. Eligible promotions are chosen randomly, excluding the last displayed promotion when an alternative is available. Only one displays per browser per rolling 24 hours, across pages and reloads. This limit uses local storage; clearing browser data resets it. When storage is unavailable, the current page retains an in-memory fallback, but cross-reload persistence cannot be guaranteed. One remaining eligible promotion may repeat on a later day.

The image is a real link in the same tab. A separate visible × button closes without redirecting. Escape and a click outside the panel also close it. The dialog traps focus and returns focus to the previous control. It waits while the document is hidden, a form field is active or another dialog is open. Navigation cancels pending displays. Images are requested only when a display is due, and failed images do not create an empty pop-up or consume the daily allowance. Lightweight browsing disables promotional pop-ups.

## Admin → Promotions

Turn all promotions off, toggle each image, change its accessible title, local image/destination paths, optional schedule and Premium visibility. Delay may be 10–60 seconds. Dates use the browser's local time in the form and are saved as UTC. Destinations must be local website paths; images must be local PNG/JPEG/WebP paths. Use `@latest` to resolve the latest published article automatically. Premium upgrade campaigns always hide from Premium members.

The three defaults live in `public/promotions-data.js`. An administrator save overrides them in the existing settings table. Additional campaign definitions can be supplied through the existing protected settings API (up to 12, with unique IDs), or added to defaults before the first override. Admin form edits the configured list; it does not upload new files. Put additional files in `public/promotions/` when updating source.

No new SQL migration or environment variable is required specifically for promotions. Apply all previous project migrations as described in README before running the project. This source update has not been deployed and no production settings have been changed. No third-party tracking or ad script is added by this feature. Impressions/click analytics are not implemented.

## Verification

The current automated report includes page allowlisting, safe path validation, scheduling, Premium filtering, dynamic latest-post resolution, random non-repetition and the daily cap. The browser report tests mobile fit, focus, × and Escape dismissal, the daily cap across reloads, next-day rotation, image-link navigation, dashboard rendering and lightweight mode against mocked APIs. Live Supabase/auth and deployment still require staging verification.
