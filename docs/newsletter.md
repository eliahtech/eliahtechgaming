# Newsletter sending (daily limit)

Newsletters are written and sent **by hand** from Admin > Newsletter. Nothing is emailed automatically when a post is published. This keeps the free Resend plan (100 emails per day, 3,000 per month, shared with sign-up confirmations, payment receipts and contact replies) from being used up.

## How a campaign is sent
1. Create a draft, press **Send test** to see it in your own inbox, then press **Start sending**.
2. Starting freezes the audience: only subscribers who confirmed their address **before** you pressed Start receive this issue. People who join later, or who have not confirmed, do not get an old issue days afterwards. Anyone who unsubscribes meanwhile is skipped automatically.
3. At most **N emails per day** go out (default 30; change it under Admin > Newsletter > *Daily sending limit*, or with `NEWSLETTER_DAILY_LIMIT`; the admin setting wins). The first batch goes out when you press Start. The scheduled job then continues every day with the next people, oldest subscribers first, until everyone has the issue.
4. If fewer people are waiting than the limit, only those are sent (20 subscribers and a limit of 30 sends 20). Two campaigns never run at once: the oldest continues first; the next starts only if the first finishes with allowance left that day.
5. **Pause** stops sending until you press **Resume sending**. **Send today's batch now** sends whatever is left of today's allowance. It can never exceed the limit.

| Subscribers | Days at 30 a day |
|---|---|
| 20 | 1 |
| 100 | 4 |
| 500 | 17 |
| 1,000 | 34 |

For a large list, raise the limit when you move to a paid email plan, otherwise the last subscribers receive old news.

## The daily limit and the "day"
The day is the **UTC calendar day**, because Resend's daily quota resets at 00:00 UTC (03:00 in Kenya). The number sent today is counted from the email log (`email_events`, type `newsletter`, status `sent`) plus rows claimed but not yet finished, so repeated or overlapping runs cannot go over the limit. Failed sends do not use quota.

## Failures
A failed delivery is retried automatically on a **later day** (never the same day) up to 3 attempts in total. If the mail service rejects a whole batch the run stops for the day. **Retry failed now** resets failed deliveries so they are eligible again, still within the daily limit.

## The scheduled job
`/api/v1/jobs/run` does the daily work (newsletter share, followed-game notifications, link checks).
- **Vercel Cron** (free plan: once a day): `vercel.json` calls it daily at 03:30 UTC (06:30 Kenya time) with a GET request. Set `SCHEDULER_ENABLED=true` and a random `CRON_SECRET` (32+ characters) on production; Vercel sends it as `Authorization: Bearer <CRON_SECRET>`. Cron runs on production deployments only.
- **External scheduler**: `POST` with `Authorization: Bearer <JOBS_TOKEN>`. Calling it more often is harmless.

On the free Vercel plan the job runs once a day at some point within its scheduled hour, so followed-game notifications for scheduled posts can be up to a day late. An external scheduler every 15 minutes avoids that and is still safe for newsletters.

## Upgrading
Apply `supabase/migrations/20261028100000_newsletter_daily_cap.sql` after a backup (health marker `20261028_newsletter_daily_cap`). It adds retry bookkeeping, the paused status and the fixed-audience rule. It does not change existing subscribers, campaigns or sent history.
