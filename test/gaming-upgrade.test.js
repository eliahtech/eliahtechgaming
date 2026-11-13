import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import path from 'node:path';
import { createWebRouter } from '../src/web/routes.js';
import { adEligible, activeAds, adMarkup, adDomains, adCsp, AD_INLINE_HASHES } from '../src/web/ads.js';
import { browserSession } from '../src/session/express.js';
import { sessionCookies, csrfProblem } from '../src/session/cookies.js';
import { registerGoogle } from '../src/session/google.js';
import { selectCandidates, executeWithFailover } from '../src/ai/router.js';
import { defaultSettings } from '../src/ai/config.js';
import { parseChatBody } from '../src/ai/service.js';
import { ProviderError, postJson } from '../src/ai/providers/base.js';
import { OpenRouterProvider } from '../src/ai/providers/openrouter.js';

const post={id:'11111111-1111-4111-8111-111111111111',slug:'ppsspp-guide',title:'PPSSPP setup',excerpt:'Set up your emulator.',author:'Elias',featured_image:'https://cdn.example/cover.jpg',category:{name:'PPSSPP',slug:'psp-ppsspp'},reading_time:4,published_at:'2026-01-01T00:00:00Z',updated_at:'2026-02-01T00:00:00Z',content:'<p>BODY_SENTINEL</p><p>Two</p><p>Three</p>',installation_guide:{title:'Installation steps',content:'<p>GUIDE_SENTINEL</p>'},tags:[]};
const root=path.resolve('public');
function site({premium=false,locked=false,failing=false,homeSettings=null}={}){
 const app=express();
 const db={select:async(table)=>table==='settings'?[{value:{enabled:true}}]:table==='ad_placements'?[{placement:'header',enabled:true,code:'<script src="https://ads.example/loader.js"></script><ins>AD_SENTINEL</ins>',device:'both'}]:[],selectPage:async()=>({total:2005})};
 const repo={getPublicSetting:async()=>homeSettings,getPublicSite:async()=>({gaming_identity:'Eliahtech Gaming'}),listSocialLinks:async()=>[{platform:'Telegram',url:'https://t.me/eliahtech'}],listCategories:async()=>[{slug:'psp-ppsspp',name:'PPSSPP'}],getPost:async()=>{if(failing)throw new Error('db down');return {...post,is_premium:locked};},listPosts:async()=>[],listPostsPage:async()=>({items:[post],meta:{has_more:true,total:90}}),listPostSlugs:async(_db,{offset})=>[{slug:'guide-'+offset}]};
 const optionalAuth=(req,_res,next)=>{req.user=premium?{access:{isPremium:true}}:null;next();};
 app.use(createWebRouter({db,repo,optionalAuth,requireAdmin:(_req,res)=>res.sendStatus(403),appUrl:'https://gaming.example',publicDir:root}));
 return app;
}
test('article HTML contains real cover, body, linked guide, metadata and canonical share URL without JavaScript',async()=>{
 process.env.AD_ALLOWED_ORIGINS='https://ads.example';
 const res=await request(site()).get('/posts/ppsspp-guide');assert.equal(res.status,200);
 for(const text of ['BODY_SENTINEL','GUIDE_SENTINEL','og:image','https://cdn.example/cover.jpg','BlogPosting','https://gaming.example/posts/ppsspp-guide','wa.me','t.me/share'])assert.ok(res.text.includes(text),text);
 assert.match(res.headers['cache-control'],/private, no-cache/);assert.match(res.text,/AD_SENTINEL/);assert.match(res.headers['content-security-policy'],/nonce-/);
});
test('active Premium users get article content and no manual or auto-ad loader',async()=>{
 const res=await request(site({premium:true})).get('/posts/ppsspp-guide');assert.equal(res.status,200);assert.match(res.text,/BODY_SENTINEL/);assert.doesNotMatch(res.text,/AD_SENTINEL|ads\.example\/loader/);
});
test('locked premium bodies and installation guides never reach guest HTML or structured data',async()=>{
 const res=await request(site({locked:true})).get('/posts/ppsspp-guide');assert.equal(res.status,200);assert.doesNotMatch(res.text,/BODY_SENTINEL|GUIDE_SENTINEL|AD_SENTINEL/);assert.match(res.text,/Continue with Premium/);
});
test('home and listing never include ad code, and pagination links are real URLs',async()=>{
 const home=await request(site()).get('/');assert.doesNotMatch(home.text,/AD_SENTINEL|ads\.example\/loader/);const listing=await request(site()).get('/posts');assert.match(listing.text,/\/posts\?page=2/);assert.match(home.text,/col-12 col-sm-6 col-lg-4/);
});
test('sitemap index paginates beyond Supabase row caps and legacy links redirect permanently',async()=>{
 const app=site();const index=await request(app).get('/sitemap.xml');assert.match(index.text,/posts-3.xml/);const page=await request(app).get('/sitemaps/posts-3.xml');assert.match(page.text,/guide-2000/);const old=await request(app).get('/post/ppsspp-guide');assert.equal(old.status,301);assert.equal(old.headers.location,'/posts/ppsspp-guide');
});
test('database outages return a retry state and 503, never an empty article or 404',async()=>{
 const res=await request(site({failing:true})).get('/posts/ppsspp-guide');assert.equal(res.status,503);assert.match(res.text,/temporarily unavailable/);assert.doesNotMatch(res.text,/db down|Article not found/);
});
test('ad scheduling and eligibility fail closed, and unknown script origins are stripped',()=>{
 assert.equal(adEligible({isPost:true,user:null}),true);assert.equal(adEligible({isPost:false}),false);assert.equal(adEligible({isPost:true,verified:false}),false);assert.equal(adEligible({isPost:true,user:{access:{isPremium:true}}}),false);
 assert.equal(activeAds([{enabled:false},{enabled:true,starts_at:'2099-01-01'},{enabled:true,ends_at:'2020-01-01'},{enabled:true}]).length,1);
 process.env.AD_ALLOWED_ORIGINS='https://ads.example';assert.doesNotMatch(adMarkup({placement:'header',code:'<script src="https://evil.example/x.js"></script>'},'abc'),/evil.example/);
});
test('browser login returns HttpOnly cookies without exposing tokens, and mutations require CSRF',async()=>{
 const app=express();app.use(browserSession({appUrl:'https://gaming.example'}));app.post('/api/v1/auth/login',(_req,res)=>res.json({success:true,data:{session:{access_token:'ACCESS_SECRET',refresh_token:'REFRESH_SECRET',expires_in:3600}}}));app.post('/api/v1/change',(_req,res)=>res.json({success:true}));
 const login=await request(app).post('/api/v1/auth/login').set('X-Eliah-Browser','1');assert.doesNotMatch(login.text,/ACCESS_SECRET|REFRESH_SECRET/);assert.match(login.headers['set-cookie'].join(';'),/HttpOnly/);
 const cookies=login.headers['set-cookie'].map(c=>c.split(';')[0]).join('; ');
 assert.equal((await request(app).post('/api/v1/change').set('Cookie',cookies)).status,403);
 const csrf=/__Host-eliah_csrf=([^;]+)/.exec(cookies)[1];assert.equal((await request(app).post('/api/v1/change').set('Cookie',cookies).set('Origin','https://gaming.example').set('X-CSRF-Token',csrf)).status,200);
});
test('OAuth start uses PKCE and refuses hostile next paths; callback requires flow cookie',async()=>{
 const before={...process.env};process.env.GOOGLE_AUTH_ENABLED='true';process.env.SUPABASE_URL='https://project.supabase.co';process.env.SUPABASE_ANON_KEY='test-key';
 try{const app=express();registerGoogle(app,{appUrl:'https://gaming.example'});const start=await request(app).get('/api/auth/google?next=https://evil.example').set('Host','gaming.example');assert.equal(start.status,302);assert.match(start.headers.location,/code_challenge_method=s256/);assert.match(start.headers['set-cookie'][0],/HttpOnly/);const callback=await request(app).get('/api/auth/google/callback?code=abcdefgh');assert.match(callback.headers.location,/google_expired/);}finally{for(const k of ['GOOGLE_AUTH_ENABLED','SUPABASE_URL','SUPABASE_ANON_KEY'])if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}
});
test('multimodal requests never fall back to a text-only model and coding is detected automatically',()=>{
 const settings=defaultSettings({});assert.equal(parseChatBody({message:'Fix my JavaScript function'},settings).capability,'coding');
 const model=(slug,caps)=>({slug,id:slug,ready:true,is_free:true,free_user_enabled:true,premium_user_enabled:true,priority:1,capabilities:caps,provider:{is_free:true,code:slug}});
 const plan=selectCandidates({tier:'free_user',settings,models:[model('text',['general']),model('vision',['multimodal'])],capability:'multimodal'});assert.deepEqual(plan.candidates.map(m=>m.slug),['vision']);
});
test('429 switches to another provider rather than another model sharing its quota',async()=>{
 const candidates=[{slug:'a',provider:{code:'shared'}},{slug:'b',provider:{code:'shared'}},{slug:'c',provider:{code:'other'}}],calls=[];
 const result=await executeWithFailover({candidates,maxAttempts:3,settings:defaultSettings({}),call:async m=>{calls.push(m.slug);if(m.slug==='a')throw new ProviderError('AI_PROVIDER_RATE_LIMITED',{recoverable:true});return {content:'done'};}});
 assert.deepEqual(calls,['a','c']);assert.equal(result.model.slug,'c');
});
test('Retry-After is preserved and free gateway rejects paid IDs before any network call',async()=>{
 await assert.rejects(postJson({url:'https://provider.example',body:{},timeoutMs:100,fetchImpl:async()=>new Response('{}',{status:429,headers:{'Retry-After':'120'}})}),err=>err.retryAfter===120);
 await assert.rejects(new OpenRouterProvider({fetchImpl:()=>{throw new Error('must not call');}}).complete({model:'vendor/paid'}),err=>err.code==='AI_PROVIDER_MISCONFIGURED');
});
test('session cookie CSRF helper rejects mismatched origin even with a matching token',()=>{
 const cookies=sessionCookies({access_token:'at',refresh_token:'rt'},{secure:true}).map(c=>c.split(';')[0]).join('; ');const token=/__Host-eliah_csrf=([^;]+)/.exec(cookies)[1];assert.equal(csrfProblem({method:'POST',url:'https://gaming.example/api/x',headers:new Headers({cookie:cookies,'x-csrf-token':token,origin:'https://evil.example'})},{secure:true,appUrl:'https://gaming.example'}),'ORIGIN_MISMATCH');
});

test('an expired access cookie with a valid refresh cookie renews before premium ad eligibility',async()=>{
 const app=express();let refreshed=0;
 app.use(browserSession({appUrl:'https://gaming.example'}));
 const optionalAuth=(req,_res,next)=>{req.user=req.headers.authorization==='Bearer renewed'?{access:{isPremium:true}}:null;next();};
 const db={select:async table=>table==='ad_placements'?[{code:'AD_SENTINEL',enabled:true,placement:'header'}]:table==='settings'?[{value:{enabled:true}}]:[]};
 const repo={getPost:async()=>post,getPublicSite:async()=>({}),listSocialLinks:async()=>[],listPosts:async()=>[]};
 app.use(createWebRouter({db,repo,auth:{refresh:async token=>{assert.equal(token,'valid-refresh');refreshed++;return{session:{access_token:'renewed',refresh_token:'rotated',expires_in:3600}};}},optionalAuth,requireAdmin:(_req,res)=>res.sendStatus(403),appUrl:'https://gaming.example',publicDir:root}));
 const res=await request(app).get('/posts/ppsspp-guide').set('Cookie','__Host-eliah_rt=valid-refresh');assert.equal(res.status,200);assert.equal(refreshed,1);assert.match(res.text,/BODY_SENTINEL/);assert.doesNotMatch(res.text,/AD_SENTINEL/);assert.ok(res.headers['set-cookie'].some(c=>c.startsWith('__Host-eliah_at=')));
});

test('homepage rendering honors dashboard section visibility and editable hero copy',async()=>{
 const response=await request(site({homeSettings:{hero_title:'MY_GAMING_TITLE',hero_description:'MY_GAMING_DESCRIPTION',latest_post_count:3,sections:[{key:'ai',title:'AI_SECTION',enabled:true},{key:'latest',enabled:false}]}})).get('/');
 assert.equal(response.status,200);assert.match(response.text,/MY_GAMING_TITLE/);assert.match(response.text,/MY_GAMING_DESCRIPTION/);assert.match(response.text,/AI_SECTION/);assert.doesNotMatch(response.text,/class="card post-card/);
});
test('built-in ad origin works without AD_ALLOWED_ORIGINS, other scripts are still stripped, and env origins add to it',()=>{
 const saved=process.env.AD_ALLOWED_ORIGINS;
 try{
  delete process.env.AD_ALLOWED_ORIGINS;
  const tag='<script>atOptions={key:\'k\'};</script><script src=\"https://bauval.org/22/k\"></script><script src=\"https://evil.example/x.js\"></script>';
  const out=adMarkup({placement:'sidebar',code:tag},'abc');
  assert.match(out,/https:\/\/bauval\.org\/22\/k/);assert.match(out,/atOptions/);assert.doesNotMatch(out,/evil\.example/);
  process.env.AD_ALLOWED_ORIGINS='https://ads.example, https://bauval.org';
  assert.deepEqual(adDomains(),['https://bauval.org','https://ads.example']);
 }finally{if(saved===undefined)delete process.env.AD_ALLOWED_ORIGINS;else process.env.AD_ALLOWED_ORIGINS=saved;}
});
test('ad page CSP lets the ad networks finish loading: extra connect origins, banner inline-script hashes, and still a nonce',()=>{
 const csp=adCsp('abc123');
 const get=(name)=>csp.split('; ').find((d)=>d.startsWith(name+' '))||'';
 assert.match(get('connect-src'),/https:\/\/araplhn\.org/);assert.match(get('connect-src'),/https:\/\/6opo\.com/);
 assert.match(get('script-src'),/'nonce-abc123'/);assert.match(get('script-src'),/https:\/\/bauval\.org/);
 for(const h of AD_INLINE_HASHES){assert.match(h,/^sha256-[A-Za-z0-9+\/]{43}=$/);assert.ok(get('script-src').includes(`'${h}'`));}
 assert.doesNotMatch(get('script-src'),/unsafe-inline|unsafe-eval/);assert.match(get('object-src'),/'none'/);assert.match(get('frame-ancestors'),/'none'/);
});
