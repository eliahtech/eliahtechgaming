// Browser-safe configuration. Contains NO secrets. Only values listed here may be referenced from client components.
// Server-side validation lives in ./env.js and must never be imported here.
export const publicConfig = Object.freeze({
  siteName: 'Eliahtech Gaming',
  apiBasePath: '/api/v1', // same-origin; browsers never learn the upstream API address
  sessionEndpoint: '/api/session',
});
