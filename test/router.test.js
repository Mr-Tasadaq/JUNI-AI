import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../core/config.js";
import { EventBus } from "../core/events.js";
import { ProviderError } from "../core/errors.js";
import { createRouter } from "../core/router.js";

function fakeProvider(name, capabilities, behavior = {}) {
  return {
    name,
    defaultModel: name + "-default",
    latencyClass: behavior.latencyClass ?? "balanced",
    capabilities: () => capabilities,
    health: async () => ({ available: behavior.available ?? true, configured: true, timeoutMs: 1000 }),
    generate: behavior.generate ?? (async (request) => ({
      provider: name,
      model: request.model || name + "-default",
      text: name + " response",
      toolCalls: [],
    })),
    stream: behavior.stream ?? (async function* () {
      yield { type: "text_delta", provider: name, text: name + " response" };
      yield { type: "completed", provider: name };
    }),
  };
}

test("routes to a provider matching modality and task requirements", async () => {
  const env = {
    JUNI_DEFAULT_PROVIDER: "openai",
    JUNI_FALLBACK_PROVIDERS: "anthropic,gemini",
  };
  const config = loadConfig(env);
  const events = new EventBus();

  const router = createRouter({
    config,
    events,
    providers: {
      openai: fakeProvider("openai", ["text", "vision", "streaming", "toolCalling"]),
      anthropic: fakeProvider("anthropic", ["text", "vision", "streaming", "toolCalling"]),
      gemini: fakeProvider("gemini", ["text", "vision", "audioInput", "streaming", "toolCalling", "liveVoice"]),
    },
  });

  const result = await router.select({ task: "voice", modality: "audio", stream: true });
  assert.equal(result.provider.name, "gemini");
});

test("uses configured provider priority when multiple providers are available", async () => {
  const config = loadConfig({
    JUNI_DEFAULT_PROVIDER: "openai",
    JUNI_PROVIDER_PRIORITY: "anthropic,openai",
    JUNI_FALLBACK_PROVIDERS: "",
  });
  const router = createRouter({
    config,
    events: new EventBus(),
    providers: {
      openai: fakeProvider("openai", ["text"]),
      anthropic: fakeProvider("anthropic", ["text"]),
      gemini: fakeProvider("gemini", ["text"], { available: false }),
    },
  });

  const selected = await router.select({ messages: [{ role: "user", content: "hello" }] });
  assert.equal(selected.provider.name, "anthropic");
});

test("falls back after a retryable provider failure", async () => {
  const config = loadConfig({
    JUNI_DEFAULT_PROVIDER: "openai",
    JUNI_FALLBACK_PROVIDERS: "anthropic",
    JUNI_MAX_PROVIDER_RETRIES: "1",
  });
  const events = new EventBus();
  const router = createRouter({
    config,
    events,
    providers: {
      openai: fakeProvider("openai", ["text"], {
        generate: async () => {
          throw new ProviderError("busy", { provider: "openai", code: "RATE_LIMITED", retryable: true });
        },
      }),
      anthropic: fakeProvider("anthropic", ["text"]),
      gemini: fakeProvider("gemini", ["text"], { available: false }),
    },
  });

  const result = await router.generate({ messages: [{ role: "user", content: "hello" }] });
  assert.equal(result.provider, "anthropic");
});

test("throws on an explicitly unknown provider", async () => {
  const config = loadConfig({ JUNI_DEFAULT_PROVIDER: "openai" });
  const router = createRouter({
    config,
    events: new EventBus(),
    providers: { openai: fakeProvider("openai", ["text"]) },
  });

  await assert.rejects(
    () => router.generate({
      provider: "does-not-exist",
      messages: [{ role: "user", content: "hello" }],
    }),
    /Unknown provider requested/
  );
});
