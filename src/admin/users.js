import { AppError } from '../errors.js';
import { isUuid } from '../validate.js';

export const ASSIGNABLE_ROLES = ['free_user', 'premium_user', 'admin'];
const term = (v) => String(v || '').replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

export async function listUsers(db, { q, limit, offset }) {
  const query = { select: 'id,display_name,role,trial_started_at,trial_ends_at,created_at', order: 'created_at.desc', limit: String(limit), offset: String(offset) };
  if (term(q)) query.display_name = `ilike.*${term(q)}*`;
  return db.selectPage('profiles', query);
}

export async function setUserRole(db, { actorId, targetId, role }) {
  if (!isUuid(targetId)) throw new AppError('NOT_FOUND', 'User not found.', 404);
  if (!ASSIGNABLE_ROLES.includes(role)) throw new AppError('VALIDATION_ERROR', `Role must be one of: ${ASSIGNABLE_ROLES.join(', ')}.`, 422);
  if (targetId === actorId) throw new AppError('CONFLICT', 'You cannot change your own role.', 409);
  const [current] = await db.select('profiles', { select: 'id,role', id: `eq.${targetId}`, limit: '1' });
  if (!current) throw new AppError('NOT_FOUND', 'User not found.', 404);
  const [updated] = await db.update('profiles', { id: `eq.${targetId}` }, { role });
  return { before: current.role, after: updated?.role ?? role };
}
