import {mountPromotions}from'/promotions.js';
// A cover that fails to load falls back to the branded default; an inline image shows its alt text in a dashed box instead of nothing.
document.addEventListener('error',event=>{const img=event.target;if(!img||img.tagName!=='IMG'||img.dataset.fallback)return;img.dataset.fallback='1';if(img.closest('.cover-frame')){img.src='/covers/default.webp';}else{img.classList.add('img-broken');}},true);
const cookie = name => document.cookie.split('; ').find(c=>c.startsWith(name+'='))?.split('=').slice(1).join('=');
const csrf=()=>decodeURIComponent(cookie('__Host-eliah_csrf')||cookie('eliah_csrf')||'');
export async function api(path,options={}) {
  const res=await fetch('/api/v1'+path,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json','X-Eliah-Browser':'1','X-CSRF-Token':csrf(),...options.headers}});
  const payload=await res.json();if(!res.ok||!payload.success)throw Object.assign(new Error(payload.error?.message||'Request failed.'),{code:payload.error?.code,status:res.status});return payload.data;
}
const e = v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const empty=(title,text)=>`<div class="empty-state empty-state-sm" role="status"><p class="empty-title">${e(title)}</p><p>${e(text)}</p></div>`;
let account=null;
try{account=await api('/auth/me');const nav=document.querySelector('#account-nav');if(nav){nav.textContent=account.display_name||'My account';nav.setAttribute('href','/community');
  if(!document.querySelector('#signout-nav')){const out=document.createElement('a');out.id='signout-nav';out.className='nav-link';out.href='/login';out.setAttribute('role','button');out.textContent='Sign out';nav.insertAdjacentElement('afterend',out);}}}catch{}
// Google sign-in returns to the member dashboard (the server cannot see the role): an admin who just signed in is forwarded to /admin once.
let justSignedIn=false;try{justSignedIn=sessionStorage.getItem('eliah.afterLogin')==='1';sessionStorage.removeItem('eliah.afterLogin');}catch{}
if(justSignedIn&&account?.role==='admin'){location.replace('/admin');}
let signingOut=false;
document.addEventListener('click',async event=>{
  const out=event.target.closest('#signout-nav');if(!out)return;event.preventDefault();if(signingOut)return;signingOut=true;
  try{await api('/auth/logout',{method:'POST'});}catch(error){if(error.status!==401){signingOut=false;out.textContent='Try again';return;}}
  try{for(const key of Object.keys(localStorage))if(key.startsWith('eliah.draft.'))localStorage.removeItem(key);}catch{}
  location.replace('/');
});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
const status=message=>{const el=document.querySelector('#reader-status');if(el)el.textContent=message;};
document.addEventListener('click',async event=>{
  const copy=event.target.closest('[data-copy]'),share=event.target.closest('[data-share]');
  if(copy){try{await navigator.clipboard.writeText(copy.dataset.copy);copy.textContent='Copied';}catch{window.prompt('Copy link',copy.dataset.copy);}}
  if(share){if(navigator.share)try{await navigator.share({title:document.title,url:share.dataset.share});}catch{}else window.prompt('Copy link',share.dataset.share);}
  const post=document.querySelector('[data-post-id]')?.dataset.postId;if(!post)return;
  const feedback=event.target.closest('[data-feedback]'),bookmark=event.target.closest('[data-bookmark]');
  if(feedback||bookmark){try{await api(`/community/${feedback?'feedback':'bookmarks'}/${post}`,{method:'POST',body:JSON.stringify(feedback?{value:feedback.dataset.feedback}:{})});status(feedback?'Thank you for the feedback.':'Guide saved to your library.');}catch(err){status(err.message);}}
});
const post=document.querySelector('[data-post-id]')?.dataset.postId;
if(post){
  for(const [selector,route,key] of [['#report-form','reports','message'],['#comment-form','comments','body']])document.querySelector(selector)?.addEventListener('submit',async event=>{event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;try{const data=await api(`/community/${route}/${post}`,{method:'POST',body:JSON.stringify({[key]:new FormData(event.target).get(key)})});status(data.message);event.target.reset();}catch(err){status(err.message);}finally{button.disabled=false;}});
  if(account)api('/community/history/'+post,{method:'POST',body:'{}'}).catch(()=>{});
  const box=document.querySelector('#comments-list');if(box)api('/community/comments/'+post).then(rows=>{box.removeAttribute('aria-busy');box.innerHTML=rows.map(r=>`<div class="border-bottom py-3"><strong>${e(r.display_name)}</strong><p>${e(r.body)}</p></div>`).join('')||empty('No reader solutions yet','Have a working fix? Share it below to help other players.');}).catch(()=>{box.removeAttribute('aria-busy');box.textContent='Reader solutions are temporarily unavailable.';});
}
const root=document.querySelector('#community-root');
if(root){
  if(!account)root.innerHTML='<div class="empty-state" role="status"><p class="empty-title">Sign in to open your dashboard</p><p>Save guides, follow games, get gaming support and manage your account in one place.</p><div class="d-flex flex-wrap gap-2 justify-content-center mt-2"><a class="btn btn-primary" href="/login">Sign in</a><a class="btn btn-outline-primary" href="/register">Create a free account</a></div></div>';
  else{try{const {renderDashboard}=await import('/dashboard.js');await renderDashboard({root,api,account,e});}catch(err){root.innerHTML='<div class="empty-state" role="alert"><p class="empty-title">We could not load your dashboard</p><p>Please refresh the page and try again.</p></div>';}}
  root.removeAttribute('aria-busy');
}
if(location.pathname==='/search'){const q=new URLSearchParams(location.search).get('q');if(q&&q.length>=2)api('/community/search-event',{method:'POST',body:JSON.stringify({query:q,results:Number(document.querySelector('[data-search-total]')?.dataset.searchTotal)||document.querySelectorAll('.post-card').length})}).catch(()=>{});}

document.querySelectorAll('form[data-newsletter]').forEach(form=>form.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;const status=form.querySelector('.newsletter-status');try{const result=await api('/newsletter/subscribe',{method:'POST',body:JSON.stringify({email:new FormData(form).get('email')})});if(status)status.textContent=result.message;form.reset();}catch(err){if(status)status.textContent=err.message;}finally{button.disabled=false;}}));

mountPromotions();
