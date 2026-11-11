# SEO

All search and social metadata is generated in two places: `src/seo.js` (pure helpers, unit-tested) and the page layout in `src/web/templates.js`. Routes (`src/web/routes.js`) only decide what to pass in.

## What every public page gets
- `<title>`: "Page | Eliahtech Gaming". The brand is left off when the title already contains it or would be cut off in results (about 60 characters).
- A unique `<meta name="description">` (plain text, cut at a word boundary, about 155 characters): articles use the post's SEO description or excerpt, topics use the topic's description from the admin (or a generated one), listings add "Page N", game hubs use their summary, static pages use their intro.
- `<link rel="canonical">` (listing pages canonicalise to themselves, including `?page=N`), `robots` with `max-image-preview:large` (eligibility for large previews and Discover), `noindex,nofollow` for search, dashboard, preview and error pages.
- Open Graph and Twitter cards: `og:type`, `og:site_name`, `og:locale`, `og:image` (+ width/height when known, alt text), `twitter:site` (taken from your X/Twitter social link), and `article:published_time`, `modified_time`, `section`, `author`, `tag` on posts.
- An RSS autodiscovery link to `/feed.xml`.
- Optional Google/Bing ownership tags (see "Search console" below).

## Structured data (JSON-LD)
- Home: `Organization` (logo, social profiles) and `WebSite` with a `SearchAction` (sitelinks search box).
- Topics and listings: `CollectionPage` with an `ItemList`, plus `BreadcrumbList`. Game hubs and the topics page: `BreadcrumbList`.
- Articles: `BlogPosting` (author, publisher, dates, section, keywords, image) + `BreadcrumbList` + the organisation/site nodes it references. Premium-locked articles are not marked up.

## App pages
`/premium`, `/contact`, `/services` and `/ai` are rendered by the single-page app but are served with their own title, description, canonical, social tags, structured data, and a `<noscript>` summary with site links, and **are indexable**. Login, register, password, payment, newsletter-confirmation and admin pages stay `noindex,nofollow` (meta tag and `X-Robots-Tag` header). To change the text, edit `SHELL_PAGES` in `src/seo.js`.

## Files for crawlers
- `/robots.txt`: public pages open; `/api/`, `/admin`, `/preview/`, `/community`, `/search`, sign-in/payment/newsletter paths blocked; sitemap listed.
- `/sitemap.xml` (index, 1,000 posts per file) and `/sitemaps/posts-N.xml`: posts with `lastmod` (last update, else publish date; invalid dates are dropped, never invented) and cover images (the generic default cover is skipped); the first file also lists the home page, guides, topics, game hubs (with `lastmod`), About, Contact, Premium, Services, AI and legal pages.
- `/feed.xml`: RSS 2.0 with the 30 latest guides (excerpts only, never premium content).
- Unknown browser URLs get a friendly 404 page (real 404 status, `noindex`); API clients get JSON.

## Caching
Pages are `private, no-cache` for anonymous visitors (revalidated, which keeps back/forward navigation instant) and `private, no-store` when signed in. HTML is **not** cached on the CDN on purpose: it varies by cookie (premium access, browsing preferences) and Vercel does not cache responses that vary by cookie. `robots.txt`, the sitemaps and the feed are identical for everyone, so they are cached at the edge (`s-maxage`), as are the public app pages.

## Search console (one-time, by you)
1. In Google Search Console add your domain. Pick the **HTML tag** method and copy only the `content` value into `GOOGLE_SITE_VERIFICATION` (Bing Webmaster Tools: `BING_SITE_VERIFICATION`), redeploy, then press Verify. A DNS TXT record works instead and needs no code.
2. Submit `https://your-domain/sitemap.xml` in both tools.
3. In Search Console, use URL Inspection > Request indexing for the home page, `/premium` and `/contact`.
4. Check the Pages report a week later (there should be no "Submitted URL marked noindex").
5. Test an article in the Rich Results Test and the Facebook Sharing Debugger / X card validator.
