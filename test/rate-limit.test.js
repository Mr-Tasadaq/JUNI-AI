import test from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit, clearRateLimitStore } from "../lib/rate-limit.js";

test("allows requests until the configured limit", () => {
  clearRateLimitStore();
  const now = 1_000_000;

  assert.equal(checkRateLimit("client", 2, 60, now).allowed, true);
  const second = checkRateLimit("client", 2, 60, now + 100);
  assert.equal(second.allowed, true);
  assert.equal(second.remaining, 0);

  const blocked = checkRateLimit("client", 2, 60, now + 200);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfter, 60);
});

test("resets after the window", () => {
  clearRateLimitStore();
  const now = 2_000_000;

  checkRateLimit("client", 1, 10, now);
  assert.equal(checkRateLimit("client", 1, 10, now + 9999).allowed, false);

  const fresh = checkRateLimit("client", 1, 10, now + 10_000);
  assert.equal(fresh.allowed, true);
  assert.equal(fresh.remaining, 0);
});
