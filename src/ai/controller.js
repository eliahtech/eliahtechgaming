// HTTP layer for /api/v1/ai/*. Translates requests to AIService calls and errors to the standard error shape, adding the
// request id. It never sees provider names, keys or raw provider responses: the service returns only safe, final values.
import { randomUUID } from 'node:crypto';
import { AppError } from '../errors.js';

const GENERIC = new AppError('AI_INTERNAL_ERROR', 'The AI assistant ran into a problem. Please try again.', 500);

export function createAiController({ service, newId = randomUUID, log = (o) => console.error(JSON.stringify(o)) }) {
  const handle = (fn) => async (req, res) => {
    const requestId = newId();
    res.set('X-Request-Id', requestId);
    try {
      const out = await fn(req, res, requestId);
      if (out !== undefined) res.status(out.status ?? 200).json({ success: true, requestId, data: out.data });
    } catch (raw) {
      let error = raw;
      if (!(raw instanceof AppError)) {
        // Database/config/unexpected failures: log the cause, tell the client nothing internal.
        log({ level: 'error', msg: 'ai_unhandled', requestId, code: raw?.code, message: raw?.message });
        error = raw?.code === 'NOT_CONFIGURED' ? new AppError('NOT_CONFIGURED', 'The AI assistant is not configured yet.', 503) : GENERIC;
      }
      const { retryAfter, ...details } = error.details ?? {};
      if (retryAfter) res.set('Retry-After', String(retryAfter));
      res.status(error.status).json({ success: false, requestId, error: { code: error.code, message: error.message, ...(Object.keys(details).length ? { details } : {}) } });
    }
  };
  const paging = (req) => ({ limit: Math.min(Math.max(Number.parseInt(req.query?.limit, 10) || 50, 1), 100), offset: Math.max(Number.parseInt(req.query?.offset, 10) || 0, 0) });

  return {
    config: handle(async (req) => ({ data: await service.config({ user: req.user }) })),
    models: handle(async (req) => ({ data: await service.models({ user: req.user }) })),
    usage: handle(async (req) => ({ data: await service.usage({ user: req.user }) })),
    chat: handle(async (req, res, requestId) => {
      const data = await service.chat({ user: req.user, ip: req.ip, body: req.body, idempotencyKey: req.headers?.['idempotency-key'], requestId });
      if (data.replayed) { res.set('Idempotent-Replayed', 'true'); const { replayed, ...rest } = data; return { data: rest }; }
      return { data };
    }),
    listConversations: handle(async (req) => ({ data: await service.listConversations(req.user, paging(req)) })),
    createConversation: handle(async (req) => ({ status: 201, data: await service.createConversation(req.user, req.body?.title) })),
    getConversation: handle(async (req) => ({ data: await service.getConversation(req.user, req.params.id) })),
    renameConversation: handle(async (req) => ({ data: await service.renameConversation(req.user, req.params.id, req.body?.title) })),
    deleteConversation: handle(async (req) => { await service.deleteConversation(req.user, req.params.id); return { data: { deleted: true } }; }),
  };
}
