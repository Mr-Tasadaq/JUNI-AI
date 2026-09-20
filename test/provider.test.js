import test from "node:test";
import assert from "node:assert/strict";
import { assertProviderContract, capabilitySupports, normalizeRequest } from "../core/provider.js";

test("provider contract requires stable adapter methods", () => {
  const provider = {
    name: "openai",
    generate() {},
    stream() {},
    capabilities() { return ["text"]; },
    health() { return Promise.resolve({ available: true }); },
  };

  assert.equal(assertProviderContract(provider), provider);
  assert.equal(capabilitySupports(["text", "vision"], ["vision"]), true);
  assert.equal(capabilitySupports(["text"], ["vision"]), false);
});

test("request normalization preserves provider-neutral fields", () => {
  const request = normalizeRequest({
    messages: [{ role: "user", content: "hello" }],
    task: "research",
    modality: "vision",
    latency: "low",
    provider: "gemini",
    model: "gemini-test",
    stream: true,
    tools: [{ name: "web.search" }],
    metadata: { requestId: "req-1" },
  });

  assert.equal(request.provider, "gemini");
  assert.equal(request.model, "gemini-test");
  assert.equal(request.stream, true);
  assert.equal(request.modality, "vision");
  assert.equal(request.task, "research");
  assert.equal(request.tools.length, 1);
  assert.equal(request.metadata.requestId, "req-1");
});
