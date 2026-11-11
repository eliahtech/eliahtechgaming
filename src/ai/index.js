// Builds the AI platform once per process/instance. Everything is created lazily from request-scoped data (Postgres is the
// source of truth), so it behaves identically on a long-running server and on a cold-started Vercel function.
import { createRegistry } from './registry.js';
import { createHealthTracker } from './health.js';
import { createSettingsStore } from './settings.js';
import { createConversations } from './conversations.js';
import { createProviderFactory } from './providers/index.js';
import { createAiService } from './service.js';
import { createAiController } from './controller.js';

export function createAiPlatform({ db, env = process.env, fetchImpl } = {}) {
  const factory = createProviderFactory({ env, fetchImpl });
  const registry = createRegistry({ db, factory });
  const health = createHealthTracker({ db });
  const settingsStore = createSettingsStore({ db, env });
  const conversations = createConversations({ db });
  const service = createAiService({ db, registry, factory, health, settingsStore, conversations });
  const controller = createAiController({ service });
  return { factory, registry, health, settingsStore, conversations, service, controller };
}
