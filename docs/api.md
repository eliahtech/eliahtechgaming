# Payment API

All responses: `{ "success": true, "data": ... }` or `{ "success": false, "error": { "code", "message" } }`, except the PesaPal IPN, which answers in PesaPal's documented acknowledgement format.

| Endpoint | Auth | Notes |
|---|---|---|
| `GET /api/v1/payments/plans` | none | Enabled plans with prices per currency. |
| `GET /api/v1/payments/providers` | none | `pesapal` and `paypal` with `available`, `currency`, `reason`. |
| `POST /api/v1/payments/checkout` | Bearer | Body `{ "plan": "<code>" (alias `plan_id`), "provider": "pesapal"\|"paypal", "phone_number"?, "country_code"? }`. Amount, currency and user are never read from the body. Returns `{ payment_id, provider, approval_url }`; send the customer to `approval_url`. |
| `POST /api/v1/payments/:id/confirm` | Bearer, owner | Server asks the provider and returns `{ status, ... }`. |
| `POST /api/v1/payments/:id/cancel` | Bearer, owner | PayPal: cancels an unpaid order. PesaPal: asks PesaPal; stays `pending` unless PesaPal says otherwise. |
| `GET /api/v1/payments/mine`, `GET /api/v1/subscriptions/me` | Bearer | History. |
| `POST` or `GET /api/v1/payments/pesapal/ipn` | public | Params `OrderTrackingId`, `OrderMerchantReference`, `OrderNotificationType` (JSON body for POST, query for GET). Replies `{ orderNotificationType, orderTrackingId, orderMerchantReference, status: 200 }`; `500` makes PesaPal retry. Rate limited. |
| `GET /api/v1/payments/pesapal/callback` | public | Verifies with PesaPal, then 302 to `/payment/return?payment=<id>` (or `/premium`). |
| `GET /api/v1/payments/pesapal/cancel?payment=<id>` | public | 302 to `/payment/cancel?payment=<id>`; changes nothing by itself. |
| `POST /api/v1/payments/webhooks/paypal` | PayPal signature | Unchanged. |
| `GET /api/v1/admin/payments` | admin | Filters `provider,status,currency,from,to,user,reference,plan`; `limit`/`offset` pagination. |
| `GET /api/v1/admin/payments/analytics` | admin | Revenue by currency/provider/plan, payments by status, subscriptions, trial conversions (from `payment_analytics()`). |
| `GET /api/v1/admin/payments/:id` | admin | Includes provider events. |

## AI API

See [ai.md](ai.md) for `/api/v1/ai/*` and `/api/v1/admin/ai/*` (chat, models, usage, conversations, errors, failover, limits).

## Express Gaming additions

Browser sessions use HttpOnly cookies; mutations send X-CSRF-Token. Browser login/refresh sends X-Eliah-Browser: 1 and receives cookies instead of raw tokens. Native clients may retain Bearer authentication.

Reader APIs: /api/v1/community/me, /device, /bookmarks/:postId, /history, /follows, /tickets, /requests and /member-benefits. Feedback/reports/comments are under /community/{feedback|reports|comments}/:postId. Private benefits require active Premium.

Admin resources add ads, tickets, reports, comments and requests. /admin/settings/ads controls the global switch; /settings/member-benefits controls private community/support settings. /admin/posts/:id/{revisions|autosave} provides recovery. /admin/tickets/:id/conversation exposes only a conversation explicitly selected by that ticket's owner.

AI tasks: POST/GET /api/v1/ai/tasks, GET/DELETE /:id and POST /:id/resume. Optional voice: POST /api/v1/ai/transcribe, supported audio under 3 MB. All reader/admin/task responses are no-store.

The disabled-by-default scheduler endpoint is `/api/v1/jobs/run` (POST for external schedulers, GET for Vercel Cron), authenticated with `JOBS_TOKEN` or `CRON_SECRET`. It sends the day's share of the active newsletter campaign, within the daily limit (see `docs/newsletter.md`).
