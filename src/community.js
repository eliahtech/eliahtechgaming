import { createHash } from 'node:crypto';
import { AppError } from './errors.js';
import { isUuid } from './validate.js';
import { audit } from './audit.js';

const invalid = message => new AppError('VALIDATION_ERROR',message,422);
const text = (value,max,min=1) => { if(typeof value!=='string'||value.trim().length<min||value.length>max)throw invalid(`Enter text between ${min} and ${max} characters.`);return value.trim(); };
export function registerCommunityRoutes(app,{db,requireAuth,requireAdmin,optionalAuth,limit}) {
  const h=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  const ok=(res,data,status=200)=>res.status(status).json({success:true,data});
  const id=req=>{if(!isUuid(req.params.id))throw new AppError('NOT_FOUND','Not found.',404);return req.params.id;};
  const visiblePost=async postId=>{if(!isUuid(postId))throw invalid('Invalid post.');const [post]=await db.select('posts',{select:'id,is_premium,slug,title',id:`eq.${postId}`,status:'eq.published',published_at:`lte.${new Date().toISOString()}`,limit:'1'});if(!post)throw new AppError('NOT_FOUND','Post not found.',404);return post;};
  app.use('/api/v1/community',(_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
  app.get('/api/v1/community/member-benefits',requireAuth,h(async(req,res)=>{
    if(!req.user.access.isPremium)throw new AppError('PREMIUM_REQUIRED','Active Premium membership required.',403);
    const [row]=await db.select('settings',{select:'value',key:'eq.member-benefits',limit:'1'});ok(res,row?.value||{});
  }));
  app.get('/api/v1/community/me',requireAuth,h(async(req,res)=>{
    const uid=`eq.${req.user.id}`;
    const tables=['bookmarks','reading_history','support_tickets','game_follows','notifications'];
    const rows=await Promise.all(tables.map(t=>db.select(t,{select:'*',user_id:uid,order:'created_at.desc',limit:'50'})));
    const [device]=await db.select('device_profiles',{select:'device,ram_gb,emulator,emulator_version',user_id:uid,limit:'1'});
    ok(res,{...Object.fromEntries(tables.map((t,i)=>[t,rows[i]])),device:device||null,is_premium:req.user.access.isPremium});
  }));
  app.put('/api/v1/community/device',requireAuth,h(async(req,res)=>{
    const b=req.body||{},ram=Number(b.ram_gb);if(!Number.isFinite(ram)||ram<.25||ram>128)throw invalid('Enter RAM between 0.25 and 128 GB.');
    const row={user_id:req.user.id,device:text(b.device,100),ram_gb:ram,emulator:text(b.emulator||'Not specified',80),emulator_version:text(b.emulator_version||'Unknown',40)};
    await db.insert('device_profiles',row,{query:{on_conflict:'user_id'},prefer:'resolution=merge-duplicates,return=minimal'});ok(res,{saved:true});
  }));
  app.post('/api/v1/community/bookmarks/:id',requireAuth,h(async(req,res)=>{
    const post=await visiblePost(id(req));
    await db.insert('bookmarks',{user_id:req.user.id,post_id:post.id,title:post.title,slug:post.slug},{query:{on_conflict:'user_id,post_id'},prefer:'resolution=ignore-duplicates,return=minimal'});ok(res,{saved:true});
  }));
  app.delete('/api/v1/community/bookmarks/:id',requireAuth,h(async(req,res)=>{await db.remove('bookmarks',{user_id:`eq.${req.user.id}`,post_id:`eq.${id(req)}`});ok(res,{deleted:true});}));
  app.post('/api/v1/community/history/:id',requireAuth,h(async(req,res)=>{
    const post=await visiblePost(id(req));await db.insert('reading_history',{user_id:req.user.id,post_id:post.id,title:post.title,slug:post.slug,created_at:new Date().toISOString()},{query:{on_conflict:'user_id,post_id'},prefer:'resolution=merge-duplicates,return=minimal'});ok(res,{saved:true});
  }));
  app.delete('/api/v1/community/history',requireAuth,h(async(req,res)=>{await db.remove('reading_history',{user_id:`eq.${req.user.id}`});ok(res,{deleted:true});}));
  app.post('/api/v1/community/feedback/:id',optionalAuth,limit('guide-feedback',20,3600,{failClosed:true}),h(async(req,res)=>{
    const post=await visiblePost(id(req)),value=req.body?.value;if(!['helpful','unhelpful'].includes(value))throw invalid('Invalid feedback.');
    const key=createHash('sha256').update(req.user?.id||String(req.ip)).digest('hex');
    await db.insert('guide_feedback',{post_id:post.id,visitor_key:key,value},{query:{on_conflict:'post_id,visitor_key'},prefer:'resolution=merge-duplicates,return=minimal'});ok(res,{saved:true});
  }));
  app.post('/api/v1/community/reports/:id',optionalAuth,limit('guide-report',5,3600,{failClosed:true}),h(async(req,res)=>{const post=await visiblePost(id(req));await db.insert('content_reports',{post_id:post.id,user_id:req.user?.id||null,message:text(req.body?.message,2000,5)});ok(res,{message:'Report received. Thank you.'},201);}));
  app.get('/api/v1/community/comments/:id',optionalAuth,h(async(req,res)=>{const post=await visiblePost(id(req));if(post.is_premium&&!req.user?.access?.isPremium)throw new AppError('PREMIUM_REQUIRED','Premium access required.',403);ok(res,await db.select('post_comments',{select:'body,display_name,created_at',post_id:`eq.${post.id}`,status:'eq.approved',order:'created_at.desc',limit:'50'}));}));
  app.post('/api/v1/community/comments/:id',requireAuth,limit('comment',10,3600,{failClosed:true}),h(async(req,res)=>{const post=await visiblePost(id(req));if(post.is_premium&&!req.user.access.isPremium)throw new AppError('PREMIUM_REQUIRED','Premium access required.',403);await db.insert('post_comments',{post_id:post.id,user_id:req.user.id,body:text(req.body?.body,3000,5),display_name:req.user.profile?.display_name||'Member',status:'pending'});ok(res,{message:'Comment submitted for moderation.'},201);}));
  app.post('/api/v1/community/tickets',requireAuth,limit('support-ticket',20,86400,{failClosed:true}),h(async(req,res)=>{
    const [benefits]=await db.select('settings',{select:'value',key:'eq.member-benefits',limit:'1'});
    const allowance=req.user.access.isPremium?Math.min(20,Math.max(1,Number(benefits?.value?.support_requests_per_day)||5)):2;
    const [quota]=await db.rpc('rate_limit_hit',{p_key:'support-user:'+req.user.id,p_window_seconds:86400,p_limit:allowance});
    if(!quota?.allowed)throw new AppError('RATE_LIMITED','Your daily support allowance has been reached.',429);
    const b=req.body||{};let conversationId=null;
    if(b.conversation_id){if(!isUuid(b.conversation_id))throw invalid('Invalid conversation.');const [c]=await db.select('ai_conversations',{select:'id',id:`eq.${b.conversation_id}`,user_id:`eq.${req.user.id}`,limit:'1'});if(!c)throw invalid('Conversation not found.');conversationId=c.id;}
    const [row]=await db.insert('support_tickets',{user_id:req.user.id,subject:text(b.subject,160,3),message:text(b.message,8000,10),priority:req.user.access.isPremium?'premium':'normal',conversation_id:conversationId});ok(res,row,201);
  }));
  app.post('/api/v1/community/follows',requireAuth,h(async(req,res)=>{const game=text(req.body?.game,80,2);await db.insert('game_follows',{user_id:req.user.id,game},{query:{on_conflict:'user_id,game'},prefer:'resolution=ignore-duplicates,return=minimal'});ok(res,{saved:true});}));
  app.delete('/api/v1/community/follows/:id',requireAuth,h(async(req,res)=>{await db.remove('game_follows',{id:`eq.${id(req)}`,user_id:`eq.${req.user.id}`});ok(res,{deleted:true});}));
  app.post('/api/v1/community/requests',requireAuth,limit('tutorial-request',3,86400,{failClosed:true}),h(async(req,res)=>{ok(res,await db.insert('tutorial_requests',{user_id:req.user.id,title:text(req.body?.title,160,5),description:text(req.body?.description,2000,10)}),201);}));
  app.get('/api/v1/community/requests',h(async(_req,res)=>ok(res,await db.select('tutorial_requests',{select:'id,title,description,status,created_at',status:'in.(open,planned,completed)',order:'created_at.desc',limit:'50'}))));
  app.post('/api/v1/community/requests/:id/vote',requireAuth,h(async(req,res)=>{await db.insert('tutorial_votes',{request_id:id(req),user_id:req.user.id},{query:{on_conflict:'request_id,user_id'},prefer:'resolution=ignore-duplicates,return=minimal'});ok(res,{saved:true});}));
  // Search analytics accept only a short redacted term, never user profile or conversation data.
  app.post('/api/v1/community/search-event',limit('search-event',30,3600),h(async(req,res)=>{
    const term=text(req.body?.query,80,2);if(/@|https?:|\d{7}/i.test(term))return ok(res,{saved:false});
    await db.insert('search_events',{query:term,results:Math.min(1000,Math.max(0,Number(req.body?.results)||0))});ok(res,{saved:true});
  }));
  app.delete('/api/v1/community/data',requireAuth,h(async(req,res)=>{
    for(const table of ['device_profiles','bookmarks','reading_history','game_follows','notifications'])await db.remove(table,{user_id:`eq.${req.user.id}`});
    await audit(db,{actorId:req.user.id,action:'community.data_deleted',targetType:'profiles',targetId:req.user.id});ok(res,{deleted:true});
  }));
  // This endpoint is outside the generic admin router so register it before that router in server.js.
  app.get('/api/v1/community/admin/analytics',requireAdmin,h(async(_req,res)=>{
    const data={};for(const table of ['guide_feedback','content_reports','support_tickets','search_events']){data[table]=await db.select(table,{select:'*',order:'created_at.desc',limit:'100'});}ok(res,data);
  }));
}
