import test from "node:test";
import assert from "node:assert/strict";
import { authorizeRequest, checkOrigin, redactSecrets, sanitizeEventData, safeTokenEquals } from "../core/security.js";

test("token comparison and authorization are safe", () => {
  assert.equal(safeTokenEquals("abc", "abc"), true);
  assert.equal(safeTokenEquals("abc", "abd"), false);
  assert.equal(authorizeRequest({ headers: { authorization: "Bearer secret" } }, "secret").allowed, true);
  assert.equal(authorizeRequest({ headers: { authorization: "Bearer bad" } }, "secret").allowed, false);
  assert.equal(authorizeRequest({ headers: {} }, "secret").reason, "missing_bearer");
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
