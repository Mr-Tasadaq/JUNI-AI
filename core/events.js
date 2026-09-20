import { randomUUID } from "node:crypto";
import { sanitizeEventData } from "./security.js";

export const EVENT_TYPES = Object.freeze([
  "request.started",
  "request.completed",
  "request.failed",
  "router.selected",
  "provider.started",
  "provider.completed",
  "provider.failed",
  "provider.retry",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "memory.created",
  "memory.updated",
  "memory.deleted",
  "learning.recorded",
  "research.started",
  "research.completed",
  "research.failed",
]);

export class EventBus {
  #listeners = new Set();
  #maxPayloadBytes;

  constructor({ maxPayloadBytes = 8_192 } = {}) {
    this.#maxPayloadBytes = maxPayloadBytes;
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  emit(type, data = {}, context = {}) {
    const event = Object.freeze({
      id: randomUUID(),
      type,
      occurredAt: new Date().toISOString(),
      requestId: context.requestId ?? null,
      provider: context.provider ?? null,
      model: context.model ?? null,
      data: sanitizeEventData(data, this.#maxPayloadBytes),
    });

    for (const listener of this.#listeners) {
      try { listener(event); } catch { /* telemetry must not break requests */ }
    }
    return event;
  }
}

export function createMemoryEventSink(limit = 1_000) {
  const events = [];
  return {
    push(event) {
      events.push(event);
      if (events.length > limit) events.splice(0, events.length - limit);
    },
    all() { return [...events]; },
    clear() { events.length = 0; },
  };
}
