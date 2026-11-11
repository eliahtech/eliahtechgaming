// Owned website announcements only. Paid ad placement remains posts-only elsewhere.
export const PROMO_KEY='etg.promotions.v1';
export const PROMO_DAY=86400000;
export const DEFAULT_PROMOTIONS={enabled:true,delay_seconds:12,items:[
 {id:'premium',title:'Explore Premium features',image:'/promotions/premium.webp',href:'/premium',hide_for_premium:true,enabled:true},
 {id:'guides',title:'Find your next gaming guide',image:'/promotions/guides.webp',href:'/games',hide_for_premium:false,enabled:true},
 {id:'latest',title:'Read our latest post',image:'/promotions/latest.webp',href:'@latest',hide_for_premium:false,enabled:true}
]};
export const promotionPage=path=>/^\/$|^\/posts$|^\/posts\/[a-z0-9-]+\/?$|^\/games(?:\/[a-z0-9-]+)?\/?$|^\/categories\/?$|^\/category\/[a-z0-9-]+\/?$/.test(path);
export function localPromoPath(value){return typeof value==='string'&&/^\/(?![\/\\])/.test(value)&&!/[\\\s\u0000-\u001f<>]/.test(value)&&!/%(?:0[0-9a-f]|1[0-9a-f]|5c)/i.test(value);}
export function eligiblePromotions(config,{premium=false,now=Date.now(),path=''}={}){
 if(!config?.enabled)return[];
 return(config.items||[]).filter(item=>item.enabled&&!(premium&&item.hide_for_premium)&&localPromoPath(item.href)&&item.href.split(/[?#]/)[0]!==path&&(!item.starts_at||Date.parse(item.starts_at)<=now)&&(!item.ends_at||Date.parse(item.ends_at)>now));
}
export function choosePromotion(items,lastId,random=Math.random){const alternatives=items.filter(item=>item.id!==lastId),pool=alternatives.length?alternatives:items;return pool.length?pool[Math.min(pool.length-1,Math.floor(Math.max(0,random())*pool.length))]:null;}
export function promotionDue(record,now=Date.now()){return !Number.isFinite(record?.shown_at)||now-record.shown_at>=PROMO_DAY;}
