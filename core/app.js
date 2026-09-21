import { loadConfig } from "./config.js";
import { EventBus, createMemoryEventSink } from "./events.js";
import { buildSystemIdentity } from "./identity.js";
import { createJuni } from "./juni.js";
import { createRouter } from "./router.js";
import { createToolRegistry } from "./tools.js";
import { createProviderRegistry } from "../providers/index.js";
import { VoiceSessionController } from "./voice.js";
import { createJuniMemoryApplication } from "../memory/app.js";
import { createJuniResearchApplication } from "../research/app.js";
import { createRateLimiter } from "../lib/rate-limit.js";
import { createOpenAIAnswerEmbedder } from "../memory/answer-embedder.js";
import { createVoiceMemoryHooks } from "../voice/memory-hooks.js";

export function createJuniApplication({ env = process.env, tools = createToolRegistry(), eventSink, answerEmbedder = null } = {}) {
  const config = loadConfig(env);
  const events = new EventBus({ maxPayloadBytes: config.observability.maxEventPayloadBytes });
  const sink = eventSink ?? createMemoryEventSink();

  events.subscribe((event) => sink.push(event));

  const providers = createProviderRegistry(config);
  const router = createRouter({ providers, config, events });
  const resolvedAnswerEmbedder = answerEmbedder ?? createOpenAIAnswerEmbedder(config);
  const memory = createJuniMemoryApplication({ config, events, answerEmbedder: resolvedAnswerEmbedder });
  const research = createJuniResearchApplication({ config, events, router, memory });
  const juni = createJuni({ config, router, tools, events });
  const voiceMemory = createVoiceMemoryHooks({ retrieval: memory.retrieval });
  const voiceSessions = memory.voiceSessions;
  const voice = new VoiceSessionController({
    sessionFactory: (options) => providers.geminiLive.connect(options),
    onEvent: (event) => events.emit(event.type, event),
  });
  const rateLimiter = createRateLimiter({
    client: config.storage.enabled ? memory.db.client : null,
    ready: config.storage.enabled ? memory.ready : null,
    databaseUrl: config.storage.databaseUrl,
  });

  return Object.freeze({
    config,
    events,
    sink,
    providers,
    router,
    tools,
    juni,
    voice,
    voiceMemory,
    voiceSessions,
    rateLimiter,
    memory,
    research,
  });
}
