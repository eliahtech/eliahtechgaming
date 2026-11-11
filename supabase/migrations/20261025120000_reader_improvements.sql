-- Additive reader/editorial improvements. Apply after 20261025110000_model_pool.sql.
begin;
create table if not exists public.game_hubs(
 id uuid primary key default gen_random_uuid(),slug text not null unique,name text not null check(length(name)between 2 and 120),summary text not null default '' check(length(summary)<=1000),
 cover_image_url text,platforms text[] not null default '{}',enabled boolean not null default true,sort_order integer not null default 0,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.posts add column if not exists game_id uuid references public.game_hubs(id)on delete set null;
alter table public.posts add column if not exists content_type text not null default 'guide' check(content_type in('guide','installation','settings','textures','update','troubleshooting'));
alter table public.posts add column if not exists platform text check(platform in('android','ppsspp','pc','console','other'));
alter table public.posts add column if not exists min_ram_gb numeric check(min_ram_gb between 0.25 and 128);
alter table public.posts add column if not exists storage_mb integer check(storage_mb between 1 and 2000000);
alter table public.posts add column if not exists android_min_version text;
alter table public.posts add column if not exists emulator_version text;
alter table public.posts add column if not exists tested_devices text[] not null default '{}';
alter table public.posts add column if not exists last_tested_at timestamptz;
alter table public.posts add column if not exists reviewed_at timestamptz;
alter table public.posts add column if not exists compatibility_notes text;
alter table public.posts add column if not exists change_summary text;
alter table public.posts add column if not exists link_scan_at timestamptz;
create index if not exists posts_game_published_idx on public.posts(game_id,status,published_at desc);
create index if not exists posts_platform_idx on public.posts(platform,content_type);
create table if not exists public.post_updates(
 id uuid primary key default gen_random_uuid(),post_id uuid not null references public.posts(id)on delete cascade,summary text not null check(length(summary)between 3 and 500),created_at timestamptz not null default now()
);
create index if not exists post_updates_post_idx on public.post_updates(post_id,created_at desc);
create table if not exists public.content_link_checks(
 id uuid primary key default gen_random_uuid(),post_id uuid not null references public.posts(id)on delete cascade,url text not null check(length(url)<=2048),kind text not null default 'link' check(kind in('link','image')),
 active boolean not null default true,status text not null default 'pending' check(status in('pending','ok','broken','restricted','temporary','blocked','unsupported')),
 http_status integer,reason text,checked_at timestamptz,next_check_at timestamptz not null default now(),lease_until timestamptz,created_at timestamptz not null default now(),unique(post_id,url)
);
create index if not exists content_link_due_idx on public.content_link_checks(active,next_check_at);
do $$declare t text;begin foreach t in array array['game_hubs','post_updates','content_link_checks']loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
end loop;end$$;
-- Do not make background link-scan timestamps produce editorial revisions.
create or replace function public.gaming_post_revision()returns trigger language plpgsql security definer set search_path=public as $$begin
 if (to_jsonb(old)-'link_scan_at'-'updated_at'-'change_summary')is distinct from(to_jsonb(new)-'link_scan_at'-'updated_at'-'change_summary')then
  insert into public.post_revisions(post_id,snapshot)values(old.id,to_jsonb(old));
 end if;return new;end$$;
create or replace function public.editorial_post_changed()returns trigger language plpgsql security definer set search_path=public as $$begin
 if (to_jsonb(old)-'link_scan_at'-'updated_at'-'change_summary')is distinct from(to_jsonb(new)-'link_scan_at'-'updated_at'-'change_summary')then
  if new.status='published' and new.published_at<=now()and length(trim(coalesce(new.change_summary,'')))>=3 then
   insert into public.post_updates(post_id,summary)values(new.id,left(trim(new.change_summary),500));
  end if;
 end if;
 if old.content_html is distinct from new.content_html or old.featured_image_url is distinct from new.featured_image_url or old.og_image is distinct from new.og_image then new.link_scan_at=null;end if;
 return new;end$$;
drop trigger if exists editorial_post_changed on public.posts;
create trigger editorial_post_changed before update on public.posts for each row execute function public.editorial_post_changed();
create or replace function public.sync_content_links(p_post_id uuid,p_links jsonb)returns void language plpgsql security definer set search_path=public as $$begin
 update public.content_link_checks set active=false where post_id=p_post_id;
 insert into public.content_link_checks(post_id,url,kind,active)
 select p_post_id,x.url,x.kind,true from jsonb_to_recordset(p_links)as x(url text,kind text)
 on conflict(post_id,url)do update set active=true,kind=excluded.kind;
 update public.posts set link_scan_at=now()where id=p_post_id;
end$$;
create or replace function public.claim_content_links(p_limit integer default 6,p_post_id uuid default null)returns setof public.content_link_checks language sql security definer set search_path=public as $$
 update public.content_link_checks set lease_until=now()+interval '60 seconds'where id in(
 select id from public.content_link_checks where active and(p_post_id is null or post_id=p_post_id)and next_check_at<=now()and(lease_until is null or lease_until<now())order by next_check_at,id limit least(greatest(p_limit,1),6)for update skip locked
 )returning *;
$$;
create or replace function public.editorial_quality_summary()returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
 'counts',jsonb_build_object(
 'published_posts',(select count(*)from posts where status='published'and published_at<=now()),
 'missing_covers',(select count(*)from posts where status='published'and published_at<=now()and coalesce(featured_image_url,'')=''),
 'review_due',(select count(*)from posts where status='published'and published_at<=now()and coalesce(reviewed_at,published_at)<now()-interval '180 days'),
 'untested_guides',(select count(*)from posts where status='published'and published_at<=now()and platform in('android','ppsspp')and last_tested_at is null),
 'open_reports',(select count(*)from content_reports where status='open'),
 'broken_links',(select count(*)from content_link_checks where active and status='broken'),
 'pending_links',(select count(*)from content_link_checks where active and status='pending')),
 'missing_covers',coalesce((select jsonb_agg(to_jsonb(x))from(select id,title,slug from posts where status='published'and published_at<=now()and coalesce(featured_image_url,'')='' order by published_at limit 20)x),'[]'::jsonb),
 'review_due',coalesce((select jsonb_agg(to_jsonb(x))from(select id,title,slug,reviewed_at,published_at from posts where status='published'and published_at<=now()and coalesce(reviewed_at,published_at)<now()-interval '180 days'order by coalesce(reviewed_at,published_at)limit 20)x),'[]'::jsonb),
 'failed_searches',coalesce((select jsonb_agg(to_jsonb(x))from(select query,count(*)as searches from search_events where results=0 and created_at>now()-interval '30 days'group by query order by count(*)desc,query limit 15)x),'[]'::jsonb)
 );
$$;
revoke all on function public.sync_content_links(uuid,jsonb)from public,anon,authenticated;
revoke all on function public.claim_content_links(integer,uuid)from public,anon,authenticated;
revoke all on function public.editorial_quality_summary()from public,anon,authenticated;
grant execute on function public.sync_content_links(uuid,jsonb)to service_role;
grant execute on function public.claim_content_links(integer,uuid)to service_role;
grant execute on function public.editorial_quality_summary()to service_role;
-- Starter hubs contain no invented posts or compatibility claims. Assign your real posts through Admin.
insert into public.game_hubs(slug,name,summary,platforms,sort_order)values
('ppsspp','PPSSPP','Setup, settings, textures and troubleshooting for PPSSPP.',array['ppsspp'],10),
('fts','FTS','Installation guides, updates and gameplay tips for FTS.',array['android'],20),
('dls','Dream League Soccer','Formations, gameplay tips and troubleshooting guides.',array['android'],30),
('efootball','eFootball','Football tactics, settings and practical help.',array['android','pc','console'],40),
('fifa-16','FIFA 16','Installation, settings and troubleshooting resources.',array['android','pc','console'],50)
on conflict(slug)do nothing;
update public.app_health set schema_version='20261025_reader_improvements',updated_at=now()where id=1;
commit;
