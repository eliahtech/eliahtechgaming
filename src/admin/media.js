// Image uploads: the API inspects the actual bytes (magic numbers), ignores the client-supplied filename and
// stores the file in Supabase Storage under a generated name. SVG and every non-image type are rejected.
import { randomUUID } from 'node:crypto';
import { AppError } from '../errors.js';
import { ConfigError } from '../supabase.js';
import { isUuid } from '../validate.js';

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // stays under Vercel's ~4.5 MB request limit
export const BUCKET = 'media';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function detectImageType(buf) {
  if (!Buffer.isBuffer(buf)) return null;
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG)) return { mime: 'image/png', ext: 'png' };
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (buf.length >= 6 && ['GIF87a', 'GIF89a'].includes(buf.toString('latin1', 0, 6))) return { mime: 'image/gif', ext: 'gif' };
  return null;
}

export function createMediaService({ db, fetchImpl, now = () => new Date() }) {
  const storage = () => {
    const base = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    if (!base || !key) throw new ConfigError('Storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    return { base, headers: { apikey: key, Authorization: `Bearer ${key}` } };
  };
  const call = async (url, init) => {
    try { return await (fetchImpl ?? globalThis.fetch)(url, init); } catch { throw new AppError('STORAGE_ERROR', 'The file storage service is unreachable.', 502); }
  };

  return {
    async upload({ buffer, declaredType, altText, actorId }) {
      if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new AppError('VALIDATION_ERROR', 'Send the image as the raw request body with an image/* Content-Type.', 422);
      if (buffer.length > MAX_IMAGE_BYTES) throw new AppError('PAYLOAD_TOO_LARGE', 'Images must be 4 MB or smaller.', 413);
      const detected = detectImageType(buffer);
      // The real bytes decide the type; the browser's declared type is only a hint (phones often report image/jpg or nothing).
      if (!detected) throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'Only JPEG, PNG, WebP and GIF images are allowed.', 415);
      const { base, headers } = storage();
      const d = now();
      const path = `uploads/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${detected.ext}`;
      const res = await call(`${base}/storage/v1/object/${BUCKET}/${path}`, { method: 'POST', headers: { ...headers, 'Content-Type': detected.mime, 'x-upsert': 'false' }, body: buffer });
      if (!res.ok) { console.error(JSON.stringify({ level: 'error', msg: 'storage_upload_failed', status: res.status })); throw new AppError('STORAGE_ERROR', 'The file could not be stored.', 502); }
      const alt = typeof altText === 'string' ? altText.replace(/<[^>]*>/g, '').trim().slice(0, 200) || null : null;
      const [row] = await db.insert('media', { bucket: BUCKET, path, public_url: `${base}/storage/v1/object/public/${BUCKET}/${path}`, mime_type: detected.mime, size_bytes: buffer.length, alt_text: alt, uploaded_by: actorId });
      return row;
    },

    async remove(id) {
      if (!isUuid(id)) throw new AppError('NOT_FOUND', 'Media not found.', 404);
      const [row] = await db.select('media', { select: 'id,path', id: `eq.${id}`, limit: '1' });
      if (!row) throw new AppError('NOT_FOUND', 'Media not found.', 404);
      const { base, headers } = storage();
      const res = await call(`${base}/storage/v1/object/${BUCKET}/${row.path}`, { method: 'DELETE', headers });
      if (!res.ok && res.status !== 404) throw new AppError('STORAGE_ERROR', 'The file could not be deleted from storage.', 502);
      await db.remove('media', { id: `eq.${id}` });
      return row;
    },
  };
}
