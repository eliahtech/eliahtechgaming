// Google Gemini (generateContent). The API key travels in the x-goog-api-key header, never in the URL, so it cannot end up in logs.
import { AIProvider, postJson, toUsage, assertSafeBaseUrl, classifyHttpStatus, providerErrors, contentRejected, emptyResponse, misconfigured } from './base.js';

const BLOCK_REASONS = new Set(['SAFETY', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY', 'RECITATION']);

export class GeminiProvider extends AIProvider {
  static adapter = 'gemini';
  static defaultBaseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  static allowedHosts = ['generativelanguage.googleapis.com']; // the key is only ever sent to Google

  async complete({ apiKey, baseUrl, model, messages, maxTokens, temperature, timeoutMs }) {
    if (!apiKey || !baseUrl || !model) throw misconfigured();
    const root = assertSafeBaseUrl(baseUrl, { allowedHosts: GeminiProvider.allowedHosts });
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const contents = [];
    for (const m of messages.filter((x) => x.role !== 'system')) {
      const role = m.role === 'assistant' ? 'model' : 'user';
      const parts = Array.isArray(m.content) ? m.content.map(p=>p.type==='text'?{text:p.text}:p.type==='image_url'?{inlineData:{mimeType:p.image_url.url.slice(5,p.image_url.url.indexOf(';')),data:p.image_url.url.split(',')[1]}}:null).filter(Boolean) : [{text:m.content}];
      if (contents.at(-1)?.role === role) contents.at(-1).parts.push(...parts); // Gemini wants alternating turns
      else contents.push({ role, parts });
    }
    const json = await postJson({
      fetchImpl: this.fetchImpl,
      url: `${root}/models/${encodeURIComponent(String(model).replace(/^models\//, ''))}:generateContent`,
      headers: { 'x-goog-api-key': apiKey },
      body: { ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), contents, generationConfig: { maxOutputTokens: maxTokens, ...(temperature != null ? { temperature } : {}) } },
      timeoutMs,
      // Gemini reports an invalid key as 400 INVALID_ARGUMENT, which would otherwise look like a bad user request.
      parseError: (status, body) => (status === 400 && /api key/i.test(String(body?.error?.message ?? '')) ? providerErrors.make(providerErrors.E.AUTH, status) : classifyHttpStatus(status)),
    });
    if (json?.promptFeedback?.blockReason) throw contentRejected();
    const candidate = json?.candidates?.[0];
    if (BLOCK_REASONS.has(candidate?.finishReason)) throw contentRejected();
    const content = (candidate?.content?.parts ?? []).filter((p) => !p?.thought && typeof p?.text === 'string').map((p) => p.text).join('').trim();
    if (!content) throw emptyResponse();
    const u = json.usageMetadata ?? {};
    const total = u.totalTokenCount;
    const input = u.promptTokenCount;
    // Output = everything after the prompt (includes any "thinking" tokens the provider bills for).
    const output = Number.isFinite(total) && Number.isFinite(input) ? total - input : u.candidatesTokenCount;
    return { content, usage: toUsage(input, output, total), finishReason: candidate?.finishReason ?? null };
  }
}
