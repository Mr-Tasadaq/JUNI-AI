import test from "node:test";
import assert from "node:assert/strict";
import {
  authorizeRequest,
  checkOrigin,
  redactSecrets,
  sanitizeEventData,
  safeTokenEquals,
  validateProviderModelSelection,
  clearAuthCookie,
  serializeAuthCookie,
  requestClientKey,
} from "../core/security.js";
import { resolveRequestIdentity } from "../core/identity.js";

const policy = {
  providers: ["openai", "anthropic"],
  modelsByProvider: {
    openai: ["gpt-5.5"],
    anthropic: ["claude-opus-5"],
  },
};

test("client address resolution prefers the trusted request IP", () => {
  assert.equal(
    requestClientKey({ ip: "203.0.113.10", headers: { "x-real-ip": "198.51.100.20" } }),
    "203.0.113.10"
  );
  assert.equal(
    requestClientKey({ headers: { "x-real-ip": "198.51.100.20", "x-forwarded-for": "192.0.2.10" } }),
    "198.51.100.20"
  );
  assert.equal(
    requestClientKey({ headers: { "x-forwarded-for": "192.0.2.10, 198.51.100.20" } }),
    "192.0.2.10"
  );
});

test("token comparison and authorization are safe", () => {
  assert.equal(safeTokenEquals("abc", "abc"), true);
  assert.equal(safeTokenEquals("abc", "abd"), false);
  assert.equal(authorizeRequest({ headers: { authorization: "Bearer secret" } }, "secret").allowed, true);
  assert.equal(authorizeRequest({ headers: { authorization: "Bearer bad" } }, "secret").allowed, false);
  assert.equal(authorizeRequest({ headers: {} }, "secret").reason, "missing_bearer");
});

test("HttpOnly auth cookies can authorize requests without browser localStorage", () => {
  const cookie = serializeAuthCookie("secret", { name: "juni_auth", maxAgeSeconds: 3600, secure: true });
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
  assert.equal(
    authorizeRequest({ headers: { cookie: "juni_auth=secret" } }, "secret", { cookieName: "juni_auth" }).allowed,
    true
  );
  assert.match(clearAuthCookie({ name: "juni_auth", secure: true }), /Max-Age=0/);
});

test("provider and model request selections are allowlisted", () => {
  assert.deepEqual(
    validateProviderModelSelection({ provider: "openai", model: "gpt-5.5" }, policy),
    { allowed: true, provider: "openai", model: "gpt-5.5" }
  );
  assert.equal(validateProviderModelSelection({ provider: "gemini" }, policy).code, "PROVIDER_NOT_ALLOWED");
  assert.equal(validateProviderModelSelection({ model: "gpt-5.5" }, policy).code, "MODEL_REQUIRES_PROVIDER");
  assert.equal(validateProviderModelSelection({ provider: "openai", model: "gpt-5.4" }, policy).code, "MODEL_NOT_ALLOWED");
  assert.equal(validateProviderModelSelection({ provider: "openai", model: "x".repeat(129) }, policy).code, "INVALID_MODEL");
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

test("production authentication uses a bounded dedicated rate-limit configuration", async () => {
  const { loadConfig } = await import("../core/config.js");
  const config = loadConfig({ JUNI_AUTH_RATE_LIMIT: "5", JUNI_AUTH_RATE_WINDOW_SECONDS: "300" });
  assert.equal(config.security.authRateLimit, 5);
  assert.equal(config.security.authRateWindowSeconds, 300);
});

test("canonical request identity prefers authenticated identity over headers", () => {
  const identity = resolveRequestIdentity(
    {
      user: { tenantId: "tenant-auth", userId: "user-auth", sessionId: "session-1", actorId: "actor-1", authMethod: "jwt" },
      headers: { "x-tenant-id": "tenant-attacker", "x-user-id": "user-attacker" },
    },
    { fixedTenantId: "tenant-fixed", fixedUserId: "user-fixed", allowIdentityHeaders: true }
  );
  assert.deepEqual(identity, {
    tenantId: "tenant-auth", userId: "user-auth", sessionId: "session-1", actorId: "actor-1", authMethod: "jwt",
  });
});

test("canonical request identity uses explicit server-fixed scope when needed", () => {
  assert.deepEqual(
    resolveRequestIdentity({ headers: {} }, { fixedTenantId: "tenant-fixed", fixedUserId: "user-fixed" }),
    { tenantId: "tenant-fixed", userId: "user-fixed", actorId: "user-fixed", authMethod: "server-fixed" }
  );
});

test("canonical request identity fails closed without a trusted identity source", () => {
  assert.throws(() => resolveRequestIdentity({ headers: {} }, {}), (error) => error.code === "REQUEST_IDENTITY_NOT_CONFIGURED");
});

test("identity headers require explicit opt-in", () => {
  assert.throws(
    () => resolveRequestIdentity({ headers: { "x-tenant-id": "tenant-header", "x-user-id": "user-header" } }, {}),
    (error) => error.code === "REQUEST_IDENTITY_NOT_CONFIGURED"
  );
  assert.deepEqual(
    resolveRequestIdentity(
      { headers: { "x-tenant-id": "tenant-header", "x-user-id": "user-header" } },
      { allowIdentityHeaders: true }
    ),
    { tenantId: "tenant-header", userId: "user-header", actorId: "user-header", authMethod: "identity-header" }
  );
});
