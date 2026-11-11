# Upgrade status and feature inventory

| Area | Implemented behavior |
|---|---|
| Migration | Express HTML templates, Bootstrap and plain JavaScript; Next/React removed |
| Public posts | Initial HTML/metadata, real covers, sharing, linked guides, related posts, breadcrumbs and pagination |
| SEO | Canonical links, Open Graph/Twitter, BlogPosting/Breadcrumb JSON-LD and paginated sitemap index |
| Admin | Sidebar/mobile menu, overview, visual/HTML editor, media, plan prices, site/social settings and existing integration controls |
| Editing recovery | Local autosave, separate server backups for saved drafts, authenticated preview, sandboxed current preview, revisions/restore |
| Covers | 1200×675 article crop and 1200×630 sharing crop with zoom/position controls |
| Authentication | Existing Supabase flows and Google PKCE retained; HttpOnly browser sessions and CSRF protection |
| Payments | Existing verified PesaPal/PayPal services retained; async callback errors reach central handler |
| Ads | Global switch, header/body/footer/sidebar/auto, dates and device targeting; posts only, Premium excluded |
| Membership | Protected guides, ad-free posts, priority support, configurable allowance/hours and entitlement-protected community URL |
| Reader tools | Bookmarks, history, device profile, feedback, reports, comments/moderation, follows/in-app notifications, requests/voting |
| AI | Free-only registry, coding classification, screenshot capability matching, optional voice transcription and text export |
| AI recovery | Cross-provider failover, shared SQL cooldowns, Retry-After, durable owner-scoped tasks, leases and pause/resume |
| Support | User-selected conversation reference, admin replies/status and member-visible ticket history |
| Analytics | Existing AI/payment analytics plus recent reader feedback, reports and redacted search events |
| Content | Two short recovered HTML artifacts as drafts; Blogger Atom converter and rerunnable import SQL generator |
| Jobs | Optional authenticated scheduler endpoint for newsletter batches, due game notifications and bounded link checks |

## External configuration and limits

- No live Supabase, storage, Google, payments, Resend, ads or model credentials were supplied. These integrations remain unverified against your accounts. Nothing has been deployed or written to production.
- New chat model candidates are disabled until tested. The two previously configured free routes retain settings. Verify exact IDs, pricing, commercial-use terms and quotas. Eight chat candidates plus two dedicated Whisper transcription models form the proposed ten-model pool; Whisper is not a chat fallback.
- OpenRouter only accepts :free IDs. Use unpaid/free-tier Google/Groq projects. A database “free” flag cannot override a provider billing plan.
- Quotas can be shared. A 429 conservatively cools down that provider. When all compatible free routes fail, tasks pause; there is no unlimited-availability promise or paid fallback.
- Tasks preserve conversation/context, not internal model thinking. They are user-driven request jobs, not autonomous browser agents.
- Guide retrieval, screenshot analysis, optional transcription and conversation-text export are implemented. Arbitrary code execution, live web search and image generation are disabled/unadvertised without separate suitable integrations. Never run untrusted code inside this server.
- Voice requires AI_VOICE_ENABLED=true and Groq access; both Whisper models share account limits.
- Game notifications are in-app. Optional email uses the existing newsletter system, not automatic per-game messages.
- Community invitation access is protected by this application. Telegram membership/removal and support staffing remain manual.
- Ad approval, delivery, consent requirements and platform-specific origin configuration are external. Device detection uses user-agent hints and is approximate.
- Saved previews require an administrator session. They are not transferable public draft links.
- Recovered articles are short/incomplete artifacts. A full Blogger export is needed to verify all historical posts. No missing content or URLs were invented.
- Historical migrations are not all rerunnable. Apply only pending files to an existing database.

## Verification

See reports/verification.md. Backend/API tests mock external integrations. New migrations were additionally executed twice against an isolated PostgreSQL-compatible schema fixture, checking revisions, notifications, task leases, cooldowns and health version. This is not live Supabase/RLS/storage verification.

Next-specific tests were retired with their implementation. Backend tests remain and new Express/SSR/session, ads, task recovery/ownership and community access tests cover the replacement contracts.


Browser rendering was checked on six page types at desktop/mobile widths with mocked data, including crop and preview controls. No page errors/overflow were observed. Live user workflows still require staging checks.

## Header/branding visual update

Added 14 original background images (two per category), desktop/mobile WebP variants and one shared site-wide slideshow. Autoplay is three seconds with last-to-first wrap and five alternating transition styles. Controls include pause, previous/next, direct selection, keyboard arrows and touch swipes. Reduced motion and background/off-screen pause are supported. The latest ETG controller emblem now supplies the site logo, email branding, PNG icons, multi-size favicon and manifest. See docs/slides-and-branding.md and the updated verification reports.

## Reader and editorial update

Added editable game hubs, compatibility/requirement fields, declared-requirement search filters, dated public change notes, same-game Continue learning suggestions, remembered lightweight/autoplay/animation controls and an admin quality dashboard. Link checking inventories active downloads, article images and enabled attached guides, with public-network HTTPS restrictions and reviewable status flags. Apply `20261025120000_reader_improvements.sql` after the prior new migrations. Starter hubs require assigning real posts; compatibility claims remain empty until editors enter tested facts. See `docs/reader-improvements.md` and the current reports. Automatic checks depend on configuring the existing optional scheduler.

## Website promotions

Three original local PNG campaigns and a shared accessible pop-up module are included. Eligible owned promotions rotate randomly without repeating the last selection when alternatives exist. A rolling 24-hour browser cap, schedules, protected settings editor, Premium-upgrade exclusion and lightweight-mode suppression are implemented. See `docs/promotions.md`; no additional migration is required for this feature.
