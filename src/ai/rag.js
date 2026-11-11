// Retrieval of PUBLIC Eliah Tech content using the existing PostgreSQL full-text index (posts.search_vector). No vector database.
// Only content any visitor could already read is returned: published, already-live, non-premium posts (with their installation
// guide when enabled) and active services. Premium posts are excluded for every tier so the assistant can never be used to
// read paywalled articles. Any failure returns [] so retrieval can never break a chat request.
const STOP = new Set('the and for are but not you your with this that have from they will would there their what when where which about into than then them these those how why can could should does did get got use using make made just like also been being were was has had its our out any all one two who whom whose very more most some such only own same too its it is of to in on at by be as an or if so do we my me i a'.split(' '));

export function keywords(text, max = 6) {
  const words = String(text).toLowerCase().match(/[\p{L}\p{N}]{3,30}/gu) ?? [];
  const unique = [...new Set(words.filter((w) => !STOP.has(w)))];
  return unique.sort((a, b) => b.length - a.length).slice(0, max);
}
const plain = (html, max) => String(html ?? '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export async function retrieve(db, message, { limit = 3, now = () => new Date() } = {}) {
  const words = keywords(message);
  if (!words.length) return [];
  try {
    const [posts, services] = await Promise.all([
      db.select('posts', { select: 'title,slug,excerpt,content_html,installation_guides(title,content_html,enabled)', status: 'eq.published', published_at: `lte.${now().toISOString()}`, is_premium: 'eq.false', search_vector: `wfts(english).${words.join(' or ')}`, limit: String(limit) }),
      db.select('services', { select: 'title,description,features', is_active: 'eq.true', or: `(title.ilike.*${words[0]}*,description.ilike.*${words[0]}*)`, limit: '2' }),
    ]);
    return [
      ...posts.map((p) => ({ type: 'post', title: String(p.title), url: `/posts/${encodeURIComponent(p.slug)}`, snippet: [p.excerpt, plain(p.content_html, 700), p.installation_guides?.enabled ? `Installation guide: ${plain(p.installation_guides.content_html, 300)}` : ''].filter(Boolean).join(' ').slice(0, 1100) })),
      ...services.map((s) => ({ type: 'service', title: String(s.title), url: '/services', snippet: [s.description, ...(Array.isArray(s.features) ? s.features.slice(0, 6) : [])].filter(Boolean).join(' ').slice(0, 500) })),
    ];
  } catch (error) {
    console.error(JSON.stringify({ level: 'warn', msg: 'ai_rag_failed', code: error.code, message: error.message }));
    return [];
  }
}
