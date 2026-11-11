// Data access for the API. Every function reads or writes Supabase; nothing is stored in memory.
// The server uses the service-role key, so every query here carries its own explicit filters; Row Level Security
// in the database protects the same data against direct PostgREST access with the public anon key.
import { sanitizeContent } from './sanitize.js';
import { isUuid } from './validate.js';

const POST_LIST_COLUMNS = 'id,slug,title,excerpt,published_at,featured,is_premium,game_id,content_type,platform,min_ram_gb,storage_mb,last_tested_at,game_hubs(name,slug,enabled),featured_image_url,author_name,reading_time,categories(slug,name,icon,color),post_tags(tags(name))';
const POST_DETAIL_COLUMNS = `${POST_LIST_COLUMNS},content_html,seo_title,seo_description,canonical_url,og_image,featured_image_alt,ads_disabled,updated_at,android_min_version,emulator_version,tested_devices,reviewed_at,compatibility_notes,installation_guides(title,content_html,enabled)`;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const shapePost = (row) => {
  const { categories, post_tags, content_html, featured_image_url, author_name, installation_guides, game_hubs, ...rest } = row;
  return {
    ...rest,
    category: categories,
    game: game_hubs?.enabled === false ? null : game_hubs || null,
    tags: (post_tags || []).map((link) => link.tags?.name).filter(Boolean),
    author: author_name,
    featured_image: featured_image_url || '/assets/gaming-cover.jpg',
    ...(content_html !== undefined ? { content: sanitizeContent(content_html) } : {}),
    // Rendered from the guide row at read time, so editing a guide updates every post that uses it.
    ...(installation_guides?.enabled ? { installation_guide: { title: installation_guides.title, content: sanitizeContent(installation_guides.content_html) } } : {}),
  };
};

// Published posts whose publish date has arrived are listed publicly. Premium posts appear in lists (flagged
// is_premium) but their body is only returned to premium users by the route handler.
const publicPostFilter = () => ({ status: 'eq.published', published_at: `lte.${new Date().toISOString()}` });

export async function listCategories(db) {
  return db.select('categories', { select: 'id,slug,name,description,icon,color', enabled: 'eq.true', order: 'sort_order.asc' });
}

export async function listPosts(db, { category, featured, limit = 12, offset = 0 } = {}) {
  const query = { select: POST_LIST_COLUMNS, ...publicPostFilter(), order: 'published_at.desc', limit: String(limit), offset: String(offset) };
  if (category) { query.select = POST_LIST_COLUMNS.replace('categories(', 'categories!inner('); query['categories.slug'] = `eq.${category}`; }
  if (featured) query.featured = 'eq.true';
  return (await db.select('posts', query)).map(shapePost);
}

export async function getPost(db, slug) {
  const rows = await db.select('posts', { select: POST_DETAIL_COLUMNS, slug: `eq.${slug}`, ...publicPostFilter(), limit: '1' });
  return rows[0] ? shapePost(rows[0]) : null;
}

const cleanTerm = (value) => String(value || '').replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

export async function searchPosts(db, rawQuery) {
  const term = cleanTerm(rawQuery);
  if (term.length < 2) return [];
  const conditions = [`search_vector.wfts(english).${term}`, `title.ilike.*${term}*`, `excerpt.ilike.*${term}*`];
  const [tags, categories] = await Promise.all([
    db.select('tags', { select: 'id', name: `ilike.*${term}*`, limit: '20' }),
    db.select('categories', { select: 'id', name: `ilike.*${term}*`, enabled: 'eq.true', limit: '20' }),
  ]);
  if (tags.length) {
    const links = await db.select('post_tags', { select: 'post_id', tag_id: `in.(${tags.map((t) => t.id).join(',')})`, limit: '200' });
    if (links.length) conditions.push(`id.in.(${links.map((l) => l.post_id).join(',')})`);
  }
  if (categories.length) conditions.push(`category_id.in.(${categories.map((c) => c.id).join(',')})`);
  const rows = await db.select('posts', { select: POST_LIST_COLUMNS, ...publicPostFilter(), or: `(${conditions.join(',')})`, order: 'published_at.desc', limit: '30' });
  return rows.map(shapePost);
}

export async function listServices(db) {
  return db.select('services', { select: 'id,slug,title,description,image_url,icon,features,price,currency,accent,action_text,action_url,seo_title,seo_description', is_active: 'eq.true', order: 'sort_order.asc' });
}

// The retired Blogger address is filtered out even if an old row survives in the database.
export async function listSocialLinks(db) {
  const rows = await db.select('social_links', { select: 'platform,url,icon', enabled: 'eq.true', order: 'sort_order.asc' });
  return rows.filter((row) => !/blogspot\.com/i.test(String(row?.url ?? '')));
}

export async function getPublicSetting(db, key) {
  const rows = await db.select('settings', { select: 'value', key: `eq.${key}`, is_public: 'eq.true', limit: '1' });
  return rows[0]?.value ?? null;
}

// Public site identity is curated in one existing settings row. Related editorial content remains in its own CMS tables.
export async function getPublicSite(db) {
  const site = (await getPublicSetting(db, 'site')) ?? null;
  if (!site) return site;
  const clean = { ...site };
  for (const key of ['website_url', 'canonical_url']) if (/blogspot\.com/i.test(String(clean[key] ?? ''))) clean[key] = '';
  return clean;
}

export async function listPostsPage(db, options = {}) {
  const { category, featured, limit = 12, offset = 0 } = options;
  const query = { select: POST_LIST_COLUMNS, ...publicPostFilter(), order: 'published_at.desc,id.asc', limit: String(limit), offset: String(offset) };
  if (category) { query.select = POST_LIST_COLUMNS.replace('categories(', 'categories!inner('); query['categories.slug'] = `eq.${category}`; }
  if (featured) query.featured = 'eq.true';
  const { rows, total } = await db.selectPage('posts', query);
  return { items: rows.map(shapePost), meta: { total, limit, offset, has_more: offset + rows.length < total } };
}
export async function listPostSlugs(db, { offset = 0, limit = 1000 } = {}) {
  return db.select('posts', { select: 'slug,updated_at,published_at,featured_image_url', ...publicPostFilter(), order: 'id.asc', limit: String(limit), offset: String(offset) });
}

export async function createMessage(db, { name, email, subject, message } = {}) {
  const record = {
    name: String(name || '').trim().slice(0, 100),
    email: String(email || '').trim().toLowerCase().slice(0, 254),
    subject: String(subject || '').trim().slice(0, 180),
    message: String(message || '').trim().slice(0, 5000),
  };
  if (!record.name || !record.subject || !record.message || !EMAIL_RE.test(record.email)) return null;
  const [row] = await db.insert('messages', record, { query: { select: 'id' } });
  return row;
}

const emptyContext = { profile: null, subscriptions: [] };

// Profile and active subscriptions for one authenticated user (input to computeAccess).
export async function getAccessContext(db, userId) {
  if (!isUuid(userId)) return emptyContext;
  const [profiles, subscriptions] = await Promise.all([
    db.select('profiles', { select: 'id,display_name,avatar_url,role,trial_started_at,trial_ends_at', id: `eq.${userId}`, limit: '1' }),
    db.select('subscriptions', { select: 'status,expires_at', user_id: `eq.${userId}`, status: 'eq.active', limit: '20' }),
  ]);
  return { profile: profiles[0] ?? null, subscriptions };
}

export async function updateOwnProfile(db, userId, { displayName }) {
  if (!isUuid(userId)) return null;
  const rows = await db.update('profiles', { id: `eq.${userId}` }, { display_name: displayName, updated_at: new Date().toISOString() });
  return rows[0] ?? null;
}

export const CONTENT_TYPES = ['guide','installation','settings','textures','update','troubleshooting'];
export const PLATFORMS = ['android','ppsspp','pc','console','other'];
export async function listGameHubs(db){return db.select('game_hubs',{select:'id,slug,name,summary,cover_image_url,platforms',enabled:'eq.true',order:'sort_order.asc,name.asc',limit:'100'});}
export async function getGameHub(db,slug){if(!/^[a-z0-9-]{1,80}$/.test(slug))return null;const [game]=await db.select('game_hubs',{select:'id,slug,name,summary,cover_image_url,platforms',enabled:'eq.true',slug:`eq.${slug}`,limit:'1'});return game||null;}
export async function listPostUpdates(db,postId){return db.select('post_updates',{select:'summary,created_at',post_id:`eq.${postId}`,order:'created_at.desc',limit:'20'});}
export function searchFilters(raw={}){
 const filters={};
 if(PLATFORMS.includes(raw.platform))filters.platform=raw.platform;
 if(CONTENT_TYPES.includes(raw.type))filters.content_type=raw.type;
 if(['free','premium'].includes(raw.access))filters.access=raw.access;
 if(isUuid(raw.game))filters.game=raw.game;
 for(const [key,max]of[['ram',128],['storage',2000000]]){const value=Number(raw[key]);if(raw[key]!==''&&raw[key]!=null&&Number.isFinite(value)&&value>0&&value<=max)filters[key]=value;}
 return filters;
}
export async function searchPostsPage(db,rawQuery='',options={}){
 const term=cleanTerm(rawQuery),filters=searchFilters(options),limit=Math.min(30,Math.max(1,Number(options.limit)||12)),offset=Math.max(0,Math.min(1000000,Number(options.offset)||0));
 const query={select:POST_LIST_COLUMNS,...publicPostFilter(),order:'published_at.desc,id.asc',limit:String(limit),offset:String(offset)};
 if(term.length>=2){
  const conditions=[`search_vector.wfts(english).${term}`,`title.ilike.*${term}*`,`excerpt.ilike.*${term}*`];
  const [tags,categories]=await Promise.all([db.select('tags',{select:'id',name:`ilike.*${term}*`,limit:'20'}),db.select('categories',{select:'id',name:`ilike.*${term}*`,enabled:'eq.true',limit:'20'})]);
  if(tags.length){const links=await db.select('post_tags',{select:'post_id',tag_id:`in.(${tags.map(t=>t.id).join(',')})`,limit:'200'});if(links.length)conditions.push(`id.in.(${links.map(l=>l.post_id).join(',')})`);}
  if(categories.length)conditions.push(`category_id.in.(${categories.map(c=>c.id).join(',')})`);
  query.or=`(${conditions.join(',')})`;
 }
 if(filters.platform)query.platform=`eq.${filters.platform}`;
 if(filters.content_type)query.content_type=`eq.${filters.content_type}`;
 if(filters.game){query.game_id=`eq.${filters.game}`;query.select=query.select.replace('game_hubs(', 'game_hubs!inner(');query['game_hubs.enabled']='eq.true';}
 if(filters.access)query.is_premium=`eq.${filters.access==='premium'}`;
 if(filters.ram)query.min_ram_gb=`lte.${filters.ram}`;
 if(filters.storage)query.storage_mb=`lte.${filters.storage}`;
 const {rows,total}=await db.selectPage('posts',query);
 return{items:rows.map(shapePost),meta:{total,limit,offset,has_more:offset+rows.length<total,query:term,filters}};
}
export async function nextGuides(db,post,{limit=3}={}){
 let rows;
 if(post.game_id)rows=(await db.select('posts',{select:POST_LIST_COLUMNS,...publicPostFilter(),game_id:`eq.${post.game_id}`,id:`neq.${post.id}`,order:'published_at.desc',limit:'24'})).map(shapePost);
 else rows=await listPosts(db,{category:post.category?.slug,limit:8});
 const order=['installation','settings','guide','textures','troubleshooting','update'],stage=order.indexOf(post.content_type||'guide');
 return rows.filter(row=>row.id!==post.id).sort((a,b)=>{const score=row=>{const n=order.indexOf(row.content_type||'guide');return n>stage?n-stage:n+order.length;};return score(a)-score(b);}).slice(0,limit);
}
