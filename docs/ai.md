# Free-only AI platform

EliahTech routes all AI requests through the server and Supabase. Provider credentials stay in hosting environment variables; the browser never receives a credential or calls a model provider. **All user tiers (Guest, Free, Premium and Admin) are restricted to providers and models positively marked free.**

## Current supported free providers

| Provider | Adapter | API model | Free status | Secret name |
|---|---|---|---|---|
| Google Gemini | `gemini` | `gemini-3.5-flash-lite` | Google documents a no-cost API tier for this model | `GEMINI_API_KEY` |
| Groq | `groq` | `openai/gpt-oss-20b` | Groq's Free Plan rate-limit table lists the model | `GROQ_API_KEY` |

These plans are provider-account/API tiers, not promotional credits. Free limits and eligible model lists can change; check the official [Gemini API pricing and free-tier documentation](https://ai.google.dev/gemini-api/docs/pricing) and [Groq rate-limit documentation](https://console.groq.com/docs/rate-limits) before deployment. The application uses vendor-pinned HTTPS hosts and never silently switches to a paid model. A provider-side quota or rate-limit response is surfaced as a controlled temporary-unavailability/limit response; failover can only try another positively classified free model.

## Setup

1. Apply every Supabase migration in order, including `supabase/migrations/20261012170000_free_ai_and_site_content.sql`.
2. Create API credentials from the provider's free tier and add `GEMINI_API_KEY` and/or `GROQ_API_KEY` to the server environment (e.g. Vercel Environment Variables). Never place them in source code, Postgres, HTML or frontend variables.
3. Redeploy and open Admin → AI. The table shows the provider/model free classification, enabled/disabled state, health, model readiness and whether a server credential is configured.
4. Use **Test** to send one tiny server-side request; it is rate-limited and its result is audited. Test only after configuring the desired provider.

Provider setup does not require enabling paid billing. Keep the provider account on its no-cost tier; if its free quota is exhausted, the app returns a safe limit/unavailability result rather than purchasing more quota.

## Enforced invariants

- The only admin-configurable adapters are `gemini` and `groq`; each is pinned to its vendor host and to its own fixed credential-variable name.
- Both `ai_providers.is_free` and `ai_models.is_free` must be true. The registry, router and provider factory each independently enforce this. Free/Premium account access flags never override the provider/model free classification.
- Legacy xAI and unclassified custom/generic integrations are retired by the migration. The generic OpenAI-wire-format adapter remains as reusable code but is not an admin option and cannot be routed as free.
- Model failover stays inside the verified free model pool. Provider-side 429/5xx/network errors do not trigger a paid provider.
- Request attempts, input/output tokens, timeouts and daily/monthly model counts remain bounded. Provider quotas remain authoritative and may be lower than EliahTech's local caps.
- Model names and IDs must be exact and match provider documentation. The migration seeds only the two listed model IDs as enabled/free; other model records are disabled.

## Model registry and admin surface

`ai_providers` stores adapter metadata, a server environment-variable **name**, a free classification and enabled state; it never stores the secret. `ai_models` stores exact vendor model ID, capabilities, free classification, account-tier access flags, priority, output/timeout limits and local request caps. Provider health is based on real requests, not fabricated status.

Admin → AI supports provider/model configuration, status, testing, usage analytics and assistant limits/prompts. It does not allow paid/custom-provider adapters or a manual paid/free toggle. Configure and test from the model list; failed tests or missing configuration never imply that a model is available.

## EliahTech content and site settings

The project uses the existing CMS: `services`, `categories`, `social_links`, and the public `settings` JSON document (`site` and `homepage`). Admin → Site info edits brand identity, About-page copy and SEO defaults. Services, categories and social links remain editable in their existing admin sections; the public home/services/About/navigation render from these data sources. The added migration updates only legacy seed copy and disables obsolete category rows without deleting their post references. It preserves the existing WhatsApp URL.

## Privacy and retention

Conversations are owner-only. Admins cannot read private chats. Usage rows contain no message text; logs contain identifiers and provider/model outcomes but never secrets. Conversation retention remains governed by the existing AI settings and explicit purge action. Review provider privacy terms before sending personal or confidential information to an external model API.

## Express Gaming migration

Current status is documented in upgrade-status.md. Additional chat candidates start disabled. OpenRouter accepts only :free IDs. Verify account pricing/terms before enabling routes.

Browser chat uses durable owner-scoped tasks and explicit resume. A provider 429 records a shared SQL cooldown using Retry-After; models sharing that provider are skipped. There is no paid fallback, quota bypass or unlimited availability guarantee.

Screenshots require a multimodal model and validated PNG/JPEG/WebP data under 1.5 MB. Raw screenshots are removed from completed task payloads; unfinished tasks retain them until completion/deletion. Prompts, media and history may be shared with different configured providers during fallback. Free-tier data-use terms apply.

AI_VOICE_ENABLED=true enables dedicated Groq Whisper transcription. Whisper rows must not be added as chat models. Code execution, image generation and live web search remain disabled without suitable separate services. Conversation-text export runs locally in the browser.
