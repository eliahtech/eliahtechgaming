-- Privacy-friendly analytics: one counter row per day/page/country/device/browser. No IP addresses, cookies or user ids are stored.
-- Written only by the server (service role). Safe to re-run.
create table if not exists public.analytics_daily (
  day date not null,
  path text not null check (char_length(path) between 1 and 160),
  country text not null default 'XX' check (country ~ '^[A-Z]{2}$'),
  device text not null default 'desktop' check (device in ('mobile', 'tablet', 'desktop')),
  browser text not null default 'Other' check (char_length(browser) between 1 and 20),
  views bigint not null default 0,
  primary key (day, path, country, device, browser)
);
create index if not exists analytics_daily_day_idx on public.analytics_daily (day desc);
alter table public.analytics_daily enable row level security;
revoke all on public.analytics_daily from anon, authenticated;

create or replace function public.analytics_hit(p_path text, p_country text, p_device text, p_browser text)
returns void language sql security definer set search_path = public as $$
  insert into public.analytics_daily (day, path, country, device, browser, views)
  values ((now() at time zone 'UTC')::date, left(p_path, 160), coalesce(nullif(upper(p_country), ''), 'XX'), p_device, left(coalesce(p_browser, 'Other'), 20), 1)
  on conflict (day, path, country, device, browser) do update set views = public.analytics_daily.views + 1;
$$;

create or replace function public.analytics_summary(p_days integer default 30)
returns jsonb language sql stable security definer set search_path = public as $$
  with t as (select (now() at time zone 'UTC')::date as today)
  select jsonb_build_object(
    'total_views', coalesce((select sum(views) from public.analytics_daily), 0)::bigint,
    'views_today', coalesce((select sum(views) from public.analytics_daily, t where day = t.today), 0)::bigint,
    'views_7d', coalesce((select sum(views) from public.analytics_daily, t where day >= t.today - 6), 0)::bigint,
    'views_30d', coalesce((select sum(views) from public.analytics_daily, t where day >= t.today - 29), 0)::bigint,
    'tracking_since', (select min(day) from public.analytics_daily),
    'pages', coalesce((select jsonb_agg(x) from (select path, sum(views)::bigint as views, (coalesce(sum(views) filter (where day >= (select today from t) - 29), 0))::bigint as views_30d from public.analytics_daily group by path order by sum(views) desc limit 300) x), '[]'::jsonb),
    'countries', coalesce((select jsonb_agg(x) from (select country, sum(views)::bigint as views from public.analytics_daily group by country order by sum(views) desc limit 60) x), '[]'::jsonb),
    'devices', coalesce((select jsonb_agg(x) from (select device, sum(views)::bigint as views from public.analytics_daily group by device order by sum(views) desc) x), '[]'::jsonb),
    'browsers', coalesce((select jsonb_agg(x) from (select browser, sum(views)::bigint as views from public.analytics_daily group by browser order by sum(views) desc limit 12) x), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(x order by x.day) from (select day, sum(views)::bigint as views from public.analytics_daily, t where day >= t.today - (greatest(least(coalesce(p_days, 30), 365), 1) - 1) group by day) x), '[]'::jsonb)
  );
$$;

-- Real, database-derived security facts for the admin Health tab. Reports; never changes anything.
create or replace function public.security_report()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'tables_total', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'),
    'tables_without_rls', coalesce((select jsonb_agg(c.relname order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), '[]'::jsonb),
    'policies_total', (select count(*) from pg_policies where schemaname = 'public'),
    'definer_functions_without_search_path', coalesce((select jsonb_agg(p.proname order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and coalesce(p.proconfig::text, '') not like '%search_path%'), '[]'::jsonb),
    'admins', (select count(*) from public.profiles where role = 'admin'),
    'premium_role_accounts', (select count(*) from public.profiles where role = 'premium_user')
  );
$$;

revoke all on function public.analytics_hit(text, text, text, text) from public, anon, authenticated;
revoke all on function public.analytics_summary(integer) from public, anon, authenticated;
revoke all on function public.security_report() from public, anon, authenticated;
grant execute on function public.analytics_hit(text, text, text, text) to service_role;
grant execute on function public.analytics_summary(integer) to service_role;
grant execute on function public.security_report() to service_role;
