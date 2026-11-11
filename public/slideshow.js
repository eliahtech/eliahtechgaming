import { getBrowsing, saveBrowsing, applyBrowsing } from './browsing-preferences.js';
import { SLIDES, SLIDE_INTERVAL, SLIDE_EFFECTS } from './slides-data.js';
import { nextSlideIndex } from './slides-view.js';
const controllers=new Map();
export function mountSlides(scope=document){
  for(const [node,controller]of controllers)if(!node.isConnected){controller.destroy();controllers.delete(node);}
  for(const root of scope.querySelectorAll('[data-etg-carousel]')){
    if(controllers.has(root))continue;
    controllers.set(root,createCarousel(root));
  }
}
function createCarousel(root){
  const slides=[...root.querySelectorAll('[data-slide]')],dots=[...root.querySelectorAll('[data-slide-to]')],pause=root.querySelector('[data-slide-pause]'),count=root.querySelector('.etg-slide-count'),announcement=root.querySelector('.etg-slide-announcement');
  const media=window.matchMedia('(prefers-reduced-motion: reduce)'),reasons=new Set(media.matches?['reduced-motion']:[]),cleanup=[];
  let preferences=getBrowsing();applyBrowsing(preferences);root.dataset.lightweight=String(preferences.lightweight);if(preferences.lightweight||!preferences.autoplay)reasons.add('browsing');
  let index=0,timer=null,busy=false,destroyed=false,transitionTimer=null,effect=0,pointerX=null;
  const listen=(node,event,fn,options)=>{node.addEventListener(event,fn,options);cleanup.push(()=>node.removeEventListener(event,fn,options));};
  const hydrate=slide=>{const source=slide.querySelector('source'),image=slide.querySelector('img');if(source?.dataset.srcset){source.srcset=source.dataset.srcset;delete source.dataset.srcset;}if(image?.dataset.src){image.loading='eager';image.src=image.dataset.src;delete image.dataset.src;}return image;};
  const preload=()=>{if(preferences.lightweight)return;const image=new Image();image.src=window.matchMedia('(max-width: 700px)').matches?SLIDES[nextSlideIndex(index)].mobileImage:SLIDES[nextSlideIndex(index)].image;};
  const schedule=()=>{clearInterval(timer);timer=null;const stopped=reasons.size>0,userStopped=reasons.has('manual')||reasons.has('reduced-motion')||reasons.has('browsing');pause.disabled=preferences.lightweight;pause.textContent=preferences.lightweight?'Light mode':userStopped?'Play':'Pause';pause.setAttribute('aria-label',userStopped?'Play slideshow':'Pause slideshow');pause.setAttribute('aria-pressed',String(userStopped));root.dataset.paused=String(stopped);if(!stopped&&!destroyed)timer=setInterval(()=>go(nextSlideIndex(index)),SLIDE_INTERVAL);};
  const setReason=(name,on)=>{if(on)reasons.add(name);else reasons.delete(name);schedule();};
  async function go(target,manual=false){
    target=nextSlideIndex(target,0,slides.length);if(target===index||busy||destroyed)return;
    busy=true;const previous=slides[index],next=slides[target],image=preferences.lightweight?null:hydrate(next);
    // Avoid blank frames when a slower connection has not fetched the next image yet.
    try{if(image)await image.decode();}catch{/* A failed image retains the navy background and readable caption. */}
    if(destroyed){busy=false;return;}
    root.dataset.effect=SLIDE_EFFECTS[effect++%SLIDE_EFFECTS.length];
    next.hidden=false;next.inert=false;next.setAttribute('aria-hidden','false');next.querySelector('a').removeAttribute('tabindex');
    previous.inert=true;previous.setAttribute('aria-hidden','true');previous.querySelector('a').setAttribute('tabindex','-1');
    previous.classList.add('is-leaving');previous.classList.remove('is-active');next.classList.add('is-entering');
    // Force the initial animation state before transitioning the new frame into view.
    void next.offsetWidth;next.classList.add('is-active');
    index=target;root.dataset.index=String(index);dots.forEach((dot,i)=>{dot.classList.toggle('is-current',i===index);if(i===index)dot.setAttribute('aria-current','true');else dot.removeAttribute('aria-current');});count.textContent=`${index+1} / ${slides.length}`;
    if(manual)announcement.textContent=`${index+1} of ${slides.length}: ${SLIDES[index].title}`;
    root.dispatchEvent(new CustomEvent('etg:slidechange',{detail:{index,id:SLIDES[index].id,effect:root.dataset.effect}}));
    clearTimeout(transitionTimer);transitionTimer=setTimeout(()=>{previous.hidden=true;previous.classList.remove('is-leaving');next.classList.remove('is-entering');busy=false;preload();},media.matches||!preferences.animations?0:650);
    if(manual)schedule();
  }
  listen(root.querySelector('[data-slide-next]'),'click',()=>go(nextSlideIndex(index),true));
  listen(root.querySelector('[data-slide-prev]'),'click',()=>go(nextSlideIndex(index,-1),true));
  dots.forEach((dot,i)=>listen(dot,'click',()=>go(i,true)));
  listen(pause,'click',()=>{
    if(preferences.lightweight)return;
    const stopped=reasons.has('manual')||reasons.has('reduced-motion')||reasons.has('browsing');
    if(stopped){reasons.delete('manual');reasons.delete('reduced-motion');reasons.delete('focus');reasons.delete('hover');}
    saveBrowsing({autoplay:stopped});schedule();
  });
  listen(document,'etg:browsingchange',event=>{
    preferences=event.detail;root.dataset.lightweight=String(preferences.lightweight);
    if(preferences.lightweight){for(const slide of slides){const image=slide.querySelector('img'),source=slide.querySelector('source');if(image.hasAttribute('src')){image.dataset.src=image.getAttribute('src');image.removeAttribute('src');}if(source.hasAttribute('srcset')){source.dataset.srcset=source.getAttribute('srcset');source.removeAttribute('srcset');}}}
    else{hydrate(slides[index]);preload();}
    setReason('browsing',preferences.lightweight||!preferences.autoplay);
  });
  listen(root,'mouseenter',()=>{if(window.matchMedia('(hover: hover)').matches)setReason('hover',true);});
  listen(root,'mouseleave',()=>setReason('hover',false));
  listen(root,'focusin',()=>setReason('focus',true));
  listen(root,'focusout',event=>{if(!root.contains(event.relatedTarget))setReason('focus',false);});
  listen(root,'keydown',event=>{if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();go(nextSlideIndex(index,event.key==='ArrowRight'?1:-1),true);}});
  listen(root,'pointerdown',event=>{if(event.pointerType==='touch')pointerX=event.clientX;});
  listen(root,'pointerup',event=>{if(pointerX!==null){const distance=event.clientX-pointerX;pointerX=null;if(Math.abs(distance)>45)go(nextSlideIndex(index,distance<0?1:-1),true);}});
  listen(document,'visibilitychange',()=>setReason('hidden',document.hidden));
  listen(media,'change',event=>setReason('reduced-motion',event.matches));
  let observer;
  if('IntersectionObserver'in window){observer=new IntersectionObserver(entries=>setReason('offscreen',!entries[0].isIntersecting),{threshold:.08});observer.observe(root);}
  root.dataset.index='0';root.dataset.ready='true';if(!preferences.lightweight)hydrate(slides[index]);schedule();preload();
  return{destroy(){destroyed=true;clearInterval(timer);clearTimeout(transitionTimer);cleanup.forEach(fn=>fn());observer?.disconnect();}};
}
if(typeof document!=='undefined'){
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>mountSlides(),{once:true});else mountSlides();
}
