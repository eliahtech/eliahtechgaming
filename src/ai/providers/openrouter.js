import { OpenAICompatibleProvider } from './openai-compatible.js';
import { misconfigured } from './base.js';
export class OpenRouterProvider extends OpenAICompatibleProvider {
  static adapter='openrouter';
  static defaultBaseUrl='https://openrouter.ai/api/v1';
  static allowedHosts=['openrouter.ai'];
  async complete(request){
    if(!String(request.model).endsWith(':free'))throw misconfigured();
    return super.complete(request);
  }
}
