// When a payment provider cannot be reached (timeout, DNS, TLS, connection reset) the customer only sees a short message.
// This writes the technical reason to the server log so it can be diagnosed. It records the error's name, code and a short
// message only: never request headers, keys, secrets or bodies.
export function logTransportError(provider, step, error) {
  const cause = error?.cause;
  console.error(JSON.stringify({
    level: 'error', msg: 'payment_provider_unreachable', provider, step,
    name: String(error?.name || '').slice(0, 60), code: String(error?.code || cause?.code || '').slice(0, 60),
    cause: String(cause?.name || '').slice(0, 60), message: String(cause?.message || error?.message || '').slice(0, 160),
  }));
}
