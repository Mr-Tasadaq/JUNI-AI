import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../core/config.js";
import { createAnthropicProvider } from "../providers/anthropic.js";
import { createOpenAIProvider } from "../providers/openai.js";
import { createGeminiProvider } from "../providers/gemini.js";
import { createGeminiLiveProvider } from "../providers/gemini-live.js";

const config = loadConfig({
  ANTHROPIC_API_KEY: "",
  OPENAI_API_KEY: "",
  GEMINI_API_KEY: "",
});

test("all primary adapters expose the same provider contract", () => {
  const providers = [
    createAnthropicProvider(config),
    createOpenAIProvider(config),
    createGeminiProvider(config),
  ];

  for (const provider of providers) {
    assert.equal(typeof provider.generate, "function");
    assert.equal(typeof provider.stream, "function");
    assert.equal(typeof provider.capabilities, "function");
    assert.equal(typeof provider.health, "function");
    assert.equal((provider.health ? true : false), true);
  }
});

test("missing provider keys fail before SDK loading", async () => {
  const providers = [
    createAnthropicProvider(config),
    createOpenAIProvider(config),
    createGeminiProvider(config),
    createGeminiLiveProvider(config),
  ];

  for (const provider of providers) {
    await assert.rejects(
      () => provider.generate?.({ messages: [] }) ?? provider.connect({}),
      /not configured/i
    );
  }
});

test("Gemini Live keeps the model configurable", () => {
  const live = createGeminiLiveProvider(config);
  assert.equal(live.defaultModel, "gemini-3.8-live");
  assert.equal(live.capabilities().includes("liveVoice"), true);
});

test("Gemini 3.8 Flash does not advertise unsupported Live output capabilities", () => {
  const provider = createGeminiProvider(config);
  const capabilities = provider.capabilities("gemini-3.8-flash");
  assert.equal(capabilities.includes("audioInput"), true);
  assert.equal(capabilities.includes("audioOutput"), false);
  assert.equal(capabilities.includes("liveVoice"), false);
});
