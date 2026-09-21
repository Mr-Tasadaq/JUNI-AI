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
  "session.open",
  "session.message",
  "audio.input",
  "audio.output",
  "tool.call",
  "tool.response",
  "interruption",
  "reconnect.start",
  "reconnect.success",
  "session.error",
  "session.close",
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
]);

const TRANSITIONS = Object.freeze({
  idle: ["requesting_permission", "connecting", "closing"],
  requesting_permission: ["connecting", "idle", "error", "closing"],
  connecting: ["listening", "error", "reconnecting", "closing"],
  listening: ["speaking", "interrupted", "reconnecting", "error", "closing"],
  speaking: ["listening", "interrupted", "reconnecting", "error", "closing"],
  interrupted: ["listening", "connecting", "error", "closing"],
  reconnecting: ["listening", "error", "closing"],
  error: ["idle", "connecting", "closing"],
  closing: ["closed"],
  closed: ["idle", "connecting"],
});

export function assertVoiceState(state) {
  if (!VOICE_STATES.includes(state)) throw new TypeError("Invalid voice state.");
  return state;
}

export function canTransitionVoiceState(from, to) {
  assertVoiceState(from);
  assertVoiceState(to);
  return TRANSITIONS[from].includes(to);
}

export function assertVoiceTransition(from, to) {
  if (!canTransitionVoiceState(from, to)) {
    const error = new Error("Illegal voice state transition: " + from + " -> " + to);
    error.code = "VOICE_ILLEGAL_STATE_TRANSITION";
    throw error;
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
  #session = null;
  #state = "idle";
  #sessionId = null;
  #onEvent;

  constructor({ sessionFactory, onEvent = () => {} }) {
    if (typeof sessionFactory !== "function") throw new TypeError("sessionFactory is required.");
    this.sessionFactory = sessionFactory;
    this.#onEvent = onEvent;
  }

  get state() { return this.#state; }
  get sessionId() { return this.#sessionId; }
  get session() { return this.#session; }

  transition(nextState, metadata = {}) {
    assertVoiceTransition(this.#state, nextState);
    const previousState = this.#state;
    this.#state = nextState;
    this.#emit("voice.state.changed", { previousState, state: nextState, sessionId: this.#sessionId, ...metadata });
    return nextState;
  }

  startPermission() {
    if (this.#state === "idle" || this.#state === "error") this.transition("requesting_permission");
    return this.#state;
  }

  async connect(options = {}) {
    if (["listening", "speaking", "reconnecting"].includes(this.#state) && this.#session) return this.#session;
    if (["idle", "error", "requesting_permission"].includes(this.#state)) this.transition("connecting");
    const sessionId = options.sessionId ?? cryptoRandomId();
    this.#sessionId = sessionId;
    try {
      this.#session = assertVoiceSessionContract(await this.sessionFactory({ ...options, sessionId }));
      this.transition("listening", { sessionId });
      this.#emit("voice.session.connected", { sessionId });
      this.#emit("session.open", { sessionId });
      return this.#session;
    } catch (error) {
      this.#session = null;
      try { this.transition("error", { code: error?.code ?? "VOICE_CONNECTION_FAILED" }); } catch { this.#state = "error"; }
      throw error instanceof ProviderError ? error : new ProviderError("Voice session could not be created.", {
        provider: options.provider ?? "gemini",
        code: error?.code ?? "VOICE_CONNECTION_FAILED",
        retryable: true,
        cause: error,
      });
    }
  }

  markSpeaking(metadata = {}) {
    if (this.#state === "listening" || this.#state === "interrupted") this.transition("speaking", metadata);
    this.#emit("voice.speaking.started", { sessionId: this.#sessionId, ...metadata });
  }

  markListening(metadata = {}) {
    if (["speaking", "interrupted", "reconnecting"].includes(this.#state)) this.transition("listening", metadata);
    this.#emit("voice.listening.started", { sessionId: this.#sessionId, ...metadata });
  }

  markInterrupted(metadata = {}) {
    if (["speaking", "listening"].includes(this.#state)) this.transition("interrupted", metadata);
    try { this.#session?.interrupt?.(); } catch {}
    this.#emit("voice.interrupted", { sessionId: this.#sessionId, ...metadata });
  }

  async reconnect(options = {}) {
    this.#emit("voice.reconnect.started", { sessionId: this.#sessionId });
    if (this.#state !== "reconnecting") {
      if (["listening", "speaking", "interrupted", "connecting"].includes(this.#state)) this.transition("reconnecting");
      else if (this.#state === "error") this.transition("connecting");
    }
    try {
      this.#session = assertVoiceSessionContract(await this.sessionFactory({ ...options, sessionId: this.#sessionId, reconnect: true }));
      this.transition("listening", { sessionId: this.#sessionId });
      this.#emit("voice.reconnect.completed", { sessionId: this.#sessionId });
      this.#emit("reconnect.success", { sessionId: this.#sessionId });
      return this.#session;
    } catch (error) {
      try { this.transition("error", { code: error?.code ?? "VOICE_RECONNECT_FAILED" }); } catch { this.#state = "error"; }
      throw error instanceof ProviderError ? error : new ProviderError("Voice session reconnect failed.", {
        provider: options.provider ?? "gemini",
        code: error?.code ?? "VOICE_RECONNECT_FAILED",
        retryable: false,
        cause: error,
      });
    }
  }

  async close() {
    if (this.#state === "closed") return;
    if (this.#state !== "closing") {
      try { this.transition("closing"); } catch { this.#state = "closing"; }
    }
    try { await this.#session?.close?.(); } finally {
      this.#session = null;
      try { this.transition("closed"); } catch { this.#state = "closed"; }
      this.#emit("voice.session.completed", { sessionId: this.#sessionId });
      this.#emit("session.close", { sessionId: this.#sessionId });
    }
  }

  reset() {
    if (!["closed", "error", "idle"].includes(this.#state)) throw new Error("Voice session must be closed or errored before reset.");
    this.#state = "idle";
    this.#session = null;
    this.#sessionId = null;
    this.#emit("voice.state.changed", { state: "idle" });
  }

  fail(error, metadata = {}) {
    this.#state = "error";
    this.#emit("voice.session.failed", { sessionId: this.#sessionId, code: error?.code ?? "VOICE_CONNECTION_FAILED", ...metadata });
  }

  #emit(type, data) {
    try { this.#onEvent({ type, data }); } catch {}
  }
}

function cryptoRandomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "voice-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
}
