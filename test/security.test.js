import test from "node:test";
import assert from "node:assert/strict";
import {
  authorizeRequest,
  checkOrigin,
  redactSecrets,
  sanitizeEventData,
  safeTokenEquals,
  validateProviderModelSelection,
} from "../core/security.js";

const policy = {
  providers: ["openai", "anthropic"],
  modelsByProvider: {
    openai: ["gpt-5.5"],
    anthropic: ["claude-opus-5"],
  },
};

test("token comparison and authorization are safe", () => {
  assert.equal(safeTokenEquals("abc", "abc"), true);
  assert.equal(safeTokenEquals("abc", "abd"), false);
  assert.equal(authorizeRequest({ headers: { authorization: "Bearer secret" } }, "secret").allowed, true);
  assert.equal(authorizeRequest({ headers: { authorization: "Bearer bad" } }, "secret").allowed, false);
  assert.equal(authorizeRequest({ headers: {} }, "secret").reason, "missing_bearer");
});

test("provider and model request selections are allowlisted", () => {
  assert.deepEqual(
    validateProviderModelSelection({ provider: "openai", model: "gpt-5.5" }, policy),
    { allowed: true, provider: "openai", model: "gpt-5.5" }
  );

  assert.equal(
    validateProviderModelSelection({ provider: "gemini" }, policy).code,
    "PROVIDER_NOT_ALLOWED"
  );

  assert.equal(
    validateProviderModelSelection({ model: "gpt-5.5" }, policy).code,
    "MODEL_REQUIRES_PROVIDER"
  );

  assert.equal(
    validateProviderModelSelection({ provider: "openai", model: "gpt-5.4" }, policy).code,
    "MODEL_NOT_ALLOWED"
  );

  assert.equal(
    validateProviderModelSelection({ provider: "openai", model: "x".repeat(129) }, policy).code,
    "INVALID_MODEL"
  );
});

test("origin checks reject a mismatched origin", () => {
  assert.equal(checkOrigin("https://juni.example", "https://juni.example"), true);
  assert.equal(checkOrigin("https://evil.example", "https://juni.example"), false);
  assert.equal(checkOrigin(undefined, "https://juni.example"), true);
});

test("event data redacts credentials", () => {
  const sanitized = sanitizeEventData({
    apiKey: "sk-super-secret",
    authorization: "Bearer very-secret",
    nested: { token: "abc", note: "safe" },
  });

  assert.equal(sanitized.apiKey, "[REDACTED]");
  assert.equal(sanitized.authorization, "[REDACTED]");
  assert.equal(sanitized.nested.token, "[REDACTED]");
  assert.equal(sanitized.nested.note, "safe");
  assert.equal(redactSecrets("api key sk-abcdefghijklmnop").includes("[REDACTED]"), true);
});
