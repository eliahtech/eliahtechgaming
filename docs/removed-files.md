# Removed from the Vercel/Express edition

- app
- functions
- firebase.json
- .firebaserc
- cloudflare.config.ts
- vite.config.ts
- next-env.d.ts
- proxy.js
- scripts/prepare-functions.mjs
- reports/verification.json
- reports/verification.md
- test/admin-native.test.js (Next-specific; replaced by Express tests)
- test/admin-lib.test.js (Next-specific; replaced by Express tests)
- test/api-proxy.test.js (Next-specific; replaced by Express tests)
- test/google-oauth.test.js (Next-specific; replaced by Express tests)
- test/session.test.js (Next-specific; replaced by Express tests)

Original legacy browser modules remain the authoritative plain JavaScript dashboard, authentication, AI and checkout implementation. They are no longer duplicate frontends.

Additional retired deployment documentation: docs/hosting-cloudflare.md, docs/two-platform-deploy.md and docs/vercel.full-stack.json. The old verification generator was replaced with an Express-focused report. Vendored Bootstrap/Jodit assets remain; they are necessary frontend dependencies, not duplicate backend output.
