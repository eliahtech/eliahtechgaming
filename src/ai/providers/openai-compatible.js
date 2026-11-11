// Adapter for any "POST {base}/chat/completions" gateway (the de-facto OpenAI wire format). The base URL is NEVER defaulted
// here: it must come from the registry, so no endpoint is ever invented in code.
import { AIProvider, postJson, toUsage, assertSafeBaseUrl, contentRejected, emptyResponse, misconfigured } from './base.js';

const textOf = (content) => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => (typeof part === 'string' ? part : part?.type === 'text' ? part.text : '')).join('');
  return '';
};

export class OpenAICompatibleProvider extends AIProvider {
  static adapter = 'openai_compatible';
  static defaultBaseUrl = null;
  static allowedHosts = null; // generic gateways: operator allow-list (AI_ALLOWED_BASE_HOSTS) applies when set

  async complete({ apiKey, baseUrl, model, messages, maxTokens, temperature, timeoutMs }) {
    if (!apiKey || !baseUrl || !model) throw misconfigured();
    const root = assertSafeBaseUrl(baseUrl, { allowedHosts: this.constructor.allowedHosts ?? undefined });
    const json = await postJson({
      fetchImpl: this.fetchImpl,
      url: `${root}/chat/completions`,
      headers: { Authorization: `Bearer ${apiKey}` },
      body: { model, messages, max_tokens: maxTokens, ...(temperature != null ? { temperature } : {}), stream: false },
      timeoutMs,
    });
    const choice = json?.choices?.[0];
    if (choice?.finish_reason === 'content_filter') throw contentRejected();
    const content = textOf(choice?.message?.content).trim();
    if (!content) throw emptyResponse();
    return { content, usage: toUsage(json.usage?.prompt_tokens, json.usage?.completion_tokens, json.usage?.total_tokens), finishReason: choice.finish_reason ?? null };
  }
}
