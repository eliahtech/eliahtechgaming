-- Phase 4.1: PesaPal replaces Equity as a payment provider. PayPal is unchanged.
-- Additive and safe to run on a database that already holds payments: no table is dropped, no row is rewritten.
-- Any historical payment with provider = 'equity' stays readable (none can exist from the shipped code, which never created one).
-- The PesaPal order tracking id is stored in the existing payments.provider_order_id column (unique per provider since 20261004),
-- so no duplicate "pesapal_order_tracking_id" column is added.

-- 1. Payments: our own unique, PesaPal-safe order reference (sent to PesaPal as `id`, returned as merchant_reference).
alter table public.payments add column if not exists merchant_reference text;
alter table public.payments drop constraint if exists payments_merchant_reference_format;
alter table public.payments add constraint payments_merchant_reference_format check (merchant_reference is null or merchant_reference ~ '^[A-Za-z0-9._:-]{1,50}$');
create unique index if not exists payments_merchant_reference_uidx on public.payments (merchant_reference) where merchant_reference is not null;
create index if not exists payments_provider_status_idx on public.payments (provider, status, created_at desc);
create index if not exists payments_currency_idx on public.payments (currency);

-- New rows must use an active provider. NOT VALID keeps any historical 'equity' rows untouched while enforcing the rule going forward.
alter table public.payments drop constraint if exists payments_provider_check;
alter table public.payments add constraint payments_provider_check check (provider in ('pesapal', 'paypal')) not valid;

-- 2. Provider notification log (IPN / webhook): which payment, what happened, whether it was processed.
alter table public.payment_events add column if not exists tracking_id text;
alter table public.payment_events add column if not exists merchant_reference text;
alter table public.payment_events add column if not exists payload jsonb;          -- redacted: never secrets or tokens
alter table public.payment_events add column if not exists processed boolean not null default true;
alter table public.payment_events add column if not exists processed_at timestamptz;
alter table public.payment_events add column if not exists error_message text;
create index if not exists payment_events_tracking_idx on public.payment_events (tracking_id) where tracking_id is not null;
-- RLS on payment_events is unchanged: only admins can read it; the server writes with the service role.

-- 3. Real analytics for the admin dashboard (computed in the database; nothing is estimated).
--    Revenue counts completed payments only (refunded/reversed excluded). A "trial conversion" is a user who had a trial
--    and has at least one completed payment.
create or replace function public.payment_analytics()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'revenue_by_currency', coalesce((select jsonb_object_agg(currency, total) from (select currency, sum(amount)::text as total from public.payments where status = 'completed' group by currency) t), '{}'::jsonb),
    'revenue_by_provider', coalesce((select jsonb_agg(jsonb_build_object('provider', provider, 'currency', currency, 'total', total, 'payments', n) order by provider, currency) from (select provider, currency, sum(amount)::text as total, count(*) as n from public.payments where status = 'completed' group by provider, currency) t), '[]'::jsonb),
    'revenue_by_plan', coalesce((select jsonb_agg(jsonb_build_object('plan', plan, 'currency', currency, 'total', total, 'payments', n) order by plan, currency) from (select coalesce(metadata ->> 'plan_code', 'unknown') as plan, currency, sum(amount)::text as total, count(*) as n from public.payments where status = 'completed' group by 1, 2) t), '[]'::jsonb),
    'payments_by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) as n from public.payments group by status) t), '{}'::jsonb),
    'subscriptions', jsonb_build_object(
      'active', (select count(*) from public.subscriptions where status = 'active' and expires_at > now()),
      'active_paid', (select count(*) from public.subscriptions where status = 'active' and expires_at > now() and payment_id is not null),
      'expired', (select count(*) from public.subscriptions where status = 'expired' or (status = 'active' and expires_at <= now()))
    ),
    'trial_conversions', jsonb_build_object(
      'trial_users', (select count(*) from public.profiles where trial_started_at is not null),
      'converted', (select count(distinct p.user_id) from public.payments p join public.profiles pr on pr.id = p.user_id where p.status = 'completed' and pr.trial_started_at is not null)
    )
  );
$$;
revoke all on function public.payment_analytics() from public, anon, authenticated;
grant execute on function public.payment_analytics() to service_role;
