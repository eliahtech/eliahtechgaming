// Conversation storage. The server uses the service role, so EVERY query here carries an explicit user_id filter; RLS protects
// the same tables against direct PostgREST access. An id belonging to someone else is indistinguishable from a missing one (404).
import { AppError } from '../errors.js';
import { isUuid } from '../validate.js';
import { HARD } from './config.js';

const notFound = () => new AppError('NOT_FOUND', 'Conversation not found.', 404);
export const titleFrom = (text) => String(text).replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'New conversation';
export const cleanTitle = (value) => {
  const t = String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length >= 1 && t.length <= 120 ? t : null;
};

export function createConversations({ db }) {
  async function own(userId, id) {
    if (!isUuid(id) || !isUuid(userId)) throw notFound();
    const [row] = await db.select('ai_conversations', { select: 'id,title,created_at,updated_at', id: `eq.${id}`, user_id: `eq.${userId}`, limit: '1' });
    if (!row) throw notFound();
    return row;
  }
  return {
    own,
    async list(userId, { limit = 50, offset = 0 } = {}) {
      const { rows, total } = await db.selectPage('ai_conversations', { select: 'id,title,created_at,updated_at', user_id: `eq.${userId}`, order: 'updated_at.desc', limit: String(Math.min(limit, HARD.maxConversationsListed)), offset: String(offset) });
      return { items: rows, meta: { total, limit, offset } };
    },
    async get(userId, id) {
      const conversation = await own(userId, id);
      const messages = await db.select('ai_messages', { select: 'id,role,content,provider,model,created_at', conversation_id: `eq.${id}`, order: 'created_at.asc', limit: String(HARD.maxMessagesPerConversation) });
      return { ...conversation, messages };
    },
    async create(userId, title) {
      const [row] = await db.insert('ai_conversations', { user_id: userId, title: cleanTitle(title) ?? 'New conversation' }, { query: { select: 'id,title,created_at,updated_at' } });
      return row;
    },
    async rename(userId, id, title) {
      const clean = cleanTitle(title);
      if (!clean) throw new AppError('VALIDATION_ERROR', 'Title must be 1 to 120 characters.', 422);
      await own(userId, id);
      const [row] = await db.update('ai_conversations', { id: `eq.${id}`, user_id: `eq.${userId}` }, { title: clean, updated_at: new Date().toISOString() });
      return row;
    },
    async remove(userId, id) {
      await own(userId, id);
      await db.remove('ai_conversations', { id: `eq.${id}`, user_id: `eq.${userId}` });
    },
    // Newest messages first from the database, returned oldest first, plus the total so a full conversation can be refused.
    async history(userId, id) {
      await own(userId, id);
      const { rows, total } = await db.selectPage('ai_messages', { select: 'role,content', conversation_id: `eq.${id}`, order: 'created_at.desc', limit: String(HARD.maxContextMessages) });
      return { messages: rows.reverse(), total };
    },
    async append(conversationId, rows) {
      // Explicit, strictly increasing timestamps: rows inserted together would otherwise share one transaction time and sort ambiguously.
      const base = Date.now();
      await db.insert('ai_messages', rows.map((r, i) => ({ conversation_id: conversationId, created_at: new Date(base + i).toISOString(), ...r })), { prefer: 'return=minimal' });
      await db.update('ai_conversations', { id: `eq.${conversationId}` }, { updated_at: new Date().toISOString() }, { prefer: 'return=minimal' });
    },
  };
}
