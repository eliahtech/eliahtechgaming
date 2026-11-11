-- Daily-capped newsletter sending: pause/resume, retry bookkeeping and a fair, fixed audience per campaign.
-- Safe to run more than once.
begin;

-- A failed delivery is retried on a later day until it has been attempted a few times (see src/newsletter-schedule.js).
alter table public.newsletter_deliveries add column if not exists attempts smallint not null default 1;

-- Campaigns can now be paused.
alter table public.newsletter_campaigns drop constraint if exists newsletter_campaigns_status_check;
alter table public.newsletter_campaigns add constraint newsletter_campaigns_status_check check (status in ('draft', 'sending', 'paused', 'sent'));

-- The daily quota check counts accepted emails and in-flight claims for the current UTC day.
create index if not exists newsletter_deliveries_status_updated_idx on public.newsletter_deliveries (status, updated_at);
create index if not exists email_events_type_status_created_idx on public.email_events (type, status, created_at);

-- Audience is fixed when the campaign starts: only subscribers who confirmed before it started receive it, oldest first,
-- so people who join mid-campaign never get an old issue days later. Unsubscribed people are skipped automatically.
create or replace function public.newsletter_next_batch(p_campaign uuid, p_limit integer)
returns table (id uuid, email text, unsubscribe_token text) language sql stable security definer set search_path = public as $$
  select s.id, s.email::text, s.unsubscribe_token
  from public.subscribers s
  join public.newsletter_campaigns c on c.id = p_campaign
  where s.status = 'active'
    and (c.started_at is null or coalesce(s.verified_at, s.subscribed_at) <= c.started_at)
    and not exists (select 1 from public.newsletter_deliveries d where d.campaign_id = p_campaign and d.subscriber_id = s.id)
  order by coalesce(s.verified_at, s.subscribed_at), s.id
  limit greatest(least(p_limit, 50), 1);
$$;
create or replace function public.newsletter_remaining(p_campaign uuid) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer
  from public.subscribers s
  join public.newsletter_campaigns c on c.id = p_campaign
  where s.status = 'active'
    and (c.started_at is null or coalesce(s.verified_at, s.subscribed_at) <= c.started_at)
    and not exists (select 1 from public.newsletter_deliveries d where d.campaign_id = p_campaign and d.subscriber_id = s.id);
$$;
revoke all on function public.newsletter_next_batch(uuid, integer) from public, anon, authenticated;
revoke all on function public.newsletter_remaining(uuid) from public, anon, authenticated;
grant execute on function public.newsletter_next_batch(uuid, integer) to service_role;
grant execute on function public.newsletter_remaining(uuid) to service_role;

update public.app_health set schema_version = '20261028_newsletter_daily_cap', updated_at = now() where id = 1;
commit;
