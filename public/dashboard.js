// Member dashboard, rendered into #community-root by gaming.js.
// Plain DOM + the shared api() helper. Every dynamic value goes through e() (HTML escape) before it reaches innerHTML.
const ICONS = {
  overview: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10.5V20h14v-9.5"/>',
  library: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/>',
  following: '<path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  support: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  billing: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/>',
  account: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
};
const TABS = [['overview', 'Overview'], ['library', 'Library'], ['following', 'Following'], ['support', 'Support'], ['billing', 'Billing'], ['account', 'Account']];
const icon = (name) => `<svg class="dash-icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
const DAY = 86_400_000;

export const initials = (name) => (String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => Array.from(w)[0].toUpperCase()).join('') || 'M');
export const greeting = (hour) => (hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening');
export const daysUntil = (iso, now = Date.now()) => (iso ? Math.ceil((new Date(iso).getTime() - now) / DAY) : null);
export const dateText = (iso) => { const d = new Date(iso); return iso && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' }) : ''; };
export const money = (amount, currency) => `${currency || ''} ${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`.trim();

// What the member currently has, in plain words (mirrors the rules used on the Premium page).
export function membership(account = {}, isPremium = false, now = Date.now()) {
  const access = account.access || {}; const trial = access.trial || {};
  if (account.role === 'admin') return { tier: 'admin', label: 'Administrator', detail: 'Full access to all content.', days: null };
  if (access.source === 'subscription') return { tier: 'premium', label: 'Premium', detail: dateText(access.premium_until) ? `Active until ${dateText(access.premium_until)}.` : 'Your Premium subscription is active.', days: daysUntil(access.premium_until, now) };
  if (access.source === 'role' || isPremium) return { tier: 'premium', label: 'Premium', detail: 'Premium access is enabled on your account.', days: null };
  if (access.source === 'trial') return { tier: 'trial', label: 'Premium trial', detail: dateText(trial.ends_at) ? `Your free trial ends on ${dateText(trial.ends_at)}.` : 'Your free trial is active.', days: daysUntil(trial.ends_at, now) };
  if (trial.expired) return { tier: 'free', label: 'Free account', detail: 'Your trial has ended. Your account and free guides stay available.', days: null };
  return { tier: 'free', label: 'Free account', detail: account.email_verified ? 'Premium adds ad-free reading, exclusive guides and priority support.' : 'Verify your email address to start your free trial.', days: null };
}
export const checklist = (account, data) => [
  { done: Boolean(account.email_verified), label: 'Verify your email', tab: 'account' },
  { done: Boolean(data.device), label: 'Add your device', tab: 'account' },
  { done: data.game_follows.length > 0, label: 'Follow a game', tab: 'following' },
  { done: data.bookmarks.length > 0, label: 'Save a guide', tab: 'library' },
];
const TICKET_STATUS = { open: ['Open', 'warn'], in_progress: ['In progress', 'info'], resolved: ['Resolved', 'ok'] };
const PAYMENT_STATUS = (status) => (/^(paid|completed|success|succeeded|active)$/i.test(status) ? 'ok' : /^(pending|processing|created)$/i.test(status) ? 'warn' : /^(failed|cancel|invalid|reversed|expired)/i.test(status) ? 'bad' : 'info');

export async function renderDashboard({ root, api, account, e }) {
  const state = { account, data: null, benefits: {}, payments: null, requests: null, tab: 'overview' };
  const fmt = dateText;
  const badge = (text, tone = 'info') => `<span class="dash-badge dash-badge-${tone}">${e(text)}</span>`;
  const empty = (title, text, action) => `<div class="empty-state empty-state-sm" role="status"><p class="empty-title">${e(title)}</p><p>${e(text)}</p>${action ? `<a class="btn btn-primary btn-sm mt-2" href="${e(action[0])}">${e(action[1])}</a>` : ''}</div>`;
  const link = (row) => `<a href="/posts/${encodeURIComponent(row.slug)}">${e(row.title)}</a>`;
  let timer = 0;
  const say = (message, tone = 'ok') => {
    const box = root.querySelector('#dash-status'); if (!box) return;
    box.className = `dash-status dash-status-${tone}`; box.textContent = message;
    clearTimeout(timer); timer = setTimeout(() => { box.textContent = ''; box.className = 'dash-status'; }, 6000);
  };

  async function load() {
    state.data = await api('/community/me');
    state.data = { bookmarks: [], reading_history: [], game_follows: [], notifications: [], support_tickets: [], device: null, ...state.data };
    if (state.data.is_premium && !state.benefits.loaded) state.benefits = { loaded: true, ...(await api('/community/member-benefits').catch(() => ({}))) };
  }

  // ---------- header, stats, tabs ----------
  const header = () => {
    const { account: a, data } = state; const m = membership(a, data.is_premium);
    const open = data.support_tickets.filter((t) => t.status !== 'resolved').length;
    const stat = (tab, value, label) => `<button class="dash-stat" type="button" data-tab="${tab}">${icon(tab)}<span class="dash-stat-value">${value}</span><span class="dash-stat-label">${e(label)}</span></button>`;
    return `<header class="dash-hero"><div class="dash-hero-main"><span class="dash-avatar" aria-hidden="true">${e(initials(a.display_name || a.email))}</span><div class="dash-hero-text"><p class="dash-greeting">${e(greeting(new Date().getHours()))},</p><h1>${e(a.display_name || 'Gamer')}</h1><p class="dash-chips">${badge(m.label + (m.days !== null && m.days >= 0 && m.tier !== 'premium' ? ` · ${m.days} day${m.days === 1 ? '' : 's'} left` : ''), m.tier === 'free' ? 'info' : 'premium')}${badge(a.email_verified ? 'Email verified' : 'Email not verified', a.email_verified ? 'ok' : 'warn')}</p></div></div><div class="dash-hero-actions"><a class="btn btn-warning" href="/posts">Browse guides</a><a class="btn btn-outline-light" href="/ai">Ask AI</a></div></header>`
      + `<div class="dash-stats">${stat('library', data.bookmarks.length, 'Saved guides')}${stat('following', data.game_follows.length, 'Games followed')}${stat('following', data.notifications.length, 'Updates')}${stat('support', open, open === 1 ? 'Open ticket' : 'Open tickets')}</div>`;
  };
  const tablist = () => `<div class="dash-tabs" role="tablist" aria-label="Dashboard sections">${TABS.map(([key, label]) => `<button class="dash-tab" role="tab" type="button" id="tab-${key}" aria-controls="dash-panel" aria-selected="${key === state.tab}" tabindex="${key === state.tab ? 0 : -1}" data-tab="${key}">${icon(key)}<span>${e(label)}</span></button>`).join('')}</div>`;

  // ---------- panels ----------
  const panels = {
    overview() {
      const { account: a, data } = state; const m = membership(a, data.is_premium); const steps = checklist(a, data); const done = steps.filter((s) => s.done).length;
      const reading = data.reading_history.slice(0, 5); const updates = data.notifications.slice(0, 5);
      const premiumCard = data.is_premium
        ? `<section class="dash-card"><h2>Your Premium benefits</h2><p>Ad-free posts, exclusive guides and priority gaming support.</p><p class="small text-secondary">${e(state.benefits.support_hours || 'Support hours will be announced by the admin.')}</p>${/^https:\/\//.test(state.benefits.community_url || '') ? `<a class="btn btn-primary btn-sm" href="${e(state.benefits.community_url)}" target="_blank" rel="noopener">Join member community</a>` : ''}</section>`
        : `<section class="dash-card dash-upsell"><h2>Go further with Premium</h2><p>${e(m.detail)}</p><ul class="dash-perks"><li>Ad-free reading</li><li>Exclusive in-depth guides</li><li>Priority gaming support</li></ul><a class="btn btn-warning btn-sm" href="/premium">See Premium plans</a></section>`;
      return `<div class="dash-grid"><section class="dash-card"><h2>${done === steps.length ? 'You\'re all set' : 'Getting set up'}</h2><p class="small text-secondary mb-2">${done === steps.length ? 'Everything is set up. Nice work.' : `${done} of ${steps.length} complete`}</p><div class="dash-progress" role="progressbar" aria-label="Setup progress" aria-valuenow="${Math.round((done / steps.length) * 100)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${(done / steps.length) * 100}%"></span></div><ul class="dash-steps">${steps.map((s) => `<li class="${s.done ? 'is-done' : ''}"><span class="dash-step-mark" aria-hidden="true">${s.done ? icon('check') : ''}</span>${s.done ? `<span>${e(s.label)}</span><span class="visually-hidden">(done)</span>` : `<button class="btn btn-link p-0" type="button" data-tab="${s.tab}">${e(s.label)}</button>`}</li>`).join('')}</ul></section>${premiumCard}`
        + `<section class="dash-card"><div class="dash-card-head"><h2>Continue reading</h2>${data.reading_history.length > 5 ? '<button class="btn btn-link btn-sm" type="button" data-tab="library">View all</button>' : ''}</div>${reading.length ? `<ul class="dash-list">${reading.map((r) => `<li>${link(r)}<small>${e(fmt(r.created_at))}</small></li>`).join('')}</ul>` : empty('Nothing read yet', 'Guides you open will show up here so you can pick up where you left off.', ['/posts', 'Browse guides'])}</section>`
        + `<section class="dash-card"><div class="dash-card-head"><h2>Latest updates</h2>${data.notifications.length > 5 ? '<button class="btn btn-link btn-sm" type="button" data-tab="following">View all</button>' : ''}</div>${updates.length ? `<ul class="dash-list">${updates.map((n) => `<li><span>${e(n.message)}</span><small>${e(fmt(n.created_at))}</small></li>`).join('')}</ul>` : empty('No updates yet', 'Follow a game to hear when new guides are published.', null)}${updates.length ? '' : '<button class="btn btn-primary btn-sm mt-2" type="button" data-tab="following">Follow a game</button>'}</section></div>`;
    },
    library() {
      const { bookmarks, reading_history: history } = state.data;
      return `<div class="dash-grid"><section class="dash-card"><h2>Saved guides</h2>${bookmarks.length ? `<ul class="dash-list">${bookmarks.map((b) => `<li>${link(b)}<button class="btn btn-sm btn-outline-danger" type="button" data-remove-bookmark="${e(b.post_id)}" aria-label="Remove ${e(b.title)} from saved guides">Remove</button></li>`).join('')}</ul>` : empty('No saved guides', 'Use “Save guide” on any article to keep it here.', ['/posts', 'Browse guides'])}</section>`
        + `<section class="dash-card"><div class="dash-card-head"><h2>Recently read</h2>${history.length ? '<button class="btn btn-sm btn-outline-secondary" type="button" id="clear-history">Clear history</button>' : ''}</div>${history.length ? `<ul class="dash-list">${history.map((r) => `<li>${link(r)}<small>${e(fmt(r.created_at))}</small></li>`).join('')}</ul>` : empty('No reading history', 'Guides you open will appear here.', null)}</section></div>`;
    },
    following() {
      const { game_follows: follows, notifications } = state.data;
      return `<div class="dash-grid"><section class="dash-card"><h2>Follow a game</h2><p class="small text-secondary">Get an update here when a new guide is published for a game you follow.</p><form id="follow-form" class="dash-inline-form"><label class="visually-hidden" for="follow-game">Game name</label><input id="follow-game" class="form-control" name="game" maxlength="80" minlength="2" placeholder="e.g. PPSSPP" required><button class="btn btn-primary">Follow</button></form>${follows.length ? `<ul class="dash-chip-list">${follows.map((f) => `<li>${e(f.game)}<button type="button" class="dash-chip-x" data-unfollow="${e(f.id)}" aria-label="Unfollow ${e(f.game)}">×</button></li>`).join('')}</ul>` : '<p class="small text-secondary mt-3 mb-0">You are not following any games yet.</p>'}</section>`
        + `<section class="dash-card"><h2>Updates</h2>${notifications.length ? `<ul class="dash-list">${notifications.map((n) => `<li><span>${e(n.message)}</span><small>${e(fmt(n.created_at))}</small></li>`).join('')}</ul>` : empty('No updates yet', 'Guides for the games you follow will show up here.', null)}</section></div>`;
    },
    support() {
      const tickets = state.data.support_tickets; const requests = state.requests;
      const ticket = (t) => { const [label, tone] = TICKET_STATUS[t.status] || [t.status, 'info']; return `<li class="dash-ticket"><div class="dash-card-head"><strong>${e(t.subject)}</strong>${badge(label, tone)}</div><small>${e(fmt(t.created_at))}${t.priority && t.priority !== 'normal' ? ` · ${e(t.priority)} priority` : ''}</small>${t.admin_reply ? `<p class="dash-reply"><strong>Reply:</strong> ${e(t.admin_reply)}</p>` : ''}</li>`; };
      return `<div class="dash-grid"><form class="dash-card" id="ticket-form"><h2>Get gaming support${state.data.is_premium ? ` ${badge('Priority', 'premium')}` : ''}</h2><label class="form-label" for="t-subject">Subject</label><input id="t-subject" name="subject" class="form-control mb-3" maxlength="160" minlength="3" required><label class="form-label" for="t-message">Problem, device and steps already tried</label><textarea id="t-message" name="message" class="form-control mb-3" rows="4" maxlength="8000" minlength="10" required></textarea><details class="mb-3"><summary class="small">Attach an AI conversation (optional)</summary><label class="form-label small mt-2" for="t-conv">AI conversation ID</label><input id="t-conv" name="conversation_id" class="form-control" maxlength="36"><p class="small text-secondary mt-1 mb-0">Only add this if you want the support team to review that conversation.</p></details><button class="btn btn-primary">Send to support</button></form>`
        + `<section class="dash-card"><h2>My tickets</h2>${tickets.length ? `<ul class="dash-list dash-tickets">${tickets.map(ticket).join('')}</ul>` : empty('No tickets yet', 'Need help? Send a support request and it will appear here with our reply.', null)}</section>`
        + `<form id="request-form" class="dash-card"><h2>Request a tutorial</h2><label class="form-label" for="r-title">Title</label><input id="r-title" class="form-control mb-3" name="title" minlength="5" maxlength="160" required><label class="form-label" for="r-desc">What should it cover?</label><textarea id="r-desc" class="form-control mb-3" name="description" rows="3" minlength="10" maxlength="2000" required></textarea><button class="btn btn-primary">Submit request</button></form>`
        + `<section class="dash-card"><h2>Community requests</h2>${requests === null ? '<span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line w-75"></span>' : requests.length ? `<ul class="dash-list">${requests.map((r) => `<li class="dash-request"><div><strong>${e(r.title)}</strong><p class="small mb-1">${e(r.description)}</p><small>${e(r.status)}</small></div><button class="btn btn-sm btn-outline-primary" type="button" data-vote="${e(r.id)}" aria-label="Vote for ${e(r.title)}">Vote</button></li>`).join('')}</ul>` : empty('No requests yet', 'Ask for a tutorial and other players can vote on it.', null)}</section></div>`;
    },
    billing() {
      const { account: a, data } = state; const m = membership(a, data.is_premium); const rows = state.payments;
      const cta = m.tier === 'premium' || m.tier === 'admin' ? '' : `<a class="btn btn-warning btn-sm" href="/premium">${m.tier === 'trial' ? 'Choose a plan' : 'See Premium plans'}</a>`;
      return `<div class="dash-grid"><section class="dash-card"><h2>Membership</h2><p class="dash-plan">${e(m.label)}</p><p class="text-secondary">${e(m.detail)}</p>${cta}</section><section class="dash-card"><h2>Payment history</h2>${rows === null ? '<span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line w-75"></span><span class="skeleton skeleton-line w-50"></span>' : rows.length ? `<ul class="dash-list dash-payments">${rows.map((p) => `<li><div><strong>${e(p.plan || 'Premium')}</strong><small>${e(fmt(p.created_at))}</small></div><div class="dash-payment-right"><span>${e(money(p.amount, p.currency))}</span>${badge(p.status, PAYMENT_STATUS(String(p.status)))}</div></li>`).join('')}</ul>` : empty('No payments yet', 'Your payments and receipts will be listed here.', null)}</section></div>`;
    },
    account() {
      const { account: a, data } = state; const d = data.device || {};
      return `<div class="dash-grid"><form class="dash-card" id="profile-form"><h2>Profile</h2><label class="form-label" for="p-name">Display name</label><input id="p-name" class="form-control mb-2" name="display_name" value="${e(a.display_name || '')}" minlength="2" maxlength="60" required><p class="small text-secondary">${e(a.email)} ${badge(a.email_verified ? 'Verified' : 'Not verified', a.email_verified ? 'ok' : 'warn')}</p><button class="btn btn-primary">Save changes</button></form>`
        + `<form class="dash-card" id="device-form"><h2>My device</h2><p class="small text-secondary">Used to check whether a guide suits your phone.</p>${[['device', 'Phone / device', d.device], ['ram_gb', 'RAM (GB)', d.ram_gb], ['emulator', 'Emulator', d.emulator], ['emulator_version', 'Emulator version', d.emulator_version]].map(([name, label, value]) => `<label class="form-label" for="d-${name}">${label}</label><input id="d-${name}" class="form-control mb-2" name="${name}" value="${e(value ?? '')}" ${name === 'ram_gb' ? 'type="number" step="0.25" min="0.25" max="128"' : 'maxlength="100"'} required>`).join('')}<button class="btn btn-primary mt-2">Save device</button></form>`
        + `<section class="dash-card"><h2>Privacy and sign out</h2><p class="small text-secondary">Remove your saved guides, reading history, device and followed games. Your account and any payments are not affected.</p><div class="d-flex flex-wrap gap-2"><button class="btn btn-outline-danger" type="button" id="delete-reader-data">Delete my saved data</button><button class="btn btn-outline-secondary" type="button" id="sign-out">Sign out</button></div></section></div>`;
    },
  };

  // ---------- rendering and behaviour ----------
  const paint = () => {
    // Keep the selected tab visible inside the horizontally scrolling tab strip on small screens.
    root.innerHTML = `<div class="dash"><p id="dash-status" class="dash-status" role="status"></p>${header()}${tablist()}<div id="dash-panel" class="dash-panel" role="tabpanel" aria-labelledby="tab-${state.tab}" tabindex="0">${panels[state.tab]()}</div></div>`;
    const strip = root.querySelector?.('.dash-tabs'); const active = root.querySelector?.('[role="tab"][aria-selected="true"]');
    if (strip && active) strip.scrollLeft = Math.max(0, active.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2);
  };
  async function show(tab, { focus = false, silent = false } = {}) {
    if (!panels[tab]) tab = 'overview';
    state.tab = tab; if (!silent) history.replaceState(null, '', tab === 'overview' ? location.pathname : `#${tab}`);
    paint();
    if (focus) root.querySelector(`#tab-${tab}`)?.focus();
    // Lists that need an extra request show a skeleton first, then fill in (a failed request shows the empty state, never a stuck skeleton).
    if (tab === 'billing' && state.payments === null) { state.payments = await api('/payments/mine').catch(() => []); if (state.tab === 'billing') paint(); }
    if (tab === 'support' && state.requests === null) { state.requests = await api('/community/requests').catch(() => []); if (state.tab === 'support') paint(); }
  }
  const refresh = async (message) => { await load(); paint(); if (message) say(message); };
  const guard = async (fn, ok) => { try { await fn(); if (ok) say(ok); } catch (err) { say(err.message || 'Something went wrong.', 'bad'); } };

  root.onclick = (event) => {
    const t = event.target.closest('button,a'); if (!t) return;
    if (t.dataset.tab) { show(t.dataset.tab); return; }
    if (t.dataset.removeBookmark) return guard(async () => { await api(`/community/bookmarks/${t.dataset.removeBookmark}`, { method: 'DELETE' }); await refresh('Removed from your saved guides.'); });
    if (t.dataset.unfollow) return guard(async () => { await api(`/community/follows/${t.dataset.unfollow}`, { method: 'DELETE' }); await refresh('Unfollowed.'); });
    if (t.dataset.vote) return guard(async () => { await api(`/community/requests/${t.dataset.vote}/vote`, { method: 'POST', body: '{}' }); }, 'Vote saved.');
    if (t.id === 'clear-history') return guard(async () => { await api('/community/history', { method: 'DELETE' }); await refresh('Reading history cleared.'); });
    if (t.id === 'delete-reader-data') { if (!confirm('Delete your saved guides, history, device and followed games? This cannot be undone.')) return; return guard(async () => { await api('/community/data', { method: 'DELETE' }); await refresh('Your saved data was deleted.'); }); }
    if (t.id === 'sign-out') return guard(async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); location.assign('/'); });
  };
  root.onkeydown = (event) => {
    const tab = event.target.closest?.('[role="tab"]'); if (!tab) return;
    const keys = TABS.map(([k]) => k); const at = keys.indexOf(tab.dataset.tab);
    const next = { ArrowRight: (at + 1) % keys.length, ArrowLeft: (at - 1 + keys.length) % keys.length, Home: 0, End: keys.length - 1 }[event.key];
    if (next !== undefined) { event.preventDefault(); show(keys[next], { focus: true }); }
  };
  root.onsubmit = (event) => {
    event.preventDefault(); const form = event.target; const body = Object.fromEntries(new FormData(form)); const button = form.querySelector('button:not([type])') || form.querySelector('button');
    const run = (fn, ok) => { if (button) button.disabled = true; return guard(fn, ok).finally(() => { if (button) button.disabled = false; }); };
    if (form.id === 'follow-form') return run(async () => { await api('/community/follows', { method: 'POST', body: JSON.stringify(body) }); await refresh('You are now following this game.'); });
    if (form.id === 'ticket-form') { if (body.conversation_id === '') delete body.conversation_id; return run(async () => { await api('/community/tickets', { method: 'POST', body: JSON.stringify(body) }); await refresh('Your request was sent. We will reply here.'); }); }
    if (form.id === 'request-form') return run(async () => { await api('/community/requests', { method: 'POST', body: JSON.stringify(body) }); state.requests = await api('/community/requests').catch(() => state.requests); paint(); say('Thanks! Your tutorial request was submitted.'); });
    if (form.id === 'device-form') return run(async () => { await api('/community/device', { method: 'PUT', body: JSON.stringify(body) }); await refresh('Device saved.'); });
    if (form.id === 'profile-form') return run(async () => { state.account = await api('/auth/me', { method: 'PATCH', body: JSON.stringify({ display_name: body.display_name }) }); const nav = document.querySelector('#account-nav'); if (nav) nav.textContent = state.account.display_name || 'My account'; paint(); say('Profile updated.'); });
  };
  window.addEventListener('hashchange', () => { const tab = location.hash.slice(1); if (panels[tab] && tab !== state.tab) show(tab, { silent: true }); });

  try { await load(); } catch (err) { root.innerHTML = `<div class="empty-state" role="alert"><p class="empty-title">We could not load your dashboard</p><p>${e(err.message || 'Please try again in a moment.')}</p><a class="btn btn-primary" href="/community">Try again</a></div>`; return; }
  await show(location.hash.slice(1), { silent: true });
}
