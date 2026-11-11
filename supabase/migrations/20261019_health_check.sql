-- Minimal table used only by the server-side health check (src/health/supabase.js).
-- RLS is enabled with NO policies: anon/authenticated roles can read nothing; only the service role (which bypasses RLS) can.
create table if not exists public.app_health (
  id int primary key default 1 check (id = 1),
  schema_version text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_health enable row level security;
revoke all on public.app_health from anon, authenticated;
insert into public.app_health (id, schema_version) values (1, '20261019_health_check')
  on conflict (id) do update set schema_version = excluded.schema_version, updated_at = now();
-- Future migrations should update schema_version at their end so `npm run verify:migrations` can detect drift.
