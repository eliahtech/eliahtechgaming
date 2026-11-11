# Payments: PesaPal and PayPal

Official PesaPal API 3.0 documentation (source of truth): <https://developer.pesapal.com/how-to-integrate/e-commerce/api-30-json/api-reference>
(Authentication, RegisterIPNURL, SubmitOrderRequest, GetTransactionStatus). PayPal: <https://developer.paypal.com/docs/api/orders/v2/>.

## Architecture

```
browser -> POST /api/v1/payments/checkout {plan, provider}
              PaymentService (src/payments/service.js)
                 |-- PesaPalProvider (src/payments/pesapal.js)   token service, RegisterIPN, SubmitOrderRequest, GetTransactionStatus
                 `-- PayPalProvider  (src/payments/paypal.js)
              payment_complete() / payment_fail() / payment_refund()   atomic, idempotent Postgres functions
```

The business rules (price from the database, verification, activation, audit, email) live in `PaymentService`; providers only talk to their API.
Active providers are exactly **PesaPal** and **PayPal**.

## PesaPal flow

1. **Checkout.** Browser sends `{ plan, provider: "pesapal", phone_number?, country_code? }`. The server checks the account, loads the plan, takes the amount from `premium_plans.prices[PESAPAL_CURRENCY]`, inserts a `pending` payment with a unique `merchant_reference`, builds the billing address (account email and name, optional validated phone/country; nothing is stored) and calls `SubmitOrderRequest`. It stores `order_tracking_id` in `payments.provider_order_id` and returns `redirect_url` (checked to be https on pesapal.com).
2. **Customer pays** on PesaPal's hosted page. Which methods appear (cards, mobile money, ...) is decided by your PesaPal account, country, currency and environment. The site makes no promise about specific methods.
3. **IPN** (`POST /api/v1/payments/pesapal/ipn`) and **callback** (`GET /api/v1/payments/pesapal/callback`) carry only `OrderTrackingId`, `OrderMerchantReference`, `OrderNotificationType`. No status. The server validates them, finds the payment by `merchant_reference`, verifies the tracking id belongs to it, authenticates with PesaPal and calls `GetTransactionStatus`.
4. **Verification** before completion: merchant reference equals ours, currency equals ours, amount equals ours (compared in minor units). Any difference: nothing is activated, the payment is marked `failed` with reason `*_mismatch`, and a `payment.mismatch` audit entry is written for review (check the PesaPal dashboard: money may have moved).
5. **Activation** by `payment_complete()` (locks the row, no-op if repeated). One subscription per payment, enforced by a unique index. Then audit entries and a single success email.
6. The callback redirects the browser to `/payment/return?payment=<id>`; that page asks the authenticated API (`POST /payments/:id/confirm`), which asks PesaPal again, and shows Processing / Successful / Failed / Cancelled.
7. **Cancel URL** (`GET /api/v1/payments/pesapal/cancel?payment=<id>`) only redirects to `/payment/cancel`. Reaching it does not fail the payment; the server asks PesaPal and only PesaPal's answer changes state.

The IPN replies with PesaPal's documented JSON acknowledgement (`status: 200`). Provider/database errors reply `500` so PesaPal retries; malformed or unknown notifications reply `400`/`404`.

### Status mapping (documented PesaPal values)

| PesaPal `status_code` / `payment_status_description` | Internal result |
|---|---|
| 1 / COMPLETED | `completed` (only after the checks above) |
| 2 / FAILED | `failed` (a later verified COMPLETED on the same order still completes it) |
| 3 / REVERSED | `refunded` and the subscription ends if it was completed; otherwise `failed` |
| 0 / INVALID | stays `pending` (this is what an unpaid order reports) |
| anything else, or code and description disagree | stays `pending`; logged as `pesapal_unknown_status`; stored as an unprocessed event |

Description matching is case-insensitive (the official sample shows "Failed").

### Idempotency and replay

PesaPal can send several notifications per order. Safe because: the payment is found by unique `merchant_reference`; completion is atomic and one-shot; `subscriptions.payment_id` is unique; each verified result is recorded once in `payment_events` under the deterministic key `trackingId:notificationType:status:statusCode`; success/failure emails are sent only when `payment_complete()`/`payment_fail()` report a real state change. IP allow-listing is not used (PesaPal says its IPs can change).

## Configuration

| Variable | Purpose |
|---|---|
| `PESAPAL_ENV` | `sandbox` (default) or `live`. Selects the base URL in one place (`pesapalConfig`). |
| `PESAPAL_BASE_URL` | Optional; must equal the official base for `PESAPAL_ENV` (sandbox `https://cybqa.pesapal.com/pesapalv3`, live `https://pay.pesapal.com/v3`). |
| `PESAPAL_CONSUMER_KEY`, `PESAPAL_CONSUMER_SECRET` | Server-only credentials. Sandbox test keys: <https://developer.pesapal.com/api3-demo-keys.txt>. Live keys come with your merchant account. |
| `PESAPAL_CURRENCY` | Currency charged (default `KES`); plans need a price in it. |
| `PESAPAL_IPN_URL` | Public IPN URL, used only by the registration script: `APP_URL/api/v1/payments/pesapal/ipn`. |
| `PESAPAL_IPN_ID` | The `ipn_id` PesaPal returned at registration; sent as `notification_id` on every order. PesaPal checkout stays unavailable until it is set. |
| `PESAPAL_CALLBACK_URL`, `PESAPAL_CANCELLATION_URL` | Optional overrides; default to `APP_URL` + `/api/v1/payments/pesapal/callback` and `/cancel`. |

Never commit real values. Use separate sandbox and live values (Vercel: separate Preview and Production environment variables). Do not use live credentials in automated tests.

### One-time IPN registration (do not register per payment)

```bash
PESAPAL_ENV=sandbox PESAPAL_CONSUMER_KEY=... PESAPAL_CONSUMER_SECRET=... \
PESAPAL_IPN_URL=https://YOUR-DOMAIN/api/v1/payments/pesapal/ipn npm run pesapal:register-ipn
```

The script registers the URL as `POST`, prints `PESAPAL_IPN_ID=<guid>` (and reports an existing registration instead of creating a duplicate). Put the id in the environment and redeploy. Repeat for live. PesaPal also offers web forms for this (see the RegisterIPNURL page). The IPN URL must be publicly reachable (not localhost).

## Recurring billing

Not implemented and not enabled. PesaPal documents recurring payments for specific payment methods only (cards in the documented flow); M-Pesa must not be assumed to support automatic debits. Subscriptions renew manually: buying again extends from the current expiry. If you later add recurring billing, put it behind a feature flag and confirm it with PesaPal for your merchant account first.

## Migration from the earlier provider plan

`supabase/migrations/20261006_replace_equity_with_pesapal.sql` is additive: new `merchant_reference` column (unique), a provider rule for new rows (`pesapal`, `paypal`; `NOT VALID` so any historical `equity` row is preserved), extra `payment_events` columns, and `payment_analytics()`. The earlier Equity integration was never implemented, so no Equity payment data exists to migrate; the Equity provider file, credentials and UI were removed.

## Notification emails

Through the Resend mailer: payment started, payment received / subscription activated, payment failed. Best effort (a mail failure never changes a payment). **Subscription-expiry emails are not implemented**: they need a scheduled job (for example Vercel Cron), which the project does not have yet.

## Testing

`npm test` runs everything with PesaPal and PayPal mocked (`test/pesapal.test.js`, `test/payments.test.js`). The mocks follow the official response shapes. A live sandbox end-to-end run (login, order, pay on the PesaPal sandbox, IPN, status query, activation) needs sandbox credentials and a public URL and has to be done by you; this repository does not claim it as done.
