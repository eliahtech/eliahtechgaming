import {PGlite}from'@electric-sql/pglite';
import{readFileSync}from'node:fs';import assert from'node:assert/strict';
const db=new PGlite();
await db.exec(`
create role anon;create role authenticated;create role service_role;
create table public.profiles(id uuid primary key,display_name text);
create table public.posts(id uuid primary key default gen_random_uuid(),title text not null,slug text,featured_image_url text,og_image text,updated_at timestamptz default now(),content_html text,status text,published_at timestamptz,is_premium boolean default false);
create table public.settings(key text primary key,value jsonb,is_public boolean,updated_at timestamptz default now());
create table public.categories(id uuid primary key default gen_random_uuid(),slug text unique,name text,description text,enabled boolean,sort_order integer);
create table public.comments(id uuid primary key,post_id uuid,user_id uuid,body text,status text,created_at timestamptz);
create table public.ai_conversations(id uuid primary key);
create table public.ai_providers(id uuid primary key default gen_random_uuid(),code text unique,display_name text,adapter text,base_url text,api_key_env text,enabled boolean,is_free boolean);
create table public.ai_models(id uuid primary key default gen_random_uuid(),slug text unique,display_name text,provider_id uuid references public.ai_providers(id),model_identifier text,capabilities text[],enabled boolean,is_free boolean,priority integer,free_user_enabled boolean,premium_user_enabled boolean,max_tokens integer);
create table public.app_health(id integer primary key,schema_version text,updated_at timestamptz);
insert into public.app_health values(1,'old',now());
create function public.is_premium()returns boolean language sql stable as $$select false$$;
insert into public.ai_providers(code,adapter)values('groq','groq'),('gemini','gemini');
`);
for(let run=1;run<=2;run++)for(const name of ['20261025100000_gaming_upgrade.sql','20261025110000_model_pool.sql','20261025120000_reader_improvements.sql']){await db.exec(readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));console.log('Applied',name,'pass',run);}
const uid='11111111-1111-4111-8111-111111111111',pid='22222222-2222-4222-8222-222222222222';
await db.query('insert into profiles(id,display_name)values($1,$2)',[uid,'Test member']);
await db.query('insert into posts(id,title,content_html,status,published_at)values($1,$2,$3,$4,now())',[pid,'PPSSPP settings','Old body','published']);
await db.query('insert into game_follows(user_id,game)values($1,$2)',[uid,'PPSSPP']);
await db.query('update posts set content_html=$1 where id=$2',['New body',pid]);
assert.equal((await db.query('select count(*)::int n from post_revisions')).rows[0].n,1);
assert.equal((await db.query('select count(*)::int n from notifications')).rows[0].n,1);
const task=(await db.query('insert into ai_tasks(user_id,idempotency_key,payload)values($1,$2,$3)returning id',[uid,'task-key','{"message":"Help"}'])).rows[0].id;
assert.equal((await db.query('select * from claim_ai_task($1,$2)',[task,uid])).rows.length,1);
assert.equal((await db.query('select * from claim_ai_task($1,$2)',[task,uid])).rows.length,0);
await db.query("select set_ai_cooldown('provider:groq',now()+interval '120 seconds','quota')");
await db.query("select set_ai_cooldown('provider:groq',now()+interval '10 seconds','quota')");
assert.ok((await db.query("select until_at>now()+interval '100 seconds' ok from ai_cooldowns")).rows[0].ok);
assert.equal((await db.query("select schema_version from app_health where id=1")).rows[0].schema_version,'20261025_reader_improvements');
const revisions=(await db.query('select count(*)::int n from post_revisions')).rows[0].n;
await db.query('select sync_content_links($1,$2)',[pid,JSON.stringify([{url:'https://example.com/file.zip',kind:'link'},{url:'https://example.com/cover.png',kind:'image'}])]);
assert.equal((await db.query('select count(*)::int n from post_revisions')).rows[0].n,revisions);
assert.equal((await db.query('select count(*)::int n from post_updates')).rows[0].n,0);
assert.equal((await db.query('select * from claim_content_links(6,$1)',[pid])).rows.length,2);
assert.equal((await db.query('select * from claim_content_links(6,$1)',[pid])).rows.length,0);
await db.query('update posts set content_html=$1,change_summary=$2 where id=$3',['Updated tested instructions','Clarified emulator settings',pid]);
assert.equal((await db.query('select summary from post_updates')).rows[0].summary,'Clarified emulator settings');
assert.equal((await db.query('select link_scan_at from posts where id=$1',[pid])).rows[0].link_scan_at,null);
await db.query('update posts set link_scan_at=now() where id=$1',[pid]);
assert.equal((await db.query('select count(*)::int n from post_updates')).rows[0].n,1);
await db.query("insert into search_events(query,results)values('Missing textures',0),('Missing textures',0),('Found',1)");
const quality=(await db.query('select editorial_quality_summary() value')).rows[0].value;
assert.equal(quality.counts.missing_covers,1);assert.equal(quality.failed_searches[0].searches,2);
assert.equal((await db.query("select has_function_privilege('anon','public.claim_content_links(integer,uuid)','execute') allowed")).rows[0].allowed,false);
// ---- Daily-capped newsletter migration (20261028100000) ----
await db.exec(`
create table public.subscribers(id uuid primary key default gen_random_uuid(),email text unique not null,status text not null default 'pending',verified_at timestamptz,subscribed_at timestamptz not null default now(),unsubscribe_token text unique not null default md5(random()::text));
create table public.newsletter_campaigns(id uuid primary key default gen_random_uuid(),subject text not null,content_html text not null,status text not null default 'draft' check (status in ('draft','sending','sent')),created_at timestamptz not null default now(),started_at timestamptz,completed_at timestamptz);
create table public.newsletter_deliveries(campaign_id uuid not null references public.newsletter_campaigns(id) on delete cascade,subscriber_id uuid not null references public.subscribers(id) on delete cascade,status text not null default 'pending' check (status in ('pending','sent','failed')),error text,updated_at timestamptz not null default now(),primary key(campaign_id,subscriber_id));
create table public.email_events(id uuid primary key default gen_random_uuid(),type text,to_email text,status text,error text,campaign_id uuid,created_at timestamptz not null default now());
`);
const capMigration=readFileSync(new URL('../supabase/migrations/20261028100000_newsletter_daily_cap.sql',import.meta.url),'utf8');
for(let run=1;run<=2;run++){await db.exec(capMigration);console.log('Applied 20261028100000_newsletter_daily_cap.sql pass',run);}
const camp='33333333-3333-4333-8333-333333333333';
await db.query("insert into subscribers(email,status,verified_at,subscribed_at)values('a@x.co','active','2026-01-01','2026-01-01'),('b@x.co','active','2026-02-01','2026-02-01'),('late@x.co','active','2026-03-05','2026-03-05'),('wait@x.co','pending',null,'2026-01-15'),('gone@x.co','unsubscribed','2026-01-20','2026-01-20')");
await db.query("insert into newsletter_campaigns(id,subject,content_html,status,started_at)values($1,'Issue','<p>x</p>','sending','2026-03-01')",[camp]);
// Only people confirmed before the campaign started, oldest first; pending, unsubscribed and late joiners are excluded.
assert.deepEqual((await db.query('select email from newsletter_next_batch($1,10)',[camp])).rows.map(r=>r.email),['a@x.co','b@x.co']);
assert.equal((await db.query('select newsletter_remaining($1) n',[camp])).rows[0].n,2);
assert.deepEqual((await db.query('select email from newsletter_next_batch($1,1)',[camp])).rows.map(r=>r.email),['a@x.co']);
await db.query("insert into newsletter_deliveries(campaign_id,subscriber_id)select $1,id from subscribers where email='a@x.co'",[camp]);
assert.deepEqual((await db.query('select email from newsletter_next_batch($1,10)',[camp])).rows.map(r=>r.email),['b@x.co']);
assert.equal((await db.query('select newsletter_remaining($1) n',[camp])).rows[0].n,1);
assert.equal((await db.query('select attempts from newsletter_deliveries')).rows[0].attempts,1);
// Campaigns can be paused; other values are still rejected.
await db.query("update newsletter_campaigns set status='paused' where id=$1",[camp]);
await assert.rejects(()=>db.query("update newsletter_campaigns set status='bogus' where id=$1",[camp]));
assert.equal((await db.query("select has_function_privilege('anon','public.newsletter_next_batch(uuid,integer)','execute') allowed")).rows[0].allowed,false);
assert.equal((await db.query("select has_function_privilege('service_role','public.newsletter_remaining(uuid)','execute') allowed")).rows[0].allowed,true);
assert.equal((await db.query("select schema_version from app_health where id=1")).rows[0].schema_version,'20261028_newsletter_daily_cap');
console.log('PASS: reader history, maintenance exclusion, link leases, quality aggregates, restricted RPC access;  migration reruns, revisions, notifications, exclusive task lease, shared cooldown, daily-capped newsletter audience/pause support and schema version.');await db.close();
