import {registerPromotionRoutes}from'./src/promotions.js';
import express from 'express';
import { registerEditorialRoutes } from './src/editorial.js';
import { registerJobs } from './src/jobs.js';
import { registerVoice } from './src/ai/voice.js';
import { registerAiTasks } from './src/ai/tasks.js';
import { registerGoogle } from './src/session/google.js';
import { browserSession, cookieRefresh } from './src/session/express.js';
import { registerWebRoutes, createNotFoundHandler } from './src/web/routes.js';
import { registerCommunityRoutes } from './src/community.js';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, isConfigured } from './src/supabase.js';
import * as repo from './src/repo.js';
import { createAuthClient } from './src/auth.js';
import { createAuthMiddleware } from './src/auth-middleware.js';
import { accountView, computeAccess } from './src/access.js';
import { rateLimit as dbRateLimit } from './src/ratelimit.js';
import { audit } from './src/audit.js';
import { AppError } from './src/errors.js';
import { cspDirectives } from './src/csp.js';
import { normalizeEmail, passwordProblem, cleanDisplayName } from './src/validate.js';
import { createAdminRouter } from './src/admin/routes.js';
import { sanitizeContent } from './src/sanitize.js';
import { createEmailService } from './src/email.js';
import { createNewsletterService } from './src/newsletter.js';
import { verifyWebhook, buildAuthEmail } from './src/auth-hook.js';
import { createProviders } from './src/payments/providers.js';
import { createPaymentService } from './src/payments/service.js';
import { createPaymentNotifier } from './src/payments/notify.js';
import { createAiPlatform } from './src/ai/index.js';
import { registerAiRoutes } from './src/ai/routes.js';
import { checkSupabase, diagnosticsAuthorized } from './src/health/supabase.js';
import { recordView } from './src/analytics.js';

const serverFile = fileURLToPath(import.meta.url);
const serverDir = path.dirname(serverFile);
const publicDir = path.join(serverDir, 'public');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const appUrl = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
// In production a missing/insecure APP_URL silently breaks email links, redirects and PesaPal callbacks, so say so loudly.
const isProduction = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
if (isProduction && !/^https:\/\//.test(appUrl)) console.error(JSON.stringify({ level: 'error', msg: 'config_app_url_invalid', detail: 'Set APP_URL to the public https:// address of the site; email links, auth redirects and payment callbacks depend on it.' }));
const db = createDb();
const auth = createAuthClient();
const mailer = createEmailService({ db });
const payments = createPaymentService({ db, providers: createProviders(), appUrl, notifier: createPaymentNotifier({ db, email: mailer }) });
const newsletter = createNewsletterService({ db, email: mailer, appUrl });
const ai = createAiPlatform({ db });
const { optionalAuth, requireAuth, requireAdmin } = createAuthMiddleware({ auth, loadContext: (userId) => repo.getAccessContext(db, userId) });

const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGIN || '').split(',').map((v) => v.trim()).filter(Boolean);

app.use(browserSession({ appUrl }));
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: { useDefaults: false, directives: cspDirectives }, crossOriginEmbedderPolicy: false }));
// Same-origin requests need no CORS. Other origins (e.g. a future Android WebView) must be listed explicitly.
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : false, credentials: allowedOrigins.length > 0 }));

const limiterMessage = { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again shortly.' } };
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 180, standardHeaders: 'draft-7', legacyHeaders: false, message: limiterMessage }));

// Per-endpoint limits are stored in Postgres so they hold across serverless instances (see src/ratelimit.js).
const limit = (scope, limitCount, windowSeconds, extra = {}) => dbRateLimit({ db, scope, limit: limitCount, windowSeconds, ...extra });
const byBodyEmail = (req) => normalizeEmail(req.body?.email);
const noStore = (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };

// Admin API: its own router (authorizes first, then parses up to 4 MB so long articles fit). Everything else gets a 100 KB body limit.
app.use('/api/v1/admin', noStore, createAdminRouter({ db, requireAdmin, sanitize: sanitizeContent, email: mailer, appUrl, batchSize: Number(process.env.NEWSLETTER_BATCH_SIZE) || 50, dailyLimit: process.env.NEWSLETTER_DAILY_LIMIT, ai }));

// PayPal webhook: needs the raw body. A bad signature is a 401; processing failures are 5xx so PayPal retries.
app.post('/api/v1/payments/webhooks/paypal', express.raw({ type: 'application/json', limit: '200kb' }), async (req, res, next) => {
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    return res.status(200).json({ success: true, data: await payments.handlePayPalWebhook({ headers: req.headers, rawBody }) });
  } catch (error) { return next(error); }
});

// PesaPal IPN (registered as POST) and browser callback/cancel. Public by necessity, so they trust nothing they receive:
// the query/body only names an order; the result always comes from PesaPal's GetTransactionStatus (see src/payments/service.js).
// Body/query are read as plain values only (strings), then validated. Replies follow PesaPal's documented JSON acknowledgement.
const pesapalParams = (req) => {
  const source = { ...(req.query ?? {}), ...(req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : {}) };
  return Object.fromEntries(['OrderTrackingId', 'OrderMerchantReference', 'OrderNotificationType'].map((k) => [k, typeof source[k] === 'string' ? source[k] : undefined]));
};
const pesapalIpn = async (req, res) => {
  const params = pesapalParams(req);
  const ack = { orderNotificationType: params.OrderNotificationType, orderTrackingId: params.OrderTrackingId, orderMerchantReference: params.OrderMerchantReference };
  try {
    const { orderNotificationType, orderTrackingId, orderMerchantReference, status } = await payments.handlePesaPalIpn({ params });
    return res.status(200).json({ orderNotificationType, orderTrackingId, orderMerchantReference, status });
  } catch (error) {
    if (error instanceof AppError && error.status < 500) return res.status(error.status).json({ ...ack, status: error.status, message: error.message });
    console.error(JSON.stringify({ level: 'error', msg: 'pesapal_ipn_failed', code: error.code || 'UNHANDLED', message: error.message }));
    return res.status(500).json({ ...ack, status: 500 }); // PesaPal's documented "received but not completed": it will retry
  }
};
const pesapalLimit = limit('pesapal-notify', 600, 3600, { keyOf: (req) => req.ip });
app.post('/api/v1/payments/pesapal/ipn', noStore, express.json({ limit: '10kb' }), pesapalLimit, pesapalIpn);
app.get('/api/v1/payments/pesapal/ipn', noStore, pesapalLimit, pesapalIpn);
app.get('/api/v1/payments/pesapal/callback', noStore, pesapalLimit, (req, res, next) => Promise.resolve().then(async () => {
  const { redirectTo } = await payments.handlePesaPalCallback({ params: pesapalParams(req) });
  res.redirect(302, redirectTo);
}).catch(next));
app.get('/api/v1/payments/pesapal/cancel', noStore, pesapalLimit, (req, res) => {
  res.redirect(302, payments.handlePesaPalCancel({ paymentId: typeof req.query.payment === 'string' ? req.query.payment : '' }).redirectTo);
});

// Supabase "Send Email" auth hook (optional). Needs the raw body to verify the webhook signature.
app.post('/api/v1/hooks/auth-email', express.raw({ type: 'application/json', limit: '100kb' }), async (req, res) => {
  const hookError = (status, message) => res.status(status).json({ error: { http_code: status, message } });
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    if (!verifyWebhook({ secret: process.env.SUPABASE_AUTH_HOOK_SECRET, headers: req.headers, rawBody })) return hookError(401, 'Invalid signature.');
    const message = buildAuthEmail(JSON.parse(rawBody), { supabaseUrl: process.env.SUPABASE_URL });
    await mailer.sendOne(message, { type: `auth_${JSON.parse(rawBody).email_data?.email_action_type}` });
    return res.status(200).json({});
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', msg: 'auth_email_hook_failed', code: error.code, status: error.status }));
    return hookError(error.status && error.status < 600 ? error.status : 500, 'Could not send the email.');
  }
});
app.use(['/api/v1/ai/chat','/api/v1/ai/tasks'], express.json({ limit: '2300kb' }));
app.use(express.json({ limit: '100kb' }));
app.use(cookieRefresh(appUrl));

const send = (res, data = {}, status = 200) => res.status(status).json({ success: status < 400, data });
const fail = (res, code, message, status = 400, details) => res.status(status).json({ success: false, error: { code, message, ...(details ? { details } : {}) } });
const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const cacheable = (res, seconds = 60) => res.set('Cache-Control', `public, s-maxage=${seconds}, stale-while-revalidate=300`);

// Page-view beacon (public/track.js). Always 204: the visitor learns nothing about what was or was not counted.
app.post('/api/v1/track', async (req, res) => { await recordView(db, { path: req.body?.path, headers: req.headers }); res.status(204).end(); });
// Liveness only: says nothing about the database. Use /api/v1/health/supabase for a real connectivity check.
app.get('/api/v1/health', (_req, res) => send(res, { status: 'ok', service: 'eliah-tech-api', database: isConfigured() ? 'configured' : 'not_configured', timestamp: new Date().toISOString() }));
app.get('/api/v1/health/supabase', noStore, wrap(async (req, res) => {
  const detailed = diagnosticsAuthorized(req.headers.authorization, process.env.HEALTH_DIAGNOSTICS_TOKEN);
  const result = await checkSupabase({ detailed });
  const body = detailed ? result : { status: result.status, service: result.service, database: result.database };
  res.status(result.status === 'error' ? 503 : 200).json(body);
}));

app.get('/api/v1/site', wrap(async (_req, res) => {
  const value = await repo.getPublicSite(db);
  if (!value) return fail(res, 'NOT_FOUND', 'Site settings have not been created yet. Run the Supabase migrations.', 404);
  cacheable(res, 300); return send(res, value);
}));

app.get('/api/v1/settings/homepage', wrap(async (_req, res) => {
  const value = await repo.getPublicSetting(db, 'homepage');
  if (!value) return fail(res, 'NOT_FOUND', 'Homepage settings have not been created yet. Run the Supabase migrations.', 404);
  cacheable(res); return send(res, value);
}));
app.get('/api/v1/settings/premium', wrap(async (_req, res) => {
  const value = await repo.getPublicSetting(db, 'premium');
  if (!value) return fail(res, 'NOT_FOUND', 'Premium settings have not been created yet.', 404);
  cacheable(res); return send(res, value);
}));
app.get('/api/v1/social-links', wrap(async (_req, res) => { cacheable(res); send(res, await repo.listSocialLinks(db)); }));
app.get('/api/v1/categories', wrap(async (_req, res) => { cacheable(res); send(res, await repo.listCategories(db)); }));
app.get('/api/v1/services', wrap(async (_req, res) => { cacheable(res); send(res, await repo.listServices(db)); }));

app.get('/api/v1/posts', wrap(async (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 12, 1), 50);
  const category = /^[a-z0-9-]{1,80}$/.test(String(req.query.category || '')) ? String(req.query.category) : '';
  const offset = Math.max(0, Math.min(1000000, Number.parseInt(req.query.offset, 10) || 0));
  const result = await repo.listPostsPage(db, { category, featured: req.query.featured === 'true', limit, offset });
  cacheable(res); send(res, result);
}));

app.get('/api/v1/posts/:slug', optionalAuth, wrap(async (req, res) => {
  const post = await repo.getPost(db, req.params.slug);
  if (!post) return fail(res, 'NOT_FOUND', 'Post not found', 404);
  if (post.is_premium && !req.user?.access.isPremium) {
    res.set('Cache-Control', 'no-store');
    return fail(res, 'PREMIUM_REQUIRED', 'This article is available to Premium members.', 403, { title: post.title, excerpt: post.excerpt, category: post.category });
  }
  if (req.user || post.is_premium) res.set('Cache-Control', 'private, no-store'); else cacheable(res);
  return send(res, post);
}));

app.get('/api/v1/search', wrap(async (req, res) => {
  const query = String(req.query.q || '').trim().slice(0, 80);
  const offset=Math.max(0,Number.parseInt(req.query.offset,10)||0);
  send(res,await repo.searchPostsPage(db,query,{...req.query,offset,limit:12}));
}));

const subscribe = wrap(async (req, res) => {
  await newsletter.subscribe(req.body?.email);
  // Same answer whether or not the address is already subscribed.
  return send(res, { message: 'Almost done. Check your inbox and confirm your email address to complete your subscription.' }, 202);
});
const newsletterLimits = [limit('newsletter', 10, 3600), limit('newsletter-email', 3, 3600, { keyOf: byBodyEmail })];
app.post('/api/v1/newsletter/subscribe', ...newsletterLimits, subscribe);
app.post('/api/v1/newsletter', ...newsletterLimits, subscribe);
app.post('/api/v1/newsletter/verify', limit('newsletter-token', 30, 3600), wrap(async (req, res) => { await newsletter.verify(req.body?.token); send(res, { message: 'Your subscription is confirmed. Welcome aboard!' }); }));
app.post('/api/v1/newsletter/unsubscribe', limit('newsletter-token', 30, 3600), wrap(async (req, res) => { await newsletter.unsubscribe(req.body?.token); send(res, { message: 'You have been unsubscribed.' }); }));

const contact = wrap(async (req, res) => {
  const row = await repo.createMessage(db, req.body || {});
  if (!row) return fail(res, 'VALIDATION_ERROR', 'Name, a valid email, subject and message are required.');
  return send(res, { message: 'Message received. We will get back to you soon.', id: row.id }, 201);
});
app.post('/api/v1/contact', limit('contact', 5, 3600), contact);
app.post('/api/v1/messages', limit('contact', 5, 3600), contact);

// ---- Authentication (Supabase Auth). Tokens are returned to the client as JSON for web and Android alike. ----
app.use('/api/v1/auth', noStore);
app.use('/api/v1/premium', noStore);
const strict = { failClosed: true };

app.post('/api/v1/auth/register', limit('register', 5, 3600, strict), limit('register-email', 3, 3600, { ...strict, keyOf: byBodyEmail }), wrap(async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const problem = passwordProblem(req.body?.password);
  const displayName = cleanDisplayName(req.body?.display_name) ?? (email ? cleanDisplayName(email.split('@')[0]) : null);
  if (!email) return fail(res, 'VALIDATION_ERROR', 'Enter a valid email address.', 422);
  if (problem) return fail(res, 'VALIDATION_ERROR', problem, 422);
  if (!displayName) return fail(res, 'VALIDATION_ERROR', 'Display name must be 2 to 60 characters.', 422);
  const result = await auth.signUp({ email, password: req.body.password, displayName, redirectTo: `${appUrl}/login?verified=1` });
  // Same response whether or not the address already exists, so this endpoint cannot be used to enumerate accounts.
  return send(res, { message: 'Check your inbox to verify your email address, then sign in.', ...(result.session ? { session: result.session } : {}) }, 201);
}));

app.post('/api/v1/auth/login', limit('login', 20, 900, strict), limit('login-email', 8, 900, { ...strict, keyOf: byBodyEmail }), wrap(async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email || typeof req.body?.password !== 'string' || !req.body.password) return fail(res, 'VALIDATION_ERROR', 'Email and password are required.', 422);
  const { session, user } = await auth.signIn({ email, password: req.body.password });
  const context = await repo.getAccessContext(db, user.id);
  const account = accountView({ ...user, emailVerified: user.email_verified, ...context, access: computeAccess(context) });
  if (account.role === 'admin') await audit(db, { actorId: user.id, action: 'admin.login', ip: req.ip });
  return send(res, { session, user: account });
}));

app.post('/api/v1/auth/refresh', limit('refresh', 60, 900, strict), wrap(async (req, res) => {
  if (typeof req.body?.refresh_token !== 'string' || !req.body.refresh_token) return fail(res, 'VALIDATION_ERROR', 'refresh_token is required.', 422);
  const { session } = await auth.refresh(req.body.refresh_token);
  return send(res, { session });
}));

// Sign-out always succeeds from the browser's point of view: the cookies are cleared by the session middleware, and the
// Supabase session is revoked on a best-effort basis (the access token may already be expired).
app.post('/api/v1/auth/logout', wrap(async (req, res) => {
  const token = /^Bearer (.+)$/i.exec(String(req.headers.authorization || ''))?.[1];
  if (token) { try { await auth.signOut(token); } catch { /* expired or already revoked: the local session is gone either way */ } }
  send(res, { message: 'Signed out.' });
}));

app.post('/api/v1/auth/forgot-password', limit('forgot', 5, 3600, strict), limit('forgot-email', 3, 3600, { ...strict, keyOf: byBodyEmail }), wrap(async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email) return fail(res, 'VALIDATION_ERROR', 'Enter a valid email address.', 422);
  try { await auth.recover(email, `${appUrl}/reset-password`); } catch (error) {
    // Unknown addresses must look identical to known ones; only genuine outages are surfaced.
    if (error.status !== 400 && error.status !== 404 && error.status !== 422) throw error;
  }
  return send(res, { message: 'If an account exists for that address, a reset link is on its way.' });
}));

// The browser lands on /reset-password#access_token=... from the emailed link and sends that recovery token as a Bearer token.
app.post('/api/v1/auth/reset-password', limit('reset', 10, 3600, strict), requireAuth, wrap(async (req, res) => {
  const problem = passwordProblem(req.body?.password);
  if (problem) return fail(res, 'VALIDATION_ERROR', problem, 422);
  await auth.updatePassword(req.user.token, req.body.password);
  await audit(db, { actorId: req.user.id, action: 'auth.password_reset', ip: req.ip });
  return send(res, { message: 'Password updated. You can now sign in.' });
}));

app.get('/api/v1/auth/me', requireAuth, (req, res) => send(res, accountView(req.user)));

app.patch('/api/v1/auth/me', requireAuth, wrap(async (req, res) => {
  const displayName = cleanDisplayName(req.body?.display_name);
  if (!displayName) return fail(res, 'VALIDATION_ERROR', 'Display name must be 2 to 60 characters.', 422);
  const row = await repo.updateOwnProfile(db, req.user.id, { displayName });
  if (!row) throw new AppError('NOT_FOUND', 'Profile not found.', 404);
  return send(res, accountView({ ...req.user, profile: { ...req.user.profile, display_name: displayName } }));
}));

// ---- AI platform (versioned; the web chat and the future Android app use exactly these endpoints) ----
// Provider keys exist only in server environment variables. Tier, Premium status and model access are decided here, never by the client.
const aiRouter = express.Router();
registerAiRoutes(aiRouter, { controller: ai.controller, optionalAuth, requireAuth, limit });
app.use('/api/v1/ai', aiRouter);

app.get('/api/v1/premium/status', requireAuth, (req, res) => send(res, accountView(req.user).access));

// ---- Payments and subscriptions (the browser never decides whether something was paid) ----
app.use(['/api/v1/payments', '/api/v1/subscriptions'], noStore);
app.get('/api/v1/payments/plans', wrap(async (_req, res) => send(res, await payments.plans())));
app.get('/api/v1/payments/providers', (_req, res) => send(res, payments.providerList()));
app.get('/api/v1/payments/mine', requireAuth, wrap(async (req, res) => send(res, await payments.myPayments(req.user.id))));
app.post('/api/v1/payments/checkout', requireAuth, limit('checkout', 10, 3600, { failClosed: true, keyOf: (req) => req.user?.id }), wrap(async (req, res) => send(res, await payments.checkout({ user: req.user, planCode: req.body?.plan ?? req.body?.plan_id, providerName: req.body?.provider, contact: { phone_number: req.body?.phone_number, country_code: req.body?.country_code } }), 201)));
app.post('/api/v1/payments/:id/confirm', requireAuth, limit('payment-confirm', 30, 3600, { keyOf: (req) => req.user?.id }), wrap(async (req, res) => send(res, await payments.confirm({ user: req.user, paymentId: req.params.id }))));
app.post('/api/v1/payments/:id/cancel', requireAuth, limit('payment-confirm', 30, 3600, { keyOf: (req) => req.user?.id }), wrap(async (req, res) => send(res, await payments.cancel({ user: req.user, paymentId: req.params.id }))));
app.get('/api/v1/subscriptions/me', requireAuth, wrap(async (req, res) => send(res, { ...accountView(req.user).access, subscriptions: await payments.mySubscriptions(req.user.id) })));

app.get('/api/session', optionalAuth, (req,res)=>{res.set('Cache-Control','private, no-store');send(res,{authenticated:Boolean(req.user),user:req.user?accountView(req.user):null});});
app.get('/api/health/supabase',(_req,res)=>res.redirect(307,'/api/v1/health/supabase'));
registerPromotionRoutes(app,{db,repo,optionalAuth});
registerEditorialRoutes(app, { db, repo, requireAdmin, optionalAuth, limit, appUrl });
registerJobs(app, { db, email: mailer, appUrl });
registerVoice(app, { requireAuth, limit });
registerAiTasks(app, { db, service: ai.service, requireAuth, limit });
registerGoogle(app, { appUrl });
registerCommunityRoutes(app, { db, requireAuth, requireAdmin, optionalAuth, limit, appUrl });
registerWebRoutes(app, { db, repo, auth, optionalAuth, requireAdmin, appUrl, publicDir, siteVerification: { google: process.env.GOOGLE_SITE_VERIFICATION, bing: process.env.BING_SITE_VERIFICATION } });

app.use('/api', (_req, res) => fail(res, 'NOT_FOUND', 'Endpoint not found', 404));

app.use(express.static(publicDir, { extensions: ['html'], setHeaders: (res, file) => { if (/\.(webp|png|jpe?g|ico|svg)$/i.test(file)) res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400'); } }));
app.get('*', createNotFoundHandler({ db, repo, appUrl }));

// Central error handler: consistent shape, no internals leaked.
app.use((err, req, res, _next) => {
  if (err instanceof AppError && err.details?.retryAfter) res.set('Retry-After',String(err.details.retryAfter));
  if (err instanceof AppError) return fail(res, err.code, err.message, err.status, err.details);
  if (err.type === 'entity.parse.failed') return fail(res, 'VALIDATION_ERROR', 'Invalid JSON body.');
  if (err.type === 'entity.too.large') return fail(res, 'PAYLOAD_TOO_LARGE', 'Request body is too large.', 413);
  if (err.code === 'NOT_CONFIGURED') return fail(res, 'NOT_CONFIGURED', err.message, 503);
  console.error(JSON.stringify({ level: 'error', path: req.path, code: err.code || 'UNHANDLED', message: err.message, detail: err.detail }));
  return fail(res, err.code === 'DATABASE_ERROR' ? 'DATABASE_ERROR' : 'SERVER_ERROR', 'Something went wrong. Please try again.', err.status || 500);
});

if (process.env.VERCEL !== '1' && process.argv[1] === serverFile) app.listen(PORT, () => console.log(`Eliah Tech running at http://localhost:${PORT}`));

export { app };
