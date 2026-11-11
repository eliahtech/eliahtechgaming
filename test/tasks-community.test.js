import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { registerAiTasks } from '../src/ai/tasks.js';
import { registerCommunityRoutes } from '../src/community.js';
import { createFakeDb } from './support/fakedb.js';
import { AppError } from '../src/errors.js';
const uid=randomUUID(),other=randomUUID(),taskId=randomUUID();
const requireAuth=(req,res,next)=>{if(!req.headers['x-test-user'])return res.status(401).json({success:false});req.user={id:req.headers['x-test-user'],access:{isPremium:false}};next();};
const requireAdmin=(_req,res)=>res.sendStatus(403),limit=()=> (_req,_res,next)=>next();
function taskApp(service,seed=[]){
 const db=createFakeDb({ai_tasks:seed},{rpc:{claim_ai_task:async({p_id,p_user_id},db)=>{const row=db.tables.ai_tasks.find(t=>t.id===p_id&&t.user_id===p_user_id&&['paused','pending','failed'].includes(t.status));if(!row)return[];row.status='running';return[{...row}];}}});
 const app=express();app.use(express.json());registerAiTasks(app,{db,service,requireAuth,limit});app.use((err,_req,res,_next)=>res.status(err.status||500).json({success:false,error:{code:err.code,details:err.details}}));return{app,db};
}
test('saved AI task pauses on exhausted providers and resumes once without rerunning completed work',async()=>{
 let calls=0;const service={chat:async()=>{calls++;if(calls===1)throw new AppError('AI_UNAVAILABLE','No providers',503);return {content:'Solved',conversationId:randomUUID()};}};
 const {app,db}=taskApp(service,[{id:taskId,user_id:uid,status:'pending',payload:{message:'Help with PPSSPP'},idempotency_key:'original-key'}]);
 const failed=await request(app).post('/api/v1/ai/tasks/'+taskId+'/resume').set('X-Test-User',uid).send({});assert.equal(failed.status,503);assert.equal(db.tables.ai_tasks[0].status,'paused');assert.equal(failed.body.error.details.task_id,taskId);
 const result=await request(app).post('/api/v1/ai/tasks/'+taskId+'/resume').set('X-Test-User',uid).send({});assert.equal(result.body.data.content,'Solved');assert.equal(db.tables.ai_tasks[0].status,'completed');
 const replay=await request(app).post('/api/v1/ai/tasks/'+taskId+'/resume').set('X-Test-User',uid).send({});assert.equal(replay.body.data.content,'Solved');assert.equal(calls,2);
});
test('another user cannot read, resume or delete a saved task',async()=>{
 const {app}=taskApp({chat:async()=>{throw new Error('must not call');}},[{id:taskId,user_id:uid,status:'pending',payload:{message:'PRIVATE_SENTINEL'}}]);
 for(const method of ['get','delete']){const res=await request(app)[method]('/api/v1/ai/tasks/'+taskId).set('X-Test-User',other);assert.equal(res.status,404);assert.doesNotMatch(res.text,/PRIVATE_SENTINEL/);}
 const resume=await request(app).post('/api/v1/ai/tasks/'+taskId+'/resume').set('X-Test-User',other).send({});assert.equal(resume.status,404);
});
test('reader data deletion is restricted to the verified owner',async()=>{
 const db=createFakeDb({bookmarks:[{user_id:uid,title:'Mine'},{user_id:other,title:'Other'}]});const app=express();app.use(express.json());registerCommunityRoutes(app,{db,requireAuth,requireAdmin,optionalAuth:(_req,_res,next)=>next(),limit});
 assert.equal((await request(app).delete('/api/v1/community/data')).status,401);
 const result=await request(app).delete('/api/v1/community/data').set('X-Test-User',uid);assert.equal(result.status,200);assert.equal(db.tables.bookmarks.length,1);assert.equal(db.tables.bookmarks[0].user_id,other);
});
test('private community invitations are inaccessible to free members',async()=>{
 const db=createFakeDb({settings:[{key:'member-benefits',value:{community_url:'https://t.me/PRIVATE_SENTINEL'}}]});const app=express();app.use(express.json());registerCommunityRoutes(app,{db,requireAuth,requireAdmin,optionalAuth:(_req,_res,next)=>next(),limit});app.use((err,_req,res,_next)=>res.status(err.status||500).json({error:err.code}));
 const result=await request(app).get('/api/v1/community/member-benefits').set('X-Test-User',uid);assert.equal(result.status,403);assert.doesNotMatch(result.text,/PRIVATE_SENTINEL/);
});
