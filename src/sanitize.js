// Allow-list HTML sanitizer for article and guide content (rich-text editor output and pasted full-HTML posts).
import sanitizeHtml from 'sanitize-html';
import { normalizeImageUrl } from './images.js';
import { scopeCss, STYLE_BLOCK, POST_SCOPE } from './css-scope.js';
export { scopeCss, POST_SCOPE };

const YOUTUBE_HOSTS = ['www.youtube.com', 'www.youtube-nocookie.com'];

// Style values that can load remote resources, run script or escape the article box are never allowed.
const SAFE_VALUE = /^(?!.*(?:url\s*\(|expression|javascript:|behavior|@import|<|\\)).{1,200}$/is;
const SAFE_STYLES = Object.fromEntries(['color', 'background', 'background-color', 'background-image', 'border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-color', 'border-radius', 'border-width', 'border-style', 'box-shadow', 'display', 'flex', 'flex-direction', 'flex-wrap', 'gap', 'align-items', 'justify-content', 'font-size', 'font-weight', 'font-style', 'font-family', 'line-height', 'letter-spacing', 'text-align', 'text-decoration', 'text-transform', 'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'width', 'max-width', 'min-width', 'height', 'max-height', 'min-height', 'overflow', 'overflow-x', 'list-style', 'vertical-align', 'white-space', 'word-break', 'opacity', 'object-fit', 'float', 'clear'].map((name) => [name, [SAFE_VALUE]]));

const options = {
  allowedTags: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'ul', 'ol', 'li', 'blockquote', 'a', 'img', 'figure', 'figcaption', 'picture', 'source', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col', 'pre', 'code', 'kbd', 'mark', 'small', 'span', 'div', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'details', 'summary', 'dl', 'dt', 'dd', 'iframe'],
  allowedAttributes: {
    '*': ['class', 'id', 'style', 'title', 'lang'],
    a: ['href', 'name', 'target', 'rel', 'class', 'id', 'style', 'title'],
    img: ['src', 'srcset', 'sizes', 'alt', 'title', 'width', 'height', 'loading', 'decoding', 'referrerpolicy', 'class', 'style'],
    source: ['srcset', 'sizes', 'media', 'type'],
    iframe: ['src', 'width', 'height', 'title', 'allowfullscreen', 'loading'],
    th: ['colspan', 'rowspan', 'scope', 'class', 'style'],
    td: ['colspan', 'rowspan', 'class', 'style'],
    details: ['open', 'class', 'style'],
  },
  allowedStyles: { '*': SAFE_STYLES },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https'], source: ['http', 'https'] },
  allowedIframeHostnames: YOUTUBE_HOSTS,
  allowProtocolRelative: false,
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
    // Lazy-loading plugins keep the real URL in data-* attributes; share/protocol-relative/http links are made loadable.
    img: (tagName, attribs) => {
      const raw = attribs.src || attribs['data-src'] || attribs['data-original'] || attribs['data-lazy-src'] || '';
      const src = normalizeImageUrl(raw);
      const out = { ...attribs, src, loading: attribs.loading === 'eager' ? 'eager' : 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' };
      for (const key of Object.keys(out)) if (key.startsWith('data-')) delete out[key];
      if (!out.alt) out.alt = '';
      return { tagName, attribs: out };
    },
  },
  exclusiveFilter: (frame) => frame.tag === 'img' && !frame.attribs.src,
};

export const sanitizeContent = (html) => {
  const source = String(html ?? '');
  const styles = [];
  const withoutStyles = source.replace(STYLE_BLOCK, (_m, css) => { const scoped = scopeCss(css); if (scoped) styles.push(scoped); return ''; });
  const body = sanitizeHtml(withoutStyles, options);
  return styles.length ? `<style>${styles.join('\n')}</style>${body}` : body;
};
