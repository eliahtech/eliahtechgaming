# Google sign-in / sign-up

Implemented as a server-side **PKCE** flow through Supabase Auth. Browsers only follow redirects; Google and Supabase tokens never reach JavaScript, and the resulting session uses the same HttpOnly cookies as password login (`/api/session`).

Flow: `/api/auth/google` (creates a PKCE verifier, stores it in a short-lived HttpOnly cookie, redirects to Supabase) → Google → Supabase → `/api/auth/google/callback?code=…` (exchanges the code with the verifier, requires a verified email, sets session cookies, redirects to the validated `next` path). New Google users are created automatically (sign-up); existing users sign in.

## One-time setup
1. **Google Cloud Console** → APIs & Services → Credentials → *Create OAuth client ID* (Web application).
   - Authorized redirect URI: `https://<your-project-ref>.supabase.co/auth/v1/callback`
   - (Consent screen: add your domain, privacy and terms URLs; publish the app to allow non-test users.)
2. **Supabase** → Authentication → Providers → **Google**: enable, paste the Client ID and Client Secret (the secret is stored in Supabase only — never in this app's environment).
3. **Supabase** → Authentication → URL Configuration → add to *Redirect URLs*: `https://<APP_URL host>/api/auth/google/callback` (one per deployment domain you actually use; do not add wildcards for production).
4. Set `GOOGLE_AUTH_ENABLED=true` on the **active** deployment (Vercel). `APP_URL`, `SUPABASE_URL` and `SUPABASE_ANON_KEY` must be set (validated by `npm run verify:env`).
5. Keep Supabase **Confirm email** enabled for password sign-ups (see below).

## Security notes
- The PKCE verifier cookie binds each attempt to the browser that started it; a code obtained elsewhere cannot be redeemed here. The cookie is cleared on every callback, success or failure.
- Only accounts with a verified email are accepted. Roles/admin rights still come only from the database; a Google login cannot create an admin, and `/admin` still requires admin role + verified email.
- `next` is accepted only as a same-origin relative path; error messages shown on `/login` come from a fixed list and never echo provider text.
- **Account linking:** Supabase links a Google identity to an existing account with the same verified email. To avoid pre-registration takeover (an attacker creating an unverified password account with a victim's address), keep *Confirm email* ON so unverified password accounts cannot sign in or hold a usable password.
- Each deployment domain needs its own redirect URL in Supabase. The start route redirects to `APP_URL` first so cookies (host-bound `__Host-`) and the callback always share one origin.

## Verifying after deploy (not possible from this repository's sandbox)
1. Open `/login`; the "Continue with Google" button appears only when configured (`GET /api/auth/google/status` → `{"enabled":true}`).
2. Click it, complete Google consent, and confirm you land on your dashboard (`/profile` redirects to `/community`) signed in; `GET /api/session` should show `authenticated: true`.
3. Confirm no token appears in the URL, page source or `localStorage`.
4. Cancel at Google's consent screen and confirm `/login` shows the "did not complete" message.
