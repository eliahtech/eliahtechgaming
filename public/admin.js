// Admin dashboard. Every action calls /api/v1/admin/*; the server re-checks the admin role on each request,
// so hiding this UI from non-admins is a convenience, not the security boundary.
import { api, state, toast, escapeHtml as esc, shell, formatDate, pageHero } from '/app.js';

// Jodit runs inside the admin session, so it is served from our own origin (public/vendor/jodit, created by `npm run vendor`).
// The jsDelivr copy is only a fallback until the vendored files exist; run the vendor script and it is never used.
const JODIT_LOCAL = { js: '/vendor/jodit/jodit.min.js', css: '/vendor/jodit/jodit.min.css' };
const JODIT_CDN = { js: 'https://cdn.jsdelivr.net/npm/jodit@4/es2021/jodit.min.js', css: 'https://cdn.jsdelivr.net/npm/jodit@4/es2021/jodit.min.css' };
const hasVendored = async () => { try { const res = await fetch(JODIT_LOCAL.js, { method: 'HEAD' }); return res.ok && !/text\/html/i.test(res.headers.get('content-type') || ''); } catch { return false; } };
const yesNo = (v) => (v ? 'Yes' : 'No');
const dateOrDash = (v) => (v ? formatDate(v) : '—');
const STATUS = ['draft', 'published', 'archived'];
const ACCENTS = ['violet', 'cyan', 'orange', 'pink'];

// Field types: text | textarea | number | checkbox | select | image | html | tags (comma list) | lines | datetime
const RES = {
  games:{label:'Game hubs',titleKey:'name',cols:[['name','Game'],['slug','Slug'],['enabled','Published',yesNo]],fields:[{name:'name',label:'Game / hub name',type:'text',required:true},{name:'slug',label:'Slug',type:'text',skipEmpty:true},{name:'summary',label:'Hub introduction',type:'textarea',required:true},{name:'cover_image_url',label:'Hub cover',type:'image'},{name:'platforms',label:'Platforms (one per line: android, ppsspp, pc, console)',type:'lines'},{name:'enabled',label:'Publish hub',type:'checkbox',default:true},{name:'sort_order',label:'Display order',type:'number'}]},
  ads: {label:'Ad placements',titleKey:'name',cols:[['name','Name'],['placement','Position'],['platform','Platform'],['enabled','Enabled',yesNo]],fields:[{name:'name',label:'Name',type:'text',required:true},{name:'platform',label:'Platform',type:'text'},{name:'placement',label:'Placement',type:'select',options:['header','body','footer','sidebar','auto']},{name:'device',label:'Devices (manual placements)',type:'select',options:['both','desktop','mobile']},{name:'code',label:'Ad code (operator-approved domains only)',type:'textarea',help:'Runs only on eligible posts. Set AD_ALLOWED_ORIGINS on the server before enabling scripts.'},{name:'paragraph',label:'Body ad: after paragraph number',type:'number',default:3},{name:'enabled',label:'Enabled',type:'checkbox'},{name:'starts_at',label:'Start date',type:'datetime'},{name:'ends_at',label:'End date',type:'datetime'},{name:'sort_order',label:'Order',type:'number'}]},
  tickets:{label:'Support tickets',titleKey:'subject',cols:[['subject','Subject'],['priority','Priority'],['status','Status']],fields:[{name:'status',label:'Status',type:'select',options:['open','in_progress','resolved']},{name:'admin_reply',label:'Reply shown in member account',type:'textarea'}]},
  reports:{label:'Content reports',titleKey:'message',cols:[['message','Report'],['status','Status']],fields:[{name:'status',label:'Status',type:'select',options:['open','resolved','dismissed']}]},
  comments:{label:'Comments',titleKey:'body',cols:[['display_name','Member'],['body','Comment'],['status','Status']],fields:[{name:'status',label:'Moderation',type:'select',options:['pending','approved','rejected']}]},
  requests:{label:'Tutorial requests',titleKey:'title',cols:[['title','Title'],['status','Status']],fields:[{name:'status',label:'Status',type:'select',options:['pending','open','planned','completed','rejected']}]},
  posts: {
    label: 'Posts', cols: [['title', 'Title'], ['status', 'Status'], ['is_premium', 'Premium', yesNo], ['published_at', 'Published', dateOrDash]], statusFilter: true, titleKey: 'title',
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true }, { name: 'slug', label: 'Slug', type: 'text', skipEmpty: true, help: 'Leave blank to generate from the title.' },
      { name: 'excerpt', label: 'Excerpt', type: 'textarea' }, { name: 'content_html', label: 'Content', type: 'html' },
      { name: 'featured_image_url', label: 'Featured image', type: 'image' }, { name: 'featured_image_alt', label: 'Image alt text', type: 'text' },
      {name:'game_id',label:'Game hub',type:'select',optionsFrom:'games',nullable:true,help:'Assign this guide to its game hub. Optional for general tech/AI posts.'},
      {name:'content_type',label:'Guide type',type:'select',options:['guide','installation','settings','textures','update','troubleshooting'],default:'guide'},
      {name:'platform',label:'Platform',type:'select',options:['android','ppsspp','pc','console','other'],nullable:true},
      {name:'android_min_version',label:'Minimum Android version',type:'text',nullable:true},
      {name:'emulator_version',label:'Emulator version used',type:'text',nullable:true},
      {name:'min_ram_gb',label:'Minimum RAM (GB)',type:'number',step:'0.25',nullable:true},
      {name:'storage_mb',label:'Required storage (MB)',type:'number',nullable:true},
      {name:'tested_devices',label:'Devices you actually tested (one per line)',type:'lines',help:'Leave blank when untested. Do not list assumed compatibility.'},
      {name:'last_tested_at',label:'Date actually tested',type:'datetime'},
      {name:'reviewed_at',label:'Date you last reviewed the guide',type:'datetime'},
      {name:'compatibility_notes',label:'Compatibility notes',type:'textarea',nullable:true},
      {name:'change_summary',label:'Public change summary for this save',type:'textarea',nullable:true,help:'For published updates, explain what changed. Leave blank if there is no public update note.'},
      { name: 'category_id', label: 'Category', type: 'select', optionsFrom: 'categories' }, { name: 'installation_guide_id', label: 'Installation guide', type: 'select', optionsFrom: 'guides', help: 'Shown below the article and updated everywhere when the guide changes.' },
      { name: 'tags', label: 'Tags', type: 'tags', help: 'Comma separated.' }, { name: 'status', label: 'Status', type: 'select', options: STATUS },
      { name: 'published_at', label: 'Publish date', type: 'datetime', help: 'A future date schedules the post. Blank = now when published.' },
      {name:'ads_disabled',label:'Suppress ads on this post',type:'checkbox'}, { name: 'featured', label: 'Featured', type: 'checkbox' }, { name: 'is_premium', label: 'Premium only', type: 'checkbox' },
      { name: 'author_name', label: 'Author name', type: 'text' }, { name: 'seo_title', label: 'SEO title', type: 'text' }, { name: 'seo_description', label: 'SEO description', type: 'textarea' },
      { name: 'seo_keywords', label: 'SEO keywords', type: 'tags' }, { name: 'canonical_url', label: 'Canonical URL', type: 'text' }, { name: 'og_image', label: 'Social share image', type: 'image' },
    ],
  },
  categories: {
    label: 'Categories', cols: [['name', 'Name'], ['slug', 'Slug'], ['enabled', 'Visible', yesNo], ['sort_order', 'Order']], sortable: true, titleKey: 'name',
    fields: [{ name: 'name', label: 'Name', type: 'text', required: true }, { name: 'slug', label: 'Slug', type: 'text', skipEmpty: true }, { name: 'description', label: 'Description', type: 'textarea' }, { name: 'icon', label: 'Icon (Font Awesome class)', type: 'text', help: 'e.g. fa-gamepad' }, { name: 'color', label: 'Colour', type: 'text', help: 'e.g. #8b5cf6' }, { name: 'enabled', label: 'Visible', type: 'checkbox', default: true }, { name: 'sort_order', label: 'Order', type: 'number' }],
  },
  tags: { label: 'Tags', cols: [['name', 'Name'], ['slug', 'Slug']], titleKey: 'name', fields: [{ name: 'name', label: 'Name', type: 'text', required: true }, { name: 'slug', label: 'Slug', type: 'text', skipEmpty: true }] },
  services: {
    label: 'Services', cols: [['title', 'Title'], ['price', 'Price'], ['is_active', 'Active', yesNo], ['sort_order', 'Order']], sortable: true, titleKey: 'title',
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true }, { name: 'slug', label: 'Slug', type: 'text', skipEmpty: true }, { name: 'description', label: 'Description', type: 'textarea', required: true },
      { name: 'image_url', label: 'Image', type: 'image' }, { name: 'icon', label: 'Icon (Font Awesome class)', type: 'text' }, { name: 'features', label: 'Features (one per line)', type: 'lines' },
      { name: 'price', label: 'Price label', type: 'text' }, { name: 'currency', label: 'Currency', type: 'text' }, { name: 'accent', label: 'Accent', type: 'select', options: ACCENTS },
      { name: 'action_text', label: 'Button text', type: 'text' }, { name: 'action_url', label: 'Button link', type: 'text', help: 'https:// URL or a /path. Blank = contact form.' },
      { name: 'is_active', label: 'Active', type: 'checkbox', default: true }, { name: 'sort_order', label: 'Order', type: 'number' },
    ],
  },
  plans: {
    label: 'Plans', cols: [['name', 'Name'], ['code', 'Code'], ['duration_days', 'Days'], ['prices', 'Prices', (v) => Object.entries(v || {}).map(([c, a]) => `${c} ${a}`).join(' / ')], ['enabled', 'Enabled', yesNo]], sortable: true, titleKey: 'name',
    fields: [{ name: 'name', label: 'Name', type: 'text', required: true }, { name: 'code', label: 'Code (letters, numbers, hyphens)', type: 'text', required: true }, { name: 'description', label: 'Description', type: 'text' }, { name: 'duration_days', label: 'Access length (days)', type: 'number', required: true }, { name: 'prices', label: 'Prices (one per line, e.g. USD=4.99)', type: 'prices', help: 'PayPal charges in PAYPAL_CURRENCY (default USD) and PesaPal in PESAPAL_CURRENCY (default KES); a plan needs a price in each currency you accept. Prices are charged exactly as written here.' }, { name: 'enabled', label: 'Enabled', type: 'checkbox', default: true }, { name: 'sort_order', label: 'Order', type: 'number' }],
  },
  guides: {
    label: 'Installation guides', cols: [['title', 'Title'], ['enabled', 'Enabled', yesNo], ['updated_at', 'Updated', dateOrDash]], titleKey: 'title',
    fields: [{ name: 'title', label: 'Title', type: 'text', required: true }, { name: 'slug', label: 'Slug', type: 'text', skipEmpty: true }, { name: 'content_html', label: 'Guide content', type: 'html' }, { name: 'enabled', label: 'Enabled', type: 'checkbox', default: true }],
  },
  'social-links': {
    label: 'Social links', cols: [['platform', 'Platform'], ['url', 'URL'], ['enabled', 'Visible', yesNo], ['sort_order', 'Order']], sortable: true, titleKey: 'platform',
    fields: [{ name: 'platform', label: 'Platform', type: 'text', required: true }, { name: 'url', label: 'URL (https)', type: 'text', required: true }, { name: 'icon', label: 'Icon (Font Awesome class)', type: 'text', help: 'e.g. fa-telegram' }, { name: 'enabled', label: 'Visible', type: 'checkbox', default: true }, { name: 'sort_order', label: 'Order', type: 'number' }],
  },
};
const TABS = [['overview','Overview'],['html','HTML post'],['analytics','Analytics'],['health','Health & security'],['quality','Content quality'],['games','Game hubs'],['promotions','Promotions'],['ads-settings','Ads switch'],['member-benefits','Member benefits'],['ads','Ad placements'],['tickets','Support'],['reports','Reports'],['comments','Comments'],['requests','Requests'],['posts', 'Posts'], ['categories', 'Categories'], ['tags', 'Tags'], ['services', 'Services'], ['guides', 'Guides'], ['media', 'Media'], ['homepage', 'Homepage'], ['social-links', 'Social'], ['premium', 'Premium'], ['plans', 'Plans'], ['payments', 'Payments'], ['subscriptions', 'Subscriptions'], ['ai', 'AI'], ['users', 'Users'], ['messages', 'Messages'], ['subscribers', 'Subscribers'], ['newsletter', 'Newsletter'], ['email-log', 'Email log'], ['audit', 'Audit log'], ['site', 'Site info']];

const qs = () => new URLSearchParams(window.location.search);
const localDateTime = (iso) => { if (!iso) return ''; const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const errText = (error) => (error.details?.fields ? `${error.message} ${Object.entries(error.details.fields).map(([k, v]) => `${k}: ${v}`).join('; ')}` : error.message);
const lib = {};

function loadAsset(kind, url) {
  if (lib[url]) return lib[url];
  lib[url] = new Promise((resolve, reject) => {
    const el = document.createElement(kind === 'js' ? 'script' : 'link');
    if (kind === 'js') el.src = url; else { el.rel = 'stylesheet'; el.href = url; }
    el.onload = resolve; el.onerror = () => reject(new Error(`Could not load ${url}`));
    document.head.append(el);
  });
  return lib[url];
}

// Phone photos are often 5-12 MB, above the 4 MB request limit, so pictures are resized and compressed in the browser first.
const MAX_UPLOAD = 3.6 * 1024 * 1024;
async function sniffType(file) {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
  return null;
}
async function prepareImage(file) {
  const type = await sniffType(file);
  if (!type) throw new Error('This file is not a JPEG, PNG, WebP or GIF image. Convert it (for example HEIC to JPG) and try again.');
  if (file.size <= MAX_UPLOAD && (type === 'image/gif' || file.size <= 1.5 * 1024 * 1024)) return new File([file], file.name, { type });
  if (type === 'image/gif') throw new Error('This GIF is larger than 3.5 MB. Use a smaller GIF or an MP4/YouTube link.');
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) { if (file.size <= MAX_UPLOAD) return new File([file], file.name, { type }); throw new Error('This image is too large and could not be resized in your browser.'); }
  const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.86, 0.75, 0.62, 0.5]) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
    if (blob && blob.type === 'image/webp' && blob.size <= MAX_UPLOAD) return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp' });
    const jpg = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (jpg && jpg.size <= MAX_UPLOAD) return new File([jpg], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  }
  throw new Error('This image is still too large after compressing. Try a smaller one.');
}
async function uploadImage(file) {
  const ready = await prepareImage(file);
  try {
    return await api(`/admin/media?alt=${encodeURIComponent(file.name.replace(/\.[^.]+$/, ''))}`, { method: 'POST', headers: { 'Content-Type': ready.type }, body: ready });
  } catch (error) {
    if (error.status === 413) throw new Error('The image is too large for the server. Try a smaller picture.');
    throw error;
  }
}
// Pictures pasted into the editor or into pasted HTML arrive as data: URLs. They are uploaded to storage and the HTML is rewritten to use the stored link.
async function uploadEmbeddedImages(html, onProgress) {
  const found = [...new Set([...String(html).matchAll(/src\s*=\s*["'](data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+)["']/gi)].map((m) => m[1]))];
  let out = String(html); let n = 0;
  for (const uri of found) {
    n += 1; onProgress?.(`Uploading embedded image ${n} of ${found.length}…`);
    const blob = await (await fetch(uri)).blob();
    const media = await uploadImage(new File([blob], `pasted-image-${n}`, { type: blob.type }));
    out = out.split(uri).join(media.public_url);
  }
  return out;
}
// Shows whether an image link actually loads, so broken links are caught before publishing.
function checkImage(url) {
  return new Promise((resolve) => { if (!url) return resolve(null); const img = new Image(); img.referrerPolicy = 'no-referrer'; const t = setTimeout(() => resolve(false), 12000); img.onload = () => { clearTimeout(t); resolve(true); }; img.onerror = () => { clearTimeout(t); resolve(false); }; img.src = url; });
}


async function withUploadedImages(payload) {
  for (const [name, value] of Object.entries(payload)) if (typeof value === 'string' && value.includes('data:image/')) { toast('Uploading pasted pictures…'); payload[name] = await uploadEmbeddedImages(value); }
  return payload;
}
function wireImageChecks() {
  document.querySelectorAll('[data-image-check]').forEach((box) => {
    const input = document.getElementById(box.dataset.imageCheck); let timer;
    const run = async () => {
      const value = input.value.trim(); if (!value) { box.textContent = ''; return; }
      box.textContent = 'Checking image…'; box.className = 'small mt-1 text-secondary';
      const ok = await checkImage(value.startsWith('//') ? `https:${value}` : value);
      if (input.value.trim() !== value) return;
      box.className = `small mt-1 ${ok ? 'text-success' : 'text-warning'}`;
      box.textContent = ok ? '✔ Image link works.' : '⚠ This link did not load as an image. Share pages (Google Drive, Dropbox, imgur) are converted automatically on save, but pages that are not images will not display. Use a direct image link or Upload.';
    };
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 600); });
    run();
  });
}

function chrome(active, inner) {
  setTimeout(()=>{
    document.querySelector('#admin-menu-toggle')?.addEventListener('click',()=>document.querySelector('.admin-sidebar')?.classList.toggle('open'));
    document.querySelector('#theme-toggle')?.addEventListener('click',()=>{const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=theme;localStorage.setItem('eliah.theme',theme);});
  },0);
  return `${pageHero('ADMIN / GAMING WORKSPACE', 'Eliahtech Gaming', 'Manage your guides, members and gaming support.')}<section class="section pt-4"><div class="container-xl"><div class="d-flex gap-2 mb-3"><button id="admin-menu-toggle" class="btn btn-ghost admin-mobile-toggle">Menu</button><a href="/" class="btn btn-ghost">View website</a><button id="theme-toggle" class="btn btn-ghost">Light / dark</button></div><div class="admin-layout"><nav class="admin-sidebar" aria-label="Admin sections">${TABS.map(([key,label])=>`<a class="btn btn-sm ${active===key?'btn-brand':'btn-ghost'}" href="/admin/${key}">${label}</a>`).join('')}</nav><div class="admin-content">${inner}</div></div></div></section>`;
}

function renderField(f, value, options) {
  const id = `f-${f.name}`; const v = value ?? (f.default ?? '');
  const label = `<label class="form-label small text-secondary" for="${id}">${esc(f.label)}${f.required ? ' *' : ''}</label>`;
  const help = f.help ? `<div class="form-text">${esc(f.help)}</div>` : '';
  let control;
  if (f.type === 'textarea') control = `<textarea class="form-control" id="${id}" rows="3">${esc(v)}</textarea>`;
  else if (f.type === 'html') control = `<textarea class="form-control" id="${id}" rows="14">${esc(v)}</textarea>`;
  else if (f.type === 'checkbox') return `<div class="form-check mb-3"><input class="form-check-input" type="checkbox" id="${id}" ${v ? 'checked' : ''}><label class="form-check-label" for="${id}">${esc(f.label)}</label>${help}</div>`;
  else if (f.type === 'select') {
    const opts = options[f.name] || (f.options || []).map((o) => ({ value: o, label: o }));
    control = `<select class="form-select" id="${id}">${f.optionsFrom || f.nullable ? '<option value="">— none —</option>' : ''}${opts.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
  } else if (f.type === 'image') control = `<div class="d-flex gap-2"><input class="form-control" id="${id}" type="text" value="${esc(v)}" placeholder="https://…"><label class="btn btn-ghost mb-0">Upload<input type="file" accept="image/*" data-upload="${id}" hidden></label></div><div class="small mt-1" data-image-check="${id}" aria-live="polite"></div>`;
  else if (f.type === 'tags') control = `<input class="form-control" id="${id}" type="text" value="${esc(Array.isArray(v) ? v.join(', ') : v)}">`;
  else if (f.type === 'prices') control = `<textarea class="form-control" id="${id}" rows="3">${esc(typeof v === 'object' ? Object.entries(v).map(([c, a]) => `${c}=${a}`).join('\n') : v)}</textarea>`;
  else if (f.type === 'lines') control = `<textarea class="form-control" id="${id}" rows="4">${esc(Array.isArray(v) ? v.join('\n') : v)}</textarea>`;
  else if (f.type === 'datetime') control = `<input class="form-control" id="${id}" type="datetime-local" value="${esc(localDateTime(v))}">`;
  else if (f.type === 'number') control = `<input class="form-control" id="${id}" type="number" step="${esc(f.step||'1')}" value="${esc(v)}">`;
  else control = `<input class="form-control" id="${id}" type="text" value="${esc(v)}">`;
  return `<div class="mb-3">${label}${control}${help}</div>`;
}

function collect(fields, editors) {
  const out = {};
  for (const f of fields) {
    const el = document.getElementById(`f-${f.name}`);
    if (!el) continue;
    let value;
    if (f.type === 'checkbox') value = el.checked;
    else if (f.type === 'html') value = editors[f.name] ? editors[f.name].value : el.value;
    else if (f.type === 'number') { if (el.value === '') { if(f.nullable)out[f.name]=null; continue; } value = Number(el.value); }
    else if (f.type === 'tags') value = el.value.split(',').map((t) => t.trim()).filter(Boolean);
    else if (f.type === 'prices') value = Object.fromEntries(el.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.split('=').map((x) => x.trim())));
    else if (f.type === 'lines') value = el.value.split('\n').map((t) => t.trim()).filter(Boolean);
    else if (f.type === 'datetime') value = el.value ? new Date(el.value).toISOString() : null;
    else value = el.value;
    if (f.skipEmpty && value === '') continue;
    out[f.name] = value;
  }
  return out;
}

async function mountEditors(fields, editors) {
  const htmlFields = fields.filter((f) => f.type === 'html');
  if (!htmlFields.length) return;
  try {
    const src = (await hasVendored()) ? JODIT_LOCAL : JODIT_CDN;
    await Promise.all([loadAsset('css', src.css), loadAsset('js', src.js)]);
    for (const f of htmlFields) {
      editors[f.name] = window.Jodit.make(`#f-${f.name}`, {
        height: 520, toolbarAdaptive: false, askBeforePasteHTML: false, askBeforePasteFromWord: false, defaultActionOnPaste: 'insert_clear_html',
        buttons: ['paragraph', 'bold', 'italic', 'underline', '|', 'ul', 'ol', '|', 'link', 'table', 'video', 'hr', '|', 'undo', 'redo', 'source', 'fullsize', '|', 'uploadImage', 'ctaButton'],
        extraButtons: [
          { name: 'uploadImage', text: 'Image', tooltip: 'Upload an image', exec: (editor) => { const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.onchange = async () => { try { const media = await uploadImage(input.files[0]); editor.s.insertHTML(`<img src="${esc(media.public_url)}" alt="${esc(media.alt_text || '')}">`); } catch (error) { toast(error.message); } }; input.click(); } },
          { name: 'ctaButton', text: 'Button', tooltip: 'Insert a button link', exec: (editor) => { const url = window.prompt('Button link (https://…)'); const text = url && window.prompt('Button text'); if (url && text) editor.s.insertHTML(`<a class="btn btn-brand" href="${esc(url)}">${esc(text)}</a>`); } },
        ],
      });
    }
  } catch (error) {
    toast('The rich-text editor could not be loaded, so a plain HTML box is shown. Content is still sanitized on save.');
  }
}

async function loadOptions(fields) {
  const opts = {};
  for (const f of fields) {
    if (!f.optionsFrom) continue;
    const { items } = await api(`/admin/${f.optionsFrom}?limit=100`);
    opts[f.name] = items.map((i) => ({ value: i.id, label: i.name || i.title }));
  }
  return opts;
}

async function listView(key) {
  const cfg = RES[key]; const p = qs(); const limit = 25; const offset = Number(p.get('offset')) || 0; const q = p.get('q') || ''; const status = p.get('status') || '';
  const params = new URLSearchParams({ limit, offset, ...(q ? { q } : {}), ...(status ? { status } : {}) });
  const { items, meta } = await api(`/admin/${key}?${params}`);
  const link = (extra) => `/admin/${key}?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}), ...extra })}`;
  shell(chrome(key, `<div class="d-flex flex-wrap gap-2 justify-content-between mb-3"><form id="search-form" class="d-flex gap-2"><input class="form-control" id="admin-q" type="search" placeholder="Search ${esc(cfg.label.toLowerCase())}" value="${esc(q)}" aria-label="Search">${cfg.statusFilter ? `<select class="form-select" id="admin-status" aria-label="Status"><option value="">All statuses</option>${STATUS.map((s) => `<option ${s === status ? 'selected' : ''}>${s}</option>`).join('')}</select>` : ''}<button class="btn btn-ghost" type="submit">Search</button></form>${['tickets','reports','comments','requests'].includes(key)?'':`<a class="btn btn-brand" href="/admin/${key}/new">New ${esc(cfg.label.replace(/s$/, '').toLowerCase())}</a>`}</div>${items.length ? `<div class="table-responsive card-surface"><table class="table table-dark table-borderless align-middle mb-0"><thead><tr>${cfg.cols.map(([, label]) => `<th scope="col">${label}</th>`).join('')}<th></th></tr></thead><tbody>${items.map((row, i) => `<tr>${cfg.cols.map(([name, , fmt]) => `<td>${key==='posts'&&name==='title'?`<div class="d-flex gap-2 align-items-center"><img class="post-admin-cover" src="${esc(/^https:\/\//.test(row.featured_image_url||'')?row.featured_image_url:'/assets/gaming-cover.jpg')}" alt="" loading="lazy"><span>${esc(row.title)}</span></div>`:esc(fmt ? fmt(row[name]) : row[name] ?? '')}</td>`).join('')}<td class="text-end text-nowrap">${cfg.sortable ? `<button class="btn btn-sm btn-ghost" data-move="${i}:-1" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>▲</button> <button class="btn btn-sm btn-ghost" data-move="${i}:1" aria-label="Move down" ${i === items.length - 1 ? 'disabled' : ''}>▼</button> ` : ''}<a class="btn btn-sm btn-ghost" href="/admin/${key}/${row.id}">Edit</a></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">Nothing here yet.</div>'}<div class="d-flex justify-content-between mt-3 small text-secondary"><span>${meta.total} total</span><span>${offset > 0 ? `<a class="section-link me-3" href="${link({ offset: Math.max(offset - limit, 0) })}">Previous</a>` : ''}${offset + limit < meta.total ? `<a class="section-link" href="${link({ offset: offset + limit })}">Next</a>` : ''}</span></div>`));
  document.getElementById('search-form').addEventListener('submit', (e) => { e.preventDefault(); const s = document.getElementById('admin-status')?.value; window.history.pushState({}, '', `/admin/${key}?${new URLSearchParams({ q: document.getElementById('admin-q').value, ...(s ? { status: s } : {}) })}`); renderAdmin(window.location.pathname); });
  document.querySelectorAll('[data-move]').forEach((btn) => btn.addEventListener('click', async (event) => {
    event.stopPropagation(); const [i, dir] = btn.dataset.move.split(':').map(Number); const order = items.slice(); const [moved] = order.splice(i, 1); order.splice(i + dir, 0, moved);
    try { await Promise.all(order.map((row, idx) => (row.sort_order === offset + (idx + 1) * 10 ? null : api(`/admin/${key}/${row.id}`, { method: 'PATCH', body: JSON.stringify({ sort_order: offset + (idx + 1) * 10 }) })))); renderAdmin(window.location.pathname); } catch (error) { toast(errText(error)); }
  }));
}

async function formView(key, id) {
  const cfg = RES[key]; const isNew = id === 'new';
  const [options, record] = await Promise.all([loadOptions(cfg.fields), isNew ? {} : api(`/admin/${key}/${id}`)]);
  const editors = {};
  if(key==='posts')record.change_summary='';
  shell(chrome(key, `<form id="admin-form" class="card-surface p-4 p-lg-5" novalidate><h2 class="h4 mb-4">${isNew ? 'New' : 'Edit'} ${esc(cfg.label.replace(/s$/, '').toLowerCase())}</h2>${cfg.fields.map((f) => renderField(f, record[f.name], options)).join('')}<div class="d-flex flex-wrap gap-2"><button class="btn btn-brand" type="submit">Save</button><a class="btn btn-ghost" href="/admin/${key}">Cancel</a>${isNew ? '' : '<button class="btn btn-ghost ms-auto" type="button" id="delete-btn">Delete</button>'}</div></form>`));
  await mountEditors(cfg.fields, editors);
  if (['tickets','reports','comments','requests'].includes(key)) { const box=document.createElement('div'); box.className='alert alert-info'; box.innerHTML=`<strong>Details</strong><p>${esc(record.message||record.body||record.description||'')}</p>${record.conversation_id?`<p>Shared AI conversation: ${esc(record.conversation_id)}</p><button type="button" id="show-shared-conversation" class="btn btn-ghost">Read selected conversation</button><div id="shared-conversation"></div>`:''}`;document.querySelector('#admin-form').prepend(box); }
  document.querySelector('#show-shared-conversation')?.addEventListener('click',async()=>{try{const data=await api('/admin/tickets/'+id+'/conversation');document.querySelector('#shared-conversation').innerHTML=data.messages.map(m=>`<strong>${esc(m.role)}</strong><p style="white-space:pre-wrap">${esc(m.content)}</p>`).join('');}catch(err){toast(err.message);}});
  if(key==='posts') mountPostTools(id,record,cfg,editors);
  wireImageChecks();
  document.querySelectorAll('[data-upload]').forEach((input) => input.addEventListener('change', async () => { try { const source=input.files[0]; const file=input.dataset.upload==='f-featured_image_url'?await cropImage(source,1200,675):input.dataset.upload==='f-og_image'?await cropImage(source,1200,630):source; const media = await uploadImage(file); document.getElementById(input.dataset.upload).value = media.public_url; toast('Image uploaded.'); } catch (error) { toast(error.message); } }));
  document.getElementById('admin-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const button = event.target.querySelector('button[type="submit"]'); button.disabled = true;
    try {
      const saved = await api(isNew ? `/admin/${key}` : `/admin/${key}/${id}`, { method: isNew ? 'POST' : 'PATCH', body: JSON.stringify(await withUploadedImages(collect(cfg.fields, editors))) });
      if(key==='posts') { try { localStorage.removeItem('eliah.draft.'+state.user.id+'.'+id); } catch {} }
      toast('Saved.'); window.history.replaceState({}, '', `/admin/${key}/${saved.id}`); await renderAdmin(window.location.pathname);
    } catch (error) { toast(errText(error)); } finally { button.disabled = false; }
  });
  document.getElementById('delete-btn')?.addEventListener('click', async () => {
    if (!window.confirm(`Delete "${record[cfg.titleKey]}"? This cannot be undone.`)) return;
    try { await api(`/admin/${key}/${id}`, { method: 'DELETE' }); toast('Deleted.'); window.history.pushState({}, '', `/admin/${key}`); await renderAdmin(window.location.pathname); } catch (error) { toast(errText(error)); }
  });
}


// ---- HTML post: paste one full HTML page, review what was detected, publish ----
async function htmlPostView() {
  const [categories, games] = await Promise.all([api('/admin/categories?limit=100'), api('/admin/games?limit=100').catch(() => ({ items: [] }))]);
  const options = (rows, value) => `<option value="">— none —</option>${rows.items.map((r) => `<option value="${esc(r.id)}" ${r.id === value ? 'selected' : ''}>${esc(r.name || r.title)}</option>`).join('')}`;
  let detected = null;
  shell(chrome('html', `<div class="card-surface p-4 mb-4">
    <h2 class="h4">HTML post</h2>
    <p class="text-secondary mb-3">Paste a complete HTML page below. Title, description, keywords, cover image, tags and the other post details are read from it automatically. Review them, then publish: the post appears in <a href="/admin/posts">Posts</a> and on the website straight away. Images pasted as data (copy/paste) are uploaded for you.</p>
    <div class="d-flex flex-wrap gap-2 mb-2">
      <button class="btn btn-ghost btn-sm" type="button" id="hp-template">Insert starter template</button>
      <button class="btn btn-ghost btn-sm" type="button" id="hp-clear">Clear</button>
      <span class="small text-secondary align-self-center" id="hp-count"></span>
    </div>
    <label class="visually-hidden" for="hp-html">Full HTML</label>
    <textarea class="form-control font-monospace" id="hp-html" rows="16" spellcheck="false" placeholder="&lt;!DOCTYPE html&gt;&#10;&lt;html&gt;&#10;&lt;head&gt;&lt;title&gt;…&lt;/title&gt;&lt;meta name=&quot;description&quot; content=&quot;…&quot;&gt;&lt;/head&gt;&#10;&lt;body&gt;…&lt;/body&gt;&#10;&lt;/html&gt;"></textarea>
    <div class="d-flex flex-wrap gap-2 mt-3"><button class="btn btn-brand" type="button" id="hp-read">Read my HTML &amp; show preview</button></div>
  </div>
  <div id="hp-review"></div>`));
  const $ = (id) => document.getElementById(id);
  const input = $('hp-html');
  const count = () => { $('hp-count').textContent = input.value ? `${input.value.length.toLocaleString()} characters` : ''; };
  input.addEventListener('input', count);
  $('hp-template').addEventListener('click', async () => { try { if (input.value.trim() && !window.confirm('Replace what you pasted with the starter template?')) return; input.value = (await api('/admin/html-posts/template')).html; count(); } catch (e) { toast(errText(e)); } });
  $('hp-clear').addEventListener('click', () => { input.value = ''; $('hp-review').innerHTML = ''; detected = null; count(); });

  const field = (id, label, control, col = 'col-md-6') => `<div class="${col}"><label class="form-label small text-secondary" for="${id}">${esc(label)}</label>${control}</div>`;
  const text = (id, v, extra = '') => `<input class="form-control" id="${id}" type="text" value="${esc(v ?? '')}" ${extra}>`;

  async function read() {
    const html = input.value;
    if (!html.trim()) { toast('Paste your HTML first.'); return; }
    const button = $('hp-read'); button.disabled = true; button.textContent = 'Reading…';
    try {
      detected = await api('/admin/html-posts/parse', { method: 'POST', body: JSON.stringify({ html }) });
      draw();
    } catch (error) { toast(errText(error)); } finally { button.disabled = false; button.textContent = 'Read my HTML & show preview'; }
  }
  $('hp-read').addEventListener('click', read);

  function draw() {
    const f = detected.fields;
    const warn = detected.warnings.length ? `<div class="alert alert-warning"><strong>Check these</strong><ul class="mb-0">${detected.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : '<div class="alert alert-success mb-3">Everything needed was found.</div>';
    const srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank"><link rel="stylesheet" href="/vendor/bootstrap.min.css"><link rel="stylesheet" href="/gaming.css"><link rel="stylesheet" href="/theme.css"></head><body><div class="container py-3"><article class="article-wrap"><h1 class="display-6 fw-bold">${esc(f.title)}</h1><p class="lead">${esc(f.excerpt || '')}</p>${f.featured_image_url ? `<img class="article-cover img-fluid rounded mb-3" referrerpolicy="no-referrer" src="${esc(f.featured_image_url)}" alt="">` : ''}<div class="article-body">${detected.preview}</div></article></div></body></html>`;
    $('hp-review').innerHTML = `${warn}
    <div class="card-surface p-4 mb-4"><h3 class="h5 mb-3">Post details <span class="small text-secondary">(edit anything before publishing)</span></h3><div class="row g-3">
      ${field('hp-title', 'Title *', text('hp-title', f.title), 'col-12')}
      ${field('hp-slug', 'Slug (web address)', text('hp-slug', f.slug, 'placeholder="auto"'))}
      ${field('hp-category', 'Category *', `<select class="form-select" id="hp-category">${options(categories, f.category_id)}</select>`)}
      ${field('hp-excerpt', 'Excerpt (card text)', `<textarea class="form-control" id="hp-excerpt" rows="2">${esc(f.excerpt || '')}</textarea>`, 'col-12')}
      ${field('hp-image', 'Cover image link', `<div class="d-flex gap-2"><input class="form-control" id="hp-image" type="text" value="${esc(f.featured_image_url || '')}" placeholder="https://…"><label class="btn btn-ghost mb-0">Upload<input type="file" accept="image/*" data-hp-upload hidden></label></div><div class="small mt-1" data-image-check="hp-image" aria-live="polite"></div>`)}
      ${field('hp-alt', 'Image alt text', text('hp-alt', f.featured_image_alt))}
      ${field('hp-tags', 'Tags (comma separated)', text('hp-tags', (f.tags || []).join(', ')))}
      ${field('hp-keywords', 'SEO keywords (comma separated)', text('hp-keywords', (f.seo_keywords || []).join(', ')))}
      ${field('hp-seo-title', 'SEO title', text('hp-seo-title', f.seo_title))}
      ${field('hp-seo-desc', 'SEO description', text('hp-seo-desc', f.seo_description))}
      ${field('hp-author', 'Author name', text('hp-author', f.author_name))}
      ${field('hp-game', 'Game hub', `<select class="form-select" id="hp-game">${options(games, f.game_id)}</select>`)}
      ${field('hp-type', 'Guide type', `<select class="form-select" id="hp-type">${['guide', 'installation', 'settings', 'textures', 'update', 'troubleshooting'].map((t) => `<option ${t === f.content_type ? 'selected' : ''}>${t}</option>`).join('')}</select>`)}
      ${field('hp-platform', 'Platform', `<select class="form-select" id="hp-platform"><option value="">— none —</option>${['android', 'ppsspp', 'pc', 'console', 'other'].map((t) => `<option ${t === f.platform ? 'selected' : ''}>${t}</option>`).join('')}</select>`)}
      ${field('hp-android', 'Minimum Android version', text('hp-android', f.android_min_version), 'col-md-3')}
      ${field('hp-emulator', 'Emulator version', text('hp-emulator', f.emulator_version), 'col-md-3')}
      ${field('hp-ram', 'Minimum RAM (GB)', text('hp-ram', f.min_ram_gb ?? ''), 'col-md-3')}
      ${field('hp-storage', 'Storage (MB)', text('hp-storage', f.storage_mb ?? ''), 'col-md-3')}
      ${field('hp-devices', 'Devices you tested (comma separated)', text('hp-devices', (f.tested_devices || []).join(', ')))}
      ${field('hp-notes', 'Compatibility notes', text('hp-notes', f.compatibility_notes))}
      ${field('hp-tested', 'Date tested', `<input class="form-control" id="hp-tested" type="datetime-local" value="${esc(localDateTime(f.last_tested_at))}">`, 'col-md-4')}
      ${field('hp-publish', 'Publish date (blank = now; future = scheduled)', `<input class="form-control" id="hp-publish" type="datetime-local" value="${esc(localDateTime(f.published_at))}">`, 'col-md-4')}
      <div class="col-md-4 d-flex flex-column justify-content-end">
        <div class="form-check"><input class="form-check-input" type="checkbox" id="hp-premium" ${f.is_premium ? 'checked' : ''}><label class="form-check-label" for="hp-premium">Premium only</label></div>
        <div class="form-check"><input class="form-check-input" type="checkbox" id="hp-featured" ${f.featured ? 'checked' : ''}><label class="form-check-label" for="hp-featured">Featured</label></div>
        <div class="form-check"><input class="form-check-input" type="checkbox" id="hp-noads" ${f.ads_disabled ? 'checked' : ''}><label class="form-check-label" for="hp-noads">Suppress ads</label></div>
      </div>
    </div></div>
    ${detected.images.length ? `<div class="card-surface p-4 mb-4"><h3 class="h5">Images in your HTML (${detected.images.length})</h3><ul class="list-unstyled mb-0" id="hp-images">${detected.images.map((im, i) => `<li class="small" data-img-row="${i}"><span class="text-secondary">Checking…</span> <code>${esc(im.fixed === 'embedded' ? '(pasted picture — will be uploaded)' : im.fixed || im.src || '(empty)')}</code></li>`).join('')}</ul></div>` : ''}
    <div class="card-surface p-3 mb-4"><h3 class="h5 px-1">Preview</h3><iframe id="hp-frame" title="Post preview" sandbox="" style="width:100%;height:520px;border:1px solid var(--bs-border-color,#ccd);border-radius:10px;background:#fff" srcdoc="${esc(srcdoc)}"></iframe></div>
    <div class="d-flex flex-wrap gap-2 mb-2"><button class="btn btn-brand btn-lg" type="button" id="hp-publish-btn">Publish now</button><button class="btn btn-ghost btn-lg" type="button" id="hp-draft-btn">Save as draft</button></div>
    <p class="small text-secondary" id="hp-status" role="status"></p><div id="hp-result"></div>`;
    wireImageChecks();
    detected.images.forEach(async (im, i) => { const row = document.querySelector(`[data-img-row="${i}"] span`); if (!row) return; if (im.fixed === 'embedded') { row.textContent = '✔'; row.className = 'text-success'; return; } const ok = await checkImage(im.fixed); if (row) { row.textContent = ok ? '✔ loads' : '⚠ does not load'; row.className = ok ? 'text-success' : 'text-warning'; } });
    document.querySelector('[data-hp-upload]').addEventListener('change', async (e) => { try { const file = e.target.files[0]; if (!file) return; const crop = await cropImage(file, 1200, 675); const media = await uploadImage(crop); $('hp-image').value = media.public_url; $('hp-image').dispatchEvent(new Event('input')); toast('Image uploaded.'); } catch (err) { toast(errText(err)); } });
    $('hp-publish-btn').addEventListener('click', () => submit('published'));
    $('hp-draft-btn').addEventListener('click', () => submit('draft'));
  }

  async function submit(status) {
    const val = (id) => $(id).value.trim();
    const csv = (id) => val(id).split(',').map((t) => t.trim()).filter(Boolean);
    if (!val('hp-title')) { toast('A title is required.'); return; }
    if (!val('hp-category')) { toast('Choose a category.'); $('hp-category').focus(); return; }
    const buttons = [$('hp-publish-btn'), $('hp-draft-btn')]; buttons.forEach((b) => { b.disabled = true; });
    const statusLine = $('hp-status');
    try {
      const html = await uploadEmbeddedImages(input.value, (msg) => { statusLine.textContent = msg; });
      statusLine.textContent = status === 'published' ? 'Publishing…' : 'Saving draft…';
      const num = (id) => (val(id) === '' ? null : Number(val(id)));
      const fields = {
        title: val('hp-title'), slug: val('hp-slug') || undefined, category_id: val('hp-category'), excerpt: val('hp-excerpt') || null,
        featured_image_url: val('hp-image') || null, featured_image_alt: val('hp-alt') || null, tags: csv('hp-tags'), seo_keywords: csv('hp-keywords'),
        seo_title: val('hp-seo-title') || null, seo_description: val('hp-seo-desc') || null, author_name: val('hp-author') || null,
        game_id: val('hp-game') || null, content_type: val('hp-type'), platform: val('hp-platform') || null,
        android_min_version: val('hp-android') || null, emulator_version: val('hp-emulator') || null, min_ram_gb: num('hp-ram'), storage_mb: num('hp-storage'),
        tested_devices: csv('hp-devices'), compatibility_notes: val('hp-notes') || null,
        last_tested_at: val('hp-tested') ? new Date(val('hp-tested')).toISOString() : null, published_at: val('hp-publish') ? new Date(val('hp-publish')).toISOString() : null,
        is_premium: $('hp-premium').checked, featured: $('hp-featured').checked, ads_disabled: $('hp-noads').checked,
      };
      const result = await api('/admin/html-posts', { method: 'POST', body: JSON.stringify({ html, fields, status }) });
      statusLine.textContent = '';
      const live = result.status === 'published' && !(fields.published_at && Date.parse(fields.published_at) > Date.now());
      $('hp-result').innerHTML = `<div class="alert alert-success"><strong>${live ? 'Published!' : result.status === 'published' ? 'Scheduled.' : 'Draft saved.'}</strong> ${live ? `Your post is live in Posts: <a href="${esc(result.url)}" target="_blank" rel="noopener">${esc(result.url)}</a>` : 'You can find it in Posts.'} <a class="ms-2" href="/admin/posts/${esc(result.post.id)}">Edit in Posts</a> <button class="btn btn-sm btn-ghost ms-2" type="button" id="hp-next">Add another HTML post</button></div>`;
      $('hp-next').addEventListener('click', () => { input.value = ''; $('hp-review').innerHTML = ''; count(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
      toast(live ? 'Post published.' : 'Saved.');
    } catch (error) { statusLine.textContent = ''; toast(errText(error)); buttons.forEach((b) => { b.disabled = false; }); return; }
    buttons.forEach((b) => { b.disabled = true; });
  }
}


// ---- Analytics: all-time views per page and for the whole site, countries, devices, browsers ----
async function analyticsView() {
  const days = 30;
  const d = await api(`/admin/analytics?days=${days}`);
  const n = (v) => Number(v || 0).toLocaleString();
  let region; try { region = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { region = null; }
  const countryName = (c) => (c === 'XX' ? 'Unknown' : (region?.of(c) || c));
  const card = (label, value, hint = '') => `<div class="col-6 col-xl-3"><div class="card-surface p-3 h-100"><span class="small text-secondary">${esc(label)}</span><strong class="display-6 d-block">${esc(value)}</strong>${hint ? `<span class="small text-secondary">${esc(hint)}</span>` : ''}</div></div>`;
  const total = Number(d.total_views) || 0;
  const bar = (rows, label) => { const max = Math.max(1, ...rows.map((r) => Number(r.views))); return rows.length ? rows.map((r) => `<div class="mb-2"><div class="d-flex justify-content-between small"><span>${esc(label(r))}</span><span>${n(r.views)} <span class="text-secondary">(${total ? Math.round((Number(r.views) / total) * 100) : 0}%)</span></span></div><div style="height:8px;border-radius:6px;background:rgba(128,128,128,.2)"><div style="height:8px;border-radius:6px;background:#0d6efd;width:${(Number(r.views) / max) * 100}%"></div></div></div>`).join('') : '<p class="text-secondary mb-0">No data yet.</p>'; };
  const series = d.daily || []; const maxDay = Math.max(1, ...series.map((r) => Number(r.views)));
  const chart = series.length ? `<div class="d-flex align-items-end gap-1" style="height:140px" role="img" aria-label="Views per day, last ${days} days">${series.map((r) => `<div title="${esc(r.day)}: ${n(r.views)} views" style="flex:1;min-width:3px;border-radius:4px 4px 0 0;background:#0d6efd;height:${Math.max(3, (Number(r.views) / maxDay) * 100)}%"></div>`).join('')}</div><div class="d-flex justify-content-between small text-secondary mt-1"><span>${esc(series[0].day)}</span><span>${esc(series[series.length - 1].day)}</span></div>` : '<p class="text-secondary mb-0">No views recorded yet.</p>';
  shell(chrome('analytics', `
    <div class="row g-3 mb-4">${card('Total website views (all time)', n(d.total_views), d.tracking_since ? `since ${d.tracking_since}` : 'counting starts after deploy')}${card('Today', n(d.views_today))}${card('Last 7 days', n(d.views_7d))}${card('Last 30 days', n(d.views_30d))}</div>
    <div class="card-surface p-4 mb-4"><h2 class="h5">Views per day (last ${days} days)</h2>${chart}</div>
    <div class="row g-3 mb-4">
      <div class="col-lg-4"><div class="card-surface p-4 h-100"><h2 class="h5">Countries</h2>${bar((d.countries || []).slice(0, 12), (r) => countryName(r.country))}</div></div>
      <div class="col-lg-4"><div class="card-surface p-4 h-100"><h2 class="h5">Devices used</h2>${bar(d.devices || [], (r) => ({ mobile: 'Phone', tablet: 'Tablet', desktop: 'Desktop / laptop' }[r.device] || r.device))}</div></div>
      <div class="col-lg-4"><div class="card-surface p-4 h-100"><h2 class="h5">Browsers</h2>${bar(d.browsers || [], (r) => r.browser)}</div></div>
    </div>
    <div class="card-surface p-4 mb-4"><div class="d-flex flex-wrap justify-content-between gap-2 mb-2"><h2 class="h5 mb-0">Total views per page (all time)</h2><input class="form-control" style="max-width:260px" id="an-filter" type="search" placeholder="Filter pages…" aria-label="Filter pages"></div>
      <div class="table-responsive"><table class="table table-sm align-middle mb-0"><thead><tr><th>Page</th><th class="text-end">All time</th><th class="text-end">Last 30 days</th></tr></thead><tbody id="an-rows">${(d.pages || []).map((r) => `<tr data-path="${esc(r.path)}"><td><a href="${esc(r.path)}" target="_blank" rel="noopener">${esc(r.path)}</a></td><td class="text-end">${n(r.views)}</td><td class="text-end">${n(r.views_30d)}</td></tr>`).join('') || '<tr><td colspan="3" class="text-secondary">No views recorded yet.</td></tr>'}</tbody></table></div>
      <p class="small text-secondary mt-2 mb-0">Shows the 300 most viewed pages. Views are counted when a page finishes loading in a real browser; bots and visitors who send Do Not Track are skipped. Only the page, country, device type and browser are stored: no IP address or cookie.</p></div>
    <div class="card-surface p-3"><label class="form-check"><input class="form-check-input" type="checkbox" id="an-skip"> <span class="form-check-label">Don't count my own visits in this browser</span></label></div>`));
  document.getElementById('an-filter').addEventListener('input', (e) => { const q = e.target.value.trim().toLowerCase(); document.querySelectorAll('#an-rows tr[data-path]').forEach((tr) => { tr.hidden = q && !tr.dataset.path.includes(q); }); });
  const skip = document.getElementById('an-skip'); try { skip.checked = localStorage.getItem('etg_no_track') === '1'; } catch { /* ignore */ }
  skip.addEventListener('change', () => { try { if (skip.checked) localStorage.setItem('etg_no_track', '1'); else localStorage.removeItem('etg_no_track'); toast(skip.checked ? 'Your visits will not be counted in this browser.' : 'Your visits will be counted again.'); } catch { toast('This browser blocked the setting.'); } });
}

// ---- Health & security: live checks, never a made-up score ----
async function healthView() {
  const d = await api('/admin/health');
  const row = (label, ok, detail = '') => `<tr><td>${esc(label)}</td><td>${ok === null ? '<span class="text-secondary">—</span>' : ok ? '<span class="text-success">✔ OK</span>' : '<span class="text-warning">⚠ Check</span>'}</td><td class="small text-secondary">${esc(detail)}</td></tr>`;
  const sb = d.supabase || {}; const checks = sb.checks || {}; const sec = d.security; const cfg = d.config || {};
  const none = (arr) => !arr || arr.length === 0;
  const health = [
    row('Database', sb.status === 'ok', checks.database?.ms != null ? `${checks.database.ms} ms${checks.database.version ? ` · schema ${checks.database.version}` : ''}` : (sb.database || '')),
    ...Object.entries(checks).filter(([k]) => k !== 'database').map(([k, v]) => row(k.replaceAll('_', ' '), Boolean(v?.ok), v?.ms != null ? `${v.ms} ms` : '')),
    row('Website address is HTTPS', cfg.app_url_https, cfg.app_url_https ? '' : 'Set APP_URL to your https:// address in Vercel.'),
    row('Email sending configured', cfg.email_configured, cfg.email_configured ? '' : 'The email service key is not set in Vercel.'),
    row('Payments configured', Boolean(cfg.payments?.paypal || cfg.payments?.pesapal), `PayPal: ${cfg.payments?.paypal ? 'yes' : 'no'} · Pesapal: ${cfg.payments?.pesapal ? 'yes' : 'no'}`),
    row('AI provider keys', Boolean(cfg.ai_keys?.gemini || cfg.ai_keys?.groq), `Gemini: ${cfg.ai_keys?.gemini ? 'yes' : 'no'} · Groq: ${cfg.ai_keys?.groq ? 'yes' : 'no'}`),
  ].join('');
  const security = sec ? [
    row('Every table has Row Level Security', none(sec.tables_without_rls), none(sec.tables_without_rls) ? `${sec.tables_total} tables, ${sec.policies_total} policies` : `Without RLS: ${sec.tables_without_rls.join(', ')}`),
    row('Database functions pin their search path', none(sec.definer_functions_without_search_path), none(sec.definer_functions_without_search_path) ? '' : sec.definer_functions_without_search_path.join(', ')),
    row('Admin accounts', null, `${sec.admins} admin account(s)`),
    row('Accounts with a permanent premium role', null, `${sec.premium_role_accounts} (these never expire; trials use dates instead)`),
  ].join('') : row('Security report', false, 'Run the analytics migration (20261107100000) in Supabase.');
  shell(chrome('health', `<div class="card-surface p-4 mb-4"><h2 class="h5">Site health <span class="small text-secondary">checked ${esc(new Date(d.checked_at).toLocaleString())}</span></h2><div class="table-responsive"><table class="table table-sm align-middle mb-0"><tbody>${health}</tbody></table></div></div>
    <div class="card-surface p-4 mb-4"><h2 class="h5">Security checks</h2><div class="table-responsive"><table class="table table-sm align-middle mb-0"><tbody>${security}</tbody></table></div></div>
    <div class="card-surface p-4"><h2 class="h5">Vulnerability scanning</h2><p class="mb-0 text-secondary">A website cannot scan itself reliably, so no score is shown here. Turn on <strong>Dependabot alerts</strong> and <strong>secret scanning</strong> in your GitHub repository settings (Security tab), and run <code>npm audit</code> before releases.</p></div>`));
}

async function mediaView() {
  const { items, meta } = await api('/admin/media?limit=48');
  shell(chrome('media', `<div class="card-surface p-4 mb-4"><label class="form-label" for="media-file">Upload image (JPEG, PNG, WebP or GIF; large photos are resized automatically)</label><input class="form-control" id="media-file" type="file" accept="image/*"></div>${items.length ? `<div class="row g-3">${items.map((m) => `<div class="col-6 col-md-3"><div class="card-surface p-2 h-100"><img class="w-100 rounded" src="${esc(m.public_url)}" alt="${esc(m.alt_text || '')}" loading="lazy"><input class="form-control form-control-sm mt-2" readonly value="${esc(m.public_url)}" aria-label="Image URL"><button class="btn btn-sm btn-ghost mt-2 w-100" data-delete="${m.id}">Delete</button></div></div>`).join('')}</div>` : '<div class="empty-state">No media uploaded yet.</div>'}<p class="small text-secondary mt-3">${meta.total} files</p>`));
  document.getElementById('media-file').addEventListener('change', async (e) => { try { await uploadImage(e.target.files[0]); toast('Uploaded.'); await renderAdmin(window.location.pathname); } catch (error) { toast(error.message); } });
  document.querySelectorAll('[data-delete]').forEach((b) => b.addEventListener('click', async () => { if (!window.confirm('Delete this image? Posts that use it will show a broken image.')) return; try { await api(`/admin/media/${b.dataset.delete}`, { method: 'DELETE' }); await renderAdmin(window.location.pathname); } catch (error) { toast(errText(error)); } }));
}

async function homepageView() {
  const [home, { items: posts }] = await Promise.all([api('/admin/settings/homepage'), api('/admin/posts?limit=100&status=published')]);
  const h = home || { sections: [] }; const sections = (h.sections || []).slice();
  const heroField = (name, label, type = 'text') => `<div class="mb-3"><label class="form-label small text-secondary" for="h-${name}">${label}</label><input class="form-control" id="h-${name}" type="${type}" value="${esc(h[name] ?? '')}"></div>`;
  const draw = () => {
    shell(chrome('homepage', `<form id="home-form" class="card-surface p-4 p-lg-5" novalidate><h2 class="h4 mb-4">Hero</h2>${heroField('hero_title', 'Headline')}<div class="mb-3"><label class="form-label small text-secondary" for="h-hero_description">Description</label><textarea class="form-control" id="h-hero_description" rows="3">${esc(h.hero_description ?? '')}</textarea></div><div class="row"><div class="col-md-6">${heroField('cta_label', 'Primary button text')}</div><div class="col-md-6">${heroField('cta_url', 'Primary button link')}</div><div class="col-md-6">${heroField('secondary_cta_label', 'Secondary button text')}</div><div class="col-md-6">${heroField('secondary_cta_url', 'Secondary button link')}</div></div><h2 class="h4 my-4">Content</h2><div class="row"><div class="col-md-6 mb-3"><label class="form-label small text-secondary" for="h-featured_post_slug">Featured post</label><select class="form-select" id="h-featured_post_slug"><option value="">Latest featured post</option>${posts.map((p) => `<option value="${esc(p.slug)}" ${p.slug === h.featured_post_slug ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}</select></div><div class="col-md-6">${heroField('latest_post_count', 'Latest posts to show (1-24)', 'number')}</div></div><h2 class="h4 my-4">Sections (order and visibility)</h2>${sections.map((s, i) => `<fieldset class="card-surface p-3 mb-3" data-section="${i}"><legend class="h6 float-none px-1">${esc(s.key)}</legend><div class="form-check mb-2"><input class="form-check-input" type="checkbox" id="s-${i}-enabled" ${s.enabled !== false ? 'checked' : ''}><label class="form-check-label" for="s-${i}-enabled">Show on homepage</label></div><div class="row g-2"><div class="col-md-4"><input class="form-control" id="s-${i}-eyebrow" placeholder="Eyebrow" aria-label="Eyebrow" value="${esc(s.eyebrow ?? '')}"></div><div class="col-md-8"><input class="form-control" id="s-${i}-title" placeholder="Title" aria-label="Title" value="${esc(s.title ?? '')}"></div>${['latest', 'newsletter'].includes(s.key) ? `<div class="col-12"><input class="form-control" id="s-${i}-description" placeholder="Description" aria-label="Description" value="${esc(s.description ?? '')}"></div>` : ''}${s.key === 'youtube' ? `<div class="col-12"><input class="form-control" id="s-${i}-video_id" placeholder="YouTube video ID (11 characters)" aria-label="YouTube video ID" value="${esc(s.video_id ?? '')}"></div>` : ''}</div><div class="mt-2"><button type="button" class="btn btn-sm btn-ghost" data-up="${i}" ${i === 0 ? 'disabled' : ''}>▲ Up</button> <button type="button" class="btn btn-sm btn-ghost" data-down="${i}" ${i === sections.length - 1 ? 'disabled' : ''}>▼ Down</button></div></fieldset>`).join('')}<button class="btn btn-brand" type="submit">Save homepage</button></form>`));
    const read = () => { for (const k of ['hero_title', 'hero_description', 'cta_label', 'cta_url', 'secondary_cta_label', 'secondary_cta_url']) h[k] = document.getElementById(`h-${k}`).value; h.latest_post_count = Number(document.getElementById('h-latest_post_count').value) || 6; h.featured_post_slug = document.getElementById('h-featured_post_slug').value || null; sections.forEach((s, i) => { s.enabled = document.getElementById(`s-${i}-enabled`).checked; for (const k of ['eyebrow', 'title', 'description', 'video_id']) { const el = document.getElementById(`s-${i}-${k}`); if (el) s[k] = el.value || null; } }); };
    const swap = (i, j) => { read(); [sections[i], sections[j]] = [sections[j], sections[i]]; draw(); };
    document.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => swap(Number(b.dataset.up), Number(b.dataset.up) - 1)));
    document.querySelectorAll('[data-down]').forEach((b) => b.addEventListener('click', () => swap(Number(b.dataset.down), Number(b.dataset.down) + 1)));
    document.getElementById('home-form').addEventListener('submit', async (e) => { e.preventDefault(); read(); try { await api('/admin/settings/homepage', { method: 'PUT', body: JSON.stringify({ ...h, sections }) }); toast('Homepage saved. Reload the site to see it.'); } catch (error) { toast(errText(error)); } });
  };
  draw();
}

async function premiumView() {
  const p = (await api('/admin/settings/premium')) || {};
  shell(chrome('premium', `<form id="premium-form" class="card-surface p-4 p-lg-5" novalidate><h2 class="h4 mb-4">Premium settings</h2><div class="mb-3"><label class="form-label small text-secondary" for="p-status">Status</label><select class="form-select" id="p-status">${['coming_soon', 'available'].map((s) => `<option ${p.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div><div class="mb-3"><label class="form-label small text-secondary" for="p-price">Price label</label><input class="form-control" id="p-price" value="${esc(p.price_label ?? '')}"></div><div class="mb-3"><label class="form-label small text-secondary" for="p-period">Billing period label</label><input class="form-control" id="p-period" value="${esc(p.period ?? '')}"></div><div class="mb-3"><label class="form-label small text-secondary" for="p-trial">Trial length in days (applies to new verifications)</label><input class="form-control" id="p-trial" type="number" min="0" max="30" value="${esc(p.trial_days ?? 3)}"></div><button class="btn btn-brand" type="submit">Save</button></form>`));
  document.getElementById('premium-form').addEventListener('submit', async (e) => { e.preventDefault(); try { await api('/admin/settings/premium', { method: 'PUT', body: JSON.stringify({ status: document.getElementById('p-status').value, price_label: document.getElementById('p-price').value, period: document.getElementById('p-period').value, trial_days: Number(document.getElementById('p-trial').value) }) }); toast('Saved.'); } catch (error) { toast(errText(error)); } });
}

async function usersView() {
  const p = qs(); const q = p.get('q') || ''; const offset = Number(p.get('offset')) || 0;
  const { items, meta } = await api(`/admin/users?limit=25&offset=${offset}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  shell(chrome('users', `<form id="search-form" class="d-flex gap-2 mb-3"><input class="form-control" id="admin-q" type="search" placeholder="Search by display name" value="${esc(q)}" aria-label="Search users"><button class="btn btn-ghost" type="submit">Search</button></form><div class="table-responsive card-surface"><table class="table table-dark table-borderless align-middle mb-0"><thead><tr><th scope="col">Name</th><th scope="col">Joined</th><th scope="col">Trial ends</th><th scope="col">Role</th><th></th></tr></thead><tbody>${items.map((u) => `<tr><td>${esc(u.display_name || u.id)}</td><td>${dateOrDash(u.created_at)}</td><td>${dateOrDash(u.trial_ends_at)}</td><td><select class="form-select form-select-sm" data-role-for="${u.id}" aria-label="Role" ${u.id === state.user.id ? 'disabled' : ''}>${['free_user', 'premium_user', 'admin'].map((r) => `<option ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></td><td><button class="btn btn-sm btn-ghost" data-save-role="${u.id}" ${u.id === state.user.id ? 'disabled' : ''}>Save</button></td></tr>`).join('')}</tbody></table></div><p class="small text-secondary mt-3">${meta.total} users. Emails are managed by Supabase Auth and are not shown here.</p>${offset + 25 < meta.total ? `<a class="section-link" href="/admin/users?offset=${offset + 25}${q ? `&q=${encodeURIComponent(q)}` : ''}">Next</a>` : ''}`));
  document.getElementById('search-form').addEventListener('submit', (e) => { e.preventDefault(); window.history.pushState({}, '', `/admin/users?q=${encodeURIComponent(document.getElementById('admin-q').value)}`); renderAdmin(window.location.pathname); });
  document.querySelectorAll('[data-save-role]').forEach((b) => b.addEventListener('click', async () => { const role = document.querySelector(`[data-role-for="${b.dataset.saveRole}"]`).value; if (!window.confirm(`Change this user's role to ${role}?`)) return; try { await api(`/admin/users/${b.dataset.saveRole}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }); toast('Role updated.'); } catch (error) { toast(errText(error)); } }));
}

async function auditView() {
  const offset = Number(qs().get('offset')) || 0;
  const { items, meta } = await api(`/admin/audit-logs?limit=50&offset=${offset}`);
  shell(chrome('audit', `${items.length ? `<div class="table-responsive card-surface"><table class="table table-dark table-borderless align-middle mb-0 small"><thead><tr><th scope="col">When</th><th scope="col">Action</th><th scope="col">Target</th><th scope="col">Details</th></tr></thead><tbody>${items.map((r) => `<tr><td class="text-nowrap">${esc(new Date(r.created_at).toLocaleString())}</td><td>${esc(r.action)}</td><td>${esc(r.target_type || '')} ${esc(r.target_id || '')}</td><td><code>${esc(JSON.stringify(r.metadata))}</code></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">No activity recorded yet.</div>'}<div class="mt-3 small text-secondary">${meta.total} entries ${offset + 50 < meta.total ? `<a class="section-link ms-3" href="/admin/audit?offset=${offset + 50}">Older</a>` : ''}</div>`));
}

const pager = (path, offset, limit, total, extra = '') => `<div class="d-flex justify-content-between mt-3 small text-secondary"><span>${total} total</span><span>${offset > 0 ? `<a class="section-link me-3" href="${path}?offset=${Math.max(offset - limit, 0)}${extra}">Previous</a>` : ''}${offset + limit < total ? `<a class="section-link" href="${path}?offset=${offset + limit}${extra}">Next</a>` : ''}</span></div>`;
const statusSelect = (id, current, values) => `<select class="form-select" id="${id}" aria-label="Status"><option value="">All statuses</option>${values.map((v) => `<option ${v === current ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
function bindSearch(path) { document.getElementById('search-form').addEventListener('submit', (e) => { e.preventDefault(); const s = document.getElementById('admin-status')?.value; window.history.pushState({}, '', `${path}?${new URLSearchParams({ q: document.getElementById('admin-q').value, ...(s ? { status: s } : {}) })}`); renderAdmin(window.location.pathname); }); }

async function messagesView(id) {
  if (id) {
    const m = await api(`/admin/messages/${id}`);
    if (m.status === 'unread') api(`/admin/messages/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'read' }) }).catch(() => {});
    shell(chrome('messages', `<div class="card-surface p-4 mb-3"><div class="d-flex flex-wrap justify-content-between gap-2"><div><h2 class="h5 mb-1">${esc(m.subject)}</h2><div class="small text-secondary">${esc(m.name)} &lt;${esc(m.email)}&gt; · ${esc(new Date(m.created_at).toLocaleString())} · <strong>${esc(m.status)}</strong></div></div><div><button class="btn btn-sm btn-ghost" id="archive-btn">Archive</button> <button class="btn btn-sm btn-ghost" id="delete-btn">Delete</button></div></div><p class="mt-3 mb-0" style="white-space:pre-wrap">${esc(m.message)}</p></div>${m.replies.map((r) => `<div class="card-surface p-3 mb-3 ms-lg-5"><div class="small text-secondary mb-1">Your reply · ${esc(new Date(r.created_at).toLocaleString())}</div><div style="white-space:pre-wrap">${esc(r.body)}</div></div>`).join('')}<form id="reply-form" class="card-surface p-4" novalidate><label class="form-label small text-secondary" for="reply-body">Reply to ${esc(m.email)} (sent by email)</label><textarea class="form-control mb-3" id="reply-body" rows="6" maxlength="5000" required></textarea><button class="btn btn-brand" type="submit">Send reply</button> <a class="btn btn-ghost" href="/admin/messages">Back</a></form>`));
    document.getElementById('reply-form').addEventListener('submit', async (e) => { e.preventDefault(); const b = e.target.querySelector('button[type="submit"]'); b.disabled = true; try { await api(`/admin/messages/${id}/reply`, { method: 'POST', body: JSON.stringify({ body: document.getElementById('reply-body').value }) }); toast('Reply sent.'); await renderAdmin(window.location.pathname); } catch (error) { toast(errText(error)); b.disabled = false; } });
    document.getElementById('archive-btn').addEventListener('click', async () => { try { await api(`/admin/messages/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'archived' }) }); window.history.pushState({}, '', '/admin/messages'); await renderAdmin('/admin/messages'); } catch (error) { toast(errText(error)); } });
    document.getElementById('delete-btn').addEventListener('click', async () => { if (!window.confirm('Delete this message and its history?')) return; try { await api(`/admin/messages/${id}`, { method: 'DELETE' }); window.history.pushState({}, '', '/admin/messages'); await renderAdmin('/admin/messages'); } catch (error) { toast(errText(error)); } });
    return;
  }
  const p = qs(); const q = p.get('q') || ''; const status = p.get('status') || ''; const offset = Number(p.get('offset')) || 0;
  const { items, meta } = await api(`/admin/messages?limit=25&offset=${offset}${q ? `&q=${encodeURIComponent(q)}` : ''}${status ? `&status=${encodeURIComponent(status)}` : ''}`);
  shell(chrome('messages', `<form id="search-form" class="d-flex gap-2 mb-3"><input class="form-control" id="admin-q" type="search" placeholder="Search name, email or subject" value="${esc(q)}" aria-label="Search">${statusSelect('admin-status', status, ['unread', 'read', 'replied', 'archived'])}<button class="btn btn-ghost" type="submit">Search</button></form>${items.length ? `<div class="table-responsive card-surface"><table class="table table-dark table-borderless align-middle mb-0"><thead><tr><th scope="col">From</th><th scope="col">Subject</th><th scope="col">Status</th><th scope="col">Received</th><th></th></tr></thead><tbody>${items.map((m) => `<tr><td>${esc(m.name)}<div class="small text-secondary">${esc(m.email)}</div></td><td>${m.status === 'unread' ? '<strong>' : ''}${esc(m.subject)}${m.status === 'unread' ? '</strong>' : ''}</td><td>${esc(m.status)}</td><td>${esc(new Date(m.created_at).toLocaleDateString())}</td><td class="text-end"><a class="btn btn-sm btn-ghost" href="/admin/messages/${m.id}">Open</a></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">No messages.</div>'}${pager('/admin/messages', offset, 25, meta.total, `${q ? `&q=${encodeURIComponent(q)}` : ''}${status ? `&status=${encodeURIComponent(status)}` : ''}`)}`));
  bindSearch('/admin/messages');
}

async function subscribersView() {
  const p = qs(); const q = p.get('q') || ''; const status = p.get('status') || ''; const offset = Number(p.get('offset')) || 0;
  const { items, meta } = await api(`/admin/subscribers?limit=25&offset=${offset}${q ? `&q=${encodeURIComponent(q)}` : ''}${status ? `&status=${encodeURIComponent(status)}` : ''}`);
  shell(chrome('subscribers', `<div class="d-flex flex-wrap justify-content-between gap-2 mb-3"><form id="search-form" class="d-flex gap-2"><input class="form-control" id="admin-q" type="search" placeholder="Search email" value="${esc(q)}" aria-label="Search">${statusSelect('admin-status', status, ['pending', 'active', 'unsubscribed'])}<button class="btn btn-ghost" type="submit">Search</button></form><button class="btn btn-ghost" id="export-btn" type="button">Export CSV</button></div>${items.length ? `<div class="table-responsive card-surface"><table class="table table-dark table-borderless align-middle mb-0"><thead><tr><th scope="col">Email</th><th scope="col">Status</th><th scope="col">Subscribed</th><th></th></tr></thead><tbody>${items.map((s) => `<tr><td>${esc(s.email)}</td><td>${esc(s.status)}</td><td>${esc(new Date(s.subscribed_at).toLocaleDateString())}</td><td class="text-end text-nowrap">${s.status !== 'unsubscribed' ? `<button class="btn btn-sm btn-ghost" data-unsub="${s.id}">Unsubscribe</button> ` : ''}<button class="btn btn-sm btn-ghost" data-del="${s.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">No subscribers.</div>'}${pager('/admin/subscribers', offset, 25, meta.total, `${q ? `&q=${encodeURIComponent(q)}` : ''}${status ? `&status=${encodeURIComponent(status)}` : ''}`)}<p class="small text-secondary mt-3">Only the subscriber can activate their own subscription (by confirming through the emailed link).</p>`));
  bindSearch('/admin/subscribers');
  document.getElementById('export-btn').addEventListener('click', async () => {
    try {
      const res = await fetch(`/api/v1/admin/subscribers/export${status ? `?status=${encodeURIComponent(status)}` : ''}`, { credentials:'same-origin' });
      if (!res.ok) throw new Error('Export failed.');
      const url = URL.createObjectURL(await res.blob()); const a = document.createElement('a'); a.href = url; a.download = 'subscribers.csv'; a.click(); URL.revokeObjectURL(url);
    } catch (error) { toast(error.message); }
  });
  document.querySelectorAll('[data-unsub]').forEach((b) => b.addEventListener('click', async () => { try { await api(`/admin/subscribers/${b.dataset.unsub}/unsubscribe`, { method: 'POST' }); await renderAdmin(window.location.pathname); } catch (error) { toast(errText(error)); } }));
  document.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => { if (!window.confirm('Permanently delete this subscriber?')) return; try { await api(`/admin/subscribers/${b.dataset.del}`, { method: 'DELETE' }); await renderAdmin(window.location.pathname); } catch (error) { toast(errText(error)); } }));
}

const CAMPAIGN_FIELDS = [{ name: 'subject', label: 'Subject', type: 'text', required: true }, { name: 'content_html', label: 'Content', type: 'html' }];
const fmtDay = (iso) => new Date(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
// Newsletters are sent manually and at most "daily limit" emails per day (UTC), so the free email plan is never exhausted.
function sendPanel(c, usage) {
  const p = c.progress; const s = c.schedule; const limit = s?.daily_limit ?? usage?.daily_limit ?? 30;
  const pct = p.total ? Math.round((p.sent / p.total) * 100) : 0;
  const progress = c.status === 'draft' ? '' : `<div class="progress mb-2" role="progressbar" aria-label="Sending progress" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" style="height:10px"><div class="progress-bar" style="width:${pct}%"></div></div><p class="mb-2"><strong>${p.sent}</strong> of ${p.total} sent${p.failed ? ` · ${p.failed} failed (retried automatically on later days, up to 3 tries)` : ''}${c.status === 'sent' ? ' · finished' : ''}</p>`;
  let schedule = '';
  if (s) schedule = `<p class="small mb-3">Today: <strong>${s.sent_today}</strong> of ${s.daily_limit} sent. ${s.allowance > 0 ? `${s.allowance} more can go out today.` : 'Today\'s limit is reached; sending continues with tomorrow\'s scheduled run.'} ${p.remaining ? `About <strong>${s.days_left}</strong> more sending day${s.days_left === 1 ? '' : 's'}${s.estimated_finish ? `, expected to finish around <strong>${esc(fmtDay(s.estimated_finish))}</strong>` : ''}.` : ''}</p>`;
  const buttons = [];
  if (c.status === 'draft') buttons.push('<button class="btn btn-brand" type="button" id="send-btn">Start sending</button>');
  if (c.status === 'sending') buttons.push(`<button class="btn btn-brand" type="button" id="send-btn"${s && s.allowance === 0 ? ' disabled' : ''}>Send today's batch now</button>`, '<button class="btn btn-ghost" type="button" id="pause-btn">Pause</button>');
  if (c.status === 'paused') buttons.push('<button class="btn btn-brand" type="button" id="resume-btn">Resume sending</button>');
  if (p.failed) buttons.push('<button class="btn btn-ghost" type="button" id="requeue-btn">Retry failed now</button>');
  const explain = c.status === 'draft' ? `<p class="small text-secondary">Sending starts now, but only up to <strong>${limit}</strong> emails go out per day, then it continues automatically every day until every confirmed subscriber has it. Only people who confirmed before you press Start receive this issue, and every email has an unsubscribe link. You can pause at any time.</p>` : '';
  return `<div class="card-surface p-4"><h3 class="h5">Send</h3><p class="small text-secondary mb-2">Status: <strong>${esc(c.status)}</strong></p>${progress}${schedule}${explain}<div class="d-flex flex-wrap gap-2 mb-3"><input class="form-control" style="max-width:280px" id="test-to" type="email" placeholder="test@example.com" aria-label="Test address"><button class="btn btn-ghost" type="button" id="test-btn">Send test</button></div><div class="d-flex flex-wrap gap-2 align-items-center">${buttons.join('')}<span id="send-status" role="status" class="small text-secondary"></span></div></div>`;
}
function limitCard(usage) {
  if (!usage) return '';
  return `<form id="limit-form" class="card-surface p-4 mb-4" novalidate><h3 class="h5">Daily sending limit</h3><p class="small text-secondary">Newsletters are sent from here by hand. To protect the free email plan (100 emails a day, shared with sign-up confirmations, payment receipts and contact replies), at most this many newsletter emails go out per day. A larger campaign simply continues the next day. Today: <strong>${usage.sent_today}</strong> of ${usage.daily_limit} sent.</p><div class="d-flex flex-wrap gap-2 align-items-end"><div><label class="form-label small" for="daily-limit">Emails per day</label><input class="form-control" id="daily-limit" type="number" min="1" max="1000" step="1" value="${usage.daily_limit}" style="width:140px"></div><button class="btn btn-brand" type="submit">Save limit</button></div></form>`;
}
async function newsletterView(id) {
  if (id === 'new' || id) {
    const isNew = id === 'new'; const c = isNew ? {} : await api(`/admin/newsletter/campaigns/${id}`); const editors = {}; const prog = c.progress;
    const usage = isNew ? null : await api('/admin/newsletter/usage').catch(() => null);
    const editable = isNew || c.status === 'draft';
        shell(chrome('newsletter', `<form id="admin-form" class="card-surface p-4 p-lg-5 mb-4" novalidate><h2 class="h4 mb-4">${isNew ? 'New newsletter' : esc(c.subject)}</h2>${editable ? CAMPAIGN_FIELDS.map((f) => renderField(f, c[f.name], {})).join('') : `<div class="article-body">${c.content_html}</div>`}<div class="d-flex flex-wrap gap-2">${editable ? '<button class="btn btn-brand" type="submit">Save draft</button>' : ''}<a class="btn btn-ghost" href="/admin/newsletter">Back</a>${!isNew && c.status === 'draft' ? '<button class="btn btn-ghost ms-auto" type="button" id="delete-btn">Delete</button>' : ''}</div></form>${isNew ? '' : sendPanel(c, usage)}`));
    if (editable) await mountEditors(CAMPAIGN_FIELDS, editors);
    document.getElementById('admin-form')?.addEventListener('submit', async (e) => { e.preventDefault(); try { const saved = await api(isNew ? '/admin/newsletter/campaigns' : `/admin/newsletter/campaigns/${id}`, { method: isNew ? 'POST' : 'PATCH', body: JSON.stringify(collect(CAMPAIGN_FIELDS, editors)) }); toast('Saved.'); window.history.replaceState({}, '', `/admin/newsletter/${saved.id}`); await renderAdmin(window.location.pathname); } catch (error) { toast(errText(error)); } });
    document.getElementById('delete-btn')?.addEventListener('click', async () => { if (!window.confirm('Delete this draft?')) return; try { await api(`/admin/newsletter/campaigns/${id}`, { method: 'DELETE' }); window.history.pushState({}, '', '/admin/newsletter'); await renderAdmin('/admin/newsletter'); } catch (error) { toast(errText(error)); } });
    document.getElementById('test-btn')?.addEventListener('click', async () => { try { await api(`/admin/newsletter/campaigns/${id}/test`, { method: 'POST', body: JSON.stringify({ to: document.getElementById('test-to').value }) }); toast('Test email sent.'); } catch (error) { toast(errText(error)); } });
    document.getElementById('requeue-btn')?.addEventListener('click', async () => { try { await api(`/admin/newsletter/campaigns/${id}/requeue`, { method: 'POST' }); toast('Failed deliveries are queued again and will go out within the daily limit.'); await renderAdmin(window.location.pathname); } catch (error) { toast(errText(error)); } });
    document.getElementById('pause-btn')?.addEventListener('click', async () => { try { await api(`/admin/newsletter/campaigns/${id}/pause`, { method: 'POST' }); toast('Sending paused. Nothing more goes out until you resume.'); await renderAdmin(window.location.pathname); } catch (error) { toast(errText(error)); } });
    document.getElementById('resume-btn')?.addEventListener('click', async () => { try { await api(`/admin/newsletter/campaigns/${id}/resume`, { method: 'POST' }); toast('Sending resumed.'); await renderAdmin(window.location.pathname); } catch (error) { toast(errText(error)); } });
    document.getElementById('send-btn')?.addEventListener('click', async (e) => {
      if (c.status === 'draft' && !window.confirm(`Start sending to all confirmed subscribers? Up to ${usage?.daily_limit ?? 30} emails go out per day, then it continues automatically each day until everyone has it. Subscribers who join later will not receive this issue.`)) return;
      e.target.disabled = true; const out = document.getElementById('send-status');
      try {
        if (c.status === 'draft') await api(`/admin/newsletter/campaigns/${id}/start`, { method: 'POST' });
        const r = await api(`/admin/newsletter/campaigns/${id}/send-batch`, { method: 'POST' });
        out.textContent = `Sent ${r.sent}${r.failed ? `, ${r.failed} failed` : ''}. ${r.remaining} still waiting.`;
        toast(r.status === 'sent' ? 'Newsletter finished: everyone has it.' : r.sent ? `Sent ${r.sent} today. The rest continue automatically each day.` : 'Today\'s limit is already reached. Sending continues tomorrow.');
      } catch (error) { toast(errText(error)); }
      await renderAdmin(window.location.pathname);
    });
    return;
  }
  const usage = await api('/admin/newsletter/usage').catch(() => null);
  const offset = Number(qs().get('offset')) || 0; const { items, meta } = await api(`/admin/newsletter/campaigns?limit=25&offset=${offset}`);
  shell(chrome('newsletter', `${limitCard(usage)}<div class="d-flex justify-content-end mb-3"><a class="btn btn-brand" href="/admin/newsletter/new">New newsletter</a></div>${items.length ? `<div class="table-responsive card-surface"><table class="table table-dark table-borderless align-middle mb-0"><thead><tr><th scope="col">Subject</th><th scope="col">Status</th><th scope="col">Created</th><th></th></tr></thead><tbody>${items.map((c) => `<tr><td>${esc(c.subject)}</td><td>${esc(c.status)}</td><td>${esc(new Date(c.created_at).toLocaleDateString())}</td><td class="text-end"><a class="btn btn-sm btn-ghost" href="/admin/newsletter/${c.id}">Open</a></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">No newsletters yet.</div>'}${pager('/admin/newsletter', offset, 25, meta.total)}`));
  document.getElementById('limit-form')?.addEventListener('submit', async (e) => { e.preventDefault(); try { await api('/admin/settings/newsletter-sending', { method: 'PUT', body: JSON.stringify({ daily_limit: Number(document.getElementById('daily-limit').value) }) }); toast('Daily limit saved.'); await renderAdmin(window.location.pathname); } catch (error) { toast(errText(error)); } });
}

async function emailLogView() {
  const offset = Number(qs().get('offset')) || 0; const { items, meta } = await api(`/admin/email-events?limit=50&offset=${offset}`);
  shell(chrome('email-log', `${items.length ? `<div class="table-responsive card-surface"><table class="table table-dark table-borderless align-middle mb-0 small"><thead><tr><th scope="col">When</th><th scope="col">Type</th><th scope="col">To</th><th scope="col">Result</th></tr></thead><tbody>${items.map((r) => `<tr><td class="text-nowrap">${esc(new Date(r.created_at).toLocaleString())}</td><td>${esc(r.type)}</td><td>${esc(r.to_email)}</td><td>${esc(r.status)}${r.error ? ` — ${esc(r.error)}` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">No emails sent yet.</div>'}${pager('/admin/email-log', offset, 50, meta.total)}`));
}

async function paymentsView(id) {
  if (id) {
    const p = await api(`/admin/payments/${id}`);
    shell(chrome('payments', `<div class="card-surface p-4"><h2 class="h5 mb-3">Payment</h2><dl class="row small mb-0">${[['Status', p.status], ['Amount', `${p.currency} ${p.amount}`], ['Plan', p.metadata?.plan_name], ['User', p.profiles?.display_name || p.user_id], ['Provider', p.provider === 'pesapal' ? 'PesaPal' : p.provider === 'paypal' ? 'PayPal' : p.provider], ['Merchant reference', p.merchant_reference], ['Provider tracking id', p.provider_order_id], ['Transaction', p.transaction_id], ['Payment method', p.metadata?.payment_method || p.payment_method], ['Failure reason', p.failure_reason], ['Created', new Date(p.created_at).toLocaleString()], ['Completed', p.completed_at ? new Date(p.completed_at).toLocaleString() : '—']].map(([k, v]) => `<dt class="col-sm-3">${k}</dt><dd class="col-sm-9">${esc(v ?? '—')}</dd>`).join('')}<dt class="col-sm-3">Provider events</dt><dd class="col-sm-9">${p.events.length ? p.events.map((e) => `${esc(e.event_type)}${e.processed === false ? ' (unprocessed' + (e.error_message ? ': ' + esc(e.error_message) : '') + ')' : ''} (${esc(new Date(e.received_at).toLocaleString())})`).join('<br>') : '—'}</dd></dl><p class="small text-secondary mt-3 mb-0">Payment status is set only by the payment provider through verified confirmations, never edited by hand. Refund customers in the provider dashboard; the provider's refund/reversal notification then ends their access automatically.</p><a class="btn btn-ghost mt-3" href="/admin/payments">Back</a></div>`));
    return;
  }
  const p = qs(); const offset = Number(p.get('offset')) || 0;
  const FILTERS = ['status', 'provider', 'currency', 'from', 'to', 'user', 'reference', 'plan'];
  const f = Object.fromEntries(FILTERS.map((k) => [k, p.get(k) || '']));
  const filterQuery = FILTERS.filter((k) => f[k]).map((k) => `&${k}=${encodeURIComponent(f[k])}`).join('');
  const [{ items, meta }, stats] = await Promise.all([api(`/admin/payments?limit=25&offset=${offset}${filterQuery}`), api('/admin/payments/analytics').catch(() => null)]);
  const money = (obj) => Object.entries(obj || {}).map(([c, t]) => `${esc(c)} ${esc(t)}`).join(' · ') || '—';
  const by = stats ? (rows, key) => (rows || []).map((r) => `<li>${esc(r[key])} (${esc(r.currency)}): ${esc(r.total)} <span class="text-secondary">· ${esc(r.payments)} payments</span></li>`).join('') || '<li>—</li>' : null;
  const panel = stats ? `<div class="row g-3 mb-4">${[
    ['Revenue (completed)', money(stats.revenue_by_currency)],
    ['Payments', ['completed', 'pending', 'failed', 'cancelled', 'refunded'].map((k) => `${k}: ${esc(stats.payments_by_status?.[k] ?? 0)}`).join(' · ')],
    ['Subscriptions', `active ${esc(stats.subscriptions?.active ?? 0)} (paid ${esc(stats.subscriptions?.active_paid ?? 0)}) · expired ${esc(stats.subscriptions?.expired ?? 0)}`],
    ['Trial conversions', `${esc(stats.trial_conversions?.converted ?? 0)} of ${esc(stats.trial_conversions?.trial_users ?? 0)} trial users paid`],
  ].map(([k, v]) => `<div class="col-md-6 col-xl-3"><div class="card-surface p-3 h-100"><div class="small text-secondary">${k}</div><div>${v}</div></div></div>`).join('')}<div class="col-md-6"><div class="card-surface p-3 h-100"><div class="small text-secondary">Revenue by provider</div><ul class="small mb-0">${by(stats.revenue_by_provider, 'provider')}</ul></div></div><div class="col-md-6"><div class="card-surface p-3 h-100"><div class="small text-secondary">Revenue by plan</div><ul class="small mb-0">${by(stats.revenue_by_plan, 'plan')}</ul></div></div></div>` : '';
  const input = (id, label, value, type = 'text') => `<input class="form-control" type="${type}" id="pf-${id}" aria-label="${label}" placeholder="${label}" value="${esc(value)}">`;
  const providerSelect = `<select class="form-select" id="pf-provider" aria-label="Provider"><option value="">All providers</option>${['pesapal', 'paypal'].map((v) => `<option value="${v}" ${v === f.provider ? 'selected' : ''}>${v === 'pesapal' ? 'PesaPal' : 'PayPal'}</option>`).join('')}</select>`;
  const statusOptions = ['pending', 'completed', 'failed', 'cancelled', 'refunded'].map((v) => `<option ${v === f.status ? 'selected' : ''}>${v}</option>`).join('');
  const form = `<form id="search-form" class="row g-2 mb-3"><div class="col-6 col-md-2">${providerSelect}</div><div class="col-6 col-md-2"><select class="form-select" id="pf-status" aria-label="Status"><option value="">All statuses</option>${statusOptions}</select></div><div class="col-6 col-md-2">${input('currency', 'Currency', f.currency)}</div><div class="col-6 col-md-2">${input('plan', 'Plan code', f.plan)}</div><div class="col-6 col-md-2">${input('from', 'From', f.from, 'date')}</div><div class="col-6 col-md-2">${input('to', 'To', f.to, 'date')}</div><div class="col-md-5">${input('reference', 'Reference / tracking id / transaction', f.reference)}</div><div class="col-md-5">${input('user', 'User id', f.user)}</div><div class="col-md-2"><button class="btn btn-ghost w-100" type="submit">Filter</button></div></form>`;
  const table = items.length ? `<div class="table-responsive card-surface"><table class="table table-dark table-borderless align-middle mb-0 small"><thead><tr><th scope="col">Date</th><th scope="col">User</th><th scope="col">Plan</th><th scope="col">Provider</th><th scope="col">Merchant ref</th><th scope="col">Tracking id</th><th scope="col">Amount</th><th scope="col">Status</th><th></th></tr></thead><tbody>${items.map((r) => `<tr><td>${esc(new Date(r.created_at).toLocaleDateString())}</td><td>${esc(r.profiles?.display_name || '—')}</td><td>${esc(r.metadata?.plan_name || '')}</td><td>${r.provider === 'pesapal' ? 'PesaPal' : r.provider === 'paypal' ? 'PayPal' : esc(r.provider)}</td><td>${esc(r.merchant_reference || '—')}</td><td class="text-break">${esc(r.provider_order_id || '—')}</td><td>${esc(r.currency)} ${esc(r.amount)}</td><td>${esc(r.status)}</td><td class="text-end"><a class="btn btn-sm btn-ghost" href="/admin/payments/${r.id}">Details</a></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">No payments match.</div>';
  shell(chrome('payments', `${panel}${form}${table}${pager('/admin/payments', offset, 25, meta.total, filterQuery)}`));
  document.getElementById('search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const next = new URLSearchParams();
    FILTERS.forEach((k) => { const v = document.getElementById(`pf-${k}`)?.value.trim(); if (v) next.set(k, v); });
    window.history.pushState({}, '', `/admin/payments${next.toString() ? `?${next}` : ''}`);
    renderAdmin(window.location.pathname);
  });
}

async function subscriptionsView() {
  const p = qs(); const status = p.get('status') || ''; const offset = Number(p.get('offset')) || 0;
  const { items, meta } = await api(`/admin/subscriptions?limit=25&offset=${offset}${status ? `&status=${encodeURIComponent(status)}` : ''}`);
  const now = Date.now();
  shell(chrome('subscriptions', `<form id="grant-form" class="card-surface p-4 mb-4" novalidate><h2 class="h5 mb-3">Grant complimentary access</h2><div class="row g-2"><div class="col-md-5"><input class="form-control" id="grant-user" placeholder="User ID (from the Users tab)" aria-label="User ID"></div><div class="col-md-2"><input class="form-control" id="grant-days" type="number" min="1" max="3660" placeholder="Days" aria-label="Days"></div><div class="col-md-3"><input class="form-control" id="grant-note" placeholder="Note (optional)" aria-label="Note"></div><div class="col-md-2"><button class="btn btn-brand w-100" type="submit">Grant</button></div></div></form><form id="search-form" class="d-flex gap-2 mb-3">${statusSelect('admin-status', status, ['active', 'expired', 'cancelled'])}<input type="hidden" id="admin-q" value=""><button class="btn btn-ghost" type="submit">Filter</button></form>${items.length ? `<div class="table-responsive card-surface"><table class="table table-dark table-borderless align-middle mb-0"><thead><tr><th scope="col">User</th><th scope="col">Plan</th><th scope="col">Source</th><th scope="col">Expires</th><th scope="col">Status</th><th></th></tr></thead><tbody>${items.map((r) => { const live = r.status === 'active' && Date.parse(r.expires_at) > now; return `<tr><td>${esc(r.profiles?.display_name || r.user_id)}</td><td>${esc(r.plan)}</td><td>${esc(r.payment_provider || '')}</td><td>${esc(new Date(r.expires_at).toLocaleDateString())}</td><td>${esc(live ? 'active' : r.status === 'active' ? 'expired' : r.status)}</td><td class="text-end">${live ? `<button class="btn btn-sm btn-ghost" data-cancel="${r.id}">Cancel</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty-state">No subscriptions yet.</div>'}${pager('/admin/subscriptions', offset, 25, meta.total, status ? `&status=${encodeURIComponent(status)}` : '')}`));
  bindSearch('/admin/subscriptions');
  document.getElementById('grant-form').addEventListener('submit', async (e) => { e.preventDefault(); try { await api('/admin/subscriptions/grant', { method: 'POST', body: JSON.stringify({ user_id: document.getElementById('grant-user').value.trim(), days: Number(document.getElementById('grant-days').value), note: document.getElementById('grant-note').value }) }); toast('Access granted.'); await renderAdmin(window.location.pathname); } catch (error) { toast(errText(error)); } });
  document.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', async () => { if (!window.confirm('Cancel this subscription now? The user loses Premium immediately.')) return; try { await api(`/admin/subscriptions/${b.dataset.cancel}/cancel`, { method: 'POST' }); toast('Subscription cancelled.'); await renderAdmin(window.location.pathname); } catch (error) { toast(errText(error)); } }));
}


async function siteView() {
  const site = await api('/admin/settings/site');
  if (!site) throw new Error('Run the new Supabase migration before editing site information.');
  const fields = [
    ['brand_name', 'Brand name'], ['gaming_identity', 'Gaming identity'], ['website_url', 'Official website URL'],
    ['tagline', 'Tagline'], ['description', 'Platform description'], ['about_title', 'About page title'],
    ['about_lead', 'About page introduction'], ['about_text', 'About page body (plain text; separate paragraphs with blank lines)'],
    ['seo_title', 'SEO title'], ['seo_description', 'SEO description'], ['canonical_url', 'Canonical base URL'],
  ];
  let faqs = Array.isArray(site.contact_faqs) ? site.contact_faqs.map((faq) => ({ question: faq.question ?? '', answer: faq.answer ?? '' })) : [];
  const multiline = new Set(['description', 'about_lead', 'about_text', 'seo_description']);
  const form = `<form id="site-form" class="card-surface p-4" novalidate><p class="small text-secondary">Brand identity, About-page copy and global SEO defaults. Services, categories and social links are edited in their existing sections.</p><div class="row g-3">${fields.map(([key, label]) => `<div class="col-12 ${['brand_name', 'gaming_identity', 'website_url', 'tagline', 'seo_title', 'canonical_url'].includes(key) ? 'col-md-6' : ''}"><label class="form-label small text-secondary" for="site-${key}">${esc(label)}</label>${multiline.has(key) ? `<textarea class="form-control" id="site-${key}" rows="${key === 'about_text' || key === 'description' ? 5 : 3}">${esc(site[key] ?? '')}</textarea>` : `<input class="form-control" id="site-${key}" value="${esc(site[key] ?? '')}">`}</div>`).join('')}</div><hr class="my-4"><div class="d-flex justify-content-between align-items-center mb-3"><h3 class="h6 mb-0">Contact page FAQs</h3><button class="btn btn-sm btn-ghost" type="button" id="faq-add">Add FAQ</button></div><div id="site-faqs"></div><button class="btn btn-brand mt-3" type="submit">Save site information</button></form>`;
  shell(chrome('site', `<h2 class="h5 mb-3">Site identity, About & SEO</h2>${form}`));
  const faqContainer = document.getElementById('site-faqs');
  const drawFaqs = () => { faqContainer.innerHTML = faqs.map((faq, index) => `<fieldset class="card-surface p-3 mb-2"><legend class="visually-hidden">FAQ ${index + 1}</legend><label class="form-label small text-secondary" for="faq-q-${index}">Question</label><input class="form-control mb-2" id="faq-q-${index}" maxlength="180" value="${esc(faq.question)}"><label class="form-label small text-secondary" for="faq-a-${index}">Answer</label><textarea class="form-control mb-2" id="faq-a-${index}" rows="3" maxlength="1000">${esc(faq.answer)}</textarea><button class="btn btn-sm btn-ghost" type="button" data-faq-remove="${index}">Remove</button></fieldset>`).join('') || '<p class="small text-secondary">No FAQs. Add one if you want to show questions on the Contact page.</p>'; document.querySelectorAll('[data-faq-remove]').forEach((button) => button.addEventListener('click', () => { faqs.splice(Number(button.dataset.faqRemove), 1); drawFaqs(); })); };
  drawFaqs();
  document.getElementById('faq-add').addEventListener('click', () => { if (faqs.length >= 12) return toast('You can add up to 12 FAQs.'); faqs.push({ question: '', answer: '' }); drawFaqs(); });
  document.getElementById('site-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(fields.map(([key]) => [key, document.getElementById(`site-${key}`).value]));
    body.contact_faqs = faqs.map((_faq, index) => ({ question: document.getElementById(`faq-q-${index}`).value, answer: document.getElementById(`faq-a-${index}`).value }));
    try { await api('/admin/settings/site', { method: 'PUT', body: JSON.stringify(body) }); toast('Site information saved.'); await renderAdmin(window.location.pathname); }
    catch (error) { toast(errText(error)); }
  });
}


export async function renderAdmin(pathname) {
  if (!state.user) { shell(`${pageHero('ADMIN', 'Sign in required.', 'Log in with an administrator account.')}<section class="section"><div class="container-xl"><a class="btn btn-brand" href="/login">Log in</a></div></section>`); return; }
  if (state.user.role !== 'admin') { shell(`${pageHero('ADMIN', 'Not authorised.', 'This area is for administrators.')}`); return; }
  document.title = 'Admin — Eliahtech Gaming';
  const [, section = 'overview', id] = pathname.split('/').filter(Boolean);
  try {
    if(section==='quality'){const {qualityView}=await import('/admin-quality.js');return await qualityView({chrome});}
    if (section === 'overview') return await overviewView();
    if (section === 'html') return await htmlPostView();
    if (section === 'analytics') return await analyticsView();
    if (section === 'health') return await healthView();
    if(section==='member-benefits')return await memberBenefitsView();
    if (section === 'promotions') { const {promotionsView}=await import('/admin-promotions.js'); return await promotionsView({chrome}); }
    if (section === 'ads-settings') return await adsSettingsView();
    if (RES[section]) return await (id ? formView(section, id) : listView(section));
    if (section === 'media') return await mediaView();
    if (section === 'homepage') return await homepageView();
    if (section === 'site') return await siteView();
    if (section === 'premium') return await premiumView();
    if (section === 'ai') { const { aiView } = await import('/admin-ai.js'); const rerender = () => renderAdmin(pathname); return await aiView({ chrome, rerender }); }
    if (section === 'users') return await usersView();
    if (section === 'payments') return await paymentsView(id);
    if (section === 'subscriptions') return await subscriptionsView();
    if (section === 'messages') return await messagesView(id);
    if (section === 'subscribers') return await subscribersView();
    if (section === 'newsletter') return await newsletterView(id);
    if (section === 'email-log') return await emailLogView();
    if (section === 'audit') return await auditView();
    shell(chrome('', '<div class="empty-state">Unknown admin section.</div>'));
  } catch (error) {
    shell(chrome(section, `<div class="empty-state">${esc(errText(error))}</div>`));
  }
  return undefined;
}

async function adsSettingsView(){
 const value=await api('/admin/settings/ads');
 shell(chrome('ads-settings',`<form id="ads-switch" class="card-surface p-4"><h2>Global ads switch</h2><p>Ads apply to published posts only. Active Premium accounts receive no ads or auto-ad scripts. All other pages remain ad-free.</p><label class="form-check"><input type="checkbox" class="form-check-input" name="enabled" ${value?.enabled?'checked':''}> Enable advertising on eligible posts</label><button class="btn btn-brand mt-3">Save</button><a href="/admin/ads" class="btn btn-ghost mt-3">Manage placements</a></form>`));
 document.querySelector('#ads-switch').onsubmit=async event=>{event.preventDefault();try{await api('/admin/settings/ads',{method:'PUT',body:JSON.stringify({enabled:event.target.elements.enabled.checked})});toast('Ads setting saved.');}catch(err){toast(errText(err));}};
}
async function overviewView(){
 const sections=[['posts','Posts'],['users','Members'],['payments','Payments'],['tickets','Support tickets'],['reports','Content reports']];
 const rows=await Promise.all(sections.map(async([key,label])=>{const result=await api('/admin/'+key+'?limit=5');return {key,label,result};}));
 shell(chrome('overview',`<div class="row g-3 mb-4">${rows.map(r=>`<div class="col-sm-6 col-xl-4"><a href="/admin/${r.key}" class="card-surface d-block p-4"><span>${esc(r.label)}</span><strong class="display-6 d-block">${esc(r.result.meta?.total??r.result.items?.length??0)}</strong></a></div>`).join('')}</div><div class="card-surface p-4"><h2 class="h4">Recent posts</h2>${rows[0].result.items.map(p=>`<p><a href="/admin/posts/${p.id}">${esc(p.title)}</a> · ${esc(p.status)}</p>`).join('')}</div><div id="reader-analytics" class="card-surface p-4 mt-4"></div>`));
 const data=await api('/community/admin/analytics');document.querySelector('#reader-analytics').innerHTML='<h2 class="h4">Recent reader signals</h2>'+Object.entries(data).map(([key,items])=>`<h3 class="h6">${esc(key.replaceAll('_',' '))}</h3><p>${items.length} recent events</p>${key==='search_events'?items.slice(0,10).map(r=>`<p>${esc(r.query)} · ${r.results} results</p>`).join(''):''}`).join('');
}
function mountPostTools(id,record,cfg,editors){
 const form=document.querySelector('#admin-form'),storageKey='eliah.draft.'+state.user.id+'.'+id;
 const panel=document.createElement('section');panel.className='card-surface p-3 mb-4';panel.innerHTML=`<div class="d-flex gap-2 flex-wrap"><button type="button" class="btn btn-ghost" id="restore-local">Recover autosaved draft</button><button type="button" class="btn btn-ghost" id="live-preview">Preview current content</button>${id!=='new'?`<a class="btn btn-ghost" target="_blank" href="/preview/${id}">Private saved preview</a><button type="button" class="btn btn-ghost" id="check-post-links">Check links</button><button type="button" class="btn btn-ghost" id="load-revisions">Revision history</button>`:''}</div><p id="save-status" class="small mt-2" role="status">Changes are autosaved locally until you press Save. Existing draft posts also save a server draft.</p><div id="revisions-box"></div><iframe id="editor-preview-frame" title="Article preview" sandbox="" class="w-100 d-none" height="450"></iframe>`;form.prepend(panel);
 let timer,dirty=false;const marker=document.querySelector('#save-status');
 const save=()=>{try{const data=collect(cfg.fields,editors);localStorage.setItem(storageKey,JSON.stringify(data));marker.textContent='Local draft saved '+new Date().toLocaleTimeString();if(id!=='new'&&record.status==='draft')api('/admin/posts/'+id+'/autosave',{method:'PUT',body:JSON.stringify(data)}).then(()=>{marker.textContent='Draft backed up on server.';}).catch(err=>{marker.textContent='Local draft saved; server backup failed: '+err.message;});}catch{marker.textContent='Autosave unavailable. Press Save to keep changes.';}};
 const changed=()=>{dirty=true;clearTimeout(timer);timer=setTimeout(save,1500);};form.addEventListener('input',changed);Object.values(editors).forEach(editor=>editor.events.on('change',changed));
 document.querySelector('#restore-local').onclick=async()=>{let data;try{data=JSON.parse(localStorage.getItem(storageKey)||'null');}catch{}if(!data&&id!=='new')try{data=(await api('/admin/posts/'+id+'/autosave')).snapshot;}catch{}if(!data){toast('No saved draft found.');return;}for(const f of cfg.fields){const el=document.getElementById('f-'+f.name);if(!el||!(f.name in data))continue;if(f.type==='checkbox')el.checked=data[f.name];else if(editors[f.name])editors[f.name].value=data[f.name];else el.value=Array.isArray(data[f.name])?data[f.name].join(', '):data[f.name]??'';}dirty=true;toast('Draft recovered. Review and save.');};
 document.querySelector('#live-preview').onclick=()=>{const data=collect(cfg.fields,editors),frame=document.querySelector('#editor-preview-frame');frame.classList.remove('d-none');frame.srcdoc=`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'"><style>body{font:18px system-ui;line-height:1.7;padding:20px}img{max-width:100%;height:auto}</style><h1>${esc(data.title)}</h1><p>${esc(data.excerpt)}</p>${data.content_html||''}`;};
 document.querySelector('#load-revisions')?.addEventListener('click',async()=>{try{const rows=await api('/admin/posts/'+id+'/revisions');const box=document.querySelector('#revisions-box');box.innerHTML=rows.map(r=>`<p>${esc(r.created_at)} <button type="button" class="btn btn-sm btn-ghost" data-restore-revision="${r.id}">Restore</button></p>`).join('')||'No previous revisions.';box.onclick=async event=>{const revision=event.target.dataset.restoreRevision;if(!revision||!confirm('Restore this saved revision? The current post becomes a revision too.'))return;try{await api('/admin/posts/'+id+'/revisions/'+revision+'/restore',{method:'POST',body:'{}'});await renderAdmin(location.pathname);}catch(err){toast(err.message);}};}catch(err){toast(err.message);}});
 document.querySelector('#check-post-links')?.addEventListener('click',async event=>{event.target.disabled=true;try{const result=await api('/editorial/admin/links/check',{method:'POST',body:JSON.stringify({post_id:id})});toast(`Scanned this post; checked ${result.links_checked} queued links. Review Content quality for results.`);}catch(err){toast(err.message);}finally{event.target.disabled=false;}});
 const guard=event=>{if(dirty&&document.contains(form)){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',guard);form.addEventListener('submit',()=>{dirty=false;clearTimeout(timer);});
 const title=document.querySelector('#f-title'),slug=document.querySelector('#f-slug');if(id==='new')title.addEventListener('blur',()=>{if(!slug.value)slug.value=title.value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80);});
}

async function memberBenefitsView(){
 const data=await api('/admin/settings/member-benefits')||{};
 shell(chrome('member-benefits',`<form id="member-benefits-form" class="card-surface p-4"><h2>Gaming member benefits</h2><p>The community link is returned only to active Premium members. External Telegram membership and removal remain manual.</p><label class="form-label d-block">Private community invitation URL<input class="form-control" name="community_url" value="${esc(data.community_url||'')}" type="url"></label><label class="form-label d-block">Support hours and response target<input class="form-control" name="support_hours" value="${esc(data.support_hours||'')}" maxlength="300"></label><label class="form-label d-block">Support request allowance per member per day<input class="form-control" name="support_requests_per_day" type="number" min="1" max="20" value="${Number(data.support_requests_per_day)||5}"></label><button class="btn btn-brand">Save</button></form>`));
 document.querySelector('#member-benefits-form').onsubmit=async event=>{event.preventDefault();try{const body=Object.fromEntries(new FormData(event.target));body.community_url=body.community_url||null;body.support_requests_per_day=Number(body.support_requests_per_day);await api('/admin/settings/member-benefits',{method:'PUT',body:JSON.stringify(body)});toast('Member benefits saved.');}catch(err){toast(err.message);}};
}

function cropImage(file, width, height){
 return new Promise((resolve,reject)=>{
  const image=new Image(),url=URL.createObjectURL(file);
  image.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Could not read this image.'));};
  image.onload=()=>{
   const dialog=document.createElement('dialog');dialog.className='card-surface p-4';dialog.style.maxWidth='min(680px,95vw)';
   dialog.innerHTML=`<h2 class="h5">Crop ${width} × ${height}</h2><canvas width="${width}" height="${height}" style="width:100%;height:auto"></canvas><label class="form-label d-block">Zoom<input class="form-range" type="range" id="crop-zoom" min="1" max="3" step="0.01" value="1"></label><label class="form-label d-block">Horizontal position<input class="form-range" type="range" id="crop-x" min="0" max="100" value="50"></label><label class="form-label d-block">Vertical position<input class="form-range" type="range" id="crop-y" min="0" max="100" value="50"></label><button class="btn btn-brand" id="crop-use" type="button">Use crop</button> <button class="btn btn-ghost" id="crop-cancel" type="button">Cancel</button>`;
   document.body.append(dialog);const canvas=dialog.querySelector('canvas'),ctx=canvas.getContext('2d');
   const draw=()=>{const scale=Math.max(width/image.width,height/image.height)*Number(dialog.querySelector('#crop-zoom').value),w=image.width*scale,h=image.height*scale,x=(width-w)*Number(dialog.querySelector('#crop-x').value)/100,y=(height-h)*Number(dialog.querySelector('#crop-y').value)/100;ctx.fillStyle='#102044';ctx.fillRect(0,0,width,height);ctx.drawImage(image,x,y,w,h);};
   const close=()=>{dialog.close();dialog.remove();URL.revokeObjectURL(url);};dialog.querySelectorAll('input').forEach(input=>input.oninput=draw);
   dialog.querySelector('#crop-cancel').onclick=()=>{close();reject(new Error('Crop cancelled.'));};dialog.addEventListener('cancel',event=>{event.preventDefault();close();reject(new Error('Crop cancelled.'));});
   dialog.querySelector('#crop-use').onclick=()=>canvas.toBlob(blob=>{close();if(!blob)return reject(new Error('Crop could not be generated.'));resolve(new File([blob],file.name.replace(/\.[^.]+$/,'')+'-crop.jpg',{type:'image/jpeg'}));},'image/jpeg',0.9);
   dialog.showModal();draw();
  };image.src=url;
 });
}
