-- Optional one-off seed: recommended Premium plans and pricing settings for Eliahtech Gaming.
-- Run it once in the Supabase dashboard: SQL Editor > New query > paste > Run. It is safe to run again.
--
-- What it does
--  * Creates three plans (monthly, quarterly, yearly) with KES prices for PesaPal and USD prices for PayPal.
--    Re-running it resets name, description, duration and prices of these three plans to the values below. It never
--    changes whether a plan is switched on, so a plan you disabled in the admin dashboard stays disabled.
--  * Updates the public Premium settings (price label, period, trial length). It does NOT change "status": leave it as
--    "coming_soon" until PesaPal/PayPal are configured in Vercel and a test payment works, then switch it to "available"
--    in the admin dashboard (Settings > Premium), or run the commented statement at the bottom.
--
-- Prices are decimal strings keyed by currency. Payments are one-off (no auto-renewal): each payment adds the plan's days.

insert into public.premium_plans (code, name, description, duration_days, prices, enabled, sort_order) values
  ('monthly',   'Monthly',   'Ad-free reading, advanced gaming guides, priority gaming support and a higher AI limit for 30 days. One-off payment, no auto-renewal.',  30, '{"KES":"199.00","USD":"2.99"}',   true, 10),
  ('quarterly', 'Quarterly', 'Everything in Monthly for 90 days. Save about 16% compared with paying monthly. One-off payment, no auto-renewal.',                         90, '{"KES":"499.00","USD":"7.99"}',   true, 20),
  ('yearly',    'Yearly',    'Everything in Monthly for 365 days. Best value: save about 37% compared with paying monthly. One-off payment, no auto-renewal.',          365, '{"KES":"1499.00","USD":"24.99"}', true, 30)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  duration_days = excluded.duration_days,
  prices = excluded.prices,
  sort_order = excluded.sort_order,
  updated_at = now();

-- Premium page settings. Existing keys (including "status") are kept; only these three are set.
insert into public.settings (key, value, is_public)
values ('premium', '{"status":"coming_soon","price_label":"From KSh 199","period":"month","trial_days":3}', true)
on conflict (key) do update set
  value = public.settings.value || jsonb_build_object('price_label', 'From KSh 199', 'period', 'month', 'trial_days', 3),
  is_public = true,
  updated_at = now();

-- When payments are ready, open sales by running this (or change Status in the admin dashboard):
-- update public.settings set value = value || '{"status":"available"}', updated_at = now() where key = 'premium';
