# Payment data

- `payments`: one row per attempt. `provider` (`pesapal`|`paypal`), `merchant_reference` (unique, PesaPal only), `provider_order_id` (PayPal order id / PesaPal `order_tracking_id`, unique per provider), `transaction_id`, `amount`, `currency`, `status` (`pending|completed|failed|cancelled|refunded`), `payment_method`, `metadata` (plan, duration, provider reference), `completed_at`, `failure_reason`.
- `payment_events`: provider notification log, unique `(provider, event_id)`; `tracking_id`, `merchant_reference`, redacted `payload`, `processed`, `processed_at`, `error_message`, `received_at`. Admin-read only.
- `subscriptions`: `payment_id` unique, so a payment can activate access once.
- Functions (service role only): `payment_complete`, `payment_fail`, `payment_refund`, `payment_analytics`.
- RLS: users read only their own payments; plans are public when enabled; events and everything else are admin-only. Writes happen server-side with the service role.
- Migration `20261006_replace_equity_with_pesapal.sql` is additive and preserves all existing payment and PayPal rows.

# AI data (Phase 5, migration `20261007_ai_platform.sql`)

- `ai_providers` / `ai_models`: the registry. Providers hold only the NAME of an environment variable (`api_key_env`), never a key. A model cannot be enabled without a provider and a model identifier (check constraint). Admin-readable via RLS; all writes go through the audited server API.
- `ai_usage` (extended, one row per provider attempt): `request_id`, `model_id`, `capability`, `tier`, `tokens_input/output/total` (null when the provider reports none), `latency_ms`, `error_code`, `attempt`, `status` (`success|error|timeout|rate_limited|rejected`). Users can read only their own rows; no client writes.
- `ai_provider_events`: failover / failure / test events (provider, model, reason, fallback). Admin-read only.
- `ai_requests`: idempotency keys (`unique (scope, idempotency_key)`), purged after 2 days. No client access.
- `ai_conversations` / `ai_messages`: owner-only RLS; no admin policy; clients cannot insert messages (server only).
- Functions (service role only): `ai_model_counters`, `ai_user_usage`, `ai_analytics`, `ai_purge_expired`.
- AI settings live in `settings` under key `ai` with `is_public = false`.
