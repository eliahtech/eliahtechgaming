// Counts one page view. Skips visitors who send Do Not Track and browsers where an admin switched counting off.
(() => {
  try { if (navigator.doNotTrack === '1' || localStorage.getItem('etg_no_track') === '1') return; } catch { /* storage blocked: count normally */ }
  const send = () => { try { navigator.sendBeacon('/api/v1/track', new Blob([JSON.stringify({ path: location.pathname })], { type: 'application/json' })); } catch { /* ignore */ } };
  if (document.visibilityState === 'prerender') document.addEventListener('visibilitychange', send, { once: true }); else send();
})();
