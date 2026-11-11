import {mountPromotions,stopPromotions}from'/promotions.js';
import { getBrowsing } from '/browsing-preferences.js';
import { renderSlideshow, brandLogo } from '/slides-view.js';
import { mountSlides } from '/slideshow.js';
import { socialBar, socialIcons } from '/social-bar.js';
import { pages, LEGAL_UPDATED, servicesExtras, premiumExtras } from './content.js';
const state = { posts: [], categories: [], services: [], socialLinks: [], homepage: null, premium: null, site: null, user: null };
const DEFAULT_SITE = { brand_name: 'Eliahtech Gaming', gaming_identity: 'EliahTech Gaming', tagline: 'Gaming guides and support', website_url: '', seo_title: 'EliahTech – Gaming & Technology', seo_description: 'Gaming and technology guides, updates and tutorials.' };
const app = document.querySelector('#app');
// Used only when the homepage setting cannot be loaded (for example before the Supabase migrations have run).
const DEFAULT_HOMEPAGE = {
  hero_title: 'Gaming guides, settings and support.', hero_description: 'Practical guides, tools and ideas from Eliah Tech.',
  cta_label: 'Browse the latest', cta_url: '/search', secondary_cta_label: 'Our services', secondary_cta_url: '/services', latest_post_count: 6, featured_post_slug: null,
  sections: [{ key: 'latest', enabled: true, eyebrow: 'LATEST', title: 'Latest from EliahTech' }, { key: 'categories', enabled: true, eyebrow: 'EXPLORE', title: 'Browse by category' }, { key: 'services', enabled: true, eyebrow: 'SERVICES', title: 'Explore EliahTech services' }, { key: 'ai', enabled: true, eyebrow: 'ELIAHTECH AI', title: 'Ask about games, tech and digital tools' }, { key: 'premium', enabled: true, eyebrow: 'PREMIUM', title: 'Go deeper with EliahTech' }, { key: 'newsletter', enabled: true, eyebrow: 'NEWSLETTER', title: 'Stay in the loop' }],
};
const escapeHtml = (value = '') => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
const formatDate = (date) => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(date));
const NEXT_KEY = 'eliah.next';
const AFTER_LOGIN_KEY = 'eliah.afterLogin';
// Where a person lands after signing in when no page was requested: admins go to the admin workspace, everyone else to their account.
const homeFor = (user) => (user?.role === 'admin' ? '/admin' : '/profile');
function takeNext() { try { const next = sessionStorage.getItem(NEXT_KEY); sessionStorage.removeItem(NEXT_KEY); return /^\/(?![\/\\])[^\r\n]*$/.test(next||'') ? next : null; } catch { return null; } }
const csrf = () => decodeURIComponent(document.cookie.split('; ').find(c => c.startsWith('__Host-eliah_csrf=')||c.startsWith('eliah_csrf='))?.split('=').slice(1).join('=')||'');
let memorySession = {cookie:true};
const session = { get:()=>memorySession, set:()=>{memorySession={cookie:true};}, clear:()=>{memorySession=null;} };
try { localStorage.removeItem('eliah.session'); } catch {}
class ApiError extends Error { constructor(message, status, code, details) { super(message); this.status = status; this.code = code; this.details = details; } }
let refreshing = null;
async function refreshSession() {
  const current = session.get();
  if (!current) return false;
  refreshing ||= (async () => {
    try {
      const res = await fetch('/api/v1/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Eliah-Browser':'1','X-CSRF-Token':csrf() }, body: '{}'  });
      const payload = await res.json();
      if (!res.ok || !payload.success) { session.clear(); return false; }
      session.set(payload.data.session);
      return true;
    } catch { return false; } finally { refreshing = null; }
  })();
  return refreshing;
}
// options.noAuth skips the stored session (login/register/forgot). A 401 triggers one silent token refresh.
const api = async (path, options = {}, retry = true) => {
  const token = options.noAuth ? null : session.get()?.access_token;
  const response = await fetch(`/api/v1${path}`, { ...options, headers: { 'Content-Type': 'application/json', 'X-Eliah-Browser':'1','X-CSRF-Token':csrf(), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) } });
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (response.status === 401 && retry && !options.noAuth && await refreshSession()) return api(path, options, false);
  if (!response.ok || !payload || payload.success === false) throw new ApiError(payload?.error?.message || 'Something went wrong.', response.status, payload?.error?.code, payload?.error?.details);
  return payload.data;
};
async function loadUser() {
  try { state.user = await api('/auth/me'); } catch (error) { if (error.status === 401) session.clear(); state.user = null; }
}
let signingOut = false;
// Per-person data kept in this browser (editor drafts) must not outlive the session on a shared phone.
function forgetLocalAccountData() {
  try { for (const key of Object.keys(localStorage)) if (key.startsWith('eliah.draft.')) localStorage.removeItem(key); } catch { /* storage unavailable */ }
  try { sessionStorage.removeItem(NEXT_KEY); sessionStorage.removeItem(AFTER_LOGIN_KEY); } catch { /* storage unavailable */ }
}
async function signOut() {
  if (signingOut) return;
  signingOut = true;
  try {
    await api('/auth/logout', { method: 'POST' });
  } catch (error) {
    // 401 means there was no valid session left, which is the outcome we wanted. Anything else (offline, blocked) is
    // reported honestly instead of pretending the person is signed out while their cookies are still in place.
    if (error.status !== 401) { signingOut = false; toast('Could not sign out. Check your connection and try again.'); return; }
  }
  session.clear(); state.user = null; forgetLocalAccountData();
  window.location.replace('/');
}
const toast = (message) => { const item = document.createElement('div'); item.className = 'toast-card'; item.textContent = message; document.querySelector('#toast-root').appendChild(item); setTimeout(() => item.remove(), 4200); };
const brandIcons = new Set(['fa-telegram', 'fa-facebook-f', 'fa-instagram', 'fa-whatsapp', 'fa-youtube']);
// Icon names come from the database (nullable, admin-edited): anything that is not a plain Font Awesome class falls back to a safe default.
const icon = (raw) => { const name = /^[a-z0-9-]{1,40}$/.test(String(raw ?? '')) ? String(raw) : 'fa-circle'; return `<i class="${brandIcons.has(name) ? 'fa-brands' : 'fa-solid'} ${name.startsWith('fa-') ? name : `fa-${name}`}" aria-hidden="true"></i>`; };
// Only http(s) URLs are ever used for external links; the value is HTML-escaped by the caller.
const externalHref = (url) => (/^https?:\/\//i.test(String(url ?? '')) ? String(url) : '#');

function header() {
  const current = window.location.pathname;
  const links = [['/', 'Home'], ['/games','Game hubs'], ['/posts','Posts'], ['/categories','Categories'], ['/ai','Ask AI'], ['/premium','Premium'], ['/community','My library']];
  return `<div class="nav-wrap"><div class="container-xl"><nav class="navbar navbar-expand-lg navbar-dark"><a class="brand etg-brand" href="/" aria-label="Eliahtech Gaming home">${brandLogo()}</a><button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#siteNav" aria-label="Toggle navigation"><span class="navbar-toggler-icon"></span></button><div class="collapse navbar-collapse" id="siteNav"><ul class="navbar-nav ms-auto align-items-lg-center gap-lg-1">${links.map(([url, label]) => `<li class="nav-item"><a class="nav-link ${current === url ? 'active' : ''}" ${current === url ? 'aria-current="page"' : ''} href="${url}">${escapeHtml(label)}</a></li>`).join('')}<li class="nav-item ms-lg-2"><a class="nav-cta" href="/search"><i class="fa-solid fa-magnifying-glass me-1"></i> Search</a></li>${state.user?.role === 'admin' ? '<li class="nav-item"><a class="nav-link" href="/admin">Admin</a></li>' : ''}<li class="nav-item ms-lg-2">${state.user ? `<a class="nav-link" href="/profile"><i class="fa-regular fa-user me-1"></i> ${escapeHtml(state.user.display_name || 'Profile')}</a></li><li class="nav-item"><a class="nav-link" href="/login" data-action="logout" role="button"><i class="fa-solid fa-right-from-bracket me-1" aria-hidden="true"></i> Sign out</a>` : `<a class="nav-link" href="/login"><i class="fa-regular fa-user me-1"></i> Login</a>`}</li></ul></div></nav></div></div>${renderSlideshow(getBrowsing())}`;
}
function footer() { return `<footer class="footer"><div class="container-xl"><div class="row g-4"><div class="col-lg-5"><a class="brand etg-brand" href="/" aria-label="Eliahtech Gaming home">${brandLogo()}</a><p class="mt-3 mb-0">${escapeHtml(state.site?.description || 'Gaming and technology guides, updates and tutorials.')}</p></div><div class="col-6 col-lg-2"><strong class="d-block mb-2">Explore</strong><p class="mb-1"><a href="/about">About</a></p><p class="mb-1"><a href="/posts">Guides</a></p><p class="mb-1"><a href="/premium">Premium</a></p><strong class="d-block mt-3 mb-2">Categories</strong>${state.categories.slice(0, 4).map((category) => `<p class="mb-1"><a href="/category/${encodeURIComponent(category.slug)}">${escapeHtml(category.name)}</a></p>`).join('')}</div><div class="col-6 col-lg-2"><strong class="d-block mb-2">Support</strong><p class="mb-1"><a href="/contact">Contact</a></p><p class="mb-1"><a href="/privacy">Privacy</a></p><p class="mb-1"><a href="/terms">Terms</a></p><p class="mb-1"><button type="button" class="btn btn-link btn-sm" data-browsing-settings>Browsing preferences</button></p></div><div class="col-lg-3"><strong class="d-block mb-2">Follow the signal</strong><div class="socials footer-icons">${socialIcons(state.socialLinks, { size: 32 })}</div></div></div><div class="d-flex flex-wrap justify-content-between gap-2 border-top mt-4 pt-3"><small>© ${new Date().getFullYear()} ${escapeHtml(state.site?.brand_name || 'EliahTech')}. Built for the next useful idea.</small><small>Only distribute or link to content you have the legal right to share.</small></div></div></footer>`; }
function shell(content) { app.innerHTML = `${socialBar(state.socialLinks)}${header()}<main>${content}</main>${footer()}`; reveal(); mountSlides(); }
function reveal() { requestAnimationFrame(() => document.querySelectorAll('.reveal').forEach((node, index) => setTimeout(() => node.classList.add('visible'), Math.min(index * 45, 320)))); }
function postCard(post) { const cat = post.category || { slug: '', name: 'Article' }; const accent = cat.slug === 'tech-tricks' ? 'linear-gradient(135deg,#064e3b,#0e7490)' : cat.slug === 'game-updates' ? 'linear-gradient(135deg,#701a75,#be185d)' : cat.slug === 'android-tips' ? 'linear-gradient(135deg,#365314,#0f766e)' : 'linear-gradient(135deg,#312e81,#7e22ce)'; return `<a class="card-surface post-card reveal" href="/post/${encodeURIComponent(post.slug)}"><div class="post-art" style="background:${accent}"><i class="fa-solid fa-${cat.slug === 'tech-tricks' ? 'microchip' : cat.slug === 'android-tips' ? 'mobile-screen-button' : 'gamepad'}"></i></div><div class="post-body"><div class="kicker">${escapeHtml(cat.name)}${post.is_premium ? ' <span class="tag">PREMIUM</span>' : ''}</div><h3>${escapeHtml(post.title)}</h3><p>${escapeHtml(post.excerpt)}</p><div class="meta"><span>${formatDate(post.published_at)}</span><span class="dot"></span><span>${post.reading_time} min read</span></div></div></a>`; }
function categoryCard(category) { return `<a href="/category/${encodeURIComponent(category.slug)}" class="category-card reveal"><span class="category-icon">${icon(category.icon)}</span><span><strong>${escapeHtml(category.name)}</strong><span>Browse the latest</span></span><i class="fa-solid fa-arrow-up-right-from-square ms-auto text-secondary small"></i></a>`; }
function serviceCard(service) { const color = { violet: 'rgba(139,92,246,.3)', cyan: 'rgba(34,211,238,.3)', orange: 'rgba(245,158,11,.3)', pink: 'rgba(244,114,182,.3)' }[service.accent] || 'rgba(139,92,246,.3)'; return `<article class="card-surface service-card reveal" style="--glow:${color}">${service.image_url ? `<img class="w-100 rounded mb-3" src="${escapeHtml(service.image_url)}" alt="" loading="lazy">` : ''}<div class="service-icon">${icon(service.icon)}</div><h3>${escapeHtml(service.title)}</h3><p>${escapeHtml(service.description)}</p><ul>${service.features.map((feature) => `<li>${icon('fa-check')} ${escapeHtml(feature)}</li>`).join('')}</ul><div class="d-flex align-items-center justify-content-between gap-2"><span class="price">${escapeHtml(service.price)}</span><a class="section-link" href="${escapeHtml(safeHref(service.action_url) === '/' && !service.action_url ? `/contact?service=${encodeURIComponent(service.title)}` : safeHref(service.action_url))}">${escapeHtml(service.action_text || 'Get started')} <i class="fa-solid fa-arrow-right ms-1"></i></a></div></article>`; }

const FALLBACK_IMAGE = '/assets/hero.svg';
const safeHref = (url) => (/^(\/(?!\/)|https:\/\/|#)/.test(url || '') ? url : '/');
function sectionHeading(section, link = '') { return `<div class="section-heading"><div>${section.eyebrow ? `<span class="eyebrow">${escapeHtml(section.eyebrow)}</span>` : ''}${section.title ? `<h2>${escapeHtml(section.title)}</h2>` : ''}</div>${link || (section.description ? `<p>${escapeHtml(section.description)}</p>` : '')}</div>`; }
const wrapSection = (inner, extra = '') => `<section class="section pt-0" ${extra}><div class="container-xl">${inner}</div></section>`;

// The homepage is data-driven: order, visibility and copy of each section come from the `homepage` setting
// edited in the admin dashboard. Sections with nothing to show (no posts, no services) are skipped.
async function renderHome() {
  const home = state.homepage;
  setMeta(state.site?.seo_title || 'Gaming guides and support', state.site?.seo_description || home.hero_description);
  let featured = (home.featured_post_slug && state.posts.find((post) => post.slug === home.featured_post_slug)) || state.posts.find((post) => post.featured) || state.posts[0];
  if (home.featured_post_slug && featured?.slug !== home.featured_post_slug) {
    try { featured = { ...(await api(`/posts/${encodeURIComponent(home.featured_post_slug)}`)) }; } catch { /* keep the fallback featured post */ }
  }
  const count = Math.min(Math.max(Number(home.latest_post_count) || 6, 1), 24);
  const builders = {
    featured: (section) => (featured ? wrapSection(`${sectionHeading(section, '<a class="section-link" href="/search">View all notes <i class="fa-solid fa-arrow-right ms-1"></i></a>')}<div class="card-surface featured-card"><div class="row g-0 align-items-stretch"><div class="col-lg-6"><img class="featured-image" src="${escapeHtml(featured.featured_image || FALLBACK_IMAGE)}" alt="${escapeHtml(featured.title)}"></div><div class="col-lg-6"><div class="featured-copy h-100 d-flex flex-column justify-content-center"><div class="kicker">${escapeHtml(featured.category?.name || 'Article')} / ${formatDate(featured.published_at)}</div><h3>${escapeHtml(featured.title)}</h3><p>${escapeHtml(featured.excerpt)}</p><div class="meta mt-2 mb-4"><span>By ${escapeHtml(featured.author)}</span><span class="dot"></span><span>${featured.reading_time} min read</span></div><a class="section-link" href="/post/${encodeURIComponent(featured.slug)}">Read the full field note <i class="fa-solid fa-arrow-up-right-from-square ms-1"></i></a></div></div></div></div>`, 'id="latest"') : ''),
    latest: (section) => wrapSection(`${sectionHeading(section)}<div class="row g-4">${state.posts.length ? state.posts.slice(0, count).map(postCard).join('') : '<div class="col-12"><div class="empty-state">No articles have been published yet.</div></div>'}</div>`),
    categories: (section) => (state.categories.length ? wrapSection(`${sectionHeading(section)}<div class="row g-3">${state.categories.map((category) => `<div class="col-md-6 col-lg-4">${categoryCard(category)}</div>`).join('')}</div>`) : ''),
    services: (section) => (state.services.length ? wrapSection(`${sectionHeading(section, '<a class="section-link" href="/services">See all services <i class="fa-solid fa-arrow-right ms-1"></i></a>')}<div class="row g-4">${state.services.map((service) => `<div class="col-md-6 col-lg-3">${serviceCard(service)}</div>`).join('')}</div>`) : ''),
    youtube: (section) => (section.video_id ? wrapSection(`${sectionHeading(section)}<div class="ratio ratio-16x9 card-surface"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(section.video_id)}" title="${escapeHtml(section.title || 'YouTube video')}" loading="lazy" allowfullscreen></iframe></div>`) : ''),
    ai: (section) => wrapSection(`${sectionHeading(section)}<div class="card-surface p-4 p-lg-5"><div class="row align-items-center g-4"><div class="col-lg-8"><h3 class="h4">Practical help, powered by free-plan AI</h3><p class="text-secondary mb-0">Ask about PSP and PPSSPP, gaming, Android, technology, coding, content and AI tools. Availability follows the providers’ free-tier limits.</p></div><div class="col-lg-4 text-lg-end"><a class="btn btn-brand" href="/ai">Open EliahTech AI <i class="fa-solid fa-arrow-right ms-2"></i></a></div></div></div>`),
    premium: (section) => (state.premium ? wrapSection(`${sectionHeading(section)}<div class="card-surface p-4 p-lg-5"><div class="row align-items-center g-4"><div class="col-lg-8"><h3 class="h4">${state.premium.status === 'available' ? 'Explore Premium access' : 'Premium is coming soon'}</h3><p class="text-secondary mb-0">${state.premium.status === 'available' ? `Premium access: ${escapeHtml(state.premium.price_label)} / ${escapeHtml(state.premium.period)}${Number(state.premium.trial_days) > 0 ? ` · ${Number(state.premium.trial_days)}-day trial` : ''}.` : 'More in-depth guides and member features are on the way.'}</p></div><div class="col-lg-4 text-lg-end"><a class="btn btn-ghost" href="/premium">${state.premium.status === 'available' ? 'View Premium' : 'Learn more'} <i class="fa-solid fa-arrow-right ms-2"></i></a></div></div></div>`) : ''),
    newsletter: (section) => wrapSection(`<div class="newsletter"><div class="row align-items-center g-4"><div class="col-lg-6">${section.eyebrow ? `<span class="eyebrow">${escapeHtml(section.eyebrow)}</span>` : ''}<h2>${escapeHtml(section.title || '')}</h2><p class="mb-0">${escapeHtml(section.description || '')}</p></div><div class="col-lg-6"><form id="newsletter-form" class="row g-2"><div class="col-sm-8"><label class="visually-hidden" for="newsletter-email">Email address</label><input class="form-control" id="newsletter-email" type="email" placeholder="you@example.com" required></div><div class="col-sm-4"><button class="btn btn-brand w-100" type="submit">Join the list</button></div></form></div></div></div>`),
  };
  const sections = (home.sections || []).filter((section) => section.enabled !== false && builders[section.key]).map((section) => builders[section.key](section)).join('');
  shell(`<section class="hero"><div class="container-xl"><div class="row hero-grid g-5"><div class="col-lg-7"><span class="eyebrow">${escapeHtml(state.site?.brand_name || 'EliahTech')}</span><h1><span class="gradient-text">${escapeHtml(home.hero_title)}</span></h1><p class="hero-copy">${escapeHtml(home.hero_description)}</p><div class="hero-actions"><a class="btn btn-brand" href="${escapeHtml(safeHref(home.cta_url))}">${escapeHtml(home.cta_label)} <i class="fa-solid fa-arrow-right ms-2"></i></a><a class="btn btn-ghost" href="${escapeHtml(safeHref(home.secondary_cta_url))}">${escapeHtml(home.secondary_cta_label)}</a></div></div><div class="col-lg-5"><div class="hero-visual"><img src="${escapeHtml(featured?.featured_image || FALLBACK_IMAGE)}" alt="${featured ? escapeHtml(featured.title) : 'Abstract neon gaming and technology workspace visual'}"></div></div></div></div></section><div class="pt-5"></div>${sections}`);
  document.querySelector('#newsletter-form')?.addEventListener('submit', async (event) => { event.preventDefault(); const email = document.querySelector('#newsletter-email').value; try { const result = await api('/newsletter/subscribe', { method: 'POST', body: JSON.stringify({ email }) }); toast(result.message); event.target.reset(); } catch (error) { toast(error.message); } });
}

async function renderServices() { setMeta('Services', 'Website development, Android apps, CMS setup, AI chatbots, tech support and content services from Eliah Tech.'); shell(`<section class="page-hero"><div class="container-xl"><span class="eyebrow">SERVICES / MAKE IT REAL</span><h1>Digital systems with a clear next step.</h1><p>From a first responsive site to a content platform that can grow into an Android app, we help shape the parts that make a product useful.</p></div></section><section class="section"><div class="container-xl"><div class="row g-4">${state.services.length ? state.services.map((service) => `<div class="col-md-6">${serviceCard(service)}</div>`).join('') : '<div class="col-12"><div class="empty-state">Services will be listed here soon. Use the contact page to ask about a project.</div></div>'}</div>${servicesExtra()}<div class="card-surface p-4 p-lg-5 mt-5"><div class="row align-items-center g-4"><div class="col-lg-8"><span class="eyebrow">NOT SURE WHERE TO START?</span><h2 class="mt-3 mb-2">Bring the messy version. We will find the useful version.</h2><p class="text-secondary mb-0">Tell us what you are trying to build, what is not working and what success would feel like. We will reply with a practical direction.</p></div><div class="col-lg-4 text-lg-end"><a class="btn btn-brand" href="/contact">Start a conversation <i class="fa-solid fa-arrow-right ms-2"></i></a></div></div></div></div></section>`); }
async function renderPremium() { setMeta('Premium', 'Ad-free reading, premium guides, early access and higher AI limits. Start a 3-day trial.'); shell(`<section class="page-hero"><div class="container-xl"><span class="eyebrow">PREMIUM / MORE SIGNAL</span><h1>Make more room for the good stuff.</h1><p>Premium is for readers who want fewer interruptions, deeper guides and early access to practical digital resources.</p></div></section><section class="section"><div class="container-xl"><div class="premium-panel"><div class="row align-items-center g-5"><div class="col-lg-7"><span class="kicker">ELIAH TECH PREMIUM</span><h2 class="display-5 fw-bold mt-3 mb-3">A calmer way to keep learning.</h2><p class="text-secondary">Start with a 3-day trial. Keep the account whether you subscribe or not. No clutter, no pressure—just a better way to access the work.</p><ul class="check-list mt-4"><li>${icon('fa-check')} Ad-free browsing</li><li>${icon('fa-check')} Premium guides and tutorials</li><li>${icon('fa-check')} Early access to new resources</li><li>${icon('fa-check')} Higher AI assistant limits</li></ul>${premiumCta()}</div><div class="col-lg-5"><div class="card-surface p-4"><div class="d-flex justify-content-between align-items-start"><span class="kicker">MONTHLY</span>${state.premium?.status === 'coming_soon' ? '<span class="tag">COMING SOON</span>' : ''}</div>${state.premium ? `<div class="display-6 fw-bold mt-3">${escapeHtml(state.premium.price_label)} <small class="text-secondary fs-6 fw-normal">/ ${escapeHtml(state.premium.period)}</small></div>` : ''}<hr class="border-secondary opacity-25"><div id="plans-box" aria-live="polite"></div></div></div></div></div>${premiumExtra()}</div></section>`); mountPlans(); }
async function renderPost(slug) { try { const post = await api(`/posts/${encodeURIComponent(slug)}`); setMeta(post.seo_title || post.title, post.seo_description || post.excerpt || ''); shell(`<section class="page-hero"><div class="container-xl article"><span class="eyebrow">${escapeHtml(post.category?.name || 'Article')} / ${formatDate(post.published_at)}</span><h1>${escapeHtml(post.title)}</h1><p>${escapeHtml(post.excerpt)}</p><div class="meta mt-3"><span>By ${escapeHtml(post.author)}</span><span class="dot"></span><span>${post.reading_time} min read</span></div></div></section><section class="section pt-4"><article class="article"><img class="article-cover" src="${escapeHtml(post.featured_image || FALLBACK_IMAGE)}" alt="${escapeHtml(post.featured_image_alt || post.title)}"><div class="article-body">${post.content}</div>${post.installation_guide ? `<section class="card-surface p-4 mt-4" aria-label="Installation guide"><span class="eyebrow">INSTALLATION GUIDE</span><h2 class="h4 mt-2">${escapeHtml(post.installation_guide.title)}</h2><div class="article-body">${post.installation_guide.content}</div></section>` : ''}<div class="d-flex flex-wrap gap-2 mt-4">${(post.tags || []).map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`).join('')}</div><div class="card-surface p-4 mt-5"><span class="eyebrow">KEEP EXPLORING</span><h3 class="mt-2 mb-2">Want more practical signal?</h3><p class="text-secondary mb-3">Browse the latest posts or tell us what you want to see next.</p><a class="btn btn-ghost me-2" href="/search">Browse posts</a><a class="btn btn-brand" href="/contact">Send a note</a></div></article></section>`); } catch (error) { if (error.code === 'PREMIUM_REQUIRED') return renderLocked(error.details); renderNotFound(error.message); } }
async function renderCategory(slug) { const category = state.categories.find((item) => item.slug === slug); const postsForCategory = (await api(`/posts?category=${encodeURIComponent(slug)}&limit=50`)).items; shell(`<section class="page-hero"><div class="container-xl"><span class="eyebrow">CATEGORY / ${category ? escapeHtml(category.name) : 'EXPLORE'}</span><h1>${category ? escapeHtml(category.name) : 'The archive'}</h1><p>${category ? `The latest ${escapeHtml(category.name.toLowerCase())} notes, guides and ideas from Eliah Tech.` : 'Explore the latest notes across gaming, device settings and content creation.'}</p></div></section><section class="section"><div class="container-xl"><div class="row g-4">${postsForCategory.length ? postsForCategory.map(postCard).join('') : '<div class="col-12"><div class="empty-state">No posts in this lane yet. Try another category or search the full archive.</div></div>'}</div></div></section>`); }
async function renderSearch() { shell(`<section class="page-hero"><div class="container-xl"><span class="eyebrow">SEARCH THE SIGNAL</span><h1>Find the useful bit.</h1><form id="search-form" class="row g-2 mt-3" style="max-width:680px"><div class="col-sm-9"><label class="visually-hidden" for="search-query">Search</label><input class="form-control" id="search-query" placeholder="Try “Android”, “setup” or “digital”" value="${escapeHtml(new URLSearchParams(window.location.search).get('q') || '')}"></div><div class="col-sm-3"><button class="btn btn-brand w-100" type="submit">Search</button></div></form></div></section><section class="section"><div class="container-xl"><div id="search-results"><div class="empty-state">Start with a phrase, then press search.</div></div></div></section>`); const form = document.querySelector('#search-form'); form.addEventListener('submit', async (event) => { event.preventDefault(); const query = document.querySelector('#search-query').value.trim(); if (query.length < 2) return toast('Enter at least two characters.'); window.history.replaceState({}, '', `/search?q=${encodeURIComponent(query)}`); let result; try { result = await api(`/search?q=${encodeURIComponent(query)}`); } catch (error) { return toast(error.message); } document.querySelector('#search-results').innerHTML = result.items.length ? `<div class="section-heading"><div><span class="eyebrow">RESULTS</span><h2>${result.meta.total} notes for “${escapeHtml(query)}”</h2></div></div><div class="row g-4">${result.items.map(postCard).join('')}</div>` : '<div class="empty-state">No matching notes yet. Try a broader phrase.</div>'; reveal(); }); const initial = new URLSearchParams(window.location.search).get('q'); if (initial) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }
const slugify = (text) => text.toLowerCase().replace(/&amp;/g, 'and').replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function setMeta(title, description) { const brand = state.site?.brand_name || 'EliahTech'; document.title = `${title} — ${brand}`; document.querySelector('meta[name="description"]')?.setAttribute('content', description); document.querySelector('meta[property="og:title"]')?.setAttribute('content', `${title} — ${brand}`); document.querySelector('meta[property="og:description"]')?.setAttribute('content', description); document.querySelector('meta[property="og:site_name"]')?.setAttribute('content', brand); document.querySelector('meta[name="twitter:title"]')?.setAttribute('content', `${title} — ${brand}`); document.querySelector('meta[name="twitter:description"]')?.setAttribute('content', description); const base = state.site?.canonical_url || state.site?.website_url; if (base) { let canonical = document.querySelector('link[rel="canonical"]'); if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.append(canonical); } try { canonical.href = new URL(window.location.pathname, base).href; document.querySelector('meta[property="og:url"]')?.setAttribute('content', canonical.href); } catch { /* validated on the server; retain existing metadata on malformed legacy data */ } } }
function faqBlock(items, id) { return `<div class="accordion faq mt-3" id="${id}">${items.map(([q, a], i) => `<div class="accordion-item"><h3 class="accordion-header"><button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#${id}-${i}" aria-expanded="false" aria-controls="${id}-${i}">${escapeHtml(q)}</button></h3><div id="${id}-${i}" class="accordion-collapse collapse" data-bs-parent="#${id}"><div class="accordion-body">${escapeHtml(a)}</div></div></div>`).join('')}</div>`; }
function servicesExtra() { return `<div class="mt-5"><span class="eyebrow">HOW A PROJECT WORKS</span><h2 class="mt-2 mb-4">Four steps from idea to launch.</h2><div class="row g-3">${servicesExtras.steps.map(([title, text], i) => `<div class="col-md-6 col-lg-3"><div class="info-tile h-100 reveal"><span class="step-num">0${i + 1}</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p></div></div>`).join('')}</div></div><div class="mt-5"><span class="eyebrow">QUESTIONS</span><h2 class="mt-2">Before you get in touch.</h2>${faqBlock(servicesExtras.faq, 'svc-faq')}</div>`; }
function premiumExtra() { const cell = (v) => v === true ? `<span class="text-success" aria-label="Included">${icon('fa-check')}</span>` : v === false ? '<span class="text-secondary" aria-label="Not included">&mdash;</span>' : escapeHtml(v); return `<div class="mt-5"><span class="eyebrow">COMPARE ACCESS</span><h2 class="mt-2 mb-3">What each level includes.</h2><div class="table-responsive card-surface p-2"><table class="table table-dark table-borderless align-middle mb-0 compare"><thead><tr><th scope="col">Feature</th><th scope="col">Guest</th><th scope="col">Free account</th><th scope="col">Premium</th></tr></thead><tbody>${premiumExtras.compare.map(([label, ...vals]) => `<tr><th scope="row" class="fw-normal">${escapeHtml(label)}</th>${vals.map((v) => `<td>${cell(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div><div class="mt-5"><span class="eyebrow">FAQ</span><h2 class="mt-2">Trials, payments and access.</h2>${faqBlock(premiumExtras.faq, 'prem-faq')}</div>`; }
function renderStatic(slug) { const page = pages[slug]; if (!page) return renderNotFound(); const site = state.site; const title = slug === 'about' ? (site?.about_title || page.title) : page.title; const lead = slug === 'about' ? (site?.about_lead || page.lead) : page.lead; const faqs = slug === 'contact' && Array.isArray(site?.contact_faqs) ? site.contact_faqs.map((faq) => [faq.question, faq.answer]) : page.faq; setMeta(title, lead); let body = slug === 'about' && site?.about_text ? site.about_text.split(/\n\s*\n/).map((p) => `<p>${escapeHtml(p.replace(/\n/g, ' '))}</p>`).join('') : page.body; let toc = ''; if (page.legal) { const heads = []; body = body.replace(/<h2>(.*?)<\/h2>/g, (_m, text) => { const id = slugify(text); heads.push([id, text]); return `<h2 id="${id}">${text}</h2>`; }); toc = `<nav class="toc card-surface p-3 mb-4" aria-label="On this page"><strong class="d-block mb-2 small text-secondary">ON THIS PAGE</strong><ol class="mb-0">${heads.map(([id, text]) => `<li><a href="#${id}">${text.replace(/^\d+\.\s*/, '')}</a></li>`).join('')}</ol></nav>`; } shell(`<section class="page-hero"><div class="container-xl"><span class="eyebrow">${page.eyebrow}</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(lead)}</p>${page.legal ? `<div class="meta mt-3"><span>Last updated ${LEGAL_UPDATED}</span></div>` : ''}</div></section><section class="section"><div class="container-xl article">${toc}<div class="article-body">${body}</div>${slug === 'contact' ? contactForm() + '<h2 class="mt-5">Common questions</h2>' + faqBlock(faqs, 'contact-faq') : ''}</div></section>`); if (slug === 'contact') bindContactForm(); }
function contactForm() { const service = new URLSearchParams(window.location.search).get('service'); return `<form id="contact-form" class="card-surface p-4 mt-4" novalidate><div class="row g-3"><div class="col-md-6"><label class="form-label small text-secondary" for="contact-name">Name</label><input class="form-control" id="contact-name" name="name" autocomplete="name" maxlength="100" required></div><div class="col-md-6"><label class="form-label small text-secondary" for="contact-email">Email</label><input class="form-control" id="contact-email" name="email" type="email" autocomplete="email" maxlength="254" required></div><div class="col-12"><label class="form-label small text-secondary" for="contact-subject">Subject</label><input class="form-control" id="contact-subject" name="subject" maxlength="180" value="${escapeHtml(service ? `Enquiry: ${service}` : '')}" required></div><div class="col-12"><label class="form-label small text-secondary" for="contact-message">Message</label><textarea class="form-control" id="contact-message" name="message" rows="6" maxlength="5000" required></textarea></div><div class="col-12 d-flex flex-wrap align-items-center gap-3"><button class="btn btn-brand" type="submit">Send message <i class="fa-solid fa-paper-plane ms-2"></i></button><span id="contact-status" class="small text-secondary" role="status" aria-live="polite"></span></div></div></form>`; }
function bindContactForm() { document.querySelector('#contact-form')?.addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return; const button = form.querySelector('button[type="submit"]'); const status = document.querySelector('#contact-status'); const body = { name: document.querySelector('#contact-name').value, email: document.querySelector('#contact-email').value, subject: document.querySelector('#contact-subject').value, message: document.querySelector('#contact-message').value }; button.disabled = true; status.textContent = 'Sending…'; try { const result = await api('/contact', { method: 'POST', body: JSON.stringify(body) }); toast(result.message); form.reset(); status.textContent = 'Message sent.'; } catch (error) { status.textContent = error.message; toast(error.message); } finally { button.disabled = false; } }); }
function renderNotFound(message = 'The page you requested was not found.') { shell(`<section class="page-hero"><div class="container-xl"><span class="eyebrow">404 / SIGNAL LOST</span><h1>That path is off the map.</h1><p>${escapeHtml(message)}</p><a class="btn btn-brand mt-3" href="/">Return home <i class="fa-solid fa-arrow-right ms-2"></i></a></div></section>`); }

function pageHero(eyebrow, title, lead) { return `<section class="page-hero"><div class="container-xl"><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${lead}</p></div></section>`; }
const field = (id, label, type = 'text', extra = '') => `<label class="form-label small text-secondary" for="${id}">${label}</label><input class="form-control mb-3" id="${id}" type="${type}" ${extra}>`;
const formCard = (inner) => `<section class="section"><div class="container-xl"><div class="row justify-content-center"><div class="col-lg-6"><form id="auth-form" class="card-surface p-4 p-lg-5" novalidate>${inner}</form></div></div></div></section>`;
async function submitForm(event, action) { event.preventDefault(); const button = event.target.querySelector('button[type="submit"]'); button.disabled = true; try { await action(); } catch (error) { toast(error.message); } finally { button.disabled = false; } }
function readHash() { const params = new URLSearchParams(window.location.hash.replace(/^#/, '')); if (window.location.hash) window.history.replaceState({}, '', window.location.pathname + window.location.search); return params; }

function renderAuth(mode) {
  const isLogin = mode === 'login';
  setMeta(isLogin ? 'Log in' : 'Create account', 'Sign in to Eliah Tech.');
  const hash = isLogin ? readHash() : new URLSearchParams();
  const oauthError=new URLSearchParams(window.location.search).get('error');
  if(oauthError){try{sessionStorage.removeItem(AFTER_LOGIN_KEY);}catch{}}
  if(oauthError&&['google_failed','google_expired','google_unavailable'].includes(oauthError))toast(oauthError==='google_expired'?'Google sign-in expired. Please start again.':oauthError==='google_unavailable'?'Google sign-in is not configured yet.':'Google sign-in did not complete. Please try again.');
  if (hash.get('error_description')) toast(hash.get('error_description').replace(/\+/g, ' '));
  else if (hash.get('access_token') || new URLSearchParams(window.location.search).get('verified')) toast('Email verified. You can sign in now.');
  shell(`${pageHero(isLogin ? 'WELCOME BACK' : 'JOIN THE SIGNAL', isLogin ? 'Log in to your space.' : 'Create your Eliah Tech account.', isLogin ? 'Access your profile, premium content and account settings.' : 'Verify your email to start your free 3-day Premium trial. The account stays free afterwards.')}${formCard(`${isLogin ? '' : field('auth-name', 'Display name', 'text', 'autocomplete="nickname" minlength="2" maxlength="60" required')}${field('auth-email', 'Email', 'email', 'autocomplete="email" required')}${field('auth-password', 'Password', 'password', `autocomplete="${isLogin ? 'current-password' : 'new-password'}" minlength="8" required`)}<button class="btn btn-brand w-100 mt-2" type="submit">${isLogin ? 'Log in' : 'Create account'}</button><p class="text-secondary small mt-3 mb-0">${isLogin ? '<a class="section-link" href="/forgot-password">Forgot your password?</a><br>New here? <a class="section-link" href="/register">Create an account</a>' : 'Already have an account? <a class="section-link" href="/login">Log in</a>'}</p>`)}`);
  const google = document.createElement('a'); google.className='btn btn-outline-primary w-100 mb-3'; google.href='/api/auth/google'; google.textContent='Continue with Google'; google.addEventListener('click',()=>{try{sessionStorage.setItem(AFTER_LOGIN_KEY,'1');}catch{}}); fetch('/api/auth/google/status').then(r=>r.json()).then(d=>{if(d.enabled)document.querySelector('#auth-form')?.prepend(google);}).catch(()=>{});
  document.querySelector('#auth-form').addEventListener('submit', (event) => submitForm(event, async () => {
    const email = document.querySelector('#auth-email').value; const password = document.querySelector('#auth-password').value;
    if (isLogin) {
      const data = await api('/auth/login', { method: 'POST', noAuth: true, body: JSON.stringify({ email, password }) });
      session.set(data.session); state.user = data.user; toast('Welcome back.'); window.history.pushState({}, '', takeNext() || homeFor(data.user)); route();
    } else {
      const data = await api('/auth/register', { method: 'POST', noAuth: true, body: JSON.stringify({ email, password, display_name: document.querySelector('#auth-name').value }) });
      if (data.session) { session.set(data.session); await loadUser(); window.history.pushState({}, '', '/profile'); route(); return; }
      toast(data.message); event.target.reset();
    }
  }));
}

function renderForgot() {
  setMeta('Forgot password', 'Request a password reset link.');
  shell(`${pageHero('PASSWORD RECOVERY', 'Get back to your account.', 'Enter your email and we will send a reset link if an account exists.')}${formCard(`${field('auth-email', 'Email address', 'email', 'autocomplete="email" required')}<button class="btn btn-brand w-100" type="submit">Send reset link</button>`)}`);
  document.querySelector('#auth-form').addEventListener('submit', (event) => submitForm(event, async () => { const data = await api('/auth/forgot-password', { method: 'POST', noAuth: true, body: JSON.stringify({ email: document.querySelector('#auth-email').value }) }); toast(data.message); }));
}

function renderReset() {
  setMeta('Reset password', 'Choose a new password.');
  const hash = readHash(); const token = hash.get('type') === 'recovery' ? hash.get('access_token') : null;
  if (!token) { shell(`${pageHero('RESET PASSWORD', 'Open the link from your email.', 'This page only works from a valid reset link. Request a new one if yours has expired.')}<section class="section"><div class="container-xl"><a class="btn btn-brand" href="/forgot-password">Request a reset link</a></div></section>`); return; }
  shell(`${pageHero('RESET PASSWORD', 'Choose a fresh password.', 'Use at least 8 characters.')}${formCard(`${field('auth-password', 'New password', 'password', 'autocomplete="new-password" minlength="8" required')}<button class="btn btn-brand w-100" type="submit">Update password</button>`)}`);
  document.querySelector('#auth-form').addEventListener('submit', (event) => submitForm(event, async () => {
    await api('/auth/reset-password', { method: 'POST', noAuth: true, headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ password: document.querySelector('#auth-password').value }) });
    session.clear(); state.user = null; toast('Password updated. Please sign in.'); window.history.pushState({}, '', '/login'); route();
  }));
}

function accessSummary(user) {
  const { access } = user; const date = (v) => (v ? formatDate(v) : '');
  if (user.role === 'admin') return ['Administrator', 'Full access to all content.'];
  if (access.source === 'subscription') return ['Premium', `Active until ${date(access.premium_until)}.`];
  if (access.source === 'role') return ['Premium', 'Premium access is enabled on your account.'];
  if (access.source === 'trial') return ['Premium trial', `Your free trial ends on ${date(access.trial.ends_at)}.`];
  if (access.trial.expired) return ['Free account', `Your trial ended on ${date(access.trial.ends_at)}. Your account and free content remain available.`];
  return ['Free account', user.email_verified ? 'Premium features are available on the Premium page.' : 'Verify your email address to start your free trial.'];
}

// The member profile now lives on the dashboard (/community): account details, billing, support, library and following.
function renderProfile() { window.location.replace('/community'); }

function premiumCta() {
  if (!state.user) return '<a href="/register" class="btn btn-brand mt-2">Start your 3-day trial <i class="fa-solid fa-arrow-right ms-2"></i></a>';
  const [label, detail] = accessSummary(state.user);
  return `<div class="card-surface p-3 mt-2"><strong>${escapeHtml(label)}</strong><p class="text-secondary small mb-0">${escapeHtml(detail)}</p></div>`;
}

async function renderAiRoute() { try { const { renderAi } = await import('/ai.js'); await renderAi(); } catch (error) { renderNotFound(error.message); } }
async function renderAdminRoute(pathname) { try { const { renderAdmin } = await import('/admin.js'); await renderAdmin(pathname); } catch (error) { renderNotFound(error.message); } }
function renderLocked(details = {}) {
  setMeta(details.title || 'Premium article', details.excerpt || 'This article is for Premium members.');
  shell(`${pageHero(`PREMIUM / ${escapeHtml(details.category?.name || 'ARTICLE')}`, escapeHtml(details.title || 'Premium article'), escapeHtml(details.excerpt || ''))}<section class="section"><div class="container-xl article"><div class="card-surface p-4 p-lg-5"><span class="kicker">PREMIUM CONTENT</span><h2 class="mt-2">This article is for Premium members.</h2><p class="text-secondary">${state.user ? 'Your account does not currently include Premium access.' : 'Create a free account to start a 3-day trial, or log in if you already have one.'}</p>${state.user ? '<a class="btn btn-brand" href="/premium">See Premium</a>' : '<a class="btn btn-brand me-2" href="/register">Start free trial</a><a class="btn btn-ghost" href="/login">Log in</a>'}</div></div></section>`);
}
document.addEventListener('click', (event) => { if (event.target.closest('[data-action="logout"]')) { event.preventDefault(); signOut(); } });
// Back/forward cache: never show a signed-in page from the previous person after sign-out.
window.addEventListener('pageshow', (event) => { if (event.persisted) window.location.reload(); });
// Newsletter links from emails open these pages. The action happens on a button press (POST), never on page load,
// so mail scanners that prefetch links cannot confirm or unsubscribe anyone.
function renderNewsletterAction(kind) {
  const token = new URLSearchParams(window.location.search).get('token');
  const confirm = kind === 'confirm';
  setMeta(confirm ? 'Confirm subscription' : 'Unsubscribe', 'Manage your Eliah Tech newsletter subscription.');
  if (!token) { shell(`${pageHero('NEWSLETTER', 'This link is incomplete.', 'Open the link from your email again.')}`); return; }
  window.history.replaceState({}, '', window.location.pathname);
  shell(`${pageHero('NEWSLETTER', confirm ? 'Confirm your subscription.' : 'Unsubscribe from the newsletter?', confirm ? 'Press the button to finish subscribing.' : 'You will stop receiving newsletter emails.')}<section class="section"><div class="container-xl"><button class="btn btn-brand" id="newsletter-action" type="button">${confirm ? 'Confirm subscription' : 'Yes, unsubscribe me'}</button><p class="mt-3 text-secondary" id="newsletter-result" role="status"></p></div></section>`);
  document.querySelector('#newsletter-action').addEventListener('click', async (event) => {
    event.target.disabled = true;
    try { const data = await api(`/newsletter/${confirm ? 'verify' : 'unsubscribe'}`, { method: 'POST', noAuth: true, body: JSON.stringify({ token }) }); document.querySelector('#newsletter-result').textContent = data.message; event.target.remove(); } catch (error) { document.querySelector('#newsletter-result').textContent = error.message; event.target.disabled = false; }
  });
}
// ---- Premium checkout. The server decides price and result; this UI only names a plan and a payment method. ----
const money = (amount, currency) => `${currency} ${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
async function mountPlans() {
  const box = document.querySelector('#plans-box'); if (!box) return;
  if (state.premium?.status !== 'available') { box.innerHTML = '<p class="text-secondary small mb-0">Subscriptions are not open yet. Your free trial still gives you full Premium access while it lasts.</p>'; return; }
  try {
    const [plans, providers] = await Promise.all([api('/payments/plans', { noAuth: true }), api('/payments/providers', { noAuth: true })]);
    if (!plans.length) { box.innerHTML = '<p class="text-secondary small mb-0">No plans are published yet.</p>'; return; }
    if (!state.user) { box.innerHTML = '<p class="text-secondary small">Create a free account or log in to subscribe.</p><a class="btn btn-brand me-2" href="/register">Create account</a><a class="btn btn-ghost" href="/login">Log in</a>'; return; }
    const firstAvailable = providers.findIndex((p) => p.available);
    box.innerHTML = `<form id="checkout-form"><fieldset class="mb-3"><legend class="form-label small text-secondary">Plan</legend>${plans.map((plan, i) => `<div class="form-check mb-2"><input class="form-check-input" type="radio" name="plan" id="plan-${i}" value="${escapeHtml(plan.code)}" ${i === 0 ? 'checked' : ''}><label class="form-check-label" for="plan-${i}"><strong>${escapeHtml(plan.name)}</strong> · ${plan.duration_days} days<span class="d-block small text-secondary">${escapeHtml(plan.description || '')} ${Object.entries(plan.prices).map(([c, a]) => escapeHtml(money(a, c))).join(' / ')}</span></label></div>`).join('')}</fieldset><fieldset class="mb-3"><legend class="form-label small text-secondary">Pay with</legend>${providers.map((p, i) => `<div class="form-check mb-2"><input class="form-check-input" type="radio" name="provider" id="prov-${i}" value="${escapeHtml(p.name)}" ${p.available ? '' : 'disabled'} ${i === firstAvailable ? 'checked' : ''}><label class="form-check-label" for="prov-${i}">${escapeHtml(p.label)} <span class="small text-secondary">(${escapeHtml(p.currency)})</span>${p.name === 'pesapal' ? '<span class="d-block small text-secondary">Pay through PesaPal using the payment methods available on the PesaPal checkout.</span>' : ''}${p.available ? '' : '<span class="d-block small text-secondary">Not available yet.</span>'}</label></div>`).join('')}</fieldset><div class="mb-3"><label class="form-label small text-secondary" for="phone">Phone number (optional, shared with PesaPal only)</label><input class="form-control" id="phone" name="phone_number" type="tel" autocomplete="tel" maxlength="20"></div><button class="btn btn-brand w-100" type="submit" ${firstAvailable >= 0 ? '' : 'disabled'}>Continue to payment</button><p class="small text-secondary mt-2 mb-0">You will be sent to the provider to pay. Premium turns on after the provider confirms your payment, not before.</p></form>`;
    document.querySelector('#checkout-form').addEventListener('submit', (event) => submitForm(event, async () => {
      const form = new FormData(event.target);
      if (!form.get('provider')) throw new Error('Choose a payment method.');
      const data = await api('/payments/checkout', { method: 'POST', body: JSON.stringify({ plan: form.get('plan'), provider: form.get('provider'), ...(form.get('provider') === 'pesapal' && String(form.get('phone_number') || '').trim() ? { phone_number: String(form.get('phone_number')).trim() } : {}) }) });
      if (!/^https:\/\//i.test(String(data.approval_url ?? ''))) throw new Error('The payment provider did not return a valid checkout link. Please try again.');
      window.location.assign(data.approval_url);
    }));
  } catch (error) { box.innerHTML = `<p class="text-secondary small mb-0">${escapeHtml(error.message)}</p>`; }
}

// The provider sends the customer back here. We ask the server to verify with the provider; the URL alone proves nothing.
async function renderPaymentReturn(kind) {
  setMeta('Payment', 'Payment status.');
  const paymentId = new URLSearchParams(window.location.search).get('payment');
  if (!state.user) { try { sessionStorage.setItem(NEXT_KEY, window.location.pathname + window.location.search); } catch { /* storage blocked */ } shell(`${pageHero('PAYMENT', 'Sign in to see your payment.', 'Log in with the account you paid with.')}<section class="section"><div class="container-xl"><a class="btn btn-brand" href="/login">Log in</a></div></section>`); return; }
  if (!paymentId) { renderNotFound('Payment not found.'); return; }
  shell(`${pageHero('PAYMENT', kind === 'cancel' ? 'Checking your payment…' : 'Confirming your payment…', 'Please wait a moment.')}<section class="section"><div class="container-xl"><p id="payment-result" role="status" class="text-secondary"></p><a class="btn btn-ghost mt-3" href="/premium">Back to Premium</a></div></section>`);
  const say = (text) => { const el = document.querySelector('#payment-result'); if (el) el.textContent = text; };
  try {
    let result = await api(`/payments/${encodeURIComponent(paymentId)}/${kind === 'cancel' ? 'cancel' : 'confirm'}`, { method: 'POST' });
    for (let attempt = 0; kind !== 'cancel' && result.status === 'pending' && attempt < 4; attempt += 1) { say('Waiting for the payment provider…'); await new Promise((resolve) => setTimeout(resolve, 2500)); result = await api(`/payments/${encodeURIComponent(paymentId)}/confirm`, { method: 'POST' }); }
    if (result.status === 'completed') { await loadUser(); say(`Payment received. Premium is active${result.expires_at ? ` until ${formatDate(result.expires_at)}` : ''}. Thank you!`); }
    else if (result.status === 'pending' && kind === 'cancel') say('You left the payment page. Nothing is confirmed yet: if you did pay, Premium switches on automatically once the provider confirms it. Otherwise you have not been charged.');
    else if (result.status === 'pending') say('Your payment is still being processed. Premium will switch on automatically once the provider confirms it; you can safely close this page.');
    else if (result.status === 'cancelled') say('The payment was cancelled. You have not been charged.');
    else if (result.status === 'refunded') say('This payment was refunded.');
    else say('The payment did not go through. You have not been charged, or any charge will be reversed by the provider. Please try again or contact us.');
  } catch (error) { say(error.message); }
}

async function mountBilling() {
  const box = document.querySelector('#billing-box'); if (!box) return;
  try {
    const rows = await api('/payments/mine');
    box.innerHTML = rows.length ? `<ul class="list-unstyled small mb-0">${rows.map((p) => `<li class="mb-2">${formatDate(p.created_at)} · ${escapeHtml(p.plan || 'Premium')} · ${escapeHtml(money(p.amount, p.currency))} · <strong>${escapeHtml(p.status)}</strong></li>`).join('')}</ul>` : '<p class="text-secondary small mb-0">No payments yet.</p>';
  } catch (error) { box.textContent = error.message; }
}

// Navigation guard. Renderers paint with shell() after their own awaits, so a slow page that finishes after a newer
// navigation could overwrite it. When that happens (a newer navigation already finished), the current URL is painted again.
// A failed render shows an error page instead of leaving the loading screen up.
let navId = 0; let lastFinished = 0;
const failurePage = (error) => { app.innerHTML = `${header()}<main><section class="page-hero"><div class="container-xl"><span class="eyebrow">ERROR</span><h1>Something went wrong.</h1><p>${escapeHtml(error?.message || 'Please try again.')}</p><a class="btn btn-brand mt-3" href="/">Return home</a></div></section></main>${footer()}`; };
async function route() {
  stopPromotions();
  const id = ++navId;
  let failure = null;
  try { await dispatch(); } catch (error) { failure = error; }
  const stale = id !== navId;
  const newerFinished = lastFinished > id;
  lastFinished = Math.max(lastFinished, id);
  if (stale) {
    if (newerFinished) { try { await dispatch(); } catch (error) { failurePage(error); } }
    return;
  }
  if (failure) failurePage(failure);
  mountSlides();
  mountPromotions();
  const main = document.querySelector('main');
  if (main) { main.setAttribute('tabindex', '-1'); main.focus({ preventScroll: true }); }
}
async function dispatch() { const pathname = (window.location.pathname.replace(/\/$/, '') || '/').replace(/\.html$/, '') || '/'; if (pathname === '/') return renderHome(); if (pathname === '/ai') return renderAiRoute(); if (pathname === '/services') { window.location.assign('/categories'); return; } if (pathname === '/premium') return renderPremium(); if (pathname === '/search') return renderSearch(); if (pathname === '/login' || pathname === '/register') return renderAuth(pathname.slice(1)); if (pathname === '/forgot-password') return renderForgot(); if (pathname === '/reset-password') return renderReset(); if (pathname === '/profile') return renderProfile(); if (pathname === '/payment/return') return renderPaymentReturn('return'); if (pathname === '/payment/cancel') return renderPaymentReturn('cancel'); if (pathname === '/newsletter/confirm') return renderNewsletterAction('confirm'); if (pathname === '/newsletter/unsubscribe') return renderNewsletterAction('unsubscribe'); if (pathname === '/admin' || pathname.startsWith('/admin/')) return renderAdminRoute(pathname); if (pathname.startsWith('/post/')) return renderPost(pathname.split('/').pop()); if (pathname.startsWith('/category/')) return renderCategory(pathname.split('/').pop()); const staticPage = pathname.slice(1); if (['about', 'contact', 'privacy', 'terms', 'disclaimer', 'dmca'].includes(staticPage)) return renderStatic(staticPage); return renderNotFound(); }
const soft = (promise, fallback) => promise.catch(() => fallback);
async function bootstrap() {
  try {
    // Static pages, login and admin must keep working when a content request fails, so only fall back per request.
    const [site, homepage, postsResult, categories, services, socialLinks, premium] = await Promise.all([
      soft(api('/site'), null), soft(api('/settings/homepage'), null), soft(api('/posts?limit=50'), { items: [] }), soft(api('/categories'), []),
      soft(api('/services'), []), soft(api('/social-links'), []), soft(api('/settings/premium'), null),
    ]);
    Object.assign(state, { site: site ?? DEFAULT_SITE, homepage: homepage ?? DEFAULT_HOMEPAGE, posts: postsResult.items ?? [], categories, services, socialLinks, premium });
    await loadUser();
    await route();
  } catch (error) { app.innerHTML = `<div class="container-xl py-5"><div class="empty-state"><h1 class="h3">Eliah Tech needs a moment.</h1><p>${escapeHtml(error.message)}</p><a class="btn btn-brand" href="/">Try again</a></div></div>`; }
}
window.addEventListener('popstate', route);
document.addEventListener('click', (event) => {
  const link = event.target.closest('a');
  // Leave the browser in charge of new-tab clicks, downloads, external links and links to a spot on the current page (#anchor).
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (link.target === '_blank' || link.hasAttribute('download') || link.origin !== window.location.origin) return;
  if (link.hash && link.pathname === window.location.pathname && link.search === window.location.search) return;
  if (!/^\/(admin(?:\/|$)|ai$|premium$|login$|register$|forgot-password$|reset-password$|profile$|contact$|payment\/|newsletter\/)/.test(link.pathname)) return;
  event.preventDefault();
  window.history.pushState({}, '', link.pathname + link.search + link.hash);
  route().then(() => {
    const target = link.hash ? document.getElementById(decodeURIComponent(link.hash.slice(1))) : null;
    if (target) target.scrollIntoView(); else window.scrollTo({ top: 0, behavior: 'smooth' });
  });
});
bootstrap();
export { api, session, state, toast, escapeHtml, shell, formatDate, pageHero, field, submitForm };
