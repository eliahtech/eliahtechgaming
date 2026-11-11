// Single source for the Content-Security-Policy. Express (Helmet) uses `cspDirectives`; vercel.json carries the
// same policy for statically served files, and a test keeps the two in sync.
export const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
  styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com'],
  fontSrc: ["'self'", 'data:', 'https://cdnjs.cloudflare.com'],
  imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
  connectSrc: ["'self'"],
  frameSrc: ["'self'", 'https://www.youtube-nocookie.com', 'https://www.youtube.com'],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
};

const kebab = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
export const cspHeaderValue = () => Object.entries(cspDirectives).map(([name, values]) => `${kebab(name)} ${values.join(' ')}`).join('; ');
