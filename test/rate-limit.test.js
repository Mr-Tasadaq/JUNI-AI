import test from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit, clearRateLimitStore, createRateLimiter } from "../lib/rate-limit.js";

test("rate limit blocks after limit and recovers after window", () => {
  clearRateLimitStore();
  assert.equal(checkRateLimit("client", 2, 60, 1_000).allowed, true);
  assert.equal(checkRateLimit("client", 2, 60, 1_001).allowed, true);
  const blocked = checkRateLimit("client", 2, 60, 1_002);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.equal(checkRateLimit("client", 2, 60, 61_000).allowed, true);
});

test("shared rate limiter is enabled only for remote database URLs", () => {
  assert.equal(createRateLimiter().shared, false);
  assert.equal(createRateLimiter({ client: {}, ready: async () => {}, databaseUrl: "file:/tmp/juni.db" }).shared, false);
  assert.equal(createRateLimiter({ client: {}, ready: async () => {}, databaseUrl: "libsql://example.turso.io" }).shared, true);
  assert.equal(createRateLimiter({ client: {}, ready: async () => {}, databaseUrl: "https://example.turso.io" }).shared, true);
});
