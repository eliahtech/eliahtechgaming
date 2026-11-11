import {AppError}from'./errors.js';
import {DEFAULT_PROMOTIONS,eligiblePromotions,localPromoPath,promotionPage}from'../public/promotions-data.js';
export function parsePromotions(body){
 const fail=()=>{throw new AppError('VALIDATION_ERROR','Provide valid promotions with unique IDs, local image/link paths, dates and a 10–60 second delay.',422);};
 if(typeof body.enabled!=='boolean'||!Number.isInteger(body.delay_seconds)||body.delay_seconds<10||body.delay_seconds>60||!Array.isArray(body.items)||body.items.length>12)fail();
 const seen=new Set();return{enabled:body.enabled,delay_seconds:body.delay_seconds,items:body.items.map(row=>{
  if(!row||!/^[a-z0-9-]{1,40}$/.test(row.id)||seen.has(row.id)||typeof row.title!=='string'||row.title.trim().length<3||row.title.length>120||!localPromoPath(row.image)||!/^\/[^?#]+\.(webp|png|jpe?g)$/i.test(row.image)||(row.href!=='@latest'&&!localPromoPath(row.href))||typeof row.enabled!=='boolean'||typeof row.hide_for_premium!=='boolean')fail();
  seen.add(row.id);const dates={};for(const key of['starts_at','ends_at']){if(row[key]){if(typeof row[key]!=='string'||!Number.isFinite(Date.parse(row[key])))fail();dates[key]=new Date(row[key]).toISOString();}else dates[key]=null;}
  if(dates.starts_at&&dates.ends_at&&dates.ends_at<=dates.starts_at)fail();
  return{id:row.id,title:row.title.trim(),image:row.image,href:row.href,enabled:row.enabled,hide_for_premium:(row.id==='premium'||row.href.split(/[?#]/)[0]==='/premium')?true:row.hide_for_premium,...dates};
 })};
}
export function registerPromotionRoutes(app,{db,repo,optionalAuth}){
 app.get('/api/v1/promotions',optionalAuth,async(req,res,next)=>{try{
  res.set('Cache-Control','private, no-store');res.vary('Cookie');
  const path=String(req.query.path||'');if(!promotionPage(path))return res.json({success:true,data:{delay_seconds:12,items:[]}});
  const [row]=await db.select('settings',{select:'value',key:'eq.promotions',limit:'1'});
  const config=parsePromotions(row?.value||DEFAULT_PROMOTIONS);
  let items=config.items;
  if(config.enabled&&items.some(i=>i.enabled&&i.href==='@latest')){const [post]=await repo.listPosts(db,{limit:1});items=items.flatMap(i=>i.href==='@latest'?(post?[{...i,href:'/posts/'+encodeURIComponent(post.slug),title:'Latest: '+post.title}]:[]):[i]);}
  const premium=Boolean(req.user?.access?.isPremium);
  res.json({success:true,data:{delay_seconds:config.delay_seconds,items:eligiblePromotions({...config,items},{premium,path})}});
 }catch(error){next(error);}});
}
