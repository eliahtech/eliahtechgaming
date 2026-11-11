-- Security foundation: closes privilege-escalation holes in the initial schema, adds trial handling,
-- distributed rate limiting and the audit log. Run after the two earlier migrations.

-- 1. Clients must never change their own role, trial window or verification state.
--    Column privileges stop PostgREST updates; the trigger is a second layer that also covers admin sessions.
revoke update on public.profiles from anon, authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;

create or replace function public.protect_profile_columns() returns trigger language plpgsql as $$
begin
  if current_user in ('anon', 'authenticated') then
    new.id := old.id;
    new.role := old.role;
    new.email_verified_at := old.email_verified_at;
    new.trial_started_at := old.trial_started_at;
    new.trial_ends_at := old.trial_ends_at;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end; $$;
drop trigger if exists protect_profile_columns on public.profiles;
create trigger protect_profile_columns before update on public.profiles for each row execute function public.protect_profile_columns();

-- 2. Comments must start as pending; users cannot self-approve.
drop policy if exists "authenticated users can create comments" on public.comments;
create policy "authenticated users can create pending comments" on public.comments
  for insert to authenticated with check (user_id = auth.uid() and status = 'pending');

-- 3. Trial: starts when the email address is verified (or at signup if the project does not require
--    verification). Length comes from settings.premium.trial_days (default 3). One trial per account.
create or replace function public.trial_days() returns integer language sql stable security definer set search_path = public as $$
  select greatest(coalesce((select (value ->> 'trial_days')::integer from public.settings where key = 'premium'), 3), 0);
$$;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, email_verified_at, trial_started_at, trial_ends_at)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1)),
    new.email_confirmed_at,
    case when new.email_confirmed_at is not null then now() end,
    case when new.email_confirmed_at is not null then now() + make_interval(days => public.trial_days()) end
  );
  return new;
end; $$;

create or replace function public.handle_user_confirmed() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    update public.profiles set
      email_verified_at = new.email_confirmed_at,
      trial_started_at = coalesce(trial_started_at, now()),
      trial_ends_at = coalesce(trial_ends_at, now() + make_interval(days => public.trial_days()))
    where id = new.id;
  end if;
  return new;
end; $$;
drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed after update of email_confirmed_at on auth.users for each row execute function public.handle_user_confirmed();

-- 4. Premium check used by RLS: admin, premium role, running trial or an unexpired active subscription.
create or replace function public.is_premium() returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and (p.role in ('premium_user', 'admin') or (p.trial_ends_at is not null and p.trial_ends_at > now()))
  ) or exists (
    select 1 from public.subscriptions s
    where s.user_id = auth.uid() and s.status = 'active' and s.expires_at > now()
  );
$$;

-- 5. Shared rate-limit counters (works across serverless instances). Only the service role can call it.
create table if not exists public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);
create index if not exists rate_limits_window_idx on public.rate_limits (window_start);
alter table public.rate_limits enable row level security;

create or replace function public.rate_limit_hit(p_key text, p_window_seconds integer, p_limit integer)
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_start timestamptz;
  v_count integer;
begin
  if p_window_seconds < 1 or p_window_seconds > 86400 or p_limit < 1 then
    raise exception 'invalid rate limit parameters';
  end if;
  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limits as r (key, window_start, count) values (p_key, v_start, 1)
  on conflict (key, window_start) do update set count = r.count + 1
  returning r.count into v_count;
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '2 days';
  end if;
  return query select v_count <= p_limit, greatest(p_limit - v_count, 0), v_start + make_interval(secs => p_window_seconds);
end; $$;
revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

-- 6. Audit log: written by the server (service role), readable by admins, never editable from clients.
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}',
  ip text,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_actor_idx on public.audit_logs (actor_id);
create index if not exists audit_logs_action_idx on public.audit_logs (action);
alter table public.audit_logs enable row level security;
create policy "admins read audit logs" on public.audit_logs for select using (public.is_admin());
