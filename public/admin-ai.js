// Admin > AI. Everything shown comes from /api/v1/admin/ai/* (real database numbers and real recent-request health). The server
// re-checks the admin role on every call; this file only renders. It never sees a provider key: only the variable NAME and
// whether the server has a value for it ("set" / "missing").
import { api, toast, escapeHtml as esc, shell, formatDate } from '/app.js';

const HEALTH = { healthy: ['Healthy', 'success'], degraded: ['Degraded', 'warning'], unavailable: ['Unavailable', 'danger'], disabled: ['Disabled', 'secondary'], unknown: ['No recent traffic', 'secondary'] };
const badge = (kind) => { const [label, tone] = HEALTH[kind] ?? HEALTH.unknown; return `<span class="badge text-bg-${tone}">${esc(label)}</span>`; };
const REASONS = { model_disabled: 'Model is disabled', no_provider: 'No provider assigned', no_model_identifier: 'No provider-side model id', provider_disabled: 'Provider is disabled', no_credential_variable: 'Provider has no key variable', credentials_or_endpoint_missing: 'Server key or endpoint missing' };
const num = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString());
const errText = (e) => (e.details?.fields ? `${e.message} ${Object.entries(e.details.fields).map(([k, v]) => `${k}: ${v}`).join('; ')}` : e.message);
const list = (obj) => Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<li>${esc(k)}: <strong>${esc(num(v))}</strong></li>`).join('') || '<li class="text-secondary">No data yet</li>';
const stat = (label, value, note = '') => `<div class="col-6 col-md-3"><div class="card-surface p-3 h-100"><div class="small text-secondary">${esc(label)}</div><div class="h5 mb-0">${esc(value)}</div>${note ? `<div class="small text-secondary">${esc(note)}</div>` : ''}</div></div>`;
const val = (id) => document.getElementById(id)?.value ?? '';
const intOrNull = (id) => (val(id).trim() === '' ? null : Number(val(id)));

export async function aiView({ chrome, rerender }) {
  const [overview, analytics, events] = await Promise.all([api('/admin/ai/overview'), api('/admin/ai/analytics').catch(() => null), api('/admin/ai/events?limit=15').catch(() => ({ items: [] }))]);
  const { providers, models, settings, options } = overview;
  const t = analytics?.tokens;

  const analyticsHtml = analytics ? `<div class="row g-3 mb-3">${[
    stat('Total AI requests', num(analytics.total_requests)), stat('Successful', num(analytics.successful_requests)), stat('Failed', num(analytics.failed_requests)), stat('Failover requests', num(analytics.failover_requests)),
    stat('Today', num(analytics.requests_today)), stat('This month', num(analytics.requests_this_month)), stat('Average latency', analytics.avg_latency_ms == null ? '—' : `${num(analytics.avg_latency_ms)} ms`), stat('Tokens (reported)', num(t?.total), t ? `${num(t.requests_without_usage)} answers had no usage data` : ''),
  ].join('')}</div><div class="row g-3 mb-4">${[['Requests by provider', analytics.by_provider], ['Requests by model', analytics.by_model], ['Requests by user tier', analytics.by_tier]].map(([title, data]) => `<div class="col-md-4"><div class="card-surface p-3 h-100"><div class="small text-secondary mb-1">${title}</div><ul class="small list-unstyled mb-0">${list(data)}</ul></div></div>`).join('')}</div>`
    : '<div class="empty-state mb-4">Analytics are unavailable. Run the Phase 5 migration (20261007_ai_platform.sql).</div>';

  const providersHtml = `<div class="d-flex justify-content-between align-items-center mb-2"><h2 class="h5 mb-0">Providers</h2><button class="btn btn-sm btn-ghost" id="prov-add" type="button">Add provider</button></div>
    <div class="table-responsive card-surface mb-4"><table class="table table-dark table-borderless align-middle mb-0 small"><thead><tr><th scope="col">Provider</th><th scope="col">Free / Paid</th><th scope="col">Adapter</th><th scope="col">API config</th><th scope="col">Health</th><th scope="col">Models</th><th scope="col"></th></tr></thead><tbody>${providers.filter((p) => p.is_free === true).map((p) => `<tr><td>${esc(p.display_name)}<div class="text-secondary">${esc(p.code)}${p.base_url ? ` · ${esc(p.base_url)}` : ''}</div></td><td><span class="badge text-bg-${p.is_free ? 'success' : 'danger'}">${p.is_free ? 'FREE' : 'PAID / UNVERIFIED'}</span></td><td>${esc(p.adapter)}</td><td>${p.api_key_env ? `<code>${esc(p.api_key_env)}</code> <span class="badge text-bg-${p.credential === 'set' ? 'success' : 'warning'}">${p.credential === 'set' ? 'configured' : 'key missing'}</span>` : '<span class="text-secondary">not configured</span>'}</td><td>${badge(p.health)}</td><td>${esc(p.models)}</td><td class="text-end"><button class="btn btn-sm btn-ghost" data-pedit="${esc(p.id)}" type="button">Edit</button> <button class="btn btn-sm btn-ghost" data-ptoggle="${esc(p.id)}" data-on="${p.enabled ? '1' : '0'}" type="button">${p.enabled ? 'Disable' : 'Enable'}</button></td></tr>`).join('') || '<tr><td colspan="7" class="text-secondary">No providers.</td></tr>'}</tbody></table></div>`;

  const modelsHtml = `<div class="d-flex justify-content-between align-items-center mb-2"><h2 class="h5 mb-0">Models</h2><button class="btn btn-sm btn-ghost" id="model-add" type="button">Add model</button></div>
    <p class="small text-secondary">Lower priority number = tried first. Only verified FREE providers and models are selectable for every account tier; paid or unclassified models are blocked server-side. Configure the server-side provider credential in the hosting environment (never paste a key here).</p>
    <div class="table-responsive card-surface mb-4"><table class="table table-dark table-borderless align-middle mb-0 small"><thead><tr><th scope="col">Priority</th><th scope="col">Model</th><th scope="col">Provider / id</th><th scope="col">Free / Paid</th><th scope="col">Capabilities</th><th scope="col">Access</th><th scope="col">Limits</th><th scope="col">Status</th><th scope="col"></th></tr></thead><tbody>${models.map((m) => `<tr><td>${esc(m.priority)}</td><td>${esc(m.display_name)}<div class="text-secondary">${esc(m.slug)}</div></td><td>${m.provider ? esc(m.provider.display_name) : '<span class="text-secondary">unassigned</span>'}<div class="text-secondary">${m.model_identifier ? esc(m.model_identifier) : 'no model id'}</div></td><td><span class="badge text-bg-${m.is_free ? 'success' : 'danger'}">${m.is_free ? 'FREE' : 'PAID / UNVERIFIED'}</span></td><td>${m.capabilities.map((c) => `<span class="tag me-1">${esc(c)}</span>`).join('')}</td><td>${m.free_user_enabled ? 'Free ' : ''}${m.premium_user_enabled ? 'Premium' : ''}${!m.free_user_enabled && !m.premium_user_enabled ? '—' : ''}</td><td>timeout ${esc(m.timeout_ms ?? 'default')} ms<br>tokens ${esc(m.max_tokens ?? 'default')}<br>day ${esc(num(m.usage.day))}/${esc(m.daily_limit ?? '∞')} · month ${esc(num(m.usage.month))}/${esc(m.monthly_limit ?? '∞')}</td><td>${badge(m.health)}${m.ready ? '<div class="text-success">Ready</div>' : `<div class="text-secondary">${esc(REASONS[m.not_ready_reason] || m.not_ready_reason)}</div>`}</td><td class="text-end text-nowrap"><button class="btn btn-sm btn-ghost" data-mtest="${esc(m.id)}" type="button">Test</button> <button class="btn btn-sm btn-ghost" data-medit="${esc(m.id)}" type="button">Edit</button> <button class="btn btn-sm btn-ghost" data-mtoggle="${esc(m.id)}" data-on="${m.enabled ? '1' : '0'}" type="button">${m.enabled ? 'Disable' : 'Enable'}</button></td></tr>`).join('') || '<tr><td colspan="9" class="text-secondary">No models.</td></tr>'}</tbody></table></div><div id="ai-form-slot"></div>`;

  const S = settings;
  const settingsHtml = `<h2 class="h5 mb-2">Assistant settings</h2><form id="ai-settings" class="card-surface p-4 mb-4" novalidate>
    <div class="row g-3">
      <div class="col-md-4"><label class="form-label small text-secondary" for="s-name">Assistant name</label><input class="form-control" id="s-name" value="${esc(S.ai_name)}"></div>
      <div class="col-md-4"><label class="form-label small text-secondary" for="s-defmodel">Default model (slug, optional)</label><input class="form-control" id="s-defmodel" value="${esc(S.default_model ?? '')}"></div>
      <div class="col-md-4"><label class="form-label small text-secondary" for="s-defcap">Default capability</label><select class="form-select" id="s-defcap">${options.capabilities.map((c) => `<option ${c === S.default_capability ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div class="col-12"><label class="form-label small text-secondary" for="s-welcome">Welcome message</label><input class="form-control" id="s-welcome" value="${esc(S.welcome_message)}"></div>
      <div class="col-12"><label class="form-label small text-secondary" for="s-prompt">System prompt <span class="text-secondary">(changes are audited by length and hash, not content)</span></label><textarea class="form-control" id="s-prompt" rows="5">${esc(S.system_prompt)}</textarea><div class="form-text">Use {{ai_name}} for the assistant name.</div></div>
      <div class="col-12"><label class="form-label small text-secondary" for="s-safety">Safety instructions</label><textarea class="form-control" id="s-safety" rows="3">${esc(S.safety_instructions)}</textarea></div>
      <div class="col-12"><label class="form-label small text-secondary" for="s-upgrade">Upgrade message shown to Free users</label><input class="form-control" id="s-upgrade" value="${esc(S.upgrade_message)}"></div>
      <div class="col-12"><div class="small text-secondary mb-1">Enabled capabilities</div>${options.capabilities.map((c) => `<label class="me-3 small"><input type="checkbox" data-cap="${esc(c)}" ${S.enabled_capabilities.includes(c) ? 'checked' : ''}> ${esc(c)}</label>`).join('')}</div>
      <div class="col-12">${[['guest_access', 'Allow guests (no login)'], ['free_access', 'Free users enabled'], ['premium_access', 'Premium users enabled'], ['failover_enabled', 'Failover for Premium/Admin'], ['free_failover', 'Failover for Free (free-enabled models only)'], ['rag_enabled', 'Use public site content (RAG)']].map(([k, label]) => `<label class="me-3 small"><input type="checkbox" data-flag="${k}" ${S[k] ? 'checked' : ''}> ${esc(label)}</label>`).join('')}</div>
      ${[['max_input_chars', 'Max message chars'], ['max_output_tokens', 'Max reply tokens'], ['max_context_messages', 'Context messages'], ['max_context_chars', 'Context chars'], ['max_attempts', 'Max provider attempts'], ['request_timeout_ms', 'Default timeout (ms)'], ['total_deadline_ms', 'Total deadline (ms)'], ['retention_days', 'Keep conversations (days, 0 = forever)']].map(([k, label]) => `<div class="col-6 col-md-3"><label class="form-label small text-secondary" for="s-${k}">${label}</label><input type="number" class="form-control" id="s-${k}" value="${esc(S[k])}"></div>`).join('')}
      <div class="col-12"><div class="small text-secondary mb-2">Usage limits per tier (tokens per day empty = none)</div><div class="table-responsive"><table class="table table-dark table-borderless align-middle mb-0 small"><thead><tr><th scope="col">Tier</th><th scope="col">Per minute</th><th scope="col">Per day</th><th scope="col">Tokens per day</th></tr></thead><tbody>${['guest', 'free_user', 'premium_user', 'admin'].map((tier) => `<tr><th scope="row">${tier}</th>${['per_minute', 'per_day', 'tokens_per_day'].map((f) => `<td><input type="number" class="form-control form-control-sm" id="l-${tier}-${f}" value="${esc(S.limits[tier][f] ?? '')}"></td>`).join('')}</tr>`).join('')}</tbody></table></div></div>
    </div>
    <div class="d-flex flex-wrap gap-2 mt-3"><button class="btn btn-brand" type="submit">Save settings</button><button class="btn btn-ghost" id="ai-purge" type="button">Delete conversations older than the retention period</button></div></form>`;

  const eventsHtml = `<h2 class="h5 mb-2">Recent failover and failure events</h2><div class="table-responsive card-surface mb-4"><table class="table table-dark table-borderless align-middle mb-0 small"><thead><tr><th scope="col">When</th><th scope="col">Type</th><th scope="col">From</th><th scope="col">Reason</th><th scope="col">To</th></tr></thead><tbody>${events.items.map((e) => `<tr><td>${esc(formatDate(e.created_at))}</td><td>${esc(e.event_type)}</td><td>${esc([e.provider, e.model].filter(Boolean).join(' / '))}</td><td>${esc(e.failure_reason || e.error_code || '—')}</td><td>${esc([e.fallback_provider, e.fallback_model].filter(Boolean).join(' / ') || '—')}</td></tr>`).join('') || '<tr><td colspan="5" class="text-secondary">No events recorded yet.</td></tr>'}</tbody></table></div>`;

  shell(chrome('ai', `<p class="small text-secondary">Health reflects real requests from the last ${esc(options.health_window_minutes)} minutes. A provider that fails repeatedly is skipped for ${esc(options.cooldown_seconds)} seconds and then tried again automatically. “Test” sends one tiny request using the server-side key.</p>${analyticsHtml}${providersHtml}${modelsHtml}${settingsHtml}${eventsHtml}`));

  const slot = document.getElementById('ai-form-slot') ?? document.body;
  const safe = async (fn, done) => { try { await fn(); if (done) toast(done); await rerender(); } catch (error) { toast(errText(error)); } };
  const field = (id, label, value = '', type = 'text', help = '') => `<div class="col-md-4"><label class="form-label small text-secondary" for="${id}">${label}</label><input class="form-control" type="${type}" id="${id}" value="${esc(value)}">${help ? `<div class="form-text">${help}</div>` : ''}</div>`;

  function modelForm(m) {
    const create = !m;
    const v = m ?? { capabilities: ['general'], priority: 100, free_user_enabled: false, premium_user_enabled: true, enabled: false };
    slot.innerHTML = `<form id="model-form" class="card-surface p-4 mb-4" novalidate><h3 class="h6">${create ? 'Add model' : `Edit ${esc(m.display_name)}`}</h3><div class="row g-3">
      ${create ? field('m-slug', 'Slug (unique)', '', 'text', 'e.g. my-model-1') : ''}${field('m-name', 'Display name', v.display_name)}
      <div class="col-md-4"><label class="form-label small text-secondary" for="m-provider">Provider</label><select class="form-select" id="m-provider"><option value="">— none —</option>${providers.filter((p) => p.is_free === true).map((p) => `<option value="${esc(p.id)}" ${p.id === v.provider_id ? 'selected' : ''}>${esc(p.display_name)}</option>`).join('')}</select></div>
      ${field('m-modelid', 'Provider-side model id', v.model_identifier ?? '', 'text', 'Exact id from the provider’s documentation')}${field('m-baseurl', 'Base URL override (optional)', v.base_url ?? '')}${field('m-priority', 'Priority (1 = first)', v.priority, 'number')}
      ${field('m-maxtokens', 'Max reply tokens', v.max_tokens ?? '', 'number')}${field('m-temp', 'Temperature (0–2)', v.temperature ?? '', 'number')}${field('m-timeout', 'Timeout (ms)', v.timeout_ms ?? '', 'number')}${field('m-daily', 'Daily request limit', v.daily_limit ?? '', 'number')}${field('m-monthly', 'Monthly request limit', v.monthly_limit ?? '', 'number')}
      <div class="col-12"><div class="small text-secondary mb-1">Capabilities</div>${options.capabilities.map((c) => `<label class="me-3 small"><input type="checkbox" data-mcap="${esc(c)}" ${v.capabilities.includes(c) ? 'checked' : ''}> ${esc(c)}</label>`).join('')}</div>
      <div class="col-12">${[['m-enabled', 'Enabled', v.enabled], ['m-free', 'Free users may use it', v.free_user_enabled], ['m-premium', 'Premium users may use it', v.premium_user_enabled]].map(([id, label, on]) => `<label class="me-3 small"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}> ${label}</label>`).join('')}</div>
    </div><div class="mt-3 d-flex gap-2"><button class="btn btn-brand" type="submit">Save</button><button class="btn btn-ghost" type="button" id="m-cancel">Cancel</button></div></form>`;
    slot.scrollIntoView({ behavior: 'smooth' });
    document.getElementById('m-cancel').onclick = () => { slot.innerHTML = ''; };
    document.getElementById('model-form').onsubmit = (e) => {
      e.preventDefault();
      const body = { ...(create ? { slug: val('m-slug').trim() } : {}), display_name: val('m-name').trim(), provider_id: val('m-provider') || null, model_identifier: val('m-modelid').trim() || null, base_url: val('m-baseurl').trim() || null, priority: Number(val('m-priority')), max_tokens: intOrNull('m-maxtokens'), temperature: intOrNull('m-temp'), timeout_ms: intOrNull('m-timeout'), daily_limit: intOrNull('m-daily'), monthly_limit: intOrNull('m-monthly'), capabilities: [...document.querySelectorAll('[data-mcap]')].filter((c) => c.checked).map((c) => c.dataset.mcap), enabled: document.getElementById('m-enabled').checked, free_user_enabled: document.getElementById('m-free').checked, premium_user_enabled: document.getElementById('m-premium').checked };
      safe(() => (create ? api('/admin/ai/models', { method: 'POST', body: JSON.stringify(body) }) : api(`/admin/ai/models/${m.id}`, { method: 'PATCH', body: JSON.stringify(body) })), 'Model saved.');
    };
  }
  function providerForm(p) {
    const create = !p;
    const v = p ?? { adapter: options.adapters[0], enabled: true };
    slot.innerHTML = `<form id="prov-form" class="card-surface p-4 mb-4" novalidate><h3 class="h6">${create ? 'Add provider' : `Edit ${esc(p.display_name)}`}</h3><div class="row g-3">
      ${create ? `${field('p-code', 'Code (lowercase)', '')}<div class="col-md-4"><label class="form-label small text-secondary" for="p-adapter">Adapter</label><select class="form-select" id="p-adapter">${options.adapters.map((a) => `<option>${esc(a)}</option>`).join('')}</select></div>` : ''}
      ${field('p-name', 'Display name', v.display_name ?? '')}${field('p-base', 'Base URL override (vendor host only)', v.base_url ?? '')}<div class="col-12 small text-secondary">The server credential slot is selected from the provider type. Configure that secret in hosting environment variables only; never paste it into this dashboard.</div>
    </div><div class="mt-3 d-flex gap-2"><button class="btn btn-brand" type="submit">Save</button><button class="btn btn-ghost" type="button" id="p-cancel">Cancel</button></div></form>`;
    slot.scrollIntoView({ behavior: 'smooth' });
    document.getElementById('p-cancel').onclick = () => { slot.innerHTML = ''; };
    document.getElementById('prov-form').onsubmit = (e) => {
      e.preventDefault();
      const body = { ...(create ? { code: val('p-code').trim(), adapter: val('p-adapter') } : {}), display_name: val('p-name').trim(), base_url: val('p-base').trim() || null };
      safe(() => (create ? api('/admin/ai/providers', { method: 'POST', body: JSON.stringify(body) }) : api(`/admin/ai/providers/${p.id}`, { method: 'PATCH', body: JSON.stringify(body) })), 'Provider saved.');
    };
  }

  document.getElementById('model-add').onclick = () => modelForm(null);
  document.getElementById('prov-add').onclick = () => providerForm(null);
  document.querySelectorAll('[data-medit]').forEach((b) => { b.onclick = () => modelForm(models.find((m) => m.id === b.dataset.medit)); });
  document.querySelectorAll('[data-pedit]').forEach((b) => { b.onclick = () => providerForm(providers.find((p) => p.id === b.dataset.pedit)); });
  document.querySelectorAll('[data-mtoggle]').forEach((b) => { b.onclick = () => safe(() => api(`/admin/ai/models/${b.dataset.mtoggle}`, { method: 'PATCH', body: JSON.stringify({ enabled: b.dataset.on !== '1' }) }), 'Model updated.'); });
  document.querySelectorAll('[data-ptoggle]').forEach((b) => { b.onclick = () => safe(() => api(`/admin/ai/providers/${b.dataset.ptoggle}`, { method: 'PATCH', body: JSON.stringify({ enabled: b.dataset.on !== '1' }) }), 'Provider updated.'); });
  document.querySelectorAll('[data-mtest]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true; b.textContent = 'Testing…';
      try { const r = await api(`/admin/ai/models/${b.dataset.mtest}/test`, { method: 'POST' }); toast(r.ok ? `Test succeeded in ${r.latency_ms} ms.` : `Test failed (${r.error_code}) after ${r.latency_ms} ms.`); await rerender(); }
      catch (error) { toast(errText(error)); b.disabled = false; b.textContent = 'Test'; }
    };
  });
  document.getElementById('ai-purge').onclick = () => { if (window.confirm('Delete conversations idle for longer than the retention period? This cannot be undone. (With 0 days nothing is deleted.)')) safe(async () => { const r = await api('/admin/ai/purge', { method: 'POST' }); toast(`Deleted ${r.conversations_deleted} conversation(s).`); }); };
  document.getElementById('ai-settings').onsubmit = (e) => {
    e.preventDefault();
    const flags = Object.fromEntries([...document.querySelectorAll('[data-flag]')].map((c) => [c.dataset.flag, c.checked]));
    const ints = Object.fromEntries(['max_input_chars', 'max_output_tokens', 'max_context_messages', 'max_context_chars', 'max_attempts', 'request_timeout_ms', 'total_deadline_ms', 'retention_days'].map((k) => [k, Number(val(`s-${k}`))]));
    const limits = Object.fromEntries(['guest', 'free_user', 'premium_user', 'admin'].map((t) => [t, Object.fromEntries(['per_minute', 'per_day', 'tokens_per_day'].map((f) => [f, intOrNull(`l-${t}-${f}`)]))]));
    const body = { ai_name: val('s-name'), welcome_message: val('s-welcome'), system_prompt: val('s-prompt'), safety_instructions: val('s-safety'), upgrade_message: val('s-upgrade'), default_model: val('s-defmodel').trim() || null, default_capability: val('s-defcap'), enabled_capabilities: [...document.querySelectorAll('[data-cap]')].filter((c) => c.checked).map((c) => c.dataset.cap), ...flags, ...ints, limits };
    safe(() => api('/admin/ai/settings', { method: 'PUT', body: JSON.stringify(body) }), 'Settings saved.');
  };
}
