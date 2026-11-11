import https from 'node:https';
import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { sanitizeContent } from './sanitize.js';

const blocked4=new BlockList(),blocked6=new BlockList();
for(const [address,prefix]of[['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])blocked4.addSubnet(address,prefix,'ipv4');
for(const [address,prefix]of[['::',96],['::1',128],['::ffff:0:0',96],['64:ff9b::',96],['100::',64],['2001::',23],['2001:db8::',32],['2002::',16],['fc00::',7],['fe80::',10],['ff00::',8]])blocked6.addSubnet(address,prefix,'ipv6');
export function isPublicAddress(address){const family=isIP(address);return Boolean(family&&!(family===4?blocked4:blocked6).check(address,family===4?'ipv4':'ipv6'));}
export function validateLinkUrl(raw){
 let url;try{url=new URL(raw);}catch{return null;}
 const host=url.hostname.replace(/^\[|\]$/g,'');
 if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||url.href.length>2048||!host.includes('.')||/(^|\.)(localhost|local|internal|lan|test|invalid)$/.test(host))return null;
 if(isIP(host)&&!isPublicAddress(host))return null;
 url.hash='';return url;
}
export async function pinnedAddresses(url,{lookup=dnsLookup}={}){
 const host=url.hostname.replace(/^\[|\]$/g,'');
 const addresses=isIP(host)?[{address:host,family:isIP(host)}]:await lookup(host,{all:true,verbatim:true});
 if(!addresses.length||addresses.some(item=>!isPublicAddress(item.address)))throw new Error('PRIVATE_DESTINATION');
 return addresses;
}
const requestHeaders=(url,{addresses,method,timeoutMs,request=https.request})=>new Promise((resolve,reject)=>{
 const req=request(url,{method,headers:{'User-Agent':'Eliahtech-LinkCheck/1.0','Accept':'*/*','Range':'bytes=0-0'},agent:false,maxHeaderSize:16384,
 lookup:(_host,options,callback)=>options.all?callback(null,addresses):callback(null,addresses[0].address,addresses[0].family),
 },res=>{resolve({status:res.statusCode,location:res.headers.location});res.destroy();req.destroy();});
 const timer=setTimeout(()=>req.destroy(new Error('TIMEOUT')),timeoutMs);
 req.on('error',reject);req.on('close',()=>clearTimeout(timer));req.end();
});
export function statusForLink(status){
 if(status>=200&&status<400)return 'ok';if(status===404||status===410)return 'broken';if([401,403,429].includes(status))return 'restricted';return 'temporary';
}
export async function checkLink(raw,{lookup=dnsLookup,request=https.request,now=()=>Date.now(),budgetMs=7000}={}){
 let url=validateLinkUrl(raw);if(!url)return{status:'blocked',http_status:null,reason:'Only public HTTPS URLs on standard ports can be checked.'};
 const deadline=now()+budgetMs;let method='HEAD';
 try{
  for(let hop=0;hop<4;hop++){
   const remaining=deadline-now();if(remaining<100)return{status:'temporary',http_status:null,reason:'Check timed out; retry later.'};
   let dnsTimer;const addresses=await Promise.race([pinnedAddresses(url,{lookup}),new Promise((_,reject)=>{dnsTimer=setTimeout(()=>reject(new Error('TIMEOUT')),Math.min(2000,remaining));})]).finally(()=>clearTimeout(dnsTimer));
   const result=await requestHeaders(url,{addresses,method,request,timeoutMs:Math.max(1,Math.min(2500,deadline-now()))});
   if([301,302,303,307,308].includes(result.status)&&result.location){const next=validateLinkUrl(new URL(result.location,url).href);if(!next)return{status:'blocked',http_status:result.status,reason:'Redirect destination is not allowed.'};url=next;continue;}
   if(method==='HEAD'&&[403,405,501].includes(result.status)){method='GET';hop--;continue;}
   return{status:statusForLink(result.status),http_status:result.status,reason:result.status===403?'Server may block automated checks; review manually.':null};
  }
  return{status:'temporary',http_status:null,reason:'Too many redirects.'};
 }catch(error){return{status:error.message==='PRIVATE_DESTINATION'?'blocked':'temporary',http_status:null,reason:error.message==='PRIVATE_DESTINATION'?'Private or reserved network destination blocked.':'Connection or DNS check failed; retry later.'};}
}
const decodeAttribute=value=>value.replace(/&amp;/gi,'&').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Math.min(Number(n),0x10ffff))).replace(/&#x([a-f0-9]+);/gi,(_,n)=>String.fromCodePoint(Math.min(parseInt(n,16),0x10ffff)));
export function collectPostLinks(post,appUrl){
 const found=new Map();
 const add=(raw,kind)=>{try{if(!raw||/^(#|mailto:|tel:|data:|javascript:)/i.test(raw))return;const url=new URL(decodeAttribute(raw),appUrl);url.hash='';if(!['https:','http:'].includes(url.protocol)||url.href.length>2048)return;if(!found.has(url.href)||kind==='image')found.set(url.href,{url:url.href,kind});}catch{}};
 for(const key of['featured_image_url','og_image'])add(post[key],'image');
 const html=sanitizeContent(post.content_html||'');
 for(const match of html.matchAll(/<(a|img|source|video|iframe)\b[^>]*?\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi))add(match[2]||match[3]||match[4],match[1].toLowerCase()==='img'?'image':'link');
 return[...found.values()].slice(0,100);
}
export function createLinkChecker({db,appUrl,check=checkLink,now=()=>Date.now()}){
 async function scanPost(post){const downloads=await db.select('downloads',{select:'url',post_id:`eq.${post.id}`,active:'eq.true',limit:'50'});const combined={...post,content_html:(post.content_html||'')+(post.installation_guides?.enabled?post.installation_guides.content_html:'')};const links=collectPostLinks(combined,appUrl);for(const row of downloads){try{const url=new URL(row.url,appUrl);url.hash='';if(['https:','http:'].includes(url.protocol)&&url.href.length<=2048&&!links.some(l=>l.url===url.href)&&links.length<100)links.push({url:url.href,kind:'link'});}catch{}}await db.rpc('sync_content_links',{p_post_id:post.id,p_links:links});return links.length;}
 return{
  scanPost,
  async runBatch({postId=null}={}){
   const since=new Date(now()-7*86400000).toISOString();
   const posts=await db.select('posts',{select:'id,content_html,featured_image_url,og_image,installation_guides(content_html,enabled)',...(postId?{id:`eq.${postId}`}:{status:'eq.published',published_at:`lte.${new Date(now()).toISOString()}`,or:`(link_scan_at.is.null,link_scan_at.lt.${since})`}),order:'link_scan_at.asc.nullsfirst,id.asc',limit:postId?'1':'3'});
   for(const post of posts)await scanPost(post);
   const rows=await db.rpc('claim_content_links',{p_limit:6,p_post_id:postId});
   const results=[];for(let offset=0;offset<rows.length;offset+=3){const batch=await Promise.all(rows.slice(offset,offset+3).map(async row=>{
    const result=row.url.startsWith('http:')?{status:'unsupported',http_status:null,reason:'HTTP link: use HTTPS or review manually.'}:await check(row.url);
    const stamp=new Date(now()).toISOString();
    await db.update('content_link_checks',{id:`eq.${row.id}`},{...result,checked_at:stamp,next_check_at:new Date(now()+(result.status==='ok'?7:1)*86400000).toISOString(),lease_until:null});
    return{id:row.id,status:result.status};
   }));results.push(...batch);}
   return{posts_scanned:posts.length,links_checked:results.length,results};
  }
 };
}
