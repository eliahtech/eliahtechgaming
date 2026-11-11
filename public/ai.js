// Eliah AI chat page. All limits, model access and Premium status come from the server (/api/v1/ai/*); nothing here decides
// access. The page never holds a provider key: the browser only ever talks to our own API.
import { api, session, state, toast, escapeHtml as esc, shell, pageHero } from '/app.js';
import { formatMessage } from '/ai-format.js';

const CAP_LABELS = { general: 'General', reasoning: 'Reasoning', coding: 'Coding', writing: 'Writing', translation: 'Translation', summarization: 'Summaries', multimodal: 'Multimodal', fast: 'Fast', long_context: 'Long context', seo: 'SEO', creative: 'Creative', data_analysis: 'Data analysis' };
const newKey = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);

export async function renderAi() {
  document.title = 'AI Assistant — Eliah Tech';
  shell(`${pageHero('AI / ASK ELIAH', 'Ask the Eliah Tech assistant.', 'Gaming, Android, websites, coding and troubleshooting, with answers that can draw on Eliah Tech guides.')}<section class="section pt-4"><div class="container-xl"><div id="ai-root" aria-live="polite"><p class="text-secondary">Loading…</p></div></div></section>`);
  const root = document.querySelector('#ai-root');
  let config;
  try { config = await api('/ai/config'); } catch (error) { root.innerHTML = `<div class="empty-state">${esc(error.message)}</div>`; return; }
  if (!config.access.allowed) {
    root.innerHTML = config.access.reason === 'UNAUTHENTICATED'
      ? '<div class="card-surface p-4"><h2 class="h5">Sign in to chat</h2><p class="text-secondary">Create a free account to use the AI assistant.</p><a class="btn btn-brand me-2" href="/login">Log in</a><a class="btn btn-ghost" href="/register">Create account</a></div>'
      : '<div class="empty-state">The AI assistant is not available for your account right now.</div>';
    return;
  }

  const signedIn = Boolean(state.user && session.get());
  const ui = { conversationId: null, messages: [], busy: false, models: { items: [], locked_count: 0 }, usage: null, conversations: [], pending: null };
  const [models, usage] = await Promise.all([api('/ai/models').catch(() => ui.models), api('/ai/usage').catch(() => null)]);
  ui.models = models; ui.usage = usage;
  if (signedIn) ui.conversations = (await api('/ai/conversations?limit=30').catch(() => ({ items: [] }))).items;

  root.innerHTML = `<div class="row g-4">
    <aside class="col-lg-3" aria-label="Conversations"><div class="card-surface p-3 ai-side">
      <button class="btn btn-brand w-100 mb-3" id="ai-new" type="button"><i class="fa-solid fa-plus me-2" aria-hidden="true"></i>New conversation</button>
      <div id="ai-history" class="ai-history"></div>
      <hr class="border-secondary opacity-25"><div id="ai-usage" class="small text-secondary"></div>
      <div id="ai-upgrade"></div>
    </div></aside>
    <div class="col-lg-9"><div class="card-surface ai-panel">
      <div class="ai-controls row g-2 p-3 pb-0">
        <div class="col-sm-6"><label class="form-label small text-secondary mb-1" for="ai-capability">Focus</label><select id="ai-capability" class="form-select form-select-sm">${config.capabilities.map((c) => `<option value="${esc(c)}" ${c === config.default_capability ? 'selected' : ''}>${esc(CAP_LABELS[c] || c)}</option>`).join('')}</select></div>
        <div class="col-sm-6"><label class="form-label small text-secondary mb-1" for="ai-model">Model</label><select id="ai-model" class="form-select form-select-sm"><option value="">Automatic (recommended)</option>${ui.models.items.map((m) => `<option value="${esc(m.slug)}">${esc(m.name)}</option>`).join('')}</select><div class="form-text" id="ai-model-note"></div></div>
      </div>
      <div id="ai-log" class="ai-log" role="log" aria-label="Conversation"></div>
      <div id="saved-ai-tasks" class="p-3"></div><form id="ai-form" class="ai-compose p-3" novalidate>
        <label class="visually-hidden" for="ai-input">Message</label>
        <textarea id="ai-input" class="form-control" rows="2" maxlength="${Number(config.max_input_chars) || 4000}" placeholder="Describe your gaming problem, include your device, or ask for coding help…"></textarea>
        <label class="form-label small mt-2" for="ai-image">Error screenshot (PNG/JPEG/WebP, under 1.5 MB)</label><input class="form-control form-control-sm" id="ai-image" type="file" accept="image/png,image/jpeg,image/webp"><label class="form-label small mt-2" for="ai-voice">Voice question (optional, under 3 MB)</label><input class="form-control form-control-sm" id="ai-voice" type="file" accept="audio/wav,audio/mpeg,audio/mp4,audio/webm,audio/ogg"><div class="d-flex justify-content-between align-items-center mt-2"><span class="small text-secondary" id="ai-count"></span><button class="btn btn-brand" id="ai-send" type="submit">Send <i class="fa-solid fa-paper-plane ms-1" aria-hidden="true"></i></button></div>
      </form>
    </div></div></div>`;

  const $ = (sel) => root.querySelector(sel);
  const log = $('#ai-log'); const input = $('#ai-input');

  const bubble = (m) => `<div class="ai-msg ${m.role === 'user' ? 'ai-user' : 'ai-assistant'}"><div class="ai-who">${m.role === 'user' ? 'You' : esc(config.name)}${m.modelName ? ` <span class="text-secondary">· ${esc(m.modelName)}</span>` : ''}</div><div class="ai-body">${m.role === 'user' ? esc(m.content).replace(/\n/g, '<br>') : formatMessage(m.content)}</div>${m.sources?.length ? `<div class="ai-sources small">Sources: ${m.sources.map((s) => `<a href="${esc(s.url)}">${esc(s.title)}</a>`).join(' · ')}</div>` : ''}</div>`;
  function paintLog() {
    const parts = ui.messages.length ? ui.messages.map(bubble) : [`<div class="ai-welcome text-secondary">${esc(config.welcome_message)}</div>`];
    if (ui.busy) parts.push('<div class="ai-msg ai-assistant"><div class="ai-body text-secondary"><span class="ai-dots" aria-hidden="true"><i></i><i></i><i></i></span> Thinking…</div></div>');
    if (ui.error) parts.push(`<div class="ai-error" role="alert">${esc(ui.error)} ${ui.pending ? '<button type="button" class="btn btn-sm btn-ghost ms-2" id="ai-retry">Retry</button>' : ''}</div>`);
    log.innerHTML = parts.join('');
    log.scrollTop = log.scrollHeight;
    $('#ai-retry')?.addEventListener('click', () => send(ui.pending));
  }
  function paintSide() {
    $('#ai-history').innerHTML = !signedIn ? '<p class="small text-secondary mb-0">Sign in to keep your conversation history.</p>'
      : ui.conversations.length ? ui.conversations.map((c) => `<div class="ai-conv ${c.id === ui.conversationId ? 'active' : ''}"><button type="button" class="ai-conv-open" data-id="${esc(c.id)}">${esc(c.title)}</button><button type="button" class="ai-conv-del" data-del="${esc(c.id)}" aria-label="Delete conversation ${esc(c.title)}"><i class="fa-solid fa-trash" aria-hidden="true"></i></button></div>`).join('')
        : '<p class="small text-secondary mb-0">No conversations yet.</p>';
    const l = config.limits; const u = ui.usage;
    $('#ai-usage').innerHTML = `<div><strong>${esc(({ guest: 'Guest', free_user: 'Free', premium_user: 'Premium', admin: 'Admin' })[config.tier] || '')}</strong> plan</div>`
      + (u?.used ? `<div>Today: ${esc(u.used.requests_today)} of ${esc(l.per_day)} requests${l.tokens_per_day ? ` · ${esc(u.used.tokens_today)} of ${esc(l.tokens_per_day)} tokens` : ''}</div>` : `<div>Up to ${esc(l.per_day)} requests per day</div>`)
      + `<div>Up to ${esc(l.per_minute)} per minute</div>`;
    $('#ai-upgrade').innerHTML = config.upgrade_message ? `<div class="ai-upgrade mt-3"><p class="small mb-2">${esc(config.upgrade_message)}</p><a class="btn btn-sm btn-brand" href="/premium">See Premium</a></div>` : '';
    $('#ai-model-note').textContent = ui.models.locked_count ? `${ui.models.locked_count} more model${ui.models.locked_count > 1 ? 's' : ''} available with Premium.` : '';
  }
  async function refreshSide() {
    ui.usage = await api('/ai/usage').catch(() => ui.usage);
    if (signedIn) ui.conversations = (await api('/ai/conversations?limit=30').catch(() => ({ items: ui.conversations }))).items;
    paintSide();
  }
  const setBusy = (busy) => { ui.busy = busy; $('#ai-send').disabled = busy; input.disabled = busy; };

  // `pending` keeps the Idempotency-Key, so a Retry after a network error can never trigger a second paid provider call.
  async function send(pending) {
    if (ui.busy) return;
    ui.error = null;
    if (!pending.userAdded) { ui.messages.push({ role: 'user', content: pending.message }); pending.userAdded = true; }
    ui.pending = pending; setBusy(true); paintLog();
    try {
      if(!pending.taskId) {
        let image;
        const file=document.querySelector('#ai-image')?.files[0];
        if(file){if(file.size>1572864)throw new Error('Choose a screenshot under 1.5 MB.');image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});}
        const task=await api('/ai/tasks',{method:'POST',headers:{'Idempotency-Key':pending.key},body:JSON.stringify({message:pending.message,capability:pending.capability,...(image?{image}:{}),...(pending.model?{model:pending.model}:{}),...(ui.conversationId?{conversationId:ui.conversationId}:{})})});pending.taskId=task.id;
      }
      const data=await api('/ai/tasks/'+pending.taskId+'/resume',{method:'POST',body:'{}'});
      ui.messages.push({ role: 'assistant', content: data.content, modelName: data.modelName, sources: data.sources });
      document.querySelector('#ai-image').value='';
      ui.conversationId = data.conversationId ?? ui.conversationId; ui.pending = null;
      setBusy(false); paintLog(); refreshSide();
    } catch (error) {
      ui.error = error.code === 'UNAUTHENTICATED' ? 'Your session expired. Please log in again.' : error.message;
      if (['VALIDATION_ERROR', 'AI_MODEL_FORBIDDEN', 'AI_LIMIT_REACHED', 'AI_CONTENT_REJECTED', 'AI_REQUEST_REJECTED'].includes(error.code)) { ui.pending = null; ui.messages.pop(); input.value = pending.message; }
      setBusy(false); paintLog();
    }
  }

  document.querySelector('#ai-voice').addEventListener('change',async event=>{const file=event.target.files[0];if(!file)return;if(file.size>3145728){toast('Choose audio under 3 MB.');return;}try{const data=await api('/ai/transcribe',{method:'POST',headers:{'Content-Type':file.type},body:file});input.value=data.text;}catch(err){toast(err.message);}});
  async function savedTasks(){if(!signedIn)return;try{const data=await api('/ai/tasks');const root=document.querySelector('#saved-ai-tasks');root.innerHTML='<details><summary>Saved tasks and results</summary>'+data.items.map(t=>`<p>${esc(t.status)} · ${esc(t.created_at)} <button type="button" class="btn btn-sm btn-ghost" data-task-resume="${esc(t.id)}">${t.status==='completed'?'Open result':'Resume'}</button> <button type="button" class="btn btn-sm btn-ghost" data-task-delete="${esc(t.id)}">Delete</button></p>`).join('')+'</details>';root.onclick=async event=>{try{const remove=event.target.dataset.taskDelete,id=event.target.dataset.taskResume;if(remove){await api('/ai/tasks/'+remove,{method:'DELETE'});await savedTasks();return;}if(id&&!ui.busy){const task=await api('/ai/tasks/'+id);if(task.status==='completed'){ui.messages.push({role:'assistant',content:task.result.content,modelName:task.result.modelName,sources:task.result.sources});paintLog();}else{ui.conversationId=task.conversationId||null;await send({message:task.message,taskId:id,key:newKey(),capability:'general',model:''});}}}catch(err){toast(err.message);}};}catch{}}
  await savedTasks();
  const download=document.createElement('button');download.type='button';download.className='btn btn-sm btn-ghost m-2';download.textContent='Download conversation';download.onclick=()=>{const text=ui.messages.map(m=>(m.role==='user'?'You':'Eliah AI')+'\n\n'+m.content).join('\n\n---\n\n'),url=URL.createObjectURL(new Blob([text],{type:'text/markdown'}));const a=document.createElement('a');a.href=url;a.download='eliahtech-conversation.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};document.querySelector('#saved-ai-tasks').append(download);
  $('#ai-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    input.value = ''; $('#ai-count').textContent = '';
    send({ message, key: newKey(), capability: $('#ai-capability').value, model: $('#ai-model').value });
  });
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $('#ai-form').requestSubmit(); } });
  input.addEventListener('input', () => { const max = Number(input.maxLength); $('#ai-count').textContent = input.value.length > max * 0.8 ? `${input.value.length} / ${max}` : ''; });
  $('#ai-new').addEventListener('click', () => { if (ui.busy) return toast('Wait for the current answer first.'); ui.conversationId = null; ui.messages = []; ui.error = null; ui.pending = null; paintLog(); paintSide(); input.focus(); });
  $('#ai-history').addEventListener('click', async (event) => {
    const open = event.target.closest('[data-id]'); const del = event.target.closest('[data-del]');
    if (ui.busy && (open || del)) return toast('Wait for the current answer before switching conversations.');
    try {
      if (open) { const c = await api(`/ai/conversations/${encodeURIComponent(open.dataset.id)}`); ui.conversationId = c.id; ui.messages = c.messages.map((m) => ({ role: m.role, content: m.content, modelName: m.model })); ui.error = null; paintLog(); paintSide(); }
      if (del && window.confirm('Delete this conversation? This cannot be undone.')) { await api(`/ai/conversations/${encodeURIComponent(del.dataset.del)}`, { method: 'DELETE' }); if (ui.conversationId === del.dataset.del) { ui.conversationId = null; ui.messages = []; } await refreshSide(); paintLog(); }
    } catch (error) { toast(error.message); }
  });
  paintLog(); paintSide();
}
