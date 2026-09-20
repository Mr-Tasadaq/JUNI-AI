import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../core/config.js";
import { createJuni } from "../core/juni.js";
import { createRouter } from "../core/router.js";
import { EventBus } from "../core/events.js";
import { ToolRegistry } from "../core/tools.js";

test("existing chat-shaped message requests still produce a normalized response", async () => {
  const config = loadConfig({
    JUNI_DEFAULT_PROVIDER: "openai",
    JUNI_FALLBACK_PROVIDERS: "anthropic,gemini",
  });

  const provider = {
    name: "openai",
    defaultModel: "compat-model",
    latencyClass: "balanced",
    capabilities: () => ["text"],
    health: async () => ({ available: true, configured: true, timeoutMs: 1000 }),
    generate: async (request) => ({
      provider: "openai",
      model: request.model,
      text: "compat ok",
      toolCalls: [],
    }),
    stream: async function* () {
      yield { type: "text_delta", provider: "openai", text: "compat ok" };
      yield { type: "completed", provider: "openai" };
    },
  };

  const router = createRouter({
    config,
    events: new EventBus(),
    providers: { openai: provider, anthropic: provider, gemini: provider },
  });

  const juni = createJuni({
    config,
    router,
    tools: new ToolRegistry(),
    events: new EventBus(),
  });

  const response = await juni.generate({
    message: "Hello",
    messages: [{ role: "user", content: "Hello" }],
  });

  assert.equal(response.text, "compat ok");
  assert.equal(response.provider, "openai");
  assert.equal(response.model, "compat-model");
});
