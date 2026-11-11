// Generic admin CRUD driven by src/admin/resources.js. Every mutation is audited (field names only, never content).
import { AppError } from '../errors.js';
import { DatabaseError } from '../supabase.js';
import { audit } from '../audit.js';
import { isUuid } from '../validate.js';
import { validateFields, parseTagNames, slugify } from './fields.js';

const cleanTerm = (v) => String(v || '').replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
const wordCount = (html) => String(html || '').replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length;

export function mapDbError(error) {
  if (error instanceof DatabaseError) {
    if (error.detail?.code === '23505') return new AppError('CONFLICT', 'That name or slug is already in use.', 409);
    if (error.detail?.code === '23503') return new AppError('INVALID_REFERENCE', 'A referenced item does not exist or is still in use.', 422);
  }
  return error;
}
const guard = async (fn) => { try { return await fn(); } catch (error) { throw mapDbError(error); } };

export function createAdminService({ db, sanitize }) {
  async function uniqueSlug(table, base, excludeId) {
    const rows = await db.select(table, { select: 'id,slug', slug: `like.${base}*`, limit: '500' });
    const taken = new Set(rows.filter((r) => r.id !== excludeId).map((r) => r.slug));
    if (!taken.has(base)) return base;
    for (let i = 2; i < 1000; i += 1) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
    throw new AppError('CONFLICT', 'Could not generate a unique slug. Provide one manually.', 409);
  }

  async function replaceTags(postId, names) {
    const rows = names.map((name) => ({ name, slug: slugify(name) }));
    if (rows.length) await db.insert('tags', rows, { query: { on_conflict: 'slug' }, prefer: 'resolution=ignore-duplicates,return=minimal' });
    const found = rows.length ? await db.select('tags', { select: 'id', slug: `in.(${rows.map((r) => r.slug).join(',')})` }) : [];
    await db.rpc('admin_set_post_tags', { p_post_id: postId, p_tag_ids: found.map((t) => t.id) });
  }

  const shape = (def, row) => {
    if (!row) return row;
    if (def.table !== 'posts') return row;
    const { post_tags, ...rest } = row;
    return { ...rest, ...(post_tags ? { tags: post_tags.map((l) => l.tags?.name).filter(Boolean) } : {}) };
  };

  async function fetchOne(def, id) {
    if (!isUuid(id)) throw new AppError('NOT_FOUND', 'Not found.', 404);
    const [row] = await guard(() => db.select(def.table, { select: def.detailSelect ?? def.listSelect, id: `eq.${id}`, limit: '1' }));
    if (!row) throw new AppError('NOT_FOUND', 'Not found.', 404);
    return row;
  }

  async function prepare(def, values, { id, existing, actor }) {
    const out = { ...values };
    if (def.slugFrom && !out.slug && (!id)) out.slug = await uniqueSlug(def.table, slugify(out[def.slugFrom]) || def.audit, undefined);
    if (def.table === 'posts') {
      out.change_summary = out.change_summary || null;
      for(const field of ['last_tested_at','reviewed_at'])if(out[field]&&Date.parse(out[field])>Date.now()+300000)throw new AppError('VALIDATION_ERROR','Testing/review dates cannot be in the future.',422);

      if ('content_html' in out) out.reading_time = Math.max(1, Math.ceil(wordCount(out.content_html) / 200));
      const status = out.status ?? existing?.status;
      if (status === 'published' && !(out.published_at ?? existing?.published_at)) out.published_at = new Date().toISOString();
      if (!id) { out.author_id = actor.id; if (!out.author_name) out.author_name = actor.profile?.display_name ?? null; }
    }
    if (def.touchUpdatedAt) out.updated_at = new Date().toISOString();
    return out;
  }

  return {
    async list(def, { q, limit, offset, filters = {} }) {
      const query = { select: def.listSelect, order: def.order, limit: String(limit), offset: String(offset) };
      const term = cleanTerm(q);
      if (term) query.or = `(${def.search.map((c) => `${c}.ilike.*${term}*`).join(',')})`;
      for (const [name, allowed] of Object.entries(def.filters ?? {})) if (allowed.includes(filters[name])) query[name] = `eq.${filters[name]}`;
      const { rows, total } = await guard(() => db.selectPage(def.table, query));
      return { items: rows, meta: { total, limit, offset } };
    },

    async get(def, id) { return shape(def, await fetchOne(def, id)); },

    async create(def, body, actor, ip) {
      const values = validateFields(def.fields, body, { sanitize });
      const tags = def.table === 'posts' ? parseTagNames(body?.tags) : undefined;
      const payload = await prepare(def, values, { actor });
      const [row] = await guard(() => db.insert(def.table, payload));
      if (tags !== undefined) await guard(() => replaceTags(row.id, tags));
      await audit(db, { actorId: actor.id, action: `${def.audit}.create`, targetType: def.table, targetId: row.id, metadata: { fields: Object.keys(payload) }, ip });
      return shape(def, await fetchOne(def, row.id));
    },

    async update(def, id, body, actor, ip) {
      const existing = await fetchOne(def, id);
      const values = validateFields(def.fields, body, { partial: true, sanitize });
      const tags = def.table === 'posts' ? parseTagNames(body?.tags) : undefined;
      const payload = await prepare(def, values, { id, existing, actor });
      if (Object.keys(payload).length) await guard(() => db.update(def.table, { id: `eq.${id}` }, payload));
      if (tags !== undefined) await guard(() => replaceTags(id, tags));
      await audit(db, { actorId: actor.id, action: `${def.audit}.update`, targetType: def.table, targetId: id, metadata: { fields: [...Object.keys(payload), ...(tags !== undefined ? ['tags'] : [])] }, ip });
      return shape(def, await fetchOne(def, id));
    },

    async remove(def, id, actor, ip) {
      const existing = await fetchOne(def, id);
      await guard(() => db.remove(def.table, { id: `eq.${id}` }));
      await audit(db, { actorId: actor.id, action: `${def.audit}.delete`, targetType: def.table, targetId: id, metadata: { label: existing.title ?? existing.name ?? existing.platform ?? null }, ip });
    },
  };
}
