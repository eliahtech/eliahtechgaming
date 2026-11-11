-- Payments and subscriptions. Prices live in the database; the browser only ever names a plan.
-- Granting access happens in payment_complete(), which is atomic and idempotent (safe for webhook retries).

create table if not exists public.premium_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9-]{2,40}$'),
  name text not null,
  description text,
  duration_days integer not null check (duration_days between 1 and 3660),
  prices jsonb not null default '{}',           -- e.g. {"USD":"4.99","KES":"499.00"}, decimal strings
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.premium_plans enable row level security;
create policy "public can read enabled plans" on public.premium_plans for select using (enabled);
create policy "admins manage plans" on public.premium_plans for all using (public.is_admin()) with check (public.is_admin());

alter table public.payments add column if not exists plan_id uuid references public.premium_plans (id) on delete set null;
alter table public.payments add column if not exists provider_order_id text;
alter table public.payments add column if not exists completed_at timestamptz;
alter table public.payments add column if not exists failure_reason text;
alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments add constraint payments_status_check check (status in ('pending', 'completed', 'failed', 'cancelled', 'refunded'));
alter table public.payments drop constraint if exists payments_amount_positive;
alter table public.payments add constraint payments_amount_positive check (amount > 0);
create unique index if not exists payments_provider_order_uidx on public.payments (provider, provider_order_id) where provider_order_id is not null;
create unique index if not exists payments_provider_txn_uidx on public.payments (provider, transaction_id) where transaction_id is not null;
create index if not exists payments_user_idx on public.payments (user_id, created_at desc);
create index if not exists payments_status_idx on public.payments (status, created_at desc);
create policy "users read own payments" on public.payments for select using (user_id = auth.uid());

alter table public.subscriptions add column if not exists payment_id uuid references public.payments (id) on delete set null;
alter table public.subscriptions add column if not exists plan_id uuid references public.premium_plans (id) on delete set null;
alter table public.subscriptions drop constraint if exists subscriptions_status_check;
alter table public.subscriptions add constraint subscriptions_status_check check (status in ('active', 'expired', 'cancelled'));
create unique index if not exists subscriptions_payment_uidx on public.subscriptions (payment_id) where payment_id is not null;
create index if not exists subscriptions_user_idx on public.subscriptions (user_id, status, expires_at desc);
create index if not exists subscriptions_provider_sub_idx on public.subscriptions (provider_subscription_id) where provider_subscription_id is not null;

-- Provider webhook events already handled (deduplication + audit trail). The processing itself is also idempotent.
create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  event_type text not null,
  payment_id uuid references public.payments (id) on delete set null,
  received_at timestamptz not null default now(),
  unique (provider, event_id)
);
create index if not exists payment_events_payment_idx on public.payment_events (payment_id);
alter table public.payment_events enable row level security;
create policy "admins read payment events" on public.payment_events for select using (public.is_admin());

-- Mark a payment completed and extend the user's access. Locks the row, so concurrent calls cannot double-grant.
create or replace function public.payment_complete(p_payment_id uuid, p_transaction_id text, p_metadata jsonb default '{}')
returns table (out_payment_id uuid, out_status text, out_newly_completed boolean, out_expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_pay public.payments;
  v_start timestamptz;
  v_end timestamptz;
  v_days integer;
begin
  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then raise exception 'payment not found'; end if;

  if v_pay.status in ('completed', 'refunded') then
    return query select v_pay.id, v_pay.status, false, (select max(s.expires_at) from public.subscriptions s where s.payment_id = v_pay.id);
    return;
  end if;
  if v_pay.user_id is null then raise exception 'payment has no user'; end if;
  v_days := (v_pay.metadata ->> 'duration_days')::integer;
  if v_days is null or v_days < 1 then raise exception 'payment has no duration'; end if;

  select greatest(now(), coalesce(max(s.expires_at), now())) into v_start
  from public.subscriptions s where s.user_id = v_pay.user_id and s.status = 'active' and s.expires_at > now();
  v_end := v_start + make_interval(days => v_days);

  update public.payments set status = 'completed', transaction_id = coalesce(p_transaction_id, transaction_id), completed_at = now(),
    failure_reason = null, updated_at = now(), metadata = metadata || coalesce(p_metadata, '{}') where id = v_pay.id;
  insert into public.subscriptions (user_id, plan, status, started_at, expires_at, payment_provider, payment_id, plan_id)
  values (v_pay.user_id, coalesce(v_pay.metadata ->> 'plan_code', 'premium'), 'active', v_start, v_end, v_pay.provider, v_pay.id, v_pay.plan_id);

  return query select v_pay.id, 'completed'::text, true, v_end;
end; $$;

-- Pending -> failed/cancelled only. A completed or refunded payment is never downgraded by a late event.
create or replace function public.payment_fail(p_payment_id uuid, p_status text, p_reason text)
returns table (out_status text, out_changed boolean)
language plpgsql security definer set search_path = public as $$
declare v_pay public.payments;
begin
  if p_status not in ('failed', 'cancelled') then raise exception 'invalid status'; end if;
  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then raise exception 'payment not found'; end if;
  if v_pay.status <> 'pending' then return query select v_pay.status, false; return; end if;
  update public.payments set status = p_status, failure_reason = left(p_reason, 200), updated_at = now() where id = v_pay.id;
  return query select p_status, true;
end; $$;

-- Refund/chargeback: completed -> refunded and the linked subscription ends now.
create or replace function public.payment_refund(p_payment_id uuid, p_metadata jsonb default '{}')
returns table (out_status text, out_changed boolean)
language plpgsql security definer set search_path = public as $$
declare v_pay public.payments;
begin
  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then raise exception 'payment not found'; end if;
  if v_pay.status <> 'completed' then return query select v_pay.status, false; return; end if;
  update public.payments set status = 'refunded', updated_at = now(), metadata = metadata || coalesce(p_metadata, '{}') where id = v_pay.id;
  update public.subscriptions set status = 'cancelled', expires_at = least(expires_at, now()), updated_at = now() where payment_id = v_pay.id;
  return query select 'refunded'::text, true;
end; $$;

revoke all on function public.payment_complete(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.payment_fail(uuid, text, text) from public, anon, authenticated;
revoke all on function public.payment_refund(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.payment_complete(uuid, text, jsonb) to service_role;
grant execute on function public.payment_fail(uuid, text, text) to service_role;
grant execute on function public.payment_refund(uuid, jsonb) to service_role;
