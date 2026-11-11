# Database verification

Apply pending migrations after a backup. Expected health marker: 20261028_newsletter_daily_cap.

npm run verify:supabase performs read-only live checks; it does not apply migrations. /api/v1/health/supabase exposes minimal status, with detailed checks protected by HEALTH_DIAGNOSTICS_TOKEN.

Isolated SQL tests do not substitute for checking your existing Supabase schema, RLS roles, storage and data.


The isolated fixture also checks the new link queue leases, quality aggregates, private RPC grants and public update-history trigger.
