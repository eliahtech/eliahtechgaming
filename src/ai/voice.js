import express from 'express';
import { AppError } from '../errors.js';
// Optional voice input. Both models share the same Groq account limits; this is not extra quota.
export function registerVoice(app,{requireAuth,limit}){
  app.post('/api/v1/ai/transcribe',requireAuth,limit('ai-voice',5,3600,{failClosed:true}),express.raw({type:['audio/wav','audio/mpeg','audio/mp4','audio/webm','audio/ogg'],limit:'3mb'}),async(req,res,next)=>{
    try{
      if(process.env.AI_VOICE_ENABLED!=='true'||!process.env.GROQ_API_KEY)throw new AppError('AI_VOICE_DISABLED','Voice input is not configured. Type your question instead.',503);
      if(!Buffer.isBuffer(req.body)||req.body.length<16)throw new AppError('VALIDATION_ERROR','Choose a supported audio file under 3 MB.',422);
      const type=req.headers['content-type'].split(';')[0],extension={'audio/wav':'wav','audio/mpeg':'mp3','audio/mp4':'mp4','audio/webm':'webm','audio/ogg':'ogg'}[type];
      let text=null;
      for(const model of ['whisper-large-v3-turbo','whisper-large-v3']){
        const form=new FormData();form.set('model',model);form.set('file',new Blob([req.body],{type}),'question.'+extension);form.set('response_format','json');
        const response=await fetch('https://api.groq.com/openai/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+process.env.GROQ_API_KEY},body:form,signal:AbortSignal.timeout(20000)});
        if(response.status===429)throw new AppError('AI_LIMIT_REACHED','Voice quota is temporarily unavailable. Type your question or retry later.',429);
        if(response.status>=500)continue;
        if(!response.ok)throw new AppError('AI_VOICE_FAILED','The voice file could not be transcribed.',422);
        text=(await response.json()).text;break;
      }
      if(!text)throw new AppError('AI_VOICE_FAILED','Transcription is temporarily unavailable.',503);
      res.set('Cache-Control','no-store').json({success:true,data:{text}});
    }catch(err){next(err);}
  });
}
