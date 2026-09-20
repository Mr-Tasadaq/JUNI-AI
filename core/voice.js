import { ProviderError } from "./errors.js";

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
]);

export function assertVoiceSessionContract(session) {
  if (!session || typeof session !== "object") {
    throw new TypeError("Voice session must be an object.");
  }

  for (const method of [
    "sendText",
    "sendAudio",
    "sendVideo",
    "interrupt",
    "sendToolResponse",
    "reconnect",
    "close",
  ]) {
    if (typeof session[method] !== "function") {
      throw new TypeError("Voice session must implement " + method + "().");
    }
  }

  return session;
}

export class VoiceSessionController {
  #session;
  #state = "idle";
  #onEvent;

  constructor({ sessionFactory, onEvent = () => {} }) {
    this.sessionFactory = sessionFactory;
    this.#onEvent = onEvent;
  }

  get state() {
    return this.#state;
  }

  async connect(options = {}) {
    if (this.#state === "open") return this.#session;

    this.#state = "connecting";
    try {
      this.#session = assertVoiceSessionContract(await this.sessionFactory(options));
      this.#state = "open";
      this.#onEvent({ type: "session.open" });
      return this.#session;
    } catch (error) {
      this.#state = "error";
      throw error instanceof ProviderError
        ? error
        : new ProviderError("Voice session could not be created.", {
            provider: options.provider ?? "gemini",
            code: "VOICE_CONNECT_FAILED",
            retryable: true,
            cause: error,
          });
    }
  }

  async reconnect(options = {}) {
    this.#onEvent({ type: "reconnect.start" });
    this.#state = "reconnecting";

    try {
      this.#session = assertVoiceSessionContract(
        await this.sessionFactory({ ...options, reconnect: true })
      );
      this.#state = "open";
      this.#onEvent({ type: "reconnect.success" });
      return this.#session;
    } catch (error) {
      this.#state = "error";
      throw error;
    }
  }

  async close() {
    await this.#session?.close();
    this.#session = null;
    this.#state = "closed";
    this.#onEvent({ type: "session.close" });
  }
}
