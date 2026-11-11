import test from'node:test';import assert from'node:assert/strict';import express from'express';import request from'supertest';
import{parsePromotions,registerPromotionRoutes}from'../src/promotions.js';
import{DEFAULT_PROMOTIONS,eligiblePromotions,promotionPage,choosePromotion,promotionDue,localPromoPath}from'../public/promotions-data.js';
const config=()=>structuredClone(DEFAULT_PROMOTIONS);
test('promotion pages exclude task and account pages while allowing owned announcements',()=>{
 for(const page of['/','/posts','/posts/test-guide','/games','/games/ppsspp','/categories','/category/football'])assert.equal(promotionPage(page),true,page);
 for(const page of['/login','/contact','/services','/search','/premium','/admin','/profile','/payment/return','/terms','/community'])assert.equal(promotionPage(page),false,page);
});
test('random selection excludes the previous item, handles one item and respects the 24-hour cap',()=>{
 const items=config().items;for(const random of[()=>0,()=>0.5,()=>0.999])assert.notEqual(choosePromotion(items,'premium',random).id,'premium');assert.equal(choosePromotion([items[0]],'premium').id,'premium');assert.equal(choosePromotion([]),null);assert.equal(promotionDue({shown_at:1000},86400999),false);assert.equal(promotionDue({shown_at:1000},86401000),true);assert.equal(promotionDue({}),true);
});
test('configuration rejects unsafe links, duplicates and invalid schedules; premium upgrades always hidden',()=>{
 for(const href of['javascript:alert(1)','//evil.example','/\\evil.example','https://evil.example','/%0aevil']){assert.equal(localPromoPath(href),false);const c=config();c.items[0].href=href;assert.throws(()=>parsePromotions(c),e=>e.status===422);}
 const duplicate=config();duplicate.items.push(duplicate.items[0]);assert.throws(()=>parsePromotions(duplicate));const dates=config();dates.items[0].starts_at='2026-10-26';dates.items[0].ends_at='2026-10-25';assert.throws(()=>parsePromotions(dates));const c=config();c.items[0].hide_for_premium=false;assert.equal(parsePromotions(c).items[0].hide_for_premium,true);
});
test('campaign eligibility respects membership, dates, disable and destination duplication',()=>{
 const c=config();c.items=c.items.filter(i=>i.href!=='@latest');assert.deepEqual(eligiblePromotions(c,{premium:true}).map(i=>i.id),['guides']);assert.equal(eligiblePromotions(c,{path:'/games',premium:true}).length,0);c.items[1].starts_at='2030-01-01';assert.equal(eligiblePromotions(c,{premium:true,now:0}).length,0);c.enabled=false;assert.equal(eligiblePromotions(c).length,0);
});
function app({premium=false,posts=[{slug:'new-post',title:'New guide'}],saved=null}={}){const app=express();registerPromotionRoutes(app,{db:{select:async()=>saved?[{value:saved}]:[]},repo:{listPosts:async()=>posts},optionalAuth:(req,_res,next)=>{req.user=premium?{access:{isPremium:true}}:null;next();}});return app;}
test('public endpoint resolves newest published post, filters premium and uses private caching',async()=>{
 const response=await request(app({premium:true})).get('/api/v1/promotions?path=/');assert.equal(response.status,200);assert.match(response.headers['cache-control'],/no-store/);assert.ok(!response.body.data.items.some(i=>i.id==='premium'));assert.equal(response.body.data.items.find(i=>i.id==='latest').href,'/posts/new-post');
 const none=await request(app({posts:[]})).get('/api/v1/promotions?path=/');assert.ok(!none.body.data.items.some(i=>i.id==='latest'));const blocked=await request(app()).get('/api/v1/promotions?path=/login');assert.deepEqual(blocked.body.data.items,[]);
});
