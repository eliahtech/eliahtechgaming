// Generate rerunnable SQL locally. Never connects to a live database or invents missing content.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { sanitizeContent } from '../src/sanitize.js';
import { slugify } from '../src/admin/fields.js';
const input=process.argv[2], output=process.argv[3]||'content/import.sql';
const q=value=>value===null||value===undefined?'null':"'"+String(value).replaceAll("'","''")+"'";
const strip=html=>html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
let rows;
if(input)rows=JSON.parse(readFileSync(input,'utf8'));
else rows=readdirSync('content/import-sources').filter(f=>f.endsWith('.html')).map(file=>{const html=readFileSync('content/import-sources/'+file,'utf8');return {title:/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]?.replace(/<[^>]+>/g,'')||/<title[^>]*>(.*?)<\/title>/i.exec(html)?.[1]||file.replace('.html','').replaceAll('_',' '),content_html:html,source_file:file};});
if(!Array.isArray(rows))throw new Error('Input must be an array of normalized posts.');
const inventory=[],sql=['-- Verified recovered source content. Drafts only; reruns never overwrite existing posts.','begin;'];
for(const row of rows){
 const title=String(row.title||'').trim(),slug=slugify(row.slug||title),content=sanitizeContent(String(row.content_html||'')),plain=strip(content);
 if(!title||!slug||!plain){inventory.push({title,skipped:true,reason:'Missing title, slug or article body'});continue;}
 const links=[...content.matchAll(/(?:href|src)="([^"]+)"/g)].map(m=>m[1]);
 const missing=links.filter(url=>/YOUR_|PLACEHOLDER|example\.com|INSERT_|DOWNLOAD_LINK|IMAGE_URL/i.test(url));
 const image=row.featured_image_url&&/^https:\/\//.test(row.featured_image_url)?row.featured_image_url:null;
 const published=row.published_at&&!Number.isNaN(Date.parse(row.published_at))?new Date(row.published_at).toISOString():null;
 sql.push(`insert into public.posts(title,slug,content_html,excerpt,status,published_at,featured_image_url,featured_image_alt,author_name,seo_title,seo_description,reading_time) values(${q(title)},${q(slug)},${q(content)},${q(row.excerpt||plain.slice(0,300))},'draft',${q(published)},${q(image)},${q(row.featured_image_alt||title)},${q(row.author_name||'Eliahtech Gaming')},${q(row.seo_title||title)},${q(row.seo_description||plain.slice(0,160))},${Math.max(1,Math.ceil(plain.split(/\s+/).length/200))}) on conflict(slug)do nothing;`);
 for(const name of [...new Set(row.tags||[])]){const tag=String(name).trim().slice(0,40),tagSlug=slugify(tag);if(!tagSlug)continue;sql.push(`insert into public.tags(name,slug)values(${q(tag)},${q(tagSlug)})on conflict do nothing;`,`insert into public.post_tags(post_id,tag_id)select p.id,t.id from public.posts p,public.tags t where p.slug=${q(slug)} and t.slug=${q(tagSlug)} and p.status='draft' on conflict do nothing;`);}
 inventory.push({title,slug,source_file:row.source_file||null,source_url:row.source_url||null,status:'draft',words:plain.split(/\s+/).length,missing_cover:!image,placeholder_links:missing,link_check:'not live-verified',note:'Existing matching slugs are preserved. Verify rights, links, cover and completeness before publishing.'});
}
sql.push('commit;');writeFileSync(output,sql.join('\n')+'\n');writeFileSync(output.replace(/\.sql$/,'')+'-inventory.json',JSON.stringify(inventory,null,2)+'\n');console.log('Generated',output,'for',inventory.length,'source records. No database changes made.');
