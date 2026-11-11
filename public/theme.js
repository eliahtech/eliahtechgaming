/* Light/dark theme: runs in <head> before first paint so there is no flash. Saved choice wins; otherwise follow the device. */
(function () {
  var KEY = 'etg-theme', root = document.documentElement, mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function stored() { try { var v = localStorage.getItem(KEY); return v === 'dark' || v === 'light' ? v : null; } catch (e) { return null; } }
  function apply(theme) {
    root.setAttribute('data-theme', theme); root.setAttribute('data-bs-theme', theme);
    var meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', theme === 'dark' ? '#0a1631' : '#102044');
    var buttons = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < buttons.length; i++) { buttons[i].setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false'); buttons[i].setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'); }
  }
  apply(stored() || (mq && mq.matches ? 'dark' : 'light'));
  if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (!stored()) apply(mq.matches ? 'dark' : 'light'); });
  document.addEventListener('DOMContentLoaded', function () { apply(root.getAttribute('data-theme') || 'light'); });
  document.addEventListener('click', function (event) {
    var button = event.target.closest && event.target.closest('[data-theme-toggle]'); if (!button) return;
    var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch (e) { /* private mode: the choice just lasts for this page */ }
    apply(next);
  });
})();
