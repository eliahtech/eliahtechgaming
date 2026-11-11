// Dependency-free CSS scoping, shared by the sanitizer and the import scripts. Pasted post CSS is confined to the post body and cannot load remote resources.
export const POST_SCOPE = '.article-body .post-html';
// ---- Scoped <style> support (pasted full-HTML posts) ----
export const STYLE_BLOCK = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
const cleanCss = (css) => String(css).replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]*;?/gi, '').replace(/@charset[^;]*;?/gi, '').replace(/expression\s*\([^)]*\)/gi, '').replace(/javascript:/gi, '').replace(/behavior\s*:[^;}]*/gi, '').replace(/-moz-binding\s*:[^;}]*/gi, '').replace(/url\s*\(([^)]*)\)/gi, (m, inner) => (/^\s*["']?(?:https:\/\/|\/(?!\/))/i.test(inner) ? m : '')).replace(/position\s*:\s*fixed/gi, 'position:relative').replace(/[<>]/g, '');

function scopeSelector(selector) {
  const sel = selector.trim();
  if (!sel) return '';
  if (sel.startsWith(POST_SCOPE)) return sel; // idempotent: already scoped
  if (/^(?:html|body|:root)$/i.test(sel)) return POST_SCOPE;
  return `${POST_SCOPE} ${sel.replace(/^(?:html|body)\s+/i, '')}`;
}
export function scopeCss(css) {
  const source = cleanCss(css);
  let out = '';
  let i = 0;
  while (i < source.length) {
    const open = source.indexOf('{', i);
    if (open === -1) break;
    const head = source.slice(i, open).trim();
    // find matching close brace (supports one nesting level for @media)
    let depth = 1; let j = open + 1;
    while (j < source.length && depth > 0) { if (source[j] === '{') depth += 1; else if (source[j] === '}') depth -= 1; j += 1; }
    const body = source.slice(open + 1, j - 1);
    if (/^@(?:media|supports)/i.test(head)) out += `${head}{${scopeCss(body)}}`;
    else if (/^@(?:keyframes|-webkit-keyframes|font-face)/i.test(head)) { if (/^@(?:keyframes|-webkit-keyframes)/i.test(head)) out += `${head}{${body}}`; }
    else if (head && !head.startsWith('@')) out += `${head.split(',').map(scopeSelector).filter(Boolean).join(',')}{${body.trim()}}`;
    i = j;
  }
  return out;
}

