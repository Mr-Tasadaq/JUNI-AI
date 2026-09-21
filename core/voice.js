import { ProviderError } from "./errors.js";

export const VOICE_STATES = Object.freeze([
  "idle",
  "requesting_permission",
  "connecting",
  "listening",
  "speaking",
  "interrupted",
  "reconnecting",
  "error",
  "closing",
  "closed",
]);

export const VOICE_EVENTS = Object.freeze([
  "voice.token.requested",
  "voice.session.started",
  "voice.session.connected",
  "voice.listening.started",
  "voice.listening.stopped",
  "voice.speaking.started",
  "voice.speaking.stopped",
  "voice.interrupted",
  "voice.tool.started",
  "voice.tool.completed",
  "voice.tool.failed",
  "voice.reconnect.started",
  "voice.reconnect.completed",
  "voice.session.completed",
  "voice.session.failed",
  "voice.session.closed",
]);

const TRANSITIONS = Object.freeze({
  idle: new Set(["requesting_permission", "connecting", "closed"]),
  requesting_permission: new Set(["connecting", "error", "closing", "closed"]),
  connecting: new Set(["listening", "error", "closing", "reconnecting"]),
  listening: new Set(["speaking", "interrupted", "reconnecting", "closing", "error", "closed"]),
  speaking: new Set(["listening", "interrupted", "reconnecting", "closing", "error", "closed"]),
  interrupted: new Set(["listening", "speaking", "reconnecting", "closing", "error", "closed"]),
  reconnecting: new Set(["listening", "speaking", "interrupted", "error", "closing", "closed"]),
  error: new Set(["connecting", "reconnecting", "requesting_permission", "closing", "closed"]),
  closing: new Set(["closed", "error"]),
  closed: new Set(["requesting_permission", "connecting"]),
});

export function canTransition(from, to) {
  return Boolean(TRANSITIONS[from]?.has(to));
}

export function assertVoiceTransition(from, to) {
  if (!VOICE_STATES.includes(from) || !VOICE_STATES.includes(to)) {
    throw new TypeError("Unknown voice state.");
  }
  if (!canTransition(from, to)) {
    const error = new Error("Illegal voice state transition: " + from + " -> " + to);
    error.code = "VOICE_INVALID_STATE_TRANSITION";
    throw error;
  }
}

export class VoiceStateMachine {
  #state = "idle";
  #sessionId;
  #listeners = new Set();
  #counters = { reconnectCount: 0, interruptionCount: 0, toolCallCount: 0, inputBytes: 0, outputBytes: 0 };

  constructor({ sessionId = makeUuid() } = {}) {
    this.#sessionId = String(sessionId);
  }

  get state() { return this.#state; }
  get sessionId() { return this.#sessionId; }
  get counters() { return Object.freeze({ ...this.#counters }); }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  transition(next, metadata = {}) {
    assertVoiceTransition(this.#state, next);
    const previous = this.#state;
    this.#state = next;
    if (next === "reconnecting") this.#counters.reconnectCount += 1;
    if (next === "interrupted") this.#counters.interruptionCount += 1;
    const event = Object.freeze({
      type: "state.changed",
      sessionId: this.#sessionId,
      previous,
      state: next,
      metadata: sanitizeVoiceMetadata(metadata),
    });
    for (const listener of this.#listeners) {
      try { listener(event); } catch {}
    }
    return event;
  }

  addInputBytes(bytes) { this.#counters.inputBytes += Math.max(0, Number(bytes) || 0); }
  addOutputBytes(bytes) { this.#counters.outputBytes += Math.max(0, Number(bytes) || 0); }
  addToolCall() { this.#counters.toolCallCount += 1; }

  reset() {
    this.#state = "idle";
    this.#counters = { reconnectCount: 0, interruptionCount: 0, toolCallCount: 0, inputBytes: 0, outputBytes: 0 };
  }
}

export function assertVoiceSessionContract(session) {
  if (!session || typeof session !== "object") throw new TypeError("Voice session must be an object.");
  for (const method of ["sendText", "sendAudio", "sendVideo", "interrupt", "sendToolResponse", "reconnect", "close"]) {
    if (typeof session[method] !== "function") throw new TypeError("Voice session must implement " + method + "().");
  }
  return session;
}

export class VoiceSessionController {
  #session;
  #machine;
  #onEvent;

  constructor({ sessionFactory, onEvent = () => {}, sessionId } = {}) {
    this.sessionFactory = sessionFactory;
    this.#onEvent = onEvent;
    this.#machine = new VoiceStateMachine({ sessionId });
    this.#machine.subscribe((event) => this.#onEvent(event));
  }

  get state() { return this.#machine.state; }
  get sessionId() { return this.#machine.sessionId; }
  get counters() { return this.#machine.counters; }
  get session() { return this.#session; }

  async connect(options = {}) {
    if (["connecting", "listening", "speaking", "interrupted"].includes(this.#machine.state)) return this.#session;
    if (["closed", "error"].includes(this.#machine.state)) this.#machine.reset();
    this.#machine.transition("connecting", { provider: options.provider ?? "gemini", model: options.model ?? null });
    try {
      this.#session = assertVoiceSessionContract(await this.sessionFactory(options));
      this.#machine.transition("listening", { provider: this.#session.provider ?? "gemini", model: this.#session.model ?? options.model ?? null });
      this.#onEvent({ type: "voice.session.connected", sessionId: this.sessionId });
      return this.#session;
    } catch (error) {
      if (this.#machine.state !== "error") this.#machine.transition("error", { code: error?.code ?? "VOICE_CONNECTION_FAILED" });
      throw error instanceof ProviderError ? error : new ProviderError("Voice session could not be created.", {
        provider: options.provider ?? "gemini",
        code: error?.code ?? "VOICE_CONNECTION_FAILED",
        retryable: true,
        cause: error,
      });
    }
  }

  async reconnect(options = {}) {
    if (this.#machine.state === "closed") this.#machine.reset();
    this.#machine.transition("reconnecting", { provider: options.provider ?? "gemini" });
    this.#onEvent({ type: "voice.reconnect.started", sessionId: this.sessionId });
    try {
      await this.#session?.close?.();
      this.#session = assertVoiceSessionContract(await this.sessionFactory({ ...options, reconnect: true }));
      this.#machine.transition("listening", { provider: this.#session.provider ?? "gemini", model: this.#session.model ?? options.model ?? null });
      this.#onEvent({ type: "voice.reconnect.completed", sessionId: this.sessionId });
      return this.#session;
    } catch (error) {
      this.#machine.transition("error", { code: error?.code ?? "VOICE_RECONNECT_FAILED" });
      throw error;
    }
  }

  async close() {
    if (this.#machine.state === "closed") return;
    if (this.#machine.state !== "closing") this.#machine.transition("closing");
    try { await this.#session?.close?.(); }
    finally {
      this.#session = null;
      this.#machine.transition("closed");
      this.#onEvent({ type: "voice.session.completed", sessionId: this.sessionId });
    }
  }
}

function sanitizeVoiceMetadata(value) {
  if (!value || typeof value !== "object") return {};
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|key|secret|password|credential|audio|pcm|prompt/i.test(key)) continue;
    if (item === null || ["string", "number", "boolean"].includes(typeof item)) result[key] = item;
  }
  return result;
}

function makeUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "voice-" + Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
}
