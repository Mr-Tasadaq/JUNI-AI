import test from "node:test";
import assert from "node:assert/strict";
import { createMetricsCollector } from "../core/metrics.js";

test("metrics collector tracks request success, provider latency, tokens, cost and errors", () => {
  const metrics = createMetricsCollector({ maxSamples: 50 });

  metrics.consume({
    type: "request.started",
    requestId: "r1",
    provider: "openai",
    model: "gpt-test",
    data: {},
  });
  metrics.consume({
    type: "provider.started",
    requestId: "r1",
    provider: "openai",
    model: "gpt-test",
    data: { retry: 0 },
  });
  metrics.consume({
    type: "provider.completed",
    requestId: "r1",
    provider: "openai",
    model: "gpt-test",
    data: {
      latencyMs: 120,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cost: 0.002 },
    },
  });
  metrics.consume({
    type: "request.completed",
    requestId: "r1",
    provider: "openai",
    model: "gpt-test",
    data: { latencyMs: 125, usage: { totalTokens: 15, cost: 0.002 } },
  });

  metrics.consume({
    type: "request.started",
    requestId: "r2",
    provider: "openai",
    model: "gpt-test",
    data: {},
  });
  metrics.consume({
    type: "request.failed",
    requestId: "r2",
    provider: "openai",
    model: "gpt-test",
    data: { code: "PROVIDER_TIMEOUT" },
  });

  const snapshot = metrics.snapshot();
  assert.equal(snapshot.requests.total, 2);
  assert.equal(snapshot.requests.completed, 1);
  assert.equal(snapshot.requests.failed, 1);
  assert.equal(snapshot.requests.active, 0);
  assert.equal(snapshot.requests.successRate, 0.5);
  assert.equal(snapshot.tokens.total, 15);
  assert.equal(snapshot.cost, 0.002);
  assert.equal(snapshot.eventCounts["provider.completed"], 1);

  const provider = snapshot.providers.find((item) => item.provider === "openai");
  assert.ok(provider);
  assert.equal(provider.completed, 1);
  assert.equal(provider.failed, 0);
  assert.equal(provider.latencyMs.p50, 120);
  assert.equal(provider.latencyMs.p95, 120);
  assert.equal(provider.tokens.total, 15);
  assert.equal(provider.cost, 0.002);
});

test("metrics tolerate missing cost and usage data", () => {
  const metrics = createMetricsCollector();
  metrics.consume({
    type: "request.started",
    requestId: "r1",
    provider: "gemini",
    model: "test",
    data: {},
  });
  metrics.consume({
    type: "request.completed",
    requestId: "r1",
    provider: "gemini",
    model: "test",
    data: { usage: null },
  });

  const snapshot = metrics.snapshot();
  assert.equal(snapshot.cost, null);
  assert.equal(snapshot.providers[0].cost, null);
});
