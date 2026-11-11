import { AppError } from './errors.js';
import { isUuid } from './validate.js';
import { createLinkChecker } from './link-checker.js';
import { audit } from './audit.js';
export function registerEditorialRoutes(app,{db,repo,requireAdmin,optionalAuth,limit,appUrl}){
 const h=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next),ok=(res,data)=>res.json({success:true,data});
 const checker=createLinkChecker({db,appUrl});
 app.use('/api/v1/editorial',(_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
 app.get('/api/v1/editorial/games',h(async(_req,res)=>ok(res,await repo.listGameHubs(db))));
 app.get('/api/v1/editorial/posts/:slug/updates',h(async(req,res)=>{const post=await repo.getPost(db,req.params.slug);if(!post)throw new AppError('NOT_FOUND','Post not found.',404);ok(res,await repo.listPostUpdates(db,post.id));}));
 app.get('/api/v1/editorial/posts/:slug/next',optionalAuth,h(async(req,res)=>{const post=await repo.getPost(db,req.params.slug);if(!post)throw new AppError('NOT_FOUND','Post not found.',404);ok(res,await repo.nextGuides(db,post));}));
 app.get('/api/v1/editorial/admin/quality',requireAdmin,h(async(_req,res)=>{
  const [summary,links,reports]=await Promise.all([db.rpc('editorial_quality_summary'),db.select('content_link_checks',{select:'id,post_id,url,kind,status,http_status,reason,checked_at,posts(title,slug)',active:'eq.true',status:'in.(broken,restricted,temporary,blocked,unsupported)',order:'checked_at.desc',limit:'50'}),db.select('content_reports',{select:'id,post_id,message,status,created_at',status:'eq.open',order:'created_at.desc',limit:'20'})]);ok(res,{...summary,links,reports});
 }));
 app.post('/api/v1/editorial/admin/links/check',requireAdmin,limit('editorial-link-check',3,60,{failClosed:true,keyOf:req=>req.user.id}),h(async(req,res)=>{
  const postId=req.body?.post_id||null;if(postId&&!isUuid(postId))throw new AppError('VALIDATION_ERROR','Invalid post ID.',422);
  const result=await checker.runBatch({postId});await audit(db,{actorId:req.user.id,action:'links.check',targetType:'posts',targetId:postId,metadata:{checked:result.links_checked}});ok(res,result);
 }));
}
