import test from "node:test";
import assert from "node:assert/strict";
import { EventBus, createMemoryEventSink } from "../core/events.js";

test("structured events capture request context without throwing on listener failures", () => {
  const sink = createMemoryEventSink();
  const bus = new EventBus({ maxPayloadBytes: 1000 });
  bus.subscribe((event) => sink.push(event));
  bus.subscribe(() => { throw new Error("listener failure"); });

  const event = bus.emit("model.call", {
    provider: "openai",
    requestId: "req-test",
    usage: { inputTokens: 10 },
  }, {
    requestId: "req-123",
    provider: "openai",
    model: "gpt-test",
  });

  assert.equal(event.type, "model.call");
  assert.equal(event.requestId, "req-123");
  assert.equal(event.provider, "openai");
  assert.equal(event.model, "gpt-test");
  assert.equal(sink.all().length, 1);
});
