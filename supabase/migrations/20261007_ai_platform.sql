-- Phase 5: AI platform. Provider/model registry, usage tracking, conversations, failover events and idempotency.
-- Additive and idempotent: safe to re-run. Extends the existing ai_usage table instead of replacing it.
-- All writes happen server-side with the service role. API keys are NEVER stored here: a provider row holds only the
-- NAME of the environment variable that carries its key (api_key_env).

-- 1. Providers (one row per integration: an adapter plus where to reach it and which env var holds its key).
create table if not exists public.ai_providers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9-]{2,40}$'),
  display_name text not null check (char_length(display_name) between 1 and 80),
  adapter text not null check (adapter in ('gemini', 'grok', 'openai_compatible')),
  base_url text check (base_url is null or base_url ~ '^https://'),
  api_key_env text check (api_key_env is null or api_key_env ~ '^[A-Z][A-Z0-9_]{1,62}_API_KEY$'),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Models (the registry). A model can only be enabled once it has a provider and a real provider-side identifier.
create table if not exists public.ai_models (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9._-]{1,59}$'),
  display_name text not null check (char_length(display_name) between 1 and 80),
  provider_id uuid references public.ai_providers (id) on delete restrict,
  model_identifier text check (model_identifier is null or char_length(model_identifier) between 1 and 200),
  base_url text check (base_url is null or base_url ~ '^https://'),
  capabilities text[] not null default '{general}'
    check (capabilities <@ array['general','reasoning','coding','writing','translation','summarization','multimodal','fast','long_context','seo','creative','data_analysis']::text[]),
  enabled boolean not null default false,
  priority integer not null default 100 check (priority between 1 and 10000),
  free_user_enabled boolean not null default false,
  premium_user_enabled boolean not null default true,
  max_tokens integer check (max_tokens is null or max_tokens between 1 and 32768),
  temperature numeric(3, 2) check (temperature is null or temperature between 0 and 2),
  timeout_ms integer check (timeout_ms is null or timeout_ms between 1000 and 55000),
  daily_limit integer check (daily_limit is null or daily_limit >= 1),
  monthly_limit integer check (monthly_limit is null or monthly_limit >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_models_enabled_requires_target check (not enabled or (provider_id is not null and model_identifier is not null))
);
create index if not exists ai_models_priority_idx on public.ai_models (enabled, priority);

-- 3. Conversations and messages. Messages are written only by the server, so a client cannot forge assistant output.
create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null default 'New conversation' check (char_length(title) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_conversations_user_idx on public.ai_conversations (user_id, updated_at desc);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations (id) on delete cascade,
  role text not null check (role in ('system', 'user', 'assistant')),
  content text not null check (char_length(content) <= 100000),
  provider text,
  model text,
  tokens_input integer,
  tokens_output integer,
  created_at timestamptz not null default now()
);
create index if not exists ai_messages_conversation_idx on public.ai_messages (conversation_id, created_at);

-- 4. Usage: extend the Phase 1 table. One row per provider attempt; request_id groups the attempts of one user request.
alter table public.ai_usage alter column provider drop not null;
alter table public.ai_usage add column if not exists request_id uuid;
alter table public.ai_usage add column if not exists model_id uuid references public.ai_models (id) on delete set null;
alter table public.ai_usage add column if not exists capability text;
alter table public.ai_usage add column if not exists tier text;
alter table public.ai_usage add column if not exists tokens_input integer;
alter table public.ai_usage add column if not exists tokens_output integer;
alter table public.ai_usage add column if not exists tokens_total integer;
alter table public.ai_usage add column if not exists latency_ms integer;
alter table public.ai_usage add column if not exists error_code text;
alter table public.ai_usage add column if not exists attempt smallint not null default 1;
alter table public.ai_usage drop constraint if exists ai_usage_status_check;
alter table public.ai_usage add constraint ai_usage_status_check check (status in ('success', 'error', 'timeout', 'rate_limited', 'rejected')) not valid;
alter table public.ai_usage drop constraint if exists ai_usage_tier_check;
alter table public.ai_usage add constraint ai_usage_tier_check check (tier is null or tier in ('guest', 'free_user', 'premium_user', 'admin')) not valid;
create index if not exists ai_usage_created_idx on public.ai_usage (created_at desc);
create index if not exists ai_usage_request_idx on public.ai_usage (request_id);
create index if not exists ai_usage_user_idx on public.ai_usage (user_id, created_at desc);
create index if not exists ai_usage_provider_idx on public.ai_usage (provider, created_at desc);
create index if not exists ai_usage_model_idx on public.ai_usage (model_id, created_at desc);

-- 5. Failover / failure / test events (observability). No secrets and no provider response bodies are stored.
create table if not exists public.ai_provider_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid,
  event_type text not null check (event_type in ('failover', 'failure', 'test')),
  provider text,
  model text,
  error_code text,
  failure_reason text,
  fallback_provider text,
  fallback_model text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists ai_provider_events_created_idx on public.ai_provider_events (created_at desc);
create index if not exists ai_provider_events_request_idx on public.ai_provider_events (request_id);

-- 6. Idempotency: a retried request (same Idempotency-Key) returns the first answer instead of calling a provider again.
create table if not exists public.ai_requests (
  id uuid primary key default gen_random_uuid(),
  scope text not null,                 -- 'u:<user uuid>' or 'ip:<hash>'
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 80),
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scope, idempotency_key)
);
create index if not exists ai_requests_created_idx on public.ai_requests (created_at);

-- 7. Row Level Security. Server-only tables get RLS with no client policies (default deny) and revoked grants.
alter table public.ai_providers enable row level security;
alter table public.ai_models enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_provider_events enable row level security;
alter table public.ai_requests enable row level security;
alter table public.ai_usage enable row level security;

revoke all on public.ai_providers, public.ai_models, public.ai_provider_events, public.ai_requests from anon, authenticated;
revoke all on public.ai_conversations, public.ai_messages from anon;

-- Admins may read configuration and events directly; every change goes through the audited server API (service role).
drop policy if exists "admins read ai providers" on public.ai_providers;
create policy "admins read ai providers" on public.ai_providers for select to authenticated using (public.is_admin());
drop policy if exists "admins read ai models" on public.ai_models;
create policy "admins read ai models" on public.ai_models for select to authenticated using (public.is_admin());
drop policy if exists "admins read ai events" on public.ai_provider_events;
create policy "admins read ai events" on public.ai_provider_events for select to authenticated using (public.is_admin());
grant select on public.ai_providers, public.ai_models, public.ai_provider_events to authenticated;

-- Usage: users read only their own rows (policy from the initial schema); admins read all aggregates through the API.
drop policy if exists "users can read own ai usage" on public.ai_usage;
create policy "users can read own ai usage" on public.ai_usage for select to authenticated using (user_id = auth.uid());
drop policy if exists "admins read ai usage" on public.ai_usage;
create policy "admins read ai usage" on public.ai_usage for select to authenticated using (public.is_admin());
revoke insert, update, delete on public.ai_usage from anon, authenticated;

-- Conversations: strictly owner-only. Admins get NO policy here: private chats are not an admin feature.
drop policy if exists "users read own ai conversations" on public.ai_conversations;
create policy "users read own ai conversations" on public.ai_conversations for select to authenticated using (user_id = auth.uid());
drop policy if exists "users create own ai conversations" on public.ai_conversations;
create policy "users create own ai conversations" on public.ai_conversations for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "users update own ai conversations" on public.ai_conversations;
create policy "users update own ai conversations" on public.ai_conversations for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "users delete own ai conversations" on public.ai_conversations;
create policy "users delete own ai conversations" on public.ai_conversations for delete to authenticated using (user_id = auth.uid());
revoke update on public.ai_conversations from authenticated;
grant update (title) on public.ai_conversations to authenticated;

drop policy if exists "users read own ai messages" on public.ai_messages;
create policy "users read own ai messages" on public.ai_messages for select to authenticated
  using (exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.user_id = auth.uid()));
revoke insert, update, delete on public.ai_messages from authenticated;

-- 8. Server-only SQL helpers (service role). Counters count SUCCESSFUL, non-test requests only.
create or replace function public.ai_model_counters()
returns table (model_id uuid, day_count integer, month_count integer)
language sql stable security definer set search_path = public as $$
  select u.model_id,
         count(*) filter (where u.created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')::integer,
         count(*)::integer
  from public.ai_usage u
  where u.status = 'success' and u.model_id is not null and u.capability is distinct from 'test'
    and u.created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'
  group by u.model_id;
$$;

create or replace function public.ai_user_usage(p_user uuid)
returns table (requests_today integer, tokens_today bigint)
language sql stable security definer set search_path = public as $$
  select count(*)::integer, coalesce(sum(u.tokens_total), 0)::bigint
  from public.ai_usage u
  where u.user_id = p_user and u.status = 'success' and u.capability is distinct from 'test'
    and u.created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
$$;

-- Real, database-derived analytics for the admin dashboard. Nothing is estimated.
create or replace function public.ai_analytics()
returns jsonb language sql stable security definer set search_path = public as $$
  with attempts as (
    select * from public.ai_usage where request_id is not null and capability is distinct from 'test'
  ), req as (
    select request_id, bool_or(status = 'success') as ok, max(attempt) as attempts, (array_agg(tier order by attempt))[1] as tier, min(created_at) as at
    from attempts group by request_id
  ), ok_rows as (select * from attempts where status = 'success')
  select jsonb_build_object(
    'total_requests', (select count(*) from req),
    'successful_requests', (select count(*) filter (where ok) from req),
    'failed_requests', (select count(*) filter (where not ok) from req),
    'failover_requests', (select count(*) filter (where attempts > 1) from req),
    'requests_today', (select count(*) from req where at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'),
    'requests_this_month', (select count(*) from req where at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'),
    'avg_latency_ms', (select round(avg(latency_ms))::integer from ok_rows where latency_ms is not null),
    'tokens', (select jsonb_build_object('input', coalesce(sum(tokens_input), 0), 'output', coalesce(sum(tokens_output), 0), 'total', coalesce(sum(tokens_total), 0), 'requests_without_usage', count(*) filter (where tokens_total is null)) from ok_rows),
    'by_provider', coalesce((select jsonb_object_agg(provider, n) from (select coalesce(provider, 'none') as provider, count(*) as n from ok_rows group by 1) p), '{}'::jsonb),
    'by_model', coalesce((select jsonb_object_agg(model, n) from (select coalesce(model, 'none') as model, count(*) as n from ok_rows group by 1) m), '{}'::jsonb),
    'by_tier', coalesce((select jsonb_object_agg(tier, n) from (select coalesce(tier, 'unknown') as tier, count(*) as n from req group by 1) t), '{}'::jsonb)
  );
$$;

-- Retention: removes conversations idle for more than p_days (0 = keep conversations) and stale idempotency/event rows.
-- Called only from the admin API (or an optional pg_cron job). Never runs automatically on its own.
create or replace function public.ai_purge_expired(p_days integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_conv integer := 0; v_req integer; v_evt integer;
begin
  if p_days is not null and p_days > 0 then
    delete from public.ai_conversations where updated_at < now() - make_interval(days => p_days);
    get diagnostics v_conv = row_count;
  end if;
  delete from public.ai_requests where created_at < now() - interval '2 days';
  get diagnostics v_req = row_count;
  delete from public.ai_provider_events where created_at < now() - interval '180 days';
  get diagnostics v_evt = row_count;
  return jsonb_build_object('conversations_deleted', v_conv, 'idempotency_rows_deleted', v_req, 'events_deleted', v_evt);
end; $$;

revoke all on function public.ai_model_counters() from public, anon, authenticated;
revoke all on function public.ai_user_usage(uuid) from public, anon, authenticated;
revoke all on function public.ai_analytics() from public, anon, authenticated;
revoke all on function public.ai_purge_expired(integer) from public, anon, authenticated;
grant execute on function public.ai_model_counters() to service_role;
grant execute on function public.ai_user_usage(uuid) to service_role;
grant execute on function public.ai_analytics() to service_role;
grant execute on function public.ai_purge_expired(integer) to service_role;

-- 9. Seed. Two integrations with documented public APIs, plus the requested 10-model pool as DISABLED placeholders.
--    Placeholders have no provider and no model identifier on purpose: real identifiers and endpoints must come from
--    the administrator once a provider actually hosts the model. Nothing here claims a model is available or free.
insert into public.ai_providers (code, display_name, adapter, base_url, api_key_env, enabled) values
  ('gemini', 'Google Gemini', 'gemini', 'https://generativelanguage.googleapis.com/v1beta', 'GEMINI_API_KEY', true),
  ('grok', 'xAI Grok', 'grok', 'https://api.x.ai/v1', 'GROK_API_KEY', true)
on conflict (code) do nothing;

insert into public.ai_models (slug, display_name, capabilities, priority, enabled, free_user_enabled, premium_user_enabled) values
  ('qwen3-8-27b', 'Qwen3.8 27B', '{general,coding,writing}', 10, false, true, true),
  ('gemma-4-26b-a4b', 'Gemma 4 26B A4B', '{general,fast}', 20, false, true, true),
  ('gemma-4-31b', 'Gemma 4 31B', '{general,reasoning}', 30, false, false, true),
  ('nemotron-3-ultra', 'NVIDIA Nemotron 3 Ultra', '{general,reasoning,coding}', 40, false, false, true),
  ('nemotron-3-super', 'NVIDIA Nemotron 3 Super', '{general,reasoning}', 50, false, false, true),
  ('nemotron-3-nano-omni', 'NVIDIA Nemotron 3 Nano Omni', '{general,multimodal,fast}', 60, false, false, true),
  ('nemotron-3-5-lightning', 'NVIDIA Nemotron 3.5 Lightning', '{general,fast}', 70, false, false, true),
  ('ling-3-flash', 'Ling 3.0 Flash', '{general,fast,summarization}', 80, false, false, true),
  ('laguna-s-2-1', 'Laguna S 2.1', '{general,writing,creative}', 90, false, false, true),
  ('inkling', 'Inkling', '{general,creative,writing}', 100, false, false, true)
on conflict (slug) do nothing;
