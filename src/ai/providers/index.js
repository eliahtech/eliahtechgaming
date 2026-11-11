// Adapter registry. Add a new integration by writing one adapter class and listing it here (and in the DB adapter check).
import { OpenRouterProvider } from './openrouter.js';
import { GeminiProvider } from './gemini.js';
import { GroqProvider } from './groq.js';
import { assertSafeBaseUrl, misconfigured } from './base.js';
import { ADAPTERS } from '../config.js';

// The generic OpenAI-wire adapter remains a reusable module but is intentionally not part of the active provider registry.
export const ADAPTER_CLASSES = { gemini: GeminiProvider, groq: GroqProvider, openrouter: OpenRouterProvider };
export { ProviderError } from './base.js';

// Where a provider is actually reached: model override, then provider setting, then the adapter's documented default.
export function resolveBaseUrl(provider, model) {
  const Adapter = ADAPTER_CLASSES[provider?.adapter];
  return model?.base_url || provider?.base_url || Adapter?.defaultBaseUrl || null;
}

export function createProviderFactory({ fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const cache = new Map();
  const adapterFor = (name) => {
    const Adapter = ADAPTER_CLASSES[name];
    if (!Adapter) throw misconfigured();
    if (!cache.has(name)) cache.set(name, new Adapter({ fetchImpl }));
    return cache.get(name);
  };
  return {
    // True only when the adapter exists, the key env var is set and the base URL is acceptable. Never returns the key.
    isConfigured(provider, model) {
      try {
        if (!ADAPTERS.includes(provider?.adapter) || provider.is_free !== true || model?.is_free !== true || !provider.api_key_env || !env[provider.api_key_env]) return false;
        assertSafeBaseUrl(resolveBaseUrl(provider, model), { allowedHosts: ADAPTER_CLASSES[provider.adapter].allowedHosts ?? undefined });
        return true;
      } catch { return false; }
    },
    // Secrets are read from the environment here, at call time, and handed straight to the adapter.
    call(provider, model, request) {
      if (!ADAPTERS.includes(provider?.adapter) || provider.is_free !== true || model?.is_free !== true) throw misconfigured();
      return adapterFor(provider.adapter).complete({ apiKey: env[provider.api_key_env], baseUrl: resolveBaseUrl(provider, model), model: model.model_identifier, ...request });
    },
  };
}
