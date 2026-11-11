// Shows a dismissible upgrade dialog. The server decides when (meta etg-upgrade = locked | expired); this only draws it.
(() => {
  const meta = document.querySelector('meta[name="etg-upgrade"]');
  if (!meta || typeof HTMLDialogElement === 'undefined') return;
  const mode = meta.content, guest = meta.dataset.guest === '1', key = `etg.upgrade.${mode}`;
  try { if (sessionStorage.getItem(key)) return; } catch { /* storage blocked: still show once per page */ }
  const copy = mode === 'expired'
    ? { title: 'Your free trial has ended', text: 'Upgrade to keep ad-free posts, premium guides and priority setup support.', cta: 'Upgrade to Premium', href: '/premium' }
    : guest
      ? { title: 'This guide is for Premium members', text: 'Sign in to start your free trial, or see the Premium plans to unlock this guide.', cta: 'See Premium plans', href: '/premium', alt: ['Sign in', '/login'] }
      : { title: 'This guide is for Premium members', text: 'Your account is on the free plan. Upgrade to unlock this guide and everything else in Premium.', cta: 'Upgrade to Premium', href: '/premium' };
  const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
  const dialog = el('dialog', { className: 'card-surface p-4', ariaLabel: copy.title });
  dialog.style.cssText = 'max-width:min(460px,92vw);border:1px solid rgba(128,128,128,.35);border-radius:16px';
  const close = el('button', { type: 'button', className: 'btn btn-ghost', textContent: 'Maybe later' });
  const actions = el('div', { className: 'd-flex flex-wrap gap-2 mt-3' }, el('a', { className: 'btn btn-brand', href: copy.href, textContent: copy.cta }));
  if (copy.alt) actions.append(el('a', { className: 'btn btn-ghost', href: copy.alt[1], textContent: copy.alt[0] }));
  actions.append(close);
  dialog.append(el('h2', { className: 'h5 mb-2', textContent: copy.title }), el('p', { className: 'mb-0', textContent: copy.text }), actions);
  const dismiss = () => { try { sessionStorage.setItem(key, '1'); } catch { /* ignore */ } dialog.close(); dialog.remove(); };
  close.addEventListener('click', dismiss); dialog.addEventListener('cancel', (e) => { e.preventDefault(); dismiss(); });
  document.body.append(dialog); setTimeout(() => { if (document.body.contains(dialog)) dialog.showModal(); }, 1200);
})();
