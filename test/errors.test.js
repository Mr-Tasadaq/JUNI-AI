import test from "node:test";
import assert from "node:assert/strict";
import { ProviderError, normalizeProviderError } from "../core/errors.js";

test("timeout and abort errors are retryable", () => {
  assert.equal(normalizeProviderError("openai", {
    code: "PROVIDER_TIMEOUT",
    message: "timed out",
  }).retryable, true);

  assert.equal(normalizeProviderError("openai", {
    name: "AbortError",
    message: "aborted",
  }).retryable, true);

  assert.equal(new ProviderError("busy", {
    provider: "openai",
    retryable: true,
  }).retryable, true);
});
