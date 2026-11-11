-- Additive Gaming upgrade. Apply after every earlier migration. Never drops existing content.
begin;
alter table public.posts add column if not exists ads_disabled boolean not null default false;
create table if not exists public.ad_placements (
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 2 and 120),
 platform text not null default 'custom', placement text not null check(placement in ('header','body','footer','sidebar','auto')),
 code text not null default '' check(length(code)<=50000), enabled boolean not null default false,
 device text not null default 'both' check(device in ('both','desktop','mobile')), paragraph integer not null default 3 check(paragraph between 1 and 100),
 starts_at timestamptz, ends_at timestamptz, sort_order integer not null default 0,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(ends_at is null or starts_at is null or ends_at>starts_at)
);
insert into public.settings(key,value,is_public)values('ads','{"enabled":false}',false)on conflict(key)do nothing;
create table if not exists public.device_profiles(user_id uuid primary key references public.profiles(id) on delete cascade,device text not null,ram_gb numeric not null check(ram_gb between 0.25 and 128),emulator text not null,emulator_version text not null,created_at timestamptz not null default now());
create table if not exists public.bookmarks(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id)on delete cascade,post_id uuid not null references public.posts(id)on delete cascade,title text not null,slug text not null,created_at timestamptz not null default now(),unique(user_id,post_id));
create table if not exists public.reading_history(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id)on delete cascade,post_id uuid not null references public.posts(id)on delete cascade,title text not null,slug text not null,created_at timestamptz not null default now(),unique(user_id,post_id));
create table if not exists public.guide_feedback(id uuid primary key default gen_random_uuid(),post_id uuid not null references public.posts(id)on delete cascade,visitor_key text not null,value text not null check(value in('helpful','unhelpful')),created_at timestamptz not null default now(),unique(post_id,visitor_key));
create table if not exists public.content_reports(id uuid primary key default gen_random_uuid(),post_id uuid references public.posts(id)on delete set null,user_id uuid references public.profiles(id)on delete set null,message text not null check(length(message)<=2000),status text not null default 'open' check(status in('open','resolved','dismissed')),created_at timestamptz not null default now());
create table if not exists public.post_comments(id uuid primary key default gen_random_uuid(),post_id uuid not null references public.posts(id)on delete cascade,user_id uuid references public.profiles(id)on delete set null,display_name text not null,body text not null check(length(body)<=3000),status text not null default 'pending' check(status in('pending','approved','rejected')),created_at timestamptz not null default now());
create table if not exists public.support_tickets(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id)on delete cascade,subject text not null,message text not null,conversation_id uuid references public.ai_conversations(id)on delete set null,priority text not null default 'normal' check(priority in('normal','premium')),status text not null default 'open' check(status in('open','in_progress','resolved')),admin_reply text,created_at timestamptz not null default now());
create table if not exists public.game_follows(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id)on delete cascade,game text not null check(length(game)<=80),created_at timestamptz not null default now(),unique(user_id,game));
create table if not exists public.notifications(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id)on delete cascade,message text not null,post_id uuid references public.posts(id)on delete cascade,created_at timestamptz not null default now(),unique(user_id,post_id));
create table if not exists public.tutorial_requests(id uuid primary key default gen_random_uuid(),user_id uuid references public.profiles(id)on delete set null,title text not null,description text not null,status text not null default 'pending' check(status in('pending','open','planned','completed','rejected')),created_at timestamptz not null default now());
create table if not exists public.tutorial_votes(id uuid primary key default gen_random_uuid(),request_id uuid not null references public.tutorial_requests(id)on delete cascade,user_id uuid not null references public.profiles(id)on delete cascade,created_at timestamptz not null default now(),unique(request_id,user_id));
create table if not exists public.search_events(id uuid primary key default gen_random_uuid(),query text not null check(length(query)<=80),results integer not null default 0,created_at timestamptz not null default now());
create table if not exists public.post_revisions(id uuid primary key default gen_random_uuid(),post_id uuid not null references public.posts(id)on delete cascade,snapshot jsonb not null,created_at timestamptz not null default now());
create table if not exists public.ai_cooldowns(scope text primary key,until_at timestamptz not null,reason text,created_at timestamptz not null default now());
create table if not exists public.ai_tasks(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id)on delete cascade,idempotency_key text not null,payload jsonb not null,status text not null default 'pending' check(status in('pending','running','completed','paused','failed')),result jsonb,error_code text,attempts integer not null default 0,lease_until timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(user_id,idempotency_key));
-- Every new table is server-only: routes explicitly authorize owners/admins. No direct anon/authenticated grants.
do $$declare t text;begin
 foreach t in array array['ad_placements','device_profiles','bookmarks','reading_history','guide_feedback','content_reports','post_comments','support_tickets','game_follows','notifications','tutorial_requests','tutorial_votes','search_events','post_revisions','ai_cooldowns','ai_tasks'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
end$$;
create index if not exists bookmarks_user_idx on public.bookmarks(user_id,created_at desc);
create index if not exists history_user_idx on public.reading_history(user_id,created_at desc);
create index if not exists tickets_user_idx on public.support_tickets(user_id,created_at desc);
create index if not exists comments_post_idx on public.post_comments(post_id,status,created_at desc);
create index if not exists revisions_post_idx on public.post_revisions(post_id,created_at desc);
create index if not exists ai_tasks_owner_idx on public.ai_tasks(user_id,created_at desc);
-- Revision snapshots and followed-game notifications are transactional with the content change.
create or replace function public.gaming_post_revision()returns trigger language plpgsql security definer set search_path=public as $$begin
 if to_jsonb(old) is distinct from to_jsonb(new) then insert into public.post_revisions(post_id,snapshot)values(old.id,to_jsonb(old));end if;
 return new;end$$;
drop trigger if exists gaming_post_revision on public.posts;
create trigger gaming_post_revision before update on public.posts for each row execute function public.gaming_post_revision();
create or replace function public.gaming_notify_followers()returns trigger language plpgsql security definer set search_path=public as $$begin
 if new.status='published' and new.published_at<=now() then
 insert into public.notifications(user_id,message,post_id)
 select distinct f.user_id,'New or updated guide: '||new.title,new.id from public.game_follows f where position(lower(f.game) in lower(new.title))>0 on conflict(user_id,post_id)do update set message=excluded.message,created_at=now();
 end if;return new;end$$;
drop trigger if exists gaming_notify_followers on public.posts;
create trigger gaming_notify_followers after insert or update of title,content_html,status,published_at on public.posts for each row execute function public.gaming_notify_followers();
-- Atomically lease a saved AI task. Only the server role can invoke it.
create or replace function public.claim_ai_task(p_id uuid,p_user_id uuid)returns setof public.ai_tasks language sql security definer set search_path=public as $$
 update public.ai_tasks set status='running',lease_until=now()+interval '90 seconds',attempts=attempts+1,updated_at=now()
 where id=p_id and user_id=p_user_id and(status in('pending','paused','failed')or(status='running' and lease_until<now()))and attempts<20 returning *;
$$;
revoke all on function public.claim_ai_task(uuid,uuid)from public,anon,authenticated;
grant execute on function public.claim_ai_task(uuid,uuid)to service_role;
-- Preserve existing category IDs. Add missing categories only; admin customizations are retained.
insert into public.categories(slug,name,description,enabled,sort_order) values
('psp-ppsspp-games','PSP & PPSSPP Games and Mods','PPSSPP setup, settings and guides.',true,10),
('football-games-updates','Football Games & Updates','Football gaming tactics and updates.',true,20),
('android-games-mods','Android Games & Mods','Android gaming guides and troubleshooting.',true,30),
('game-installation-setup','Game Installation & Setup Guides','Practical installation instructions.',true,40),
('game-graphics-textures-mods','Game Graphics, Textures & Mods','Original graphics and texture setup.',true,50),
('tech-tips-tutorials','Tech Tips & Tutorials','Gaming devices, software and troubleshooting.',true,60),
('ai-tools-tutorials','AI Tools, Tips & Tutorials','AI for gaming content creators.',true,70)
on conflict(slug)do nothing;
create table if not exists public.post_drafts(post_id uuid not null references public.posts(id)on delete cascade,actor_id uuid not null references public.profiles(id)on delete cascade,snapshot jsonb not null,updated_at timestamptz not null default now(),primary key(post_id,actor_id));
alter table public.post_drafts enable row level security;
revoke all on public.post_drafts from anon,authenticated;
grant all on public.post_drafts to service_role;
create or replace function public.set_ai_cooldown(p_scope text,p_until timestamptz,p_reason text)returns void language sql security definer set search_path=public as $$
 insert into public.ai_cooldowns(scope,until_at,reason)values(p_scope,p_until,p_reason)
 on conflict(scope)do update set until_at=greatest(ai_cooldowns.until_at,excluded.until_at),reason=excluded.reason;
$$;
revoke all on function public.set_ai_cooldown(text,timestamptz,text)from public,anon,authenticated;
grant execute on function public.set_ai_cooldown(text,timestamptz,text)to service_role;
-- Public direct database reads must also respect scheduled publication dates.
drop policy if exists "public can read published posts" on public.posts;
create policy "public can read published posts" on public.posts for select using(status='published' and published_at<=now() and(not is_premium or public.is_premium()));
-- Preserve comments created before the migration; the dashboard now moderates one comments table.
insert into public.post_comments(id,post_id,user_id,display_name,body,status,created_at)
select c.id,c.post_id,c.user_id,coalesce(p.display_name,'Member'),c.body,c.status,c.created_at from public.comments c left join public.profiles p on p.id=c.user_id on conflict(id)do nothing;
create table if not exists public.gaming_job_lease(id integer primary key check(id=1),until_at timestamptz not null);
alter table public.gaming_job_lease enable row level security;
revoke all on public.gaming_job_lease from anon,authenticated;
grant all on public.gaming_job_lease to service_role;
create or replace function public.claim_gaming_job()returns boolean language plpgsql security definer set search_path=public as $$declare affected integer;begin
 insert into public.gaming_job_lease(id,until_at)values(1,now()+interval '65 seconds')on conflict(id)do update set until_at=excluded.until_at where gaming_job_lease.until_at<now();
 get diagnostics affected=row_count;return affected=1;end$$;
create or replace function public.notify_due_gaming_posts()returns void language sql security definer set search_path=public as $$
 insert into public.notifications(user_id,message,post_id)
 select distinct f.user_id,'New guide: '||p.title,p.id from public.game_follows f join public.posts p on position(lower(f.game)in lower(p.title))>0
 where p.status='published'and p.published_at<=now()and not exists(select 1 from public.notifications n where n.user_id=f.user_id and n.post_id=p.id)
 limit 100 on conflict(user_id,post_id)do nothing;
$$;
revoke all on function public.claim_gaming_job()from public,anon,authenticated;
revoke all on function public.notify_due_gaming_posts()from public,anon,authenticated;
grant execute on function public.claim_gaming_job()to service_role;
grant execute on function public.notify_due_gaming_posts()to service_role;
insert into public.settings(key,value,is_public)values('member-benefits','{"community_url":null,"support_hours":"","support_requests_per_day":5}',false)on conflict(key)do nothing;
commit;
