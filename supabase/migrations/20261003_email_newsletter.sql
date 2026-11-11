-- Email, newsletter and contact inbox support.

-- Newsletter subscribers: double opt-in. Only a SHA-256 hash of the confirmation token is stored.
alter table public.subscribers add column if not exists verify_token_hash text;
alter table public.subscribers add column if not exists verify_sent_at timestamptz;
alter table public.subscribers add column if not exists unsubscribed_at timestamptz;
alter table public.subscribers drop constraint if exists subscribers_status_check;
alter table public.subscribers add constraint subscribers_status_check check (status in ('pending', 'active', 'unsubscribed'));
create index if not exists subscribers_status_idx on public.subscribers (status, subscribed_at desc);
create index if not exists subscribers_verify_hash_idx on public.subscribers (verify_token_hash) where verify_token_hash is not null;

-- Contact inbox: add the "replied" state and supporting indexes.
alter table public.messages drop constraint if exists messages_status_check;
alter table public.messages add constraint messages_status_check check (status in ('unread', 'read', 'replied', 'archived'));
create index if not exists messages_status_idx on public.messages (status, created_at desc);
create index if not exists messages_email_idx on public.messages (email);
create index if not exists message_replies_message_idx on public.message_replies (message_id, created_at);

-- Every email attempt (never the body). Written by the server only.
create table if not exists public.email_events (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  to_email text not null,
  status text not null check (status in ('sent', 'failed')),
  error text,
  campaign_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists email_events_created_idx on public.email_events (created_at desc);
create index if not exists email_events_to_idx on public.email_events (to_email);
alter table public.email_events enable row level security;
create policy "admins read email events" on public.email_events for select using (public.is_admin());

-- Newsletter campaigns are sent in small batches (serverless time limits). Deliveries make sending resumable and idempotent.
create table if not exists public.newsletter_campaigns (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  content_html text not null,
  status text not null default 'draft' check (status in ('draft', 'sending', 'sent')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);
create table if not exists public.newsletter_deliveries (
  campaign_id uuid not null references public.newsletter_campaigns (id) on delete cascade,
  subscriber_id uuid not null references public.subscribers (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  error text,
  updated_at timestamptz not null default now(),
  primary key (campaign_id, subscriber_id)
);
create index if not exists newsletter_deliveries_status_idx on public.newsletter_deliveries (campaign_id, status);
alter table public.newsletter_campaigns enable row level security;
alter table public.newsletter_deliveries enable row level security;
create policy "admins manage campaigns" on public.newsletter_campaigns for all using (public.is_admin()) with check (public.is_admin());
create policy "admins read deliveries" on public.newsletter_deliveries for select using (public.is_admin());

create or replace function public.newsletter_next_batch(p_campaign uuid, p_limit integer)
returns table (id uuid, email text, unsubscribe_token text) language sql stable security definer set search_path = public as $$
  select s.id, s.email::text, s.unsubscribe_token from public.subscribers s
  where s.status = 'active'
    and not exists (select 1 from public.newsletter_deliveries d where d.campaign_id = p_campaign and d.subscriber_id = s.id)
  order by s.id limit greatest(least(p_limit, 50), 1);
$$;
create or replace function public.newsletter_remaining(p_campaign uuid) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer from public.subscribers s
  where s.status = 'active'
    and not exists (select 1 from public.newsletter_deliveries d where d.campaign_id = p_campaign and d.subscriber_id = s.id);
$$;
revoke all on function public.newsletter_next_batch(uuid, integer) from public, anon, authenticated;
revoke all on function public.newsletter_remaining(uuid) from public, anon, authenticated;
grant execute on function public.newsletter_next_batch(uuid, integer) to service_role;
grant execute on function public.newsletter_remaining(uuid) to service_role;
