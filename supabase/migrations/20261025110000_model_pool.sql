-- Current candidate pool. Unverified new routes start DISABLED until account connectivity/price checks.
begin;
alter table public.ai_providers drop constraint if exists ai_providers_adapter_check;
alter table public.ai_providers add constraint ai_providers_adapter_check check(adapter in('gemini','groq','openai_compatible','openrouter'));
insert into public.ai_providers(code,display_name,adapter,base_url,api_key_env,enabled,is_free)
values('openrouter','OpenRouter free routes','openrouter','https://openrouter.ai/api/v1','OPENROUTER_API_KEY',false,true)
on conflict(code)do nothing;
insert into public.ai_models(slug,display_name,provider_id,model_identifier,capabilities,enabled,is_free,priority,free_user_enabled,premium_user_enabled,max_tokens)
select v.slug,v.name,p.id,v.model,v.caps,false,true,v.priority,true,true,2048
from(values
('groq-gpt-oss-120b','GPT-OSS 120B','groq','openai/gpt-oss-120b',array['general','coding','reasoning'],10),
('groq-qwen-3-8-27b','Qwen 3.8 27B','groq','qwen/qwen3.8-27b',array['general','coding','reasoning'],15),
('gemini-3-1-flash-lite','Gemini 3.1 Flash-Lite','gemini','gemini-3.1-flash-lite',array['general','multimodal','fast'],40),
('openrouter-flint','Recursive Flint free','openrouter','recursive/flint-v1.0:free',array['coding','reasoning'],20),
('openrouter-nemotron-ultra','Nemotron 3 Ultra free','openrouter','nvidia/nemotron-3-ultra-550b-a55b:free',array['general','reasoning','coding'],30),
('openrouter-nemotron-lightning','Nemotron 3.5 Lightning free','openrouter','nvidia/nemotron-3.5-lightning:free',array['general','fast'],50)
)v(slug,name,provider,model,caps,priority)join public.ai_providers p on p.code=v.provider
on conflict(slug)do nothing;
-- The two existing routes remain as configured, but vision is now correctly advertised for Flash-Lite.
update public.ai_models set capabilities=array(select distinct unnest(capabilities||array['multimodal']))where slug='gemini-3-5-flash-lite';
-- Do not create chat registry rows for Whisper. Optional voice input uses dedicated audio endpoints/models.
update public.app_health set schema_version='20261025_model_pool',updated_at=now()where id=1;
commit;
