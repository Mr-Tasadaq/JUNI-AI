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
    JUNI_STORAGE_BUDGET_BYTES: "10737418240",
  });

  assert.equal(config.app.defaultProvider, "gemini");
  assert.equal(config.providers.openai.defaultModel, "gpt-test");
  assert.equal(config.providers.anthropic.defaultModel, "claude-test");
  assert.equal(config.providers.gemini.defaultModel, "gemini-test");
  assert.equal(config.providers.gemini.liveModel, "gemini-live-test");
  assert.deepEqual(config.app.providerPriority, ["openai", "anthropic", "gemini"]);
  assert.deepEqual(config.app.fallbackProviders, ["anthropic", "openai"]);
  assert.equal(config.storage.quotaBytes, 10_737_418_240);
  assert.equal(config.provenance.storageBudgetBytes, 10_737_418_240);
  assert.deepEqual(configuredProviderNames(config), []);
  assert.deepEqual(config.security.requestAllowlist.providers, ["anthropic", "openai", "gemini"]);
  assert.deepEqual(config.security.requestAllowlist.modelsByProvider.openai, ["gpt-test"]);
  assert.deepEqual(config.security.requestAllowlist.modelsByProvider.anthropic, ["claude-test"]);
  assert.deepEqual(config.security.requestAllowlist.modelsByProvider.gemini, ["gemini-test"]);
});

test("supports explicit client provider/model allowlist extensions", () => {
  const config = loadConfig({
    OPENAI_MODEL: "gpt-5.5",
    ANTHROPIC_MODEL: "claude-opus-5",
    GEMINI_MODEL: "gemini-3.8-flash",
    JUNI_REQUEST_ALLOWED_PROVIDERS: "openai,gemini",
    JUNI_REQUEST_ALLOWED_MODELS_JSON: JSON.stringify({
      openai: ["gpt-5.5", "gpt-5.4"],
      gemini: ["gemini-3.8-flash"],
    }),
  });

  assert.deepEqual(config.security.requestAllowlist.providers, ["openai", "gemini"]);
  assert.deepEqual(config.security.requestAllowlist.modelsByProvider.openai, ["gpt-5.5", "gpt-5.4"]);
  assert.deepEqual(config.security.requestAllowlist.modelsByProvider.gemini, ["gemini-3.8-flash"]);
});

test("placeholder credentials are not interpreted as configured keys", () => {
  const config = loadConfig({
    OPENAI_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    GEMINI_API_KEY: "",
  });

  assert.deepEqual(configuredProviderNames(config), []);
});
