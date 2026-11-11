import{PROMO_KEY,promotionPage,choosePromotion,promotionDue,localPromoPath,eligiblePromotions}from'/promotions-data.js';
import{getBrowsing}from'/browsing-preferences.js';
let timer=null,generation=0,memory={},active=null;
function read(){try{const saved=JSON.parse(localStorage.getItem(PROMO_KEY)||'{}')||{};return (memory.shown_at||0)>(saved.shown_at||0)?memory:saved;}catch{return memory;}}
function write(value){memory=value;try{localStorage.setItem(PROMO_KEY,JSON.stringify(value));}catch{}}
export function stopPromotions(){generation++;clearTimeout(timer);if(active){active.close();active=null;}}
export async function mountPromotions(){
 stopPromotions();const run=generation,path=location.pathname;
 if(!promotionPage(path)||getBrowsing().lightweight||!promotionDue(read()))return;
 let data;try{const response=await fetch('/api/v1/promotions?path='+encodeURIComponent(path),{credentials:'same-origin',headers:{'X-Eliah-Browser':'1'}});const json=await response.json();if(!response.ok||!json.success)return;data=json.data;}catch{return;}
 if(run!==generation||!data.items?.length)return;
 const show=async()=>{
  if(run!==generation||location.pathname!==path||!promotionPage(location.pathname)||!promotionDue(read())||getBrowsing().lightweight)return;
  if(document.hidden||document.querySelector('dialog[open]')||/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)){timer=setTimeout(show,2000);return;}
  const item=choosePromotion(eligiblePromotions({enabled:true,items:data.items},{path}),read().last_id);if(!item||!localPromoPath(item.href)||!localPromoPath(item.image))return;
  const image=new Image();image.src=item.image;image.alt=item.title;image.width=1024;image.height=1024;try{await image.decode();}catch{return;}
  if(run!==generation||document.hidden||!promotionDue(read())||document.querySelector('dialog[open]')||getBrowsing().lightweight)return;
  const previous=document.activeElement,dialog=document.createElement('dialog');dialog.className='etg-promotion';dialog.setAttribute('aria-label',item.title);
  const close=document.createElement('button');close.type='button';close.className='etg-promotion-close';close.setAttribute('aria-label','Close promotion');close.textContent='×';
  const label=document.createElement('p');label.className='etg-promotion-label';label.textContent='From Eliahtech Gaming';
  const link=document.createElement('a');link.href=item.href;link.setAttribute('aria-label',item.title);link.append(image);dialog.append(close,label,link);
  close.onclick=()=>dialog.close();link.addEventListener('click',()=>dialog.close());dialog.addEventListener('click',event=>{if(event.target===dialog){const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)dialog.close();}});
  dialog.addEventListener('close',()=>{dialog.remove();if(active===dialog)active=null;if(previous?.isConnected)previous.focus({preventScroll:true});},{once:true});
  document.body.append(dialog);active=dialog;dialog.showModal();close.focus();write({shown_at:Date.now(),last_id:item.id});
 };
 timer=setTimeout(show,Math.max(10,Math.min(60,Number(data.delay_seconds)||12))*1000);
}
if(typeof document!=='undefined'){
 window.addEventListener('pagehide',stopPromotions);
 document.addEventListener('etg:browsingchange',event=>{if(event.detail.lightweight)stopPromotions();});
 window.addEventListener('storage',event=>{if(event.key===PROMO_KEY&&!promotionDue(read()))stopPromotions();});
}
