// Google Tag Manager for public, indexable pages. The container id is not a secret (it is visible in every page's source).
// The standard snippet starts with an inline script; this site's policy only allows inline scripts with a nonce, so the same
// two lines live in /gtm-init.js (served from this site) and run before gtm.js, which is exactly what the inline snippet does.
export const GTM_ID = 'GTM-WH2NL9LW';
export const analyticsHead = () => `<script src="/gtm-init.js"></script><script async src="https://www.googletagmanager.com/gtm.js?id=${GTM_ID}"></script>`;
// Addresses Google Tag Manager and Google Analytics need. Added to the page policy only on pages that carry the tag.
export const ANALYTICS_ORIGINS = {
  script: ['https://www.googletagmanager.com', 'https://*.googletagmanager.com', 'https://www.google-analytics.com'],
  connect: ['https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://*.googletagmanager.com', 'https://stats.g.doubleclick.net'],
  frame: ['https://www.googletagmanager.com'],
};
// Adds the analytics origins to a set of CSP directives without changing any other directive.
export const withAnalytics = (directives) => ({
  ...directives,
  scriptSrc: [...directives.scriptSrc, ...ANALYTICS_ORIGINS.script],
  connectSrc: [...directives.connectSrc, ...ANALYTICS_ORIGINS.connect],
  frameSrc: [...directives.frameSrc, ...ANALYTICS_ORIGINS.frame],
});
