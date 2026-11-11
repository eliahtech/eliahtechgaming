// Groq's OpenAI-compatible API. The host is pinned so a GROQ_API_KEY can never be sent to another endpoint.
import { OpenAICompatibleProvider } from './openai-compatible.js';

export class GroqProvider extends OpenAICompatibleProvider {
  static adapter = 'groq';
  static defaultBaseUrl = 'https://api.groq.com/openai/v1';
  static allowedHosts = ['api.groq.com'];
}
