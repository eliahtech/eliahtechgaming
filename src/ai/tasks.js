import { randomUUID } from 'node:crypto';
import { AppError } from '../errors.js';
import { isUuid } from '../validate.js';
export function registerAiTasks(app,{db,service,requireAuth,limit}){
  const h=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  const ok=(res,data,status=200)=>res.status(status).json({success:true,data});
  const own=async(req)=>{if(!isUuid(req.params.id))throw new AppError('NOT_FOUND','Task not found.',404);const [row]=await db.select('ai_tasks',{select:'*',id:`eq.${req.params.id}`,user_id:`eq.${req.user.id}`,limit:'1'});if(!row)throw new AppError('NOT_FOUND','Task not found.',404);return row;};
  app.use('/api/v1/ai/tasks',(_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
  app.get('/api/v1/ai/tasks',requireAuth,h(async(req,res)=>ok(res,{items:await db.select('ai_tasks',{select:'id,status,error_code,created_at,updated_at',user_id:`eq.${req.user.id}`,order:'created_at.desc',limit:'30'})})));
  app.post('/api/v1/ai/tasks',requireAuth,limit('ai-task-create',10,60,{failClosed:true}),limit('ai-task-daily',50,86400,{failClosed:true,keyOf:req=>req.user.id}),h(async(req,res)=>{
    const body=req.body||{};if(typeof body.message!=='string'||!body.message.trim()||body.message.length>32000)throw new AppError('VALIDATION_ERROR','A message up to 32000 characters is required.',422);
    const key=req.headers['idempotency-key']||randomUUID();if(!/^[a-zA-Z0-9._:-]{8,80}$/.test(key))throw new AppError('VALIDATION_ERROR','Invalid Idempotency-Key.',422);
    const payload={message:body.message,capability:body.capability,model:body.model,conversationId:body.conversationId,...(body.image?{image:body.image}:{})};
    if(payload.image&&(!/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(payload.image)||payload.image.length>2100000))throw new AppError('VALIDATION_ERROR','Use a PNG, JPEG or WebP screenshot under 1.5 MB.',422);
    await db.insert('ai_tasks',{user_id:req.user.id,idempotency_key:key,payload},{query:{on_conflict:'user_id,idempotency_key'},prefer:'resolution=ignore-duplicates,return=minimal'});
    const [row]=await db.select('ai_tasks',{select:'id,payload,status',user_id:`eq.${req.user.id}`,idempotency_key:`eq.${key}`,limit:'1'});
    if(JSON.stringify(row.payload)!==JSON.stringify(JSON.parse(JSON.stringify(payload)))){
      // JSONB changes object ordering; compare normalized fields instead.
      const keys=[...new Set([...Object.keys(row.payload),...Object.keys(payload)])];if(keys.some(k=>JSON.stringify(row.payload[k])!==JSON.stringify(payload[k])))throw new AppError('AI_IDEMPOTENCY_CONFLICT','This key was already used for another task.',409);
    }
    ok(res,{id:row.id,status:row.status},201);
  }));
  app.get('/api/v1/ai/tasks/:id',requireAuth,h(async(req,res)=>{const row=await own(req);ok(res,{id:row.id,status:row.status,error_code:row.error_code,result:row.result,message:row.payload?.message,conversationId:row.payload?.conversationId,updated_at:row.updated_at});}));
  app.delete('/api/v1/ai/tasks/:id',requireAuth,h(async(req,res)=>{await own(req);await db.remove('ai_tasks',{id:`eq.${req.params.id}`,user_id:`eq.${req.user.id}`});ok(res,{deleted:true});}));
  app.post('/api/v1/ai/tasks/:id/resume',requireAuth,limit('ai-task-run',10,60,{failClosed:true}),h(async(req,res)=>{
    const task=await own(req);if(task.status==='completed')return ok(res,task.result);
    const [claimed]=await db.rpc('claim_ai_task',{p_id:task.id,p_user_id:req.user.id});if(!claimed)throw new AppError('AI_REQUEST_IN_PROGRESS','Task is running or its retry limit was reached. Refresh its status.',409);
    try{
      const result=await service.chat({user:req.user,ip:req.ip,body:claimed.payload,idempotencyKey:'task:'+task.id,requestId:task.id});
      await db.update('ai_tasks',{id:`eq.${task.id}`,user_id:`eq.${req.user.id}`},{status:'completed',result,payload:{...claimed.payload,image:undefined},lease_until:null,error_code:null,updated_at:new Date().toISOString()});ok(res,result);
    }catch(err){
      const paused=err.status===429||err.status>=500;
      await db.update('ai_tasks',{id:`eq.${task.id}`,user_id:`eq.${req.user.id}`},{status:paused?'paused':'failed',error_code:err.code||'AI_ERROR',lease_until:null,updated_at:new Date().toISOString()});
      throw new AppError(err.code||'AI_UNAVAILABLE',paused?'Your task is saved. Available free providers could not finish it. Resume after their limits reset.':err.message,err.status||503,{task_id:task.id,retryAfter:err.details?.retryAfter||60});
    }
  }));
}
