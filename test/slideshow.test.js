import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync}from'node:fs';
import {SLIDES,SLIDE_CATEGORIES,SLIDE_INTERVAL,SLIDE_EFFECTS}from'../public/slides-data.js';
import {renderSlideshow,nextSlideIndex,brandingHead,brandLogo}from'../public/slides-view.js';
import {layout}from'../src/web/templates.js';

test('all seven categories have two original slide images and support up to five each',()=>{
 assert.equal(SLIDE_CATEGORIES.length,7);assert.equal(SLIDES.length,14);
 for(const category of SLIDE_CATEGORIES){assert.equal(category.slides.length,2);assert.ok(category.slides.length<=5);}
 assert.equal(new Set(SLIDES.map(s=>s.id)).size,SLIDES.length);
 for(const slide of SLIDES){assert.ok(existsSync('public'+slide.image));assert.ok(existsSync('public'+slide.mobileImage));assert.match(slide.href,/^\/category\/[a-z0-9-]+$/);assert.ok(slide.title&&slide.description&&slide.alt);}
 assert.equal(new Set(SLIDES.slice(0,7).map(s=>s.categorySlug)).size,7,'every category appears before its second image');
});
test('carousel advances every three seconds and wraps last-to-first and first-to-last',()=>{
 assert.equal(SLIDE_INTERVAL,3000);assert.equal(nextSlideIndex(13),0);assert.equal(nextSlideIndex(0,-1),13);assert.equal(nextSlideIndex(14,0),0);assert.ok(SLIDE_EFFECTS.length>=3);
});
test('server HTML has a visible first slide, accessible controls, and deferred inactive image sources',()=>{
 const html=renderSlideshow();assert.equal((html.match(/data-slide="/g)||[]).length,14);assert.equal((html.match(/hidden inert/g)||[]).length,13);
 assert.equal((html.match(/<img src=/g)||[]).length,1);assert.equal((html.match(/data-src=/g)||[]).length,13);
 for(const marker of ['data-slide-next','data-slide-prev','data-slide-pause','aria-roledescription="carousel"','data-interval="3000"'])assert.ok(html.includes(marker));
});
test('public layout and application shell both use the same slideshow and ETG branding',()=>{
 const html=layout({title:'Article',canonical:'https://example.test',image:'https://example.test/a.png',body:'<h1>Article</h1>'});
 assert.match(html,/data-etg-carousel/);assert.match(html,/\/slideshow.js/);assert.match(html,/\/slides.css/);assert.match(html,/etg-logo.webp/);assert.match(html,/favicon.ico/);
 const app=readFileSync('public/app.js','utf8');assert.match(app,/renderSlideshow\(getBrowsing\(\)\)/);assert.match(app,/mountSlides\(\)/);assert.match(app,/brandLogo\(\)/);
 const head=brandingHead();for(const file of ['/favicon.ico','/assets/branding/icon-64.png','/assets/branding/icon-180.png','/site.webmanifest']){assert.ok(head.includes(file));assert.ok(existsSync('public'+file));}
 assert.match(brandLogo(),/alt="Eliahtech Gaming/);
 const ico=readFileSync('public/favicon.ico');assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),6);
});
