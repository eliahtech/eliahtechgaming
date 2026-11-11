// Minimal Supabase (PostgREST) client. Server-side only: it uses the service-role key,
// which must never reach the browser. No SDK dependency, so it runs anywhere fetch exists.

export class ConfigError extends Error {
  constructor(message) { super(message); this.name = 'ConfigError'; this.code = 'NOT_CONFIGURED'; this.status = 503; }
}

export class DatabaseError extends Error {
  constructor(message, detail) { super(message); this.name = 'DatabaseError'; this.code = 'DATABASE_ERROR'; this.status = 502; this.detail = detail; }
}

export function createDb({ url, key, fetchImpl } = {}) {
  const request = async (method, table, { query = {}, body, prefer, withCount = false } = {}) => {
    const baseUrl = (url ?? process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
    const apiKey = key ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    if (!baseUrl || !apiKey) {
      throw new ConfigError('Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your environment (.env).');
    }
    const qs = new URLSearchParams(query).toString();
    const doFetch = fetchImpl ?? globalThis.fetch;
    let response;
    try {
      response = await doFetch(`${baseUrl}/rest/v1/${table}${qs ? `?${qs}` : ''}`, {
        method,
        headers: {
          apikey: apiKey,
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(prefer || withCount ? { Prefer: [prefer, withCount ? 'count=exact' : ''].filter(Boolean).join(',') } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (cause) {
      throw new DatabaseError('Could not reach the database.', cause?.message);
    }
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
    if (!response.ok) throw new DatabaseError('Database request failed.', { status: response.status, table, code: payload?.code, message: payload?.message });
    if (withCount) return { rows: payload ?? [], total: Number(/\/(\d+)$/.exec(response.headers?.get?.('content-range') || '')?.[1] ?? (payload?.length ?? 0)) };
    return payload;
  };

  return {
    select: (table, query) => request('GET', table, { query }),
    // Like select, but also returns the total row count: { rows, total }.
    selectPage: (table, query) => request('GET', table, { query, withCount: true }),
    insert: (table, rows, { query, prefer = 'return=representation' } = {}) => request('POST', table, { query, body: rows, prefer }),
    // PATCH rows matching the PostgREST filters in `query` (e.g. { id: 'eq.<uuid>' }). Always pass a filter.
    update: (table, query, values, { prefer = 'return=representation' } = {}) => {
      if (!query || !Object.keys(query).length) throw new Error('update() requires a filter');
      return request('PATCH', table, { query, body: values, prefer });
    },
    remove: (table, query) => {
      if (!query || !Object.keys(query).length) throw new Error('remove() requires a filter');
      return request('DELETE', table, { query, prefer: 'return=representation' });
    },
    // Call a Postgres function: POST /rest/v1/rpc/<name>
    rpc: (name, args = {}) => request('POST', `rpc/${name}`, { body: args }),
  };
}

export const isConfigured = () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
