import { buildAuthorizeUrl, challengeFor, encodeFlow, decodeFlow, randomVerifier, exchangeCode } from './oauth.js';
import { cookieNames, parseCookies, serialize, sessionCookies, safeNextPath } from './cookies.js';
export function registerGoogle(app,{appUrl}) {
  const secure=appUrl.startsWith('https:'),names=cookieNames(secure);
  const enabled=()=>process.env.GOOGLE_AUTH_ENABLED==='true'&&Boolean(process.env.SUPABASE_URL&&process.env.SUPABASE_ANON_KEY);
  app.get('/api/auth/google/status',(_req,res)=>res.set('Cache-Control','no-store').json({enabled:enabled()}));
  app.get('/api/auth/google',async(req,res,next)=>{try{
    res.set('Cache-Control','no-store');if(!enabled())return res.redirect('/login?error=google_unavailable');
    if(req.get('host')!==new URL(appUrl).host)return res.redirect(appUrl+'/api/auth/google?'+new URLSearchParams({next:safeNextPath(req.query.next)}));
    const verifier=randomVerifier(),nextPath=safeNextPath(req.query.next);
    res.setHeader('Set-Cookie',serialize(names.oauth,encodeFlow({verifier,next:nextPath}),{maxAge:600,httpOnly:true,secure}));
    res.redirect(buildAuthorizeUrl({supabaseUrl:process.env.SUPABASE_URL,redirectTo:appUrl+'/api/auth/google/callback',challenge:await challengeFor(verifier)}));
  }catch(err){next(err);}});
  app.get('/api/auth/google/callback',async(req,res,next)=>{try{
    res.set('Cache-Control','no-store');const clear=serialize(names.oauth,'',{maxAge:0,httpOnly:true,secure});res.setHeader('Set-Cookie',clear);
    const flow=decodeFlow(parseCookies(req.headers.cookie||'')[names.oauth]);
    if(!enabled()||!flow||req.query.error)return res.redirect('/login?error=google_expired');
    const result=await exchangeCode({supabaseUrl:process.env.SUPABASE_URL,anonKey:process.env.SUPABASE_ANON_KEY,code:req.query.code,verifier:flow.verifier});
    if(!result.ok)return res.redirect('/login?error=google_failed');
    res.setHeader('Set-Cookie',[clear,...sessionCookies(result.session,{secure})]);res.redirect(safeNextPath(flow.next));
  }catch(err){next(err);}});
}
