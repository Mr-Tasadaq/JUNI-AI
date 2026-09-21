import { createAnthropicProvider } from "./anthropic.js";
import { createOpenAIProvider } from "./openai.js";
import { createGeminiProvider } from "./gemini.js";
import { createGeminiLiveProvider } from "./gemini-live.js";
import { buildSystemIdentity } from "../core/identity.js";

export function createProviderRegistry(config) {
  const identity = buildSystemIdentity();
  return {
    anthropic: createAnthropicProvider(config, { identity }),
    openai: createOpenAIProvider(config, { identity }),
    gemini: createGeminiProvider(config, { identity }),
    geminiLive: createGeminiLiveProvider(config, { identity }),
  };
}
