# Design system

Public pages load their styles in this order: Bootstrap, `gaming.css`, `slides.css`, `promotions.css`, `fonts.css`, `theme.css`, `mobile.css`. The admin/account shell loads `workspace.css`, `fonts.css` and `mobile.css`.

## Typography
Poppins (400, 500, 700) is self-hosted from `public/fonts` as small Latin-subset WOFF files (about 9 KB each), declared in `fonts.css` with `font-display: swap`; the 400 and 700 files are preloaded. System fonts are the fallback. To change weights or characters, run `python3 scripts/make-fonts.py <Poppins .ttf files>`. Poppins is licensed under the SIL OFL 1.1 (`public/fonts/POPPINS-LICENSE.txt`).

## Header and footer
`siteNav()` highlights the current section (`aria-current="page"`), shows Premium as a gold button and the account link as "Sign in" (`gaming.js` swaps it to the member's name and `/community` (the dashboard) when signed in). `siteFooter()` has Guides, Company and Legal columns, socials, a subscribe form (`data-newsletter`, handled in `gaming.js`) and a back-to-top link. The subscribe box is hidden on the homepage when the homepage newsletter section is enabled.

## Homepage
`homeHero()` shows the dashboard-controlled title, description and CTAs, a search box, category chips and only real numbers (guide and topic counts). Sections are rendered by `homeSection()`; categories become image tiles, AI and Premium become banners, and the newsletter becomes a card. Section keys, order and visibility are still controlled from the admin dashboard.

## Article covers
- Posts with no featured image use a branded 1200x675 cover for their category (`public/covers/<category>.webp`, ETG logo top-left). Older category slugs are mapped to the new ones in `templates.js`.
- Uploaded covers are never edited; the CSS adds a small ETG badge in the bottom-right corner (`.cover-frame`).
- Regenerate covers and homepage tiles with `python3 scripts/make-covers.py` (needs Pillow and numpy).

## Dark mode
`/theme.js` is loaded in the `<head>` before any CSS, so the right theme is applied before first paint (no flash). A saved choice (`localStorage` key `etg-theme`) wins; otherwise the page follows the device setting and updates live if the device changes. The sun/moon button in the navigation toggles it. The script sets `data-theme` and `data-bs-theme` on `<html>` (Bootstrap forms, tables and badges follow automatically) and updates the browser `theme-color`. All colours live in the variables at the top of `theme.css` (`:root` for light, `[data-theme="dark"]` for dark). `test/design.test.js` checks that every text/background pair in both palettes meets WCAG AA (4.5:1), so a palette change that hurts readability fails the tests. The admin dashboard keeps its own light styling.

## Loading and empty states
- Skeletons (`.skeleton`, `skeletonPanel()`, `skeletonCards()`) are server-rendered placeholders that shimmer while data loads (account page, reader solutions, community requests). They are `aria-hidden`, the container is `aria-busy`, and `gaming.js` clears the flag when real content arrives. Shimmer is disabled for visitors who prefer reduced motion.
- Empty states (`emptyState()` on the server, `empty()` in `gaming.js`) replace plain "No results" text with an icon, a short explanation and, where useful, a next step (search, browse, request a tutorial).

## Member dashboard
`/community` is the member dashboard (`/profile` redirects to it, as do client-side links). The page is a small server-rendered shell with loading skeletons; `public/dashboard.js` fills it in after sign-in is confirmed. Signed-out visitors see a sign-in prompt instead.
- **Header and tiles:** greeting, avatar initials, membership badge (Premium, trial with days left, or Free), email-verified badge, and four summary tiles (saved guides, games followed, updates, open tickets) that jump to the matching tab.
- **Tabs** (ARIA tab pattern, arrow keys/Home/End, deep links such as `/community#billing`): *Overview* (setup checklist, Premium benefits or upgrade card, continue reading, latest updates), *Library* (saved guides, history), *Following* (follow/unfollow games, updates), *Support* (tickets with status and replies, tutorial requests and votes), *Billing* (membership, payment history), *Account* (display name, device, delete saved data, sign out).
- It uses the same API as before (`/community/*`, `/auth/me`, `/payments/mine`); nothing server-side changed except that `/profile` now redirects. Every value is HTML-escaped, and the page uses the shared light/dark theme, skeletons and empty states. The marketing carousel is hidden on this page (`showSlideshow:false`).
