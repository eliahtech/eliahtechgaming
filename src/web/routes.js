import express from 'express';
import { browsingFromCookie } from '../../public/browsing-preferences.js';
import { sessionCookies, cookieNames } from '../session/cookies.js';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeContent } from '../sanitize.js';
import { pages } from '../../public/content.js';
import { escape, layout, emptyState, skeletonPanel, cards, share, socials, safeImage, date, compatibilityPanel, updateHistory, gameCards, articleCover, homeHero, homeSection, topicTiles, promoBand, newsletterCard } from './templates.js';
import { activeAds, adEligible, adMarkup, adCsp } from './ads.js';
import { HOME_TITLE, DEFAULT_DESCRIPTION, FEED_CACHE, PUBLIC_FILE_CACHE, STATIC_SITEMAP_PATHS, absoluteUrl, articleNode, breadcrumbNode, collectionNode, graph, injectShellSeo, isoDate, knownImageSize, listingDescription, metaDescription, organizationNode, pageLabel, robotsTxt, rssFeed, shellSeo, sitemapIndex, sitemapUrlset, tagNames, twitterHandle, websiteNode } from '../seo.js';

const STATIC_TITLES = { '/about': 'About Eliahtech Gaming', '/privacy': 'Privacy Policy', '/terms': 'Terms of Service', '/disclaimer': 'Disclaimer', '/dmca': 'DMCA and Copyright Policy' };
const SHELL_PATHS = ['/admin', '/admin/' + '*', '/ai', '/premium', '/login', '/register', '/forgot-password', '/reset-password', '/auth/callback', '/payment/return', '/payment/cancel', '/newsletter/confirm', '/newsletter/unsubscribe', '/contact', '/services'];
const SHELL_CACHE = 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600';

const h = fn => (req,res,next) => Promise.resolve(fn(req,res)).catch(next);
export function createWebRouter({ db, repo, auth, optionalAuth, requireAdmin, appUrl, publicDir, siteVerification = {} }) {
  const router = express.Router();
  const verification = [['google-site-verification', siteVerification.google], ['msvalidate.01', siteVerification.bing]];
  const abs = value => new URL(value || '/assets/gaming-cover.jpg', appUrl).href;
  async function branding() {
    const [site,social] = await Promise.all([repo.getPublicSite(db),repo.listSocialLinks(db)]);
    return { site: site || {}, social };
  }
  const send = async (res, options) => {
    const nonce = options.nonce || randomBytes(18).toString('base64');
    res.set('Content-Security-Policy', adCsp(nonce));
    const cookie = res.req?.headers?.cookie || '';
    // HTML varies with the visitor's cookies, so shared caches and the CDN must never keep it. Signed-in pages are not stored at all;
    // anonymous pages may be kept by the browser but are always revalidated, which keeps back/forward navigation instant.
    res.set('Cache-Control', /(?:^|;\s*)(?:__Host-)?eliah_(?:at|rt)=/.test(cookie) ? 'private, no-store' : 'private, no-cache');
    res.vary('Cookie');
    const image = options.image || abs('/assets/gaming-cover.jpg');
    res.type('html').send(layout({ browsing:browsingFromCookie(cookie), canonical: appUrl, image, imageSize: knownImageSize(image), twitterSite: twitterHandle(options.social), verification, nonce, ...options }));
  };
  const page = req => Math.min(50000,Math.max(1,Number.parseInt(req.query.page,10)||1));
  const pager = (meta, current, base) => `<nav aria-label="Article pages" class="d-flex gap-3 my-4">${current>1?`<a class="btn btn-outline-primary" href="${base}${base.includes('?')?'&':'?'}page=${current-1}">← Previous</a>`:''}<span class="align-self-center">Page ${current}</span>${meta.has_more?`<a class="btn btn-outline-primary" href="${base}${base.includes('?')?'&':'?'}page=${current+1}">Next →</a>`:''}</nav>`;

  router.get(['/', '/posts', '/category/:slug'], h(async (req,res) => {
    const current=page(req), category=req.params.slug, home=req.path==='/';
    const homeSettings=home&&repo.getPublicSetting?await repo.getPublicSetting(db,'homepage'):null;
    const pageSize=home?Math.max(1,Math.min(24,Number(homeSettings?.latest_post_count)||6)):12;
    const [brand,result,categories]=await Promise.all([branding(),repo.listPostsPage(db,{limit:pageSize,offset:(current-1)*pageSize,category}),repo.listCategories(db)]);
    const selected=categories.find(c=>c.slug===category);
    if(category&&!selected) return res.status(404).type('html').send(layout({title:'Category not found',noindex:true,body:'<div class="container py-5"><h1>Category not found</h1><a href="/posts">Browse guides</a></div>',canonical:appUrl+'/posts',image:abs(),...brand}));
    const title=selected?.name || (home?(homeSettings?.hero_title||'Play smarter. Solve problems.'):'Latest gaming guides');
    const heroDescription=homeSettings?.hero_description||'PPSSPP settings, football tactics, Android guides and practical help for your next game.';
    const safeLink=value=>/^\/(?![\/\\])/.test(value||'')||/^https:\/\//.test(value||'')?value:'/posts';
    const homeFeatured=home&&homeSettings?.featured_post_slug?await repo.getPost(db,homeSettings.featured_post_slug):null;
    let homeBody='',homeHasNewsletter=false;
    if(home){
      const homeSections=homeSettings?.sections||[{key:'categories',enabled:true},{key:'latest',enabled:true},{key:'ai',enabled:true},{key:'premium',enabled:true},{key:'newsletter',enabled:true}];
      const services=homeSections.some(s=>s.key==='services'&&s.enabled)&&repo.listServices?await repo.listServices(db):[];
      for(const section of homeSections.filter(s=>s.enabled)){
        let inner='',heading=section.title,action=null;
        if(section.key==='latest'){heading||='Latest gaming guides';inner=result.items.length?cards(result.items):emptyState({icon:'book',title:'Guides are on the way',text:'New gaming guides will appear here as soon as they are published.',action:['/games','Explore game hubs']});action=['/posts','Browse all guides'];}
        if(section.key==='categories'){heading||='Explore gaming topics';inner=categories.length?topicTiles(categories):'<p>Topics will appear here soon.</p>';action=['/categories','All topics'];}
        if(section.key==='featured'){const featured=homeFeatured||result.items.find(p=>p.slug===homeSettings?.featured_post_slug)||result.items.find(p=>p.featured)||result.items[0];heading||='Featured guide';inner=featured?cards([featured]):'';}
        if(section.key==='services'){heading||='Gaming help and resources';inner='<div class="row g-3">'+services.map(s=>`<div class="col-md-6 col-lg-4"><article class="card h-100 p-4"><h3 class="h5">${escape(s.title)}</h3><p>${escape(s.description)}</p><a href="${escape(safeLink(s.action_url))}">${escape(s.action_text||'Explore guides')} →</a></article></div>`).join('')+'</div>';}
        if(section.key==='ai'){heading||='Ask Eliahtech AI';inner=promoBand({kind:'ai',text:'Get help with your game, emulator or error screenshot. Free-provider limits apply.',href:'/ai',label:'Open the assistant',buttonClass:'btn-warning'});}
        if(section.key==='premium'){heading||='Go further with Premium';inner=promoBand({kind:'premium',text:'Ad-free posts, advanced gaming guides and priority setup support.',href:'/premium',label:'Explore membership',buttonClass:'btn-warning'});}
        if(section.key==='youtube'&&/^[A-Za-z0-9_-]{11}$/.test(section.video_id||'')){heading||='Watch and learn';inner=`<div class="ratio ratio-16x9"><iframe loading="lazy" title="${escape(heading)}" src="https://www.youtube-nocookie.com/embed/${section.video_id}" allowfullscreen></iframe></div>`;}
        if(section.key==='newsletter'){heading||='Follow gaming updates';inner=newsletterCard();homeHasNewsletter=true;}
        if(inner)homeBody+=homeSection({key:section.key,heading,description:section.description,inner,action});
      }
    }
    const listBase=appUrl+(home?'':category?'/category/'+encodeURIComponent(category):'/posts');
    const canonicalUrl=(home?appUrl+'/':listBase)+(current>1?'?page='+current:'');
    const seoTitle=home?HOME_TITLE:pageLabel(title,current);
    const seoDescription=home?heroDescription:listingDescription({name:selected?.name,description:selected?.description,page:current});
    const seoStructured=home?graph(organizationNode({appUrl,social:brand.social}),websiteNode({appUrl})):graph(collectionNode({appUrl,url:canonicalUrl,name:seoTitle,description:seoDescription,posts:result.items}),breadcrumbNode(selected?[['Home',appUrl],['Guides',appUrl+'/posts'],[selected.name,listBase]]:[['Home',appUrl],['Guides',appUrl+'/posts']]));
    await send(res,{...brand,showSubscribe:!homeHasNewsletter,title:seoTitle,description:seoDescription,structured:seoStructured,canonical:canonicalUrl,body:`${home?homeHero({title,description:heroDescription,categories,total:result.meta?.total,settings:homeSettings,safeLink}):`<section class="hero page-banner"><div class="container"><span class="eyebrow">ELIAHTECH GAMING</span><h1>${escape(title)}</h1><p>${escape(heroDescription)}</p><form action="/search" class="d-flex gap-2" role="search"><input class="form-control" name="q" placeholder="Game, device or error message" aria-label="Search guides" required><button class="btn btn-warning">Search</button></form></div></section>`}${home?homeBody:`<section class="container py-5"><div class="d-flex gap-2 flex-wrap mb-4">${categories.map(c=>`<a class="btn btn-sm btn-outline-primary" href="/category/${escape(c.slug)}">${escape(c.name)}</a>`).join('')}</div>${result.items.length?cards(result.items):emptyState({icon:'book',title:'No guides in this section yet',text:'Try another topic, or search for a game, device or error message.',action:['/search','Search guides']})}${pager(result.meta,current,category?'/category/'+encodeURIComponent(category):'/posts')}</section>`}`});
  }));
  router.get('/games',h(async(_req,res)=>{
    const [brand,games]=await Promise.all([branding(),repo.listGameHubs(db)]);
    await send(res,{...brand,title:'Game hubs',description:'Installation steps, settings, updates, textures and troubleshooting for the games you play, organised in one hub per game.',structured:graph(breadcrumbNode([['Home',appUrl],['Game hubs',appUrl+'/games']])),canonical:appUrl+'/games',body:`<section class="container py-5"><span class="eyebrow">YOUR GAME, IN ONE PLACE</span><h1>Explore game hubs</h1><p class="lead">Find installation steps, updates, settings, textures and troubleshooting for your game.</p>${games.length?gameCards(games):emptyState({icon:'gamepad',title:'Game hubs are coming soon',text:'Installation steps, settings and fixes for each game will be collected here.',action:['/posts','Browse all guides']})}</section>`});
  }));
  router.get('/games/:slug',h(async(req,res)=>{
    const game=await repo.getGameHub(db,req.params.slug);if(!game)return res.status(404).type('html').send(layout({title:'Game hub not found',canonical:appUrl+'/games',image:abs(),body:'<section class="container py-5"><h1>Game hub not found</h1><a href="/games">Browse game hubs</a></section>'}));
    const current=page(req),type=['guide','installation','settings','textures','update','troubleshooting'].includes(req.query.type)?req.query.type:'';
    const [brand,result]=await Promise.all([branding(),repo.searchPostsPage(db,'',{game:game.id,type,limit:12,offset:(current-1)*12})]);
    const types=[['','All guides'],['installation','Installation'],['settings','Settings'],['guide','Gameplay guides'],['textures','Graphics & textures'],['update','Updates'],['troubleshooting','Troubleshooting']];
    const base='/games/'+encodeURIComponent(game.slug)+(type?'?type='+encodeURIComponent(type):'');
    await send(res,{...brand,title:game.name+' guides & support',description:game.summary||`Installation, settings, updates and troubleshooting guides for ${game.name}.`,structured:graph(breadcrumbNode([['Home',appUrl],['Game hubs',appUrl+'/games'],[game.name,appUrl+base]])),canonical:appUrl+base,image:abs(safeImage(game.cover_image_url||'/slides/football-1.webp')),body:`<section class="container py-5"><nav><a href="/games">Game hubs</a> → ${escape(game.name)}</nav><div class="row align-items-center g-4 my-2"><div class="col-md-7"><span class="eyebrow">GAME HUB</span><h1>${escape(game.name)}</h1><p class="lead">${escape(game.summary)}</p><p>${(game.platforms||[]).map(p=>`<span class="badge text-bg-primary me-1">${escape(p.toUpperCase())}</span>`).join('')}</p></div><div class="col-md-5"><img class="w-100 rounded-4" width="640" height="360" src="${escape(safeImage(game.cover_image_url||(game.platforms?.includes('ppsspp')?'/slides/psp-1.webp':'/slides/football-1.webp')))}" alt="${escape(game.name)} guide hub"></div></div><nav class="d-flex gap-2 flex-wrap my-4" aria-label="Guide types">${types.map(([key,label])=>`<a class="btn btn-sm ${key===type?'btn-primary':'btn-outline-primary'}" href="/games/${escape(game.slug)}${key?'?type='+key:''}">${label}</a>`).join('')}</nav>${result.items.length?cards(result.items):'<div class="reader-actions"><h2 class="h5">Guides are being organized</h2><p>There are no published guides in this section yet. Explore the other sections or request a tutorial.</p><a href="/community">Request a tutorial</a></div>'}${pager(result.meta,current,base)}</section>`});
  }));
  router.get('/search',h(async(req,res)=>{
    const q=String(req.query.q||'').trim().slice(0,80),current=page(req);
    const [brand,games,result]=await Promise.all([branding(),repo.listGameHubs(db),repo.searchPostsPage(db,q,{...req.query,limit:12,offset:(current-1)*12})]);
    const f=result.meta.filters||{};
    const select=(name,label,choices,value)=>`<label class="form-label col-sm-6 col-lg-3">${label}<select name="${name}" class="form-select"><option value="">All</option>${choices.map(([id,text])=>`<option value="${escape(id)}" ${String(id)===String(value)?'selected':''}>${escape(text)}</option>`).join('')}</select></label>`;
    const params=new URLSearchParams(Object.entries(req.query).filter(([key])=>key!=='page'));const base='/search'+(params.size?'?'+params:'');
    await send(res,{...brand,title:q?'Search: '+q:'Find your next guide',canonical:appUrl+'/search',noindex:true,body:`<section class="container py-5" data-search-total="${result.meta.total}"><h1>Find the right guide</h1><form class="reader-actions mb-4"><label class="form-label d-block" for="guide-query">Game, topic or error message<input id="guide-query" name="q" class="form-control" maxlength="80" value="${escape(q)}" placeholder="Search guides"></label><div class="row g-3">${select('game','Game',games.map(g=>[g.id,g.name]),f.game)}${select('platform','Platform',[['android','Android'],['ppsspp','PSP / PPSSPP'],['pc','PC'],['console','Console'],['other','Other']],f.platform)}${select('type','Guide type',[['guide','Gameplay guide'],['installation','Installation'],['settings','Settings'],['textures','Graphics & textures'],['update','Updates'],['troubleshooting','Troubleshooting']],f.content_type)}${select('access','Access',[['free','Free'],['premium','Premium']],f.access)}<label class="form-label col-sm-6">My device RAM (GB)<input class="form-control" name="ram" type="number" min="0.25" max="128" step="0.25" value="${escape(f.ram||'')}" placeholder="Any"></label><label class="form-label col-sm-6">Available storage (MB)<input class="form-control" name="storage" type="number" min="1" max="2000000" value="${escape(f.storage||'')}" placeholder="Any"></label></div><p class="small text-secondary mt-2">RAM/storage filters include only guides with declared requirements. They do not guarantee performance on a particular device.</p><button class="btn btn-primary">Apply filters</button> <a href="/search" class="btn btn-outline-primary">Clear</a></form><p>${Number(result.meta.total)} matching guides</p>${result.items.length?cards(result.items):emptyState({icon:'search',title:q?'No guides match “'+q.slice(0,60)+'”':'No matching guides',text:'Try fewer filters or a different game name, or ask us to write the tutorial you need.',action:['/community','Request a tutorial']})}${pager(result.meta,current,base)}</section>`});
  }));
  // Old Blogger addresses (/2025/11/some-post.html) keep working: they redirect permanently to the matching new post.
  router.get(/^\/\d{4}\/\d{2}\/([a-z0-9-]{1,120})\.html$/,(req,res)=>res.redirect(301,`/posts/${req.params[0]}`));
  router.get('/posts/:slug', (req,res,next)=>{
    res.set('Cache-Control','private, no-store');
    // Invalid/expired cookies fail closed before ads or protected content are rendered.
    optionalAuth(req,res,async error=>{
      if(!error&&req.user)return next();
      const secure=appUrl.startsWith('https:'),refresh=req.browserCookies?.[cookieNames(secure).refresh];
      if(!refresh||!auth)return next(error);
      if(error&&error.status!==401)return next(error);
      try{const {session}=await auth.refresh(refresh);res.setHeader('Set-Cookie',sessionCookies(session,{secure}));req.headers.authorization='Bearer '+session.access_token;optionalAuth(req,res,next);}catch(err){next(err);}
    });
  },h(async(req,res)=>{
    const [post,brand]=await Promise.all([repo.getPost(db,req.params.slug),branding()]);
    if(!post) return res.status(404).type('html').send(layout({title:'Article not found',canonical:appUrl+'/posts',image:abs(),body:'<section class="container py-5"><h1>Article not found</h1><a href="/posts">Browse guides</a></section>',...brand}));
    const locked=post.is_premium&&!req.user?.access?.isPremium, url=appUrl+'/posts/'+encodeURIComponent(post.slug),nonce=randomBytes(18).toString('base64');
    let ads=[];
    // Direct site scripts (src/web/site-scripts.js) follow the same rule as admin ads: posts only, never for premium members, locked or ads-off posts.
    const siteScripts=adEligible({isPost:true,user:req.user})&&!locked&&!post.ads_disabled;
    // Upgrade dialog: locked premium post for non-members, or an ended trial. Members are never prompted.
    const upgradeMode=locked?'locked':(req.user&&!req.user.access?.isPremium&&req.user.access?.trial?.expired?'expired':'');
    const upgradeHead=upgradeMode?`<meta name="etg-upgrade" content="${upgradeMode}"${req.user?'':' data-guest="1"'}><script src="/upgrade-prompt.js" defer></script>`:'';
    if(siteScripts){
      const [setting]=await db.select('settings',{select:'value',key:'eq.ads',limit:'1'});
      if(setting?.value?.enabled===true) { const mobile=/Android|iPhone|iPad|Mobile/i.test(req.headers['user-agent']||''); ads=activeAds(await db.select('ad_placements',{select:'*',enabled:'eq.true',order:'sort_order.asc'})).filter(a=>(a.placement!=='sidebar'||!mobile)&&(!a.device||a.device==='both'||a.device===(mobile?'mobile':'desktop'))); }
    }
    const placement=(key)=>ads.filter(a=>a.placement===key).map(a=>adMarkup(a,nonce)).join('');
    const sidebar=placement('sidebar');
    let content=locked?'':post.content;
    const bodyAds=ads.filter(a=>a.placement==='body');
    for(const ad of bodyAds){let count=0;content=content.replace(/<\/p>/gi,match=>{count++;return match+(count===(ad.paragraph||3)?adMarkup(ad,nonce):'');});}
    const [related,updates]=await Promise.all([repo.nextGuides?repo.nextGuides(db,post):repo.listPosts(db,{category:post.category?.slug,limit:4}),repo.listPostUpdates?repo.listPostUpdates(db,post.id):[]]);
    const postImage=abs(safeImage(post.og_image||post.featured_image));
    const structured=locked?undefined:graph(organizationNode({appUrl,social:brand.social}),websiteNode({appUrl}),articleNode({post,url,image:postImage,appUrl,tags:tagNames(post)}),breadcrumbNode([['Home',appUrl],[post.category?.name||'Guides',appUrl+'/posts'],[post.title,url]]));
    await send(res,{...brand,title:post.seo_title||post.title,description:post.seo_description||post.excerpt,canonical:url,image:postImage,ogType:'article',siteScripts,extraHead:upgradeHead,imageAlt:post.featured_image_alt||post.title,article:{published:isoDate(post.published_at),modified:isoDate(post.updated_at||post.published_at),section:post.category?.name,author:post.author,tags:tagNames(post)},structured,nonce,body:`${placement('auto')}<div class="container py-4"><div class="article-grid ${sidebar?'has-sidebar':''}"><article class="article-wrap" data-post-id="${escape(post.id)}"><nav aria-label="Breadcrumb"><a href="/">Home</a> → <a href="/posts">${escape(post.category?.name||'Guides')}</a></nav>${placement('header')}${post.game?`<p class="mt-3"><a href="/games/${escape(post.game.slug)}">Explore the ${escape(post.game.name)} hub →</a></p>`:''}<h1 class="display-5 fw-bold mt-4">${escape(post.title)}</h1><p class="lead">${escape(post.excerpt)}</p><p class="text-secondary">By ${escape(post.author||'Eliahtech Gaming')} · ${date(post.published_at)} · ${Number(post.reading_time)||1} min read</p>${articleCover(post)}${share(url,post.title)}${compatibilityPanel(post)}<div class="d-flex gap-2 flex-wrap mb-4">${socials(brand.social)}</div>${locked?'<section class="reader-actions premium-lock"><h2>Continue with Premium</h2><p>Sign in with an active membership to read this guide.</p><a class="btn btn-primary" href="/login">Sign in</a> <a class="btn btn-warning" href="/premium">Explore Premium</a></section>':`<div class="article-body">${content}</div>${post.installation_guide?`<section class="reader-actions mt-4"><h2>${escape(post.installation_guide.title)}</h2><div class="article-body">${post.installation_guide.content}</div></section>`:''}${updateHistory(updates)}<section class="reader-actions mt-4"><h2 class="h5">Was this guide helpful?</h2><button class="btn btn-outline-success btn-sm" data-feedback="helpful">Yes</button> <button class="btn btn-outline-secondary btn-sm" data-feedback="unhelpful">Needs improvement</button> <button class="btn btn-outline-primary btn-sm" data-bookmark>Save guide</button><form id="report-form" class="mt-3"><label class="form-label" for="report-text">Report a broken link or outdated instructions</label><textarea id="report-text" name="message" class="form-control" maxlength="2000" required></textarea><button class="btn btn-sm btn-outline-danger mt-2">Send report</button></form><p id="reader-status" role="status"></p></section><section class="reader-actions mt-4"><h2 class="h5">Reader solutions</h2><div id="comments-list" aria-busy="true"><span class="visually-hidden">Loading reader solutions…</span><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line w-75"></span></div><form id="comment-form"><label class="form-label" for="comment-text">Share a working solution (sign-in required; moderated)</label><textarea class="form-control" id="comment-text" name="body" maxlength="3000" required></textarea><button class="btn btn-primary btn-sm mt-2">Submit comment</button></form></section>${placement('footer')}`}${share(url,post.title)}<div class="d-flex gap-2 flex-wrap my-4">${socials(brand.social)}</div></article>${sidebar?`<aside class="article-sidebar">${sidebar}</aside>`:''}</div><section class="mt-5"><h2>Continue learning</h2><p>Explore the next useful settings, installation or troubleshooting guide.</p>${cards(related.filter(p=>p.id!==post.id).slice(0,3))}</section></div>`});
  }));
  router.get('/post/:slug',(req,res)=>res.redirect(301,'/posts/'+encodeURIComponent(req.params.slug)));
  router.get('/preview/:id',requireAdmin,h(async(req,res)=>{
    const [row]=await db.select('posts',{select:'title,content_html,excerpt',id:`eq.${req.params.id}`,limit:'1'});
    if(!row)return res.sendStatus(404);
    res.set('Cache-Control','private, no-store');
    await send(res,{title:row.title,canonical:appUrl+'/posts',noindex:true,body:`<section class="container py-5 article-wrap"><p class="badge text-bg-warning">Private admin preview</p><h1>${escape(row.title)}</h1><p>${escape(row.excerpt)}</p><div class="article-body">${sanitizeContent(row.content_html)}</div></section>`});
  }));
  router.get('/sitemap.xml',h(async(_req,res)=>{
    const {total}=await db.selectPage('posts',{select:'id',status:'eq.published',published_at:`lte.${new Date().toISOString()}`,limit:'1'});
    const count=Math.max(1,Math.ceil(total/1000));
    res.set('Cache-Control',PUBLIC_FILE_CACHE).type('xml').send(sitemapIndex(Array.from({length:count},(_,i)=>({loc:`${appUrl}/sitemaps/posts-${i+1}.xml`}))));
  }));
  router.get('/sitemaps/posts-:page.xml',h(async(req,res)=>{
    const index=Number(req.params.page);if(!Number.isInteger(index)||index<1)return res.sendStatus(404);
    const posts=await repo.listPostSlugs(db,{offset:(index-1)*1000,limit:1000});
    const categories=index===1?await repo.listCategories(db):[];
    const games=index===1&&repo.listGameHubs?await repo.listGameHubs(db):[];
    const fixed=index===1?[...STATIC_SITEMAP_PATHS.map(p=>({loc:appUrl+p})),...categories.map(c=>({loc:appUrl+'/category/'+encodeURIComponent(c.slug)})),...games.map(g=>({loc:appUrl+'/games/'+encodeURIComponent(g.slug),lastmod:isoDate(g.updated_at)}))]:[];
    const entries=[...fixed,...posts.map(p=>({loc:`${appUrl}/posts/${encodeURIComponent(p.slug)}`,lastmod:isoDate(p.updated_at||p.published_at),images:/gaming-cover/.test(p.featured_image_url||'')?[]:[absoluteUrl(p.featured_image_url,appUrl)].filter(u=>p.featured_image_url&&/^https?:/.test(u||''))}))];
    res.set('Cache-Control',PUBLIC_FILE_CACHE).type('xml').send(sitemapUrlset(entries));
  }));
  router.get('/robots.txt',(_req,res)=>res.set('Cache-Control',PUBLIC_FILE_CACHE).type('txt').send(robotsTxt(appUrl)));
  router.get('/feed.xml',h(async(_req,res)=>{
    const [brand,result]=await Promise.all([branding(),repo.listPostsPage(db,{limit:30,offset:0})]);
    res.set('Cache-Control',FEED_CACHE).set('Content-Type','application/rss+xml; charset=utf-8').send(rssFeed({appUrl,description:metaDescription(brand.site?.description,DEFAULT_DESCRIPTION),posts:result.items}));
  }));
  router.get('/categories/:slug',(req,res)=>res.redirect(301,'/category/'+encodeURIComponent(req.params.slug)));
  router.get('/categories',h(async(_req,res)=>{const [brand,categories]=await Promise.all([branding(),repo.listCategories(db)]);await send(res,{...brand,title:'Gaming categories',description:'Browse every Eliahtech Gaming topic: PPSSPP, Android games, football games, installation help, graphics and tech tips.',structured:graph(breadcrumbNode([['Home',appUrl],['Topics',appUrl+'/categories']])),canonical:appUrl+'/categories',body:`<section class="container py-5"><h1>Explore gaming guides</h1>${categories.map(c=>`<p><a href="/category/${escape(c.slug)}">${escape(c.name)}</a> · ${escape(c.description)}</p>`).join('')}</section>`});}));
  router.get('/newsletter',(_req,res)=>res.redirect(302,'/contact'));
  router.get('/community',h(async(_req,res)=>send(res,{title:'My dashboard',showSlideshow:false,canonical:appUrl+'/community',noindex:true,body:'<section class="container dash-page"><h1 class="visually-hidden">My dashboard</h1><div id="community-root" aria-live="polite" aria-busy="true"><span class="visually-hidden">Loading your dashboard…</span>'+skeletonPanel(2)+skeletonPanel(4)+'</div></section>'})));
  router.get('/profile',(_req,res)=>res.redirect(302,'/community'));
  router.get(['/about','/privacy','/terms','/disclaimer','/dmca'],h(async(req,res)=>{
    const pageData=pages[req.path.slice(1)];
    const content=pageData?.body ? sanitizeContent(pageData.body) : Array.isArray(pageData?.sections)?pageData.sections.map(s=>`<h2>${escape(s.title||s.heading)}</h2><p>${escape(s.text||s.body||s.content)}</p>`).join(''):'';
    await send(res,{...await branding(),title:STATIC_TITLES[req.path]||pageData?.title||req.path.slice(1),description:pageData?.lead||undefined,canonical:appUrl+req.path,body:`<section class="container py-5 article-wrap"><h1>${escape(pageData?.title||req.path.slice(1))}</h1><p class="lead">${escape(pageData?.lead||'')}</p>${content||'<p>Eliahtech Gaming provides practical gaming guides and troubleshooting. Contact us for help or content enquiries.</p>'}</section>`});
  }));
  const shell=fs.readFileSync(path.join(publicDir,'admin.html'),'utf8').replace('</head>','<link rel="stylesheet" href="/workspace.css"><link rel="stylesheet" href="/fonts.css"><link rel="stylesheet" href="/mobile.css"></head>');
  // Public app pages (/premium, /contact, /services, /ai) get their own title, description, canonical, social tags and are indexable;
  // sign-in, payment and admin pages stay noindex (also sent as a header).
  router.get(SHELL_PATHS,h(async(req,res)=>{
    const cfg=shellSeo(req.path);
    if(!cfg.index){res.set('Cache-Control','private, no-store').set('X-Robots-Tag','noindex, nofollow');}
    else res.set('Cache-Control',SHELL_CACHE);
    const social=cfg.index?(await branding().catch(()=>({social:[]}))).social:[];
    res.type('html').send(injectShellSeo(shell,{pathname:req.path,appUrl,image:abs('/assets/gaming-cover.jpg'),social}));
  }));
  router.use((err,req,res,next)=>{
    if(req.path.startsWith('/api/'))return next(err);
    const status=err.status===401?401:err.status===403?403:503;
    res.status(status).set('Cache-Control','no-store').type('html').send(layout({title:status===401?'Sign in again':'Temporarily unavailable',canonical:appUrl+req.path,image:abs(),noindex:true,body:`<section class="container py-5"><h1>${status===401?'Please sign in again':'This page is temporarily unavailable'}</h1><p>${status===401?'Your session has expired.':'We could not load this page. Your content has not been deleted.'}</p><a href="/login" class="btn btn-primary">Sign in</a> <a href="${escape(req.path)}" class="btn btn-outline-primary">Retry</a></section>`}));
  });
  return router;
}
export function registerWebRoutes(app, options) { app.use(createWebRouter(options)); }

// Friendly, correctly-statused 404 page for unknown browser URLs (JSON for API clients). Never indexed.
export function createNotFoundHandler({ db, repo, appUrl }) {
  return async (req, res) => {
    if (req.path.startsWith('/api') || !req.accepts('html')) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'API route not found.' } });
    let brand = { site: {}, social: [] };
    try { const [site, social] = await Promise.all([repo.getPublicSite(db), repo.listSocialLinks(db)]); brand = { site: site || {}, social }; } catch { /* the 404 page must render even if the database is down */ }
    res.status(404).set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex').type('html').send(layout({ ...brand, title: 'Page not found', description: 'This page could not be found.', noindex: true, canonical: appUrl + '/', image: new URL('/assets/gaming-cover.jpg', appUrl).href, showSlideshow: false, body: `<section class="container py-5">${emptyState({ icon: 'search', title: 'We could not find that page', text: 'It may have moved or never existed. Try searching, or browse the latest guides.', action: ['/posts', 'Browse guides'] })}</section>` }));
  };
}
