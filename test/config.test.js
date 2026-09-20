import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig, configuredProviderNames } from "../core/config.js";

test("loads provider-neutral configuration without secrets", () => {
  const config = loadConfig({
    OPENAI_MODEL: "gpt-test",
    ANTHROPIC_MODEL: "claude-test",
    GEMINI_MODEL: "gemini-test",
    GEMINI_LIVE_MODEL: "gemini-live-test",
    JUNI_DEFAULT_PROVIDER: "gemini",
    JUNI_FALLBACK_PROVIDERS: "anthropic,openai",
    JUNI_STORAGE_BUDGET_BYTES: "10000000000",
  });

  assert.equal(config.app.defaultProvider, "gemini");
  assert.equal(config.providers.openai.defaultModel, "gpt-test");
  assert.equal(config.providers.anthropic.defaultModel, "claude-test");
  assert.equal(config.providers.gemini.defaultModel, "gemini-test");
  assert.equal(config.providers.gemini.liveModel, "gemini-live-test");
  assert.deepEqual(config.app.providerPriority, ["openai", "anthropic", "gemini"]);
  assert.deepEqual(config.app.fallbackProviders, ["anthropic", "openai"]);
  assert.equal(config.provenance.storageBudgetBytes, 10_000_000_000);
  assert.deepEqual(configuredProviderNames(config), []);
});

test("placeholder credentials are not interpreted as configured keys", () => {
  const config = loadConfig({
    OPENAI_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    GEMINI_API_KEY: "",
  });

  assert.deepEqual(configuredProviderNames(config), []);
});
