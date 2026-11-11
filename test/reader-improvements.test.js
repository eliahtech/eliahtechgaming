import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import {registerEditorialRoutes}from'../src/editorial.js';
import {validateFields}from'../src/admin/fields.js';
import {RESOURCES}from'../src/admin/resources.js';
import {EventEmitter}from'node:events';
import {checkLink,isPublicAddress,validateLinkUrl,collectPostLinks,createLinkChecker}from'../src/link-checker.js';
import {searchFilters,searchPostsPage,nextGuides,listPostUpdates}from'../src/repo.js';
import {normalizeBrowsing,browsingFromCookie}from'../public/browsing-preferences.js';
import {renderSlideshow}from'../public/slides-view.js';
import {compatibilityPanel,updateHistory}from'../src/web/templates.js';
const game='11111111-1111-4111-8111-111111111111';
const lookup=async()=>[{address:'93.184.216.34',family:4}];
function transport(responses,calls=[]){return(url,options,callback)=>{const req=new EventEmitter();req.destroy=error=>{if(error)req.emit('error',error);req.emit('close');};req.end=()=>queueMicrotask(()=>{calls.push({url:url.href,options});const result=responses.shift();callback({statusCode:result.status,headers:result.headers||{},destroy(){}});});return req;};}
test('link checks reject local, reserved and mapped addresses before requesting',async()=>{
 for(const ip of['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.1','100.64.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2002:7f00:1::'])assert.equal(isPublicAddress(ip),false,ip);
 assert.equal(isPublicAddress('8.8.8.8'),true);assert.equal(isPublicAddress('2606:4700:4700::1111'),true);
 for(const url of['http://example.com','https://localhost/','https://user:pass@example.com/','https://example.com:8443','https://127.0.0.1'])assert.equal(validateLinkUrl(url),null);
 let requested=false;const result=await checkLink('https://example.com',{lookup:async()=>[{address:'10.0.0.1',family:4}],request:()=>{requested=true;}});assert.equal(result.status,'blocked');assert.equal(requested,false);
});
test('each redirect is checked and DNS is pinned to the validated address',async()=>{
 const calls=[];const result=await checkLink('https://example.com',{lookup,request:transport([{status:302,headers:{location:'https://127.0.0.1/admin'}}],calls)});
 assert.equal(result.status,'blocked');assert.equal(calls.length,1);
 let address;calls[0].options.lookup('example.com',{},(_err,value)=>address=value);assert.equal(address,'93.184.216.34');assert.equal(calls[0].options.agent,false);
 let resolutions=0;const redirect=await checkLink('https://example.com',{lookup:async()=>++resolutions===1?await lookup():[{address:'127.0.0.1',family:4}],request:transport([{status:302,headers:{location:'https://other.example.com/'}}])});assert.equal(redirect.status,'blocked');assert.equal(resolutions,2);
});
test('HEAD fallback checks headers without downloading bodies and distinguishes review from broken',async()=>{
 const calls=[];assert.equal((await checkLink('https://example.com',{lookup,request:transport([{status:405},{status:200}],calls)})).status,'ok');assert.deepEqual(calls.map(c=>c.options.method),['HEAD','GET']);
 for(const [status,expected]of[[404,'broken'],[410,'broken'],[429,'restricted'],[503,'temporary']])assert.equal((await checkLink('https://example.com',{lookup,request:transport([{status}])})).status,expected);
 assert.equal((await checkLink('https://example.com',{lookup:async()=>{throw Error('DNS');}})).status,'temporary');
});
test('link inventory deduplicates, resolves local images and ignores non-web schemes',()=>{
 const rows=collectPostLinks({featured_image_url:'/cover.png',content_html:'<img src="/cover.png"><a href="https://example.com/file?a=1&amp;b=2#part">File</a><a href="mailto:a@example.com">Mail</a>'},'https://site.example');assert.equal(rows.length,2);assert.equal(rows[0].kind,'image');assert.equal(rows[1].url,'https://example.com/file?a=1&b=2');
});
test('background batch inventories downloads and guides and persists check results',async()=>{
 const writes=[],rpcs=[];const db={select:async table=>table==='posts'?[{id:game,content_html:'',installation_guides:{enabled:true,content_html:'<a href="https://example.com/guide">Guide</a>'}}]:[{url:'https://example.com/file'}],rpc:async(name,args)=>{rpcs.push({name,args});return name==='claim_content_links'?[{id:game,url:'https://example.com/file'}]:null;},update:async(...args)=>writes.push(args)};
 const result=await createLinkChecker({db,appUrl:'https://site.example',check:async()=>({status:'broken',http_status:404,reason:null}),now:()=>0}).runBatch({postId:game});assert.equal(result.links_checked,1);assert.equal(rpcs[0].args.p_links.length,2);assert.equal(rpcs[1].args.p_post_id,game);assert.equal(writes[0][2].lease_until,null);assert.equal(writes[0][2].status,'broken');
});
test('search validates filters and never selects premium article bodies',async()=>{
 assert.deepEqual(searchFilters({platform:'android),status.eq.draft',access:'all',game:'bad',ram:'NaN',storage:-1,type:'bad'}),{});
 let query;const db={select:async()=>[],selectPage:async(_table,q)=>{query=q;return{rows:[],total:0};}};
 await searchPostsPage(db,'x),status.eq.draft',{game,platform:'android',access:'premium',type:'settings',ram:2,storage:1024});assert.equal(query.game_id,'eq.'+game);assert.equal(query['game_hubs.enabled'],'eq.true');assert.equal(query.is_premium,'eq.true');assert.equal(query.min_ram_gb,'lte.2');assert.equal(query.storage_mb,'lte.1024');assert.equal(query.content_type,'eq.settings');assert.ok(!query.select.includes('content_html'));assert.ok(!query.or.includes('status.eq.draft'));
});
test('continue learning follows game progression and history exposes only public summaries',async()=>{
 const calls=[];const db={select:async(table,q)=>{calls.push({table,q});return table==='posts'?[{id:'a',content_type:'installation'},{id:'b',content_type:'guide'},{id:'c',content_type:'textures'}]:[];}};
 const next=await nextGuides(db,{id:'current',game_id:game,content_type:'settings'});assert.deepEqual(next.map(p=>p.id),['b','c','a']);assert.equal(calls[0].q.status,'eq.published');assert.ok(!calls[0].q.select.includes('content_html'));await listPostUpdates(db,game);assert.equal(calls[1].q.select,'summary,created_at');
});
test('lightweight preferences survive cookie rendering without slideshow image requests',()=>{
 const saved={lightweight:true,autoplay:false,animations:false};assert.deepEqual(browsingFromCookie('x=1; etg_browsing='+encodeURIComponent(JSON.stringify(saved))),saved);assert.equal(browsingFromCookie('etg_browsing=broken').lightweight,false);assert.deepEqual(normalizeBrowsing({lightweight:'yes'}),{lightweight:false,autoplay:true,animations:true});
 const html=renderSlideshow(saved);assert.equal((html.match(/<img src=/g)||[]).length,0);assert.equal((html.match(/<source srcset=/g)||[]).length,0);assert.match(html,/data-slide-next/);assert.match(html,/data-browsing-settings/);
});
test('compatibility and public change notes escape editor text and do not invent tests',()=>{
 assert.match(compatibilityPanel({}),/No tested devices have been recorded/i);assert.ok(!compatibilityPanel({tested_devices:['<script>bad</script>']}).includes('<script>'));assert.ok(!updateHistory([{summary:'<script>bad</script>',created_at:'2026-10-25'}]).includes('<script>'));
});

test('quality and link-check endpoints require admin before accessing data',async()=>{
 const app=express();let touched=false;const db={rpc:async()=>{touched=true;},select:async()=>{touched=true;return[];}};
 registerEditorialRoutes(app,{db,repo:{listGameHubs:async()=>[]},requireAdmin:(_req,res)=>res.sendStatus(403),optionalAuth:(_req,_res,next)=>next(),limit:()=> (_req,_res,next)=>next(),appUrl:'https://example.com'});
 await request(app).get('/api/v1/editorial/admin/quality').expect(403);await request(app).post('/api/v1/editorial/admin/links/check').expect(403);assert.equal(touched,false);await request(app).get('/api/v1/editorial/games').expect(200);
});
test('compatibility editing accepts fractional RAM and unknowns but rejects invalid requirements',()=>{
 const fields=RESOURCES.posts.fields;assert.deepEqual(validateFields(fields,{min_ram_gb:1.5,storage_mb:null,platform:null},{partial:true}),{min_ram_gb:1.5,storage_mb:null,platform:null});
 for(const body of[{min_ram_gb:0},{min_ram_gb:129},{storage_mb:-1},{storage_mb:1.5},{platform:'unknown'},{change_summary:'x'}])assert.throws(()=>validateFields(fields,body,{partial:true}),e=>e.status===422);
});
