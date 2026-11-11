// These preferences never grant account permissions. Cookie mirrors local storage for server rendering.
export const BROWSING_KEY='etg.browsing.v1';
let memory=null;
export function normalizeBrowsing(value={},defaults={}){const flag=(key,fallback)=>typeof value?.[key]==='boolean'?value[key]:fallback;return{lightweight:flag('lightweight',defaults.lightweight||false),autoplay:flag('autoplay',defaults.autoplay!==false),animations:flag('animations',defaults.animations!==false)};}
export function browsingFromCookie(header=''){const part=header.split(';').map(p=>p.trim()).find(p=>p.startsWith('etg_browsing='));try{return part?normalizeBrowsing(JSON.parse(decodeURIComponent(part.slice(13)))):normalizeBrowsing();}catch{return normalizeBrowsing();}}
export function getBrowsing(){
 const defaults=typeof window!=='undefined'?{lightweight:!!navigator.connection?.saveData,autoplay:!window.matchMedia('(prefers-reduced-motion: reduce)').matches,animations:!window.matchMedia('(prefers-reduced-motion: reduce)').matches}:{};
 if(memory)return memory;
 if(typeof document==='undefined')return normalizeBrowsing({},defaults);
 try{const saved=JSON.parse(localStorage.getItem(BROWSING_KEY)||'null');if(saved)return normalizeBrowsing(saved,defaults);}catch{}
 if(document.cookie.includes('etg_browsing='))return browsingFromCookie(document.cookie);
 return normalizeBrowsing({},defaults);
}
export function applyBrowsing(value=getBrowsing()){
 if(typeof document==='undefined')return;document.documentElement.dataset.etgLightweight=String(value.lightweight);document.documentElement.dataset.etgMotion=value.animations&&!value.lightweight?'on':'off';
}
export function saveBrowsing(values){
 const value=normalizeBrowsing({...getBrowsing(),...values});memory=value;let persisted=true;
 try{localStorage.setItem(BROWSING_KEY,JSON.stringify(value));document.cookie='etg_browsing='+encodeURIComponent(JSON.stringify(value))+'; Path=/; Max-Age=31536000; SameSite=Lax'+(location.protocol==='https:'?'; Secure':'');}catch{persisted=false;}
 applyBrowsing(value);document.dispatchEvent(new CustomEvent('etg:browsingchange',{detail:value}));return{value,persisted};
}
export function installBrowsingControls(){
 if(typeof document==='undefined'||document.documentElement.dataset.browsingControls)return;document.documentElement.dataset.browsingControls='true';applyBrowsing();
 document.addEventListener('click',event=>{
  if(!event.target.closest('[data-browsing-settings]'))return;
  const current=getBrowsing(),dialog=document.createElement('dialog');dialog.className='etg-browsing-dialog';dialog.setAttribute('aria-labelledby','browsing-title');
  dialog.innerHTML=`<form method="dialog"><h2 id="browsing-title">Browsing preferences</h2><p>Choose a lighter experience. Your choice is remembered on this browser.</p><label><input type="checkbox" name="lightweight" ${current.lightweight?'checked':''}> Lightweight mode — skip slideshow images and autoplay</label><label><input type="checkbox" name="autoplay" ${current.autoplay?'checked':''}> Automatically advance the slideshow</label><label><input type="checkbox" name="animations" ${current.animations?'checked':''}> Enable animations</label><p class="etg-preference-note">Lightweight mode keeps category links and manual slide controls available. Essential article images still load normally.</p><div class="etg-browsing-actions"><button type="submit" value="save">Save preferences</button><button type="button" data-cancel>Cancel</button></div></form>`;
  document.body.append(dialog);dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  dialog.querySelector('form').addEventListener('submit',event=>{event.preventDefault();const form=new FormData(event.target);saveBrowsing({lightweight:form.has('lightweight'),autoplay:form.has('autoplay'),animations:form.has('animations')});dialog.close();});dialog.showModal();
 });
}
if(typeof document!=='undefined'){applyBrowsing();if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installBrowsingControls,{once:true});else installBrowsingControls();}
