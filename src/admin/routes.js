// Express wiring for /api/v1/admin/*. Every route is behind requireAdmin (verified token + admin role from the database).
import express from 'express';
import { AppError } from '../errors.js';
import { audit } from '../audit.js';
import { normalizeEmail } from '../validate.js';
import { validateFields, slugify } from './fields.js';
import { RESOURCES } from './resources.js';
import { createAdminService } from './service.js';
import { createMediaService, MAX_IMAGE_BYTES } from './media.js';
import { SETTINGS } from './settings.js';
import { listUsers, setUserRole } from './users.js';
import { createMailAdmin } from './mail.js';
import { createBillingAdmin } from './billing.js';
import { createAiAdmin, registerAiAdminRoutes } from './ai.js';
import { rateLimit as dbRateLimit } from '../ratelimit.js';
import { parseHtmlPost, resolveRefs, HTML_POST_TEMPLATE } from './html-post.js';
import { checkSupabase } from '../health/supabase.js';

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
const page = (req) => ({
  q: String(req.query.q ?? '').slice(0, 80),
  limit: Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 25, 1), 100),
  offset: Math.max(Number.parseInt(req.query.offset, 10) || 0, 0),
});

export function createAdminRouter({ db, requireAdmin, sanitize, fetchImpl, email, appUrl, batchSize, dailyLimit, ai }) {
  const router = express.Router();
  const service = createAdminService({ db, sanitize });
  const media = createMediaService({ db, fetchImpl });
  const billing = createBillingAdmin({ db });
  const mail = createMailAdmin({ db, email, appUrl, sanitize, batchSize, dailyLimit });
  const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  const actor = (req) => ({ id: req.user.id, profile: req.user.profile });

  router.use(requireAdmin); // authorization first, so unauthenticated callers never get a large body parsed
  router.use(express.json({ limit: '4mb' })); // long articles; stays under Vercel's ~4.5 MB request cap

  // ---- Users ----
  router.get('/users', h(async (req, res) => {
    const { q, limit, offset } = page(req);
    const { rows, total } = await listUsers(db, { q, limit, offset });
    ok(res, { items: rows, meta: { total, limit, offset } });
  }));
  router.patch('/users/:id/role', h(async (req, res) => {
    const change = await setUserRole(db, { actorId: req.user.id, targetId: req.params.id, role: req.body?.role });
    await audit(db, { actorId: req.user.id, action: 'user.role_change', targetType: 'profiles', targetId: req.params.id, metadata: change, ip: req.ip });
    ok(res, change);
  }));

  // ---- Settings (homepage, premium) ----
  router.get('/settings/:key', h(async (req, res) => {
    if (!SETTINGS[req.params.key]) throw new AppError('NOT_FOUND', 'Unknown setting.', 404);
    const [row] = await db.select('settings', { select: 'value', key: `eq.${req.params.key}`, limit: '1' });
    ok(res, row?.value ?? null);
  }));
  router.put('/settings/:key', h(async (req, res) => {
    const parse = SETTINGS[req.params.key];
    if (!parse) throw new AppError('NOT_FOUND', 'Unknown setting.', 404);
    const value = parse(req.body ?? {});
    await db.insert('settings', { key: req.params.key, value, is_public: !['ads','member-benefits','promotions','newsletter-sending'].includes(req.params.key), updated_at: new Date().toISOString() }, { query: { on_conflict: 'key' }, prefer: 'resolution=merge-duplicates,return=minimal' });
    await audit(db, { actorId: req.user.id, action: 'settings.update', targetType: 'settings', targetId: req.params.key, metadata: { fields: Object.keys(value) }, ip: req.ip });
    ok(res, value);
  }));

  // ---- Media (raw image body; bytes are inspected server-side) ----
  router.get('/media', h(async (req, res) => {
    const { limit, offset } = page(req);
    const { rows, total } = await db.selectPage('media', { select: 'id,public_url,mime_type,size_bytes,alt_text,created_at', order: 'created_at.desc', limit: String(limit), offset: String(offset) });
    ok(res, { items: rows, meta: { total, limit, offset } });
  }));
  router.post('/media', express.raw({ type: ['image/*', 'application/octet-stream'], limit: MAX_IMAGE_BYTES }), h(async (req, res) => {
    const row = await media.upload({ buffer: req.body, declaredType: String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase(), altText: req.query.alt, actorId: req.user.id });
    await audit(db, { actorId: req.user.id, action: 'media.upload', targetType: 'media', targetId: row.id, metadata: { mime: row.mime_type, size: row.size_bytes }, ip: req.ip });
    ok(res, row, 201);
  }));
  router.delete('/media/:id', h(async (req, res) => {
    const row = await media.remove(req.params.id);
    await audit(db, { actorId: req.user.id, action: 'media.delete', targetType: 'media', targetId: row.id, ip: req.ip });
    ok(res, { deleted: true });
  }));

  // ---- Audit log (read-only) ----
  router.get('/audit-logs', h(async (req, res) => {
    const { limit, offset } = page(req);
    const { rows, total } = await db.selectPage('audit_logs', { select: 'id,actor_id,action,target_type,target_id,metadata,created_at', order: 'created_at.desc', limit: String(limit), offset: String(offset) });
    ok(res, { items: rows, meta: { total, limit, offset } });
  }));

  // ---- Billing (read-only payments; subscriptions can be granted or cancelled) ----
  router.get('/payments/analytics', h(async (_req, res) => ok(res, await billing.analytics())));
  router.get('/payments', h(async (req, res) => ok(res, await billing.listPayments({ ...page(req), status: req.query.status, provider: req.query.provider, currency: req.query.currency, from: req.query.from, to: req.query.to, user: req.query.user, reference: req.query.reference, plan: req.query.plan }))));
  router.get('/payments/:id', h(async (req, res) => ok(res, await billing.getPayment(req.params.id))));
  router.get('/subscriptions', h(async (req, res) => ok(res, await billing.listSubscriptions({ ...page(req), status: req.query.status }))));
  router.post('/subscriptions/grant', h(async (req, res) => ok(res, await billing.grant({ userId: req.body?.user_id, days: req.body?.days, note: req.body?.note }, actor(req), req.ip), 201)));
  router.post('/subscriptions/:id/cancel', h(async (req, res) => ok(res, await billing.cancel(req.params.id, actor(req), req.ip))));

  // ---- Contact inbox ----
  router.get('/messages', h(async (req, res) => ok(res, await mail.inbox.list({ ...page(req), status: req.query.status }))));
  router.get('/messages/:id', h(async (req, res) => ok(res, await mail.inbox.get(req.params.id))));
  router.patch('/messages/:id', h(async (req, res) => ok(res, await mail.inbox.setStatus(req.params.id, req.body?.status, actor(req), req.ip))));
  router.post('/messages/:id/reply', h(async (req, res) => ok(res, await mail.inbox.reply(req.params.id, req.body?.body, actor(req), req.ip), 201)));
  router.delete('/messages/:id', h(async (req, res) => { await mail.inbox.remove(req.params.id, actor(req), req.ip); ok(res, { deleted: true }); }));

  // ---- Subscribers ----
  router.get('/subscribers/export', h(async (req, res) => {
    const csv = await mail.subscribers.exportCsv(req.query.status, actor(req), req.ip);
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="subscribers.csv"' }).status(200).send(csv);
  }));
  router.get('/subscribers', h(async (req, res) => ok(res, await mail.subscribers.list({ ...page(req), status: req.query.status }))));
  router.post('/subscribers/:id/unsubscribe', h(async (req, res) => { await mail.subscribers.unsubscribe(req.params.id, actor(req), req.ip); ok(res, { status: 'unsubscribed' }); }));
  router.delete('/subscribers/:id', h(async (req, res) => { await mail.subscribers.remove(req.params.id, actor(req), req.ip); ok(res, { deleted: true }); }));

  // ---- Newsletter campaigns (sent in resumable batches) ----
  router.get('/newsletter/campaigns', h(async (req, res) => ok(res, await mail.campaigns.list(page(req)))));
  router.post('/newsletter/campaigns', h(async (req, res) => ok(res, await mail.campaigns.create(req.body, actor(req), req.ip), 201)));
  router.get('/newsletter/campaigns/:id', h(async (req, res) => ok(res, await mail.campaigns.get(req.params.id))));
  router.patch('/newsletter/campaigns/:id', h(async (req, res) => ok(res, await mail.campaigns.update(req.params.id, req.body, actor(req), req.ip))));
  router.delete('/newsletter/campaigns/:id', h(async (req, res) => { await mail.campaigns.remove(req.params.id, actor(req), req.ip); ok(res, { deleted: true }); }));
  router.post('/newsletter/campaigns/:id/test', h(async (req, res) => {
    const to = normalizeEmail(req.body?.to);
    if (!to) throw new AppError('VALIDATION_ERROR', 'Enter a valid test address.', 422);
    await mail.campaigns.sendTest(req.params.id, to);
    ok(res, { sent: true });
  }));
  router.post('/newsletter/campaigns/:id/start', h(async (req, res) => ok(res, await mail.campaigns.start(req.params.id, actor(req), req.ip))));
  router.get('/newsletter/usage', h(async (_req, res) => ok(res, await mail.campaigns.usage())));
  router.post('/newsletter/campaigns/:id/pause', h(async (req, res) => ok(res, await mail.campaigns.pause(req.params.id, actor(req), req.ip))));
  router.post('/newsletter/campaigns/:id/resume', h(async (req, res) => ok(res, await mail.campaigns.resume(req.params.id, actor(req), req.ip))));
  router.post('/newsletter/campaigns/:id/send-batch', h(async (req, res) => ok(res, await mail.campaigns.sendBatch(req.params.id))));
  router.post('/newsletter/campaigns/:id/requeue', h(async (req, res) => ok(res, await mail.campaigns.requeue(req.params.id, actor(req), req.ip))));

  router.get('/email-events', h(async (req, res) => ok(res, await mail.emailEvents.list(page(req)))));

  // ---- AI platform (providers, models, settings, analytics, health, tests). Registered before the generic /:resource routes. ----
  if (ai) {
    registerAiAdminRoutes(router, {
      admin: createAiAdmin({ db, registry: ai.registry, health: ai.health, settingsStore: ai.settingsStore, service: ai.service }),
      h, actor, ok, page,
      limit: (scope, limitCount, windowSeconds, extra = {}) => dbRateLimit({ db, scope, limit: limitCount, windowSeconds, ...extra }),
    });
  }

  router.get('/tickets/:id/conversation',h(async(req,res)=>{
    const [ticket]=await db.select('support_tickets',{select:'conversation_id,user_id',id:`eq.${req.params.id}`,limit:'1'});
    if(!ticket?.conversation_id)return ok(res,{messages:[]});
    const [conversation]=await db.select('ai_conversations',{select:'id',id:`eq.${ticket.conversation_id}`,user_id:`eq.${ticket.user_id}`,limit:'1'});
    if(!conversation)return ok(res,{messages:[]});
    ok(res,{messages:await db.select('ai_messages',{select:'role,content,created_at',conversation_id:`eq.${conversation.id}`,order:'created_at.asc',limit:'100'})});
  }));
  router.get('/posts/:id/revisions', h(async(req,res)=>{await service.get(RESOURCES.posts,req.params.id);ok(res,await db.select('post_revisions',{select:'id,created_at',post_id:`eq.${req.params.id}`,order:'created_at.desc',limit:'50'}));}));
  router.post('/posts/:id/revisions/:revision/restore',h(async(req,res)=>{
    await service.get(RESOURCES.posts,req.params.id);
    const [revision]=await db.select('post_revisions',{select:'snapshot',id:`eq.${req.params.revision}`,post_id:`eq.${req.params.id}`,limit:'1'});
    if(!revision)throw new AppError('NOT_FOUND','Revision not found.',404);
    ok(res,await service.update(RESOURCES.posts,req.params.id,revision.snapshot,actor(req),req.ip));
  }));
  router.put('/posts/:id/autosave',h(async(req,res)=>{
    const post=await service.get(RESOURCES.posts,req.params.id);
    if(post.status!=='draft')throw new AppError('CONFLICT','Autosave is limited to drafts. Use Save for published posts.',409);
    const snapshot=validateFields(RESOURCES.posts.fields,req.body,{partial:true,sanitize});
    await db.insert('post_drafts',{post_id:post.id,actor_id:req.user.id,snapshot,updated_at:new Date().toISOString()},{query:{on_conflict:'post_id,actor_id'},prefer:'resolution=merge-duplicates,return=minimal'});ok(res,{saved:true});
  }));
  router.get('/posts/:id/autosave',h(async(req,res)=>{await service.get(RESOURCES.posts,req.params.id);const [row]=await db.select('post_drafts',{select:'snapshot,updated_at',post_id:`eq.${req.params.id}`,actor_id:`eq.${req.user.id}`,limit:'1'});ok(res,row||{});}));

  // ---- Analytics and site health (read-only) ----
  router.get('/analytics', h(async (req, res) => ok(res, await db.rpc('analytics_summary', { p_days: Math.min(365, Math.max(1, Number(req.query.days) || 30)) }))));
  router.get('/health', h(async (_req, res) => {
    const present = (name) => Boolean(process.env[name]);
    const [supabase, security] = await Promise.all([checkSupabase({ detailed: true, useCache: false }).catch(() => ({ status: 'error' })), db.rpc('security_report').catch(() => null)]);
    ok(res, {
      supabase,
      security,
      config: {
        app_url_https: /^https:\/\//i.test(String(process.env.APP_URL || appUrl || '')),
        ai_keys: { gemini: present('GEMINI_API_KEY'), groq: present('GROQ_API_KEY') },
        ads_allowed_origins_set: present('AD_ALLOWED_ORIGINS'),
        payments: { paypal: present('PAYPAL_CLIENT_ID'), pesapal: present('PESAPAL_CONSUMER_KEY') },
        email_configured: present('RESEND_API_KEY'),
        site_verification: { google: present('GOOGLE_SITE_VERIFICATION'), bing: present('BING_SITE_VERIFICATION') },
      },
      checked_at: new Date().toISOString(),
    });
  }));

  // ---- HTML post: paste a complete HTML page, review the detected fields, publish ----
  const htmlInput = (req) => { const html = req.body?.html; if (typeof html !== 'string' || !html.trim()) throw new AppError('VALIDATION_ERROR', 'Paste your HTML first.', 422); if (html.length > 1_800_000) throw new AppError('PAYLOAD_TOO_LARGE', 'The HTML is too large (limit about 1.8 MB). Upload big images instead of embedding them.', 413); return html; };
  router.get('/html-posts/template', h(async (_req, res) => ok(res, { html: HTML_POST_TEMPLATE })));
  router.post('/html-posts/parse', h(async (req, res) => {
    const parsed = parseHtmlPost(htmlInput(req));
    const refs = await resolveRefs(db, parsed.hints);
    if (parsed.hints.category && !refs.category_id) parsed.warnings.push(`Category "${parsed.hints.category}" was not found: choose one below.`);
    if (parsed.hints.game && !refs.game_id) parsed.warnings.push(`Game hub "${parsed.hints.game}" was not found: choose one below.`);
    ok(res, { ...parsed, fields: { ...parsed.fields, ...refs }, preview: sanitize(parsed.fields.content_html) });
  }));
  router.post('/html-posts', h(async (req, res) => {
    const parsed = parseHtmlPost(htmlInput(req));
    const refs = await resolveRefs(db, parsed.hints);
    const o = req.body?.fields && typeof req.body.fields === 'object' ? req.body.fields : {};
    const status = ['draft', 'published'].includes(req.body?.status) ? req.body.status : 'draft';
    const merged = { ...parsed.fields, ...refs };
    // Values the admin edited in the review form win over what was read from the HTML.
    for (const key of Object.keys(merged)) if (key !== 'content_html' && key in o && o[key] !== undefined) merged[key] = o[key];
    for (const key of Object.keys(merged)) if (merged[key] === '' ) merged[key] = null;
    for (const key of ['seo_keywords', 'tested_devices']) if (merged[key] === null) merged[key] = [];
    if (merged.tags === null) merged.tags = [];
    if (!merged.title) throw new AppError('VALIDATION_ERROR', 'A title is required (add a <title> or <h1>, or type one in).', 422, { fields: { title: 'Required.' } });
    // Empty values are omitted so required-checks and defaults behave; an automatic slug is regenerated unique on save.
    const body = Object.fromEntries(Object.entries({ ...merged, status }).filter(([, v]) => v !== null && v !== undefined));
    if (body.slug && body.slug === slugify(body.title) && !parsed.hints.slug) delete body.slug;
    if (status === 'published' && !body.published_at) body.published_at = new Date().toISOString();
    const post = await service.create(RESOURCES.posts, body, actor(req), req.ip);
    ok(res, { post, url: `/posts/${post.slug}`, status: post.status, warnings: parsed.warnings }, 201);
  }));

  // ---- Generic CRUD: posts, categories, tags, services, guides, social-links ----
  const resource = (req) => {
    const def = Object.hasOwn(RESOURCES, req.params.resource) ? RESOURCES[req.params.resource] : null;
    if (!def) throw new AppError('NOT_FOUND', 'Unknown resource.', 404);
    return def;
  };
  router.get('/:resource', h(async (req, res) => ok(res, await service.list(resource(req), { ...page(req), filters: { status: req.query.status } }))));
  router.post('/:resource', h(async (req, res) => ok(res, await service.create(resource(req), req.body, actor(req), req.ip), 201)));
  router.get('/:resource/:id', h(async (req, res) => ok(res, await service.get(resource(req), req.params.id))));
  router.patch('/:resource/:id', h(async (req, res) => ok(res, await service.update(resource(req), req.params.id, req.body, actor(req), req.ip))));
  router.delete('/:resource/:id', h(async (req, res) => { await service.remove(resource(req), req.params.id, actor(req), req.ip); ok(res, { deleted: true }); }));

  return router;
}
