// Central AI configuration: vocabulary, hard ceilings and defaults. Nothing else in src/ai hardcodes a limit.
// Defaults can be tuned with environment variables; the admin-editable settings document (settings.key = 'ai')
// overrides them, and HARD ceilings always win so a bad setting can never cause unbounded provider spend.

export const CAPABILITIES = ['general', 'reasoning', 'coding', 'writing', 'translation', 'summarization', 'multimodal', 'fast', 'long_context', 'seo', 'creative', 'data_analysis'];
export const TIERS = ['guest', 'free_user', 'premium_user', 'admin'];
// Only adapters whose free API plans are verified and whose endpoints are pinned can be configured in Admin.
export const ADAPTERS = ['gemini', 'groq', 'openrouter'];

export const HARD = {
  maxInputChars: 32000,          // 32k chars can reach ~128 KB of UTF-8; the global JSON body limit (100 KB) is a second guard
  maxOutputTokens: 8192,
  maxAttempts: 5,                // provider attempts for one request, whatever the settings say
  maxTimeoutMs: 55000,
  minTimeoutMs: 1000,
  maxDeadlineMs: 58000,          // whole request, must stay under the serverless function limit (vercel.json maxDuration 60)
  maxContextMessages: 40,
  maxContextChars: 60000,
  maxMessagesPerConversation: 400,
  maxConversationsListed: 100,
  maxRetentionDays: 3650,
};

const int = (value, fallback, min, max) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
};

// Per-tier request/token limits. `null` means "no limit of that kind" and is only offered for token limits.
export const defaultLimits = () => ({
  guest: { per_minute: 3, per_day: 10, tokens_per_day: null },
  free_user: { per_minute: 5, per_day: 30, tokens_per_day: 50000 },
  premium_user: { per_minute: 20, per_day: 500, tokens_per_day: 500000 },
  admin: { per_minute: 60, per_day: 2000, tokens_per_day: null },
});

export function defaultSettings(env = process.env) {
  const retries = int(env.AI_MAX_RETRIES, 2, 0, HARD.maxAttempts - 1);
  return {
    ai_name: 'Eliah AI',
    welcome_message: 'Hi! Ask me about PPSSPP, Android games, football tactics, installation errors or gaming content creation.',
    system_prompt: 'You are {{ai_name}}, the assistant for Eliah Tech, a gaming guides and support site. Be accurate, practical and concise. Help with gaming, technology, Android, websites, HTML, CSS, JavaScript, Node.js, Express, Supabase, PostgreSQL, APIs, SEO, content creation, tutorials and troubleshooting. If you are not sure, say so instead of guessing. Do not claim to have done things you cannot do.',
    safety_instructions: 'Decline requests for malware, credential theft, piracy of paid software, or anything illegal or harmful. Do not give medical, legal or financial advice as if you were a professional.',
    default_model: env.AI_DEFAULT_MODEL || null,
    default_capability: CAPABILITIES.includes(env.AI_DEFAULT_CAPABILITY) ? env.AI_DEFAULT_CAPABILITY : 'general',
    enabled_capabilities: [...CAPABILITIES],
    guest_access: false,
    free_access: true,
    premium_access: true,
    max_input_chars: int(env.AI_MAX_INPUT_CHARS, 4000, 1, HARD.maxInputChars),
    max_output_tokens: int(env.AI_MAX_OUTPUT_TOKENS, 1024, 1, HARD.maxOutputTokens),
    max_context_messages: 12,
    max_context_chars: 12000,
    failover_enabled: true,
    free_failover: true,            // Every eligible model is positively classified FREE; fallback stays within this allow-listed pool
    max_attempts: retries + 1,      // AI_MAX_RETRIES extra attempts after the first
    request_timeout_ms: int(env.AI_REQUEST_TIMEOUT_MS, 20000, HARD.minTimeoutMs, HARD.maxTimeoutMs),
    total_deadline_ms: 50000,
    rag_enabled: true,
    retention_days: 0,              // 0 = keep conversations until the user deletes them
    upgrade_message: 'EliahTech AI uses free-plan providers only. Availability depends on provider free-tier limits.',
    limits: defaultLimits(),
  };
}
