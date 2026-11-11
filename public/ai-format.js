// Pure, DOM-free renderer for assistant replies. Everything is HTML-escaped FIRST; only a tiny whitelist of tags is produced
// afterwards (code, pre, strong, br and https links), so model output can never inject markup or script.
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
export const esc = (value = '') => String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

function inline(text) {
  return esc(text)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    // Only https links; the URL was escaped above, so it cannot break out of the attribute.
    .replace(/\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer nofollow">$1</a>')
    .replace(/\n/g, '<br>');
}

export function formatMessage(text) {
  return String(text ?? '').split('```').map((part, i) => {
    if (i % 2 === 0) return inline(part);
    const body = part.replace(/^[A-Za-z0-9+#._-]{0,20}\n/, '').replace(/\n$/, '');
    return `<pre><code>${esc(body)}</code></pre>`;
  }).join('');
}
