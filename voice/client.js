import { assertVoiceTransition, canTransitionVoiceState } from "../core/voice.js";
import { buildAudioInputMessage, buildSetupMessage, buildToolResponseMessage, parseLiveServerMessage } from "./protocol.js";
import { VoiceAudioInput } from "./audio-input.js";
import { VoiceAudioOutput } from "./audio-output.js";
import { VOICE_TOOL_DECLARATIONS, executeVoiceTool } from "./tools.js";

const ACCESS_KEY = "juni-ai-access-token-v1";
const DEFAULT_RECONNECTS = 5;

export class VoiceClient {
  #fetch;
  #WebSocket;
  #state = "idle";
  #socket = null;
  #audioInput = null;
  #audioOutput = null;
  #tokenInfo = null;
  #resumptionHandle = null;
  #sessionId = null;
  #reconnectAttempts = 0;
  #reconnectTimer = null;
  #sessionTimer = null;
  #levelFrame = null;
  #sessionStartedAt = 0;
  #stopped = false;
  #setupComplete = false;
  #onEvent;
  #captionsPreference = false;
  #config;
  #metrics = { reconnectCount: 0, interruptionCount: 0, toolCallCount: 0, inputBytes: 0, outputBytes: 0 };
  #audioInputFactory;
  #audioOutputFactory;

  constructor({
    fetchImpl = globalThis.fetch?.bind(globalThis),
    webSocketImpl = globalThis.WebSocket,
    audioInputFactory = (options) => new VoiceAudioInput(options),
    audioOutputFactory = (options) => new VoiceAudioOutput(options),
    onEvent = () => {},
    config = {},
  } = {}) {
    this.#fetch = fetchImpl;
    this.#WebSocket = webSocketImpl;
    this.#audioInputFactory = audioInputFactory;
    this.#audioOutputFactory = audioOutputFactory;
    this.#onEvent = onEvent;
    this.#config = {
      tokenEndpoint: "/api/voice-token",
      eventEndpoint: "/api/voice-events",
      audioChunkMs: 60,
      outputBufferLimitMs: 1200,
      maxReconnects: DEFAULT_RECONNECTS,
      reconnectBaseMs: 500,
      captionsEnabled: false,
      maxSessionMinutes: 30,
      ...config,
    };
  }

  get state() { return this.#state; }
  get sessionId() { return this.#sessionId; }
  get muted() { return Boolean(this.#audioInput?.muted); }
  get metrics() {
    const durationMs = this.#sessionStartedAt ? Date.now() - this.#sessionStartedAt : 0;
    return Object.freeze({ ...this.#metrics, durationMs });
  }

  async start({ captions = this.#captionsPreference } = {}) {
    if (["connecting", "listening", "speaking", "reconnecting", "requesting_permission"].includes(this.#state)) return;
    this.#stopped = false;
    this.#captionsPreference = Boolean(captions);
    this.#reconnectAttempts = 0;
    this.#metrics = { reconnectCount: 0, interruptionCount: 0, toolCallCount: 0, inputBytes: 0, outputBytes: 0 };
    this.#transitionFromIdle("requesting_permission");
    try {
      await this.#ensureAudio();
      this.#sessionStartedAt = Date.now();
      await this.#getToken(true);
      await this.#connect(false);
    } catch (error) {
      await this.stop({ reason: "start_failed", preserveToken: false });
      this.#setError(normalizeVoiceError(error));
      throw normalizeVoiceError(error);
    }
  }

  setCaptionsEnabled(enabled) {
    this.#captionsPreference = Boolean(enabled);
    this.#emit("voice.captions.changed", { enabled: this.#captionsPreference });
  }

  async setMuted(muted) {
    this.#audioInput?.setMuted(Boolean(muted));
    this.#emit("voice.muted.changed", { sessionId: this.#sessionId, muted: Boolean(muted) });
  }

  setVolume(volume) {
    const normalized = Number.isFinite(Number(volume)) ? Math.max(0, Math.min(1, Number(volume))) : 1;
    this.#audioOutput?.setVolume(normalized);
    this.#emit("voice.volume.changed", { volume: normalized });
  }

  async resume() {
    await this.#audioInput?.resume?.();
    await this.#audioOutput?.start?.();
  }

  async interrupt(reason = "user") {
    this.#audioOutput?.clear();
    this.#metrics.interruptionCount += 1;
    this.#transitionSafely("interrupted");
    this.#emit("voice.interrupted", { sessionId: this.#sessionId, reason });
    this.#transitionSafely("listening");
    await this.#sendAudit("voice_session_interrupted", { sessionId: this.#sessionId, interruptionCount: this.#metrics.interruptionCount });
  }

  async stop({ reason = "user", preserveToken = false } = {}) {
    this.#stopped = true;
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    if (this.#sessionTimer) clearTimeout(this.#sessionTimer);
    this.#stopLevelMonitor();
    this.#reconnectTimer = null;
    this.#sessionTimer = null;
    this.#audioOutput?.clear();
    try { this.#socket?.close?.(1000, "voice-session-closed"); } catch {}
    await this.#audioInput?.close?.();
    await this.#audioOutput?.close?.();
    this.#socket = null;
    this.#setupComplete = false;
    const sessionId = this.#sessionId;
    const metrics = this.metrics;
    this.#transitionClosed();
    this.#emit("voice.session.completed", { sessionId, reason, ...metrics });
    await this.#sendAudit("voice_session_completed", { sessionId, reason, ...metrics });
    if (!preserveToken) {
      this.#tokenInfo = null;
      this.#resumptionHandle = null;
    }
    this.#sessionId = null;
    this.#sessionStartedAt = 0;
  }

  async retry() {
    if (!["error", "closed", "idle"].includes(this.#state)) return;
    this.#state = "idle";
    return this.start({ captions: this.#captionsPreference });
  }

  async #ensureAudio() {
    this.#audioOutput ??= this.#audioOutputFactory({ maxBufferedMs: this.#config.outputBufferLimitMs });
    await this.#audioOutput.start();
    this.#audioInput ??= this.#audioInputFactory({
      chunkMs: this.#config.audioChunkMs,
      onChunk: (bytes, meta = {}) => {
        if (meta.ended) {
          this.#emit("voice.microphone.ended", { sessionId: this.#sessionId });
          this.#setError(voiceError("VOICE_MIC_UNAVAILABLE", "The microphone became unavailable."));
          return;
        }
        if (!bytes?.byteLength || this.#stopped || !this.#setupComplete) return;
        if (this.#socket?.readyState !== this.#WebSocket.OPEN) return;
        try {
          this.#socket.send(JSON.stringify(buildAudioInputMessage(toBase64(bytes))));
          this.#metrics.inputBytes += bytes.byteLength;
          this.#emit("voice.audio.input", { sessionId: this.#sessionId, bytes: bytes.byteLength });
        } catch {
          this.#handleConnectionError(voiceError("VOICE_CONNECTION_FAILED", "Voice audio could not be sent."));
        }
      },
      onLevel: (level) => this.#emit("voice.input.level", { level }),
    });
    await this.#audioInput.start();
    this.#startLevelMonitor();
  }

  #startLevelMonitor() {
    if (this.#levelFrame != null) return;
    const tick = () => {
      if (this.#stopped) {
        this.#levelFrame = null;
        return;
      }
      const inputLevel = this.#audioInput?.getLevel?.() ?? 0;
      const outputLevel = this.#audioOutput?.getLevel?.() ?? 0;
      this.#emit("voice.activity.level", {
        sessionId: this.#sessionId,
        inputLevel: Math.max(0, Math.min(1, Number(inputLevel) || 0)),
        outputLevel: Math.max(0, Math.min(1, Number(outputLevel) || 0)),
        level: Math.max(Number(inputLevel) || 0, Number(outputLevel) || 0),
      });
      this.#levelFrame = typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(tick)
        : setTimeout(tick, 80);
    };
    tick();
  }

  #stopLevelMonitor() {
    if (this.#levelFrame == null) return;
    if (typeof this.#levelFrame === "number" && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.#levelFrame);
    else clearTimeout(this.#levelFrame);
    this.#levelFrame = null;
  }

  async #getToken(force = false) {
    if (!this.#fetch) throw voiceError("VOICE_TOKEN_FAILED", "Voice token service is unavailable.");
    if (!force && this.#tokenInfo && !tokenNeedsRefresh(this.#tokenInfo)) return this.#tokenInfo;
    const headers = { "Content-Type": "application/json" };
    const access = globalThis.localStorage?.getItem?.(ACCESS_KEY) || "";
    if (access) headers.Authorization = "Bearer " + access;

    const response = await this.#fetch(this.#config.tokenEndpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sessionId: this.#sessionId,
        captions: this.#captionsPreference,
      }),
    });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) {
      const code = response.status === 401 ? "VOICE_AUTH_REQUIRED" : data.code || "VOICE_TOKEN_FAILED";
      throw voiceError(code, data.error || "Voice authentication could not be established.");
    }
    if (!data.token || !data.model || !data.sessionId || !data.expiresAt) throw voiceError("VOICE_TOKEN_FAILED", "Voice token response was incomplete.");

    this.#tokenInfo = data;
    this.#sessionId = String(data.sessionId);
    this.#config = {
      ...this.#config,
      audioChunkMs: Number(data.audioChunkMs) || this.#config.audioChunkMs,
      outputBufferLimitMs: Number(data.outputBufferLimitMs) || this.#config.outputBufferLimitMs,
      maxSessionMinutes: Number(data.maxSessionMinutes) || this.#config.maxSessionMinutes,
      maxReconnects: Number(data.maxReconnectAttempts) || this.#config.maxReconnects,
      reconnectBaseMs: Number(data.reconnectBaseMs) || this.#config.reconnectBaseMs,
    };
    this.#emit("voice.session.started", { sessionId: this.#sessionId, model: data.model });
    return data;
  }

  async #connect(isReconnect) {
    if (!this.#WebSocket) throw voiceError("VOICE_CONNECTION_FAILED", "WebSocket is unavailable in this browser.");
    if (isReconnect) this.#transitionSafely("reconnecting");
    else this.#transitionSafely("connecting");

    await this.#getToken(false);
    const token = this.#tokenInfo.token;
    const model = this.#tokenInfo.model;
    const endpoint = this.#tokenInfo.wsEndpoint || "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";
    const url = endpoint + "?access_token=" + encodeURIComponent(token);
    this.#setupComplete = false;

    await new Promise((resolve, reject) => {
      let settled = false;
      let setupTimeout;
      const socket = new this.#WebSocket(url);
      this.#socket = socket;

      const fail = (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(setupTimeout);
          reject(error);
        }
        this.#handleConnectionError(error);
      };

      socket.addEventListener("open", () => {
        try {
          socket.send(JSON.stringify(buildSetupMessage({
            model,
            includeTranscriptions: Boolean(this.#tokenInfo.captionsEnabled ?? this.#captionsPreference),
            resumptionHandle: this.#resumptionHandle,
            tools: VOICE_TOOL_DECLARATIONS,
          })));
          setupTimeout = setTimeout(() => fail(voiceError("VOICE_CONNECTION_FAILED", "Voice setup timed out.")), 15_000);
        } catch (error) {
          fail(voiceError("VOICE_CONNECTION_FAILED", "Voice setup could not be sent."));
        }
      });

      socket.addEventListener("message", async (event) => {
        try {
          const raw = event.data instanceof Blob ? await event.data.text()
            : event.data instanceof ArrayBuffer ? new TextDecoder().decode(event.data)
              : event.data;
          const events = parseLiveServerMessage(raw);
          for (const parsed of events) await this.#handleParsedEvent(parsed);
          if (events.some((item) => item.type === "setupComplete")) {
            this.#setupComplete = true;
            clearTimeout(setupTimeout);
            this.#reconnectAttempts = 0;
            this.#transitionSafely("listening");
            this.#emit("voice.session.connected", { sessionId: this.#sessionId, resumed: Boolean(this.#resumptionHandle) });
            await this.#sendAudit("voice_session_connected", { sessionId: this.#sessionId, resumed: Boolean(this.#resumptionHandle) });
            this.#scheduleSessionTimeout();
            if (!settled) { settled = true; resolve(); }
          }
        } catch {
          fail(voiceError("VOICE_PROTOCOL_ERROR", "Voice provider sent an invalid message."));
        }
      });

      socket.addEventListener("error", () => fail(voiceError("VOICE_CONNECTION_FAILED", "Voice connection failed.")));

      socket.addEventListener("close", (event) => {
        this.#setupComplete = false;
        clearTimeout(setupTimeout);
        if (!settled) {
          settled = true;
          reject(voiceError("VOICE_CONNECTION_CLOSED", "Voice connection closed before setup completed."));
          return;
        }
        if (!this.#stopped) this.#scheduleReconnect({ reason: event?.reason || event?.code || "connection_closed" });
      });
    });
  }

  async #handleParsedEvent(event) {
    switch (event.type) {
      case "setupComplete":
        this.#emit("voice.setup.complete", { sessionId: this.#sessionId });
        break;
      case "audio": {
        try {
          const result = await this.#audioOutput.playPcm24(event.data, event.mimeType);
          if (result.scheduled) {
            this.#metrics.outputBytes += decodedByteLength(event.data);
            this.#transitionSafely("speaking");
          }
          this.#emit("voice.audio.output", { sessionId: this.#sessionId, bufferedMs: Math.round(result.bufferedMs ?? 0), scheduled: Boolean(result.scheduled), obsolete: Boolean(result.obsolete) });
        } catch {
          throw voiceError("VOICE_AUDIO_ERROR", "Voice audio playback failed.");
        }
        break;
      }
      case "inputTranscription":
        if (this.#captionsPreference) this.#emit("voice.caption.input.final", { sessionId: this.#sessionId, text: event.text });
        break;
      case "interimInputTranscription":
        if (this.#captionsPreference) this.#emit("voice.caption.input.interim", { sessionId: this.#sessionId, text: event.text });
        break;
      case "outputTranscription":
        if (this.#captionsPreference) this.#emit("voice.caption.output", { sessionId: this.#sessionId, text: event.text });
        break;
      case "generationComplete":
        this.#emit("voice.generation.complete", { sessionId: this.#sessionId });
        break;
      case "turnComplete":
        this.#transitionSafely("listening");
        this.#emit("voice.listening.started", { sessionId: this.#sessionId });
        break;
      case "waitingForInput":
        this.#transitionSafely("listening");
        break;
      case "interactionStatus":
        if (event.status === "IDLE") this.#transitionSafely("listening");
        if (event.status === "IN_PROGRESS" && this.#audioOutput.bufferedMs > 0) this.#transitionSafely("speaking");
        this.#emit("voice.interaction.status", { sessionId: this.#sessionId, status: event.status });
        break;
      case "interrupted":
        this.#audioOutput.clear();
        this.#metrics.interruptionCount += 1;
        this.#transitionSafely("interrupted");
        this.#emit("voice.interrupted", { sessionId: this.#sessionId, reason: "server" });
        this.#transitionSafely("listening");
        await this.#sendAudit("voice_session_interrupted", { sessionId: this.#sessionId, interruptionCount: this.#metrics.interruptionCount });
        break;
      case "sessionResumptionUpdate":
        if (event.resumable && event.newHandle) {
          this.#resumptionHandle = event.newHandle;
          this.#emit("voice.session.resumption.updated", { sessionId: this.#sessionId, resumable: true });
        } else {
          this.#emit("voice.session.resumption.updated", { sessionId: this.#sessionId, resumable: false });
        }
        break;
      case "goAway":
        this.#emit("voice.goaway", { sessionId: this.#sessionId, timeLeft: event.timeLeft });
        this.#scheduleReconnect({ reason: "goAway" });
        break;
      case "toolCall":
        await this.#handleToolCall(event.functionCalls);
        break;
      case "toolCallCancellation":
        this.#emit("voice.tool.cancelled", { sessionId: this.#sessionId, count: event.ids.length });
        break;
      case "error":
        this.#handleConnectionError(voiceError("VOICE_CONNECTION_FAILED", "The voice service returned an error."));
        break;
      case "protocol.error":
        throw voiceError("VOICE_PROTOCOL_ERROR", "Voice provider sent malformed data.");
      case "unknown":
        this.#emit("voice.message.unknown", { sessionId: this.#sessionId, keys: event.keys });
        break;
      default:
        break;
    }
  }

  async #handleToolCall(functionCalls) {
    const responses = [];
    for (const call of functionCalls) {
      this.#metrics.toolCallCount += 1;
      this.#emit("voice.tool.started", { sessionId: this.#sessionId, toolName: call.name, callId: call.id });
      if (!call.id || !VOICE_TOOL_DECLARATIONS.some((tool) => tool.name === call.name)) {
        responses.push({ name: call.name || "unknown", id: call.id || "rejected", response: { error: "VOICE_TOOL_REJECTED" } });
        this.#emit("voice.tool.failed", { sessionId: this.#sessionId, toolName: call.name || "unknown", callId: call.id, code: "VOICE_TOOL_REJECTED" });
        continue;
      }
      try {
        const result = await executeVoiceTool(call.name, call.args);
        const safeResult = sanitizeToolResult(result);
        responses.push({ name: call.name, id: call.id, response: { result: safeResult } });
        this.#emit("voice.tool.completed", { sessionId: this.#sessionId, toolName: call.name, callId: call.id, result: safeResult });
        if (call.name === "openWebsite" && safeResult.url) this.#emit("voice.tool.offer", { sessionId: this.#sessionId, toolName: call.name, url: safeResult.url, label: safeResult.label });
        await this.#sendAudit("voice_tool_call", { sessionId: this.#sessionId, toolName: call.name, outcome: "completed" });
      } catch {
        responses.push({ name: call.name, id: call.id, response: { error: "VOICE_TOOL_REJECTED" } });
        this.#emit("voice.tool.failed", { sessionId: this.#sessionId, toolName: call.name, callId: call.id, code: "VOICE_TOOL_REJECTED" });
        await this.#sendAudit("voice_tool_call", { sessionId: this.#sessionId, toolName: call.name, outcome: "rejected" });
      }
    }
    if (this.#socket?.readyState === this.#WebSocket.OPEN && responses.length) {
      this.#socket.send(JSON.stringify(buildToolResponseMessage(responses)));
      this.#emit("voice.tool.response", { sessionId: this.#sessionId, count: responses.length });
    }
  }

  #scheduleReconnect(closeEvent = {}) {
    if (this.#stopped || this.#reconnectTimer) return;
    if (this.#reconnectAttempts >= this.#config.maxReconnects) {
      this.#setError(voiceError("VOICE_RECONNECT_FAILED", "Voice reconnect limit reached."));
      return;
    }
    this.#reconnectAttempts += 1;
    this.#metrics.reconnectCount = this.#reconnectAttempts;
    const attempt = this.#reconnectAttempts;
    const base = Number(this.#config.reconnectBaseMs) || 500;
    const exponential = Math.min(15_000, base * (2 ** (attempt - 1)));
    const jitter = Math.floor(Math.random() * Math.max(25, exponential * 0.25));
    const delayMs = Math.min(15_000, exponential + jitter);
    this.#transitionSafely("reconnecting");
    this.#emit("voice.reconnect.started", { sessionId: this.#sessionId, attempt, delayMs, reason: sanitizeReason(closeEvent.reason) });
    this.#sendAudit("voice_session_reconnected", { sessionId: this.#sessionId, attempt });
    const staleSocket = this.#socket;
    this.#reconnectTimer = setTimeout(async () => {
      this.#reconnectTimer = null;
      try {
        await this.#connect(true);
        this.#emit("voice.reconnect.completed", { sessionId: this.#sessionId, attempt });
      } catch {
        if (!this.#stopped) this.#scheduleReconnect({ reason: "reconnect_failed" });
      }
    }, delayMs);
    if (staleSocket && staleSocket.readyState === this.#WebSocket.OPEN) {
      try { staleSocket.close(1000, "reconnecting"); } catch {}
    }
  }

  #scheduleSessionTimeout() {
    if (this.#sessionTimer) clearTimeout(this.#sessionTimer);
    const maxMs = Math.max(60_000, Number(this.#config.maxSessionMinutes) * 60_000);
    const elapsed = Date.now() - this.#sessionStartedAt;
    this.#sessionTimer = setTimeout(() => this.stop({ reason: "max_session_lifetime" }), Math.max(1, maxMs - elapsed));
  }

  #handleConnectionError(error) {
    const normalized = normalizeVoiceError(error);
    this.#emit("voice.session.error", { sessionId: this.#sessionId, code: normalized.code });
    if (!this.#stopped && normalized.code !== "VOICE_PROTOCOL_ERROR") this.#scheduleReconnect({ reason: normalized.code });
    else if (normalized.code === "VOICE_PROTOCOL_ERROR") this.#setError(normalized);
  }

  #transitionFromIdle(next) {
    if (this.#state === next) return;
    if (this.#state === "closed") this.#state = "idle";
    this.#transitionSafely(next);
  }

  #transitionSafely(next) {
    if (this.#state === next) return;
    try {
      assertVoiceTransition(this.#state, next);
    } catch {
      this.#state = "error";
      this.#emit("voice.session.failed", { sessionId: this.#sessionId, code: "VOICE_ILLEGAL_STATE_TRANSITION" });
      return;
    }
    const previous = this.#state;
    this.#state = next;
    this.#emit("voice.state.changed", { sessionId: this.#sessionId, previousState: previous, state: next });
    this.#emitStateSpecific(next);
  }

  #transitionClosed() {
    if (this.#state === "closed") return;
    if (this.#state !== "closing") {
      if (canTransitionVoiceState(this.#state, "closing")) this.#state = "closing";
      else this.#state = "closing";
      this.#emit("voice.state.changed", { sessionId: this.#sessionId, state: "closing" });
    }
    this.#state = "closed";
    this.#emit("voice.state.changed", { sessionId: this.#sessionId, state: "closed" });
  }

  #emitStateSpecific(state) {
    if (state === "listening") this.#emit("voice.listening.started", { sessionId: this.#sessionId });
    if (state === "speaking") this.#emit("voice.speaking.started", { sessionId: this.#sessionId });
    if (state === "reconnecting") this.#emit("voice.reconnect.started", { sessionId: this.#sessionId });
  }

  #setError(error) {
    this.#state = "error";
    this.#emit("voice.session.failed", { sessionId: this.#sessionId, code: error?.code ?? "VOICE_CONNECTION_FAILED" });
    this.#sendAudit("voice_session_failed", { sessionId: this.#sessionId, code: error?.code ?? "VOICE_CONNECTION_FAILED" });
  }

  #emit(type, data) {
    try { this.#onEvent({ type, data }); } catch {}
  }

  async #sendAudit(eventType, data) {
    if (!this.#fetch || !data?.sessionId || typeof data !== "object") return;
    try {
      const metadata = sanitizeAuditMetadata(data);
      const headers = { "Content-Type": "application/json" };
      const access = globalThis.localStorage?.getItem?.(ACCESS_KEY) || "";
      if (access) headers.Authorization = "Bearer " + access;
      await this.#fetch(this.#config.eventEndpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ event: eventType, sessionId: data.sessionId, metadata }),
        keepalive: true,
      });
    } catch {}
  }
}

function tokenNeedsRefresh(tokenInfo) {
  const expires = Date.parse(String(tokenInfo?.expiresAt ?? ""));
  return !Number.isFinite(expires) || Date.now() + 30_000 >= expires;
}
function decodedByteLength(base64) {
  try { return Math.floor(String(base64).replace(/\s+/g, "").length * 3 / 4); } catch { return 0; }
}
function toBase64(bytes) {
  let binary = "";
  const stride = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += stride) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + stride)));
  }
  return btoa(binary);
}
function sanitizeToolResult(result) {
  if (!result || typeof result !== "object") return { status: "ok" };
  return Object.fromEntries(Object.entries(result).filter(([key]) => ["status", "url", "label", "utc"].includes(key)));
}
function sanitizeReason(reason) {
  const value = String(reason ?? "connection_closed");
  return value.length > 120 ? value.slice(0, 120) : value;
}
function sanitizeAuditMetadata(data) {
  const allowed = {};
  for (const key of ["sessionId", "reason", "reconnectCount", "interruptionCount", "toolCallCount", "inputBytes", "outputBytes", "durationMs", "model", "toolName", "outcome"]) {
    if (data[key] == null) continue;
    if (["reason", "model", "toolName", "outcome"].includes(key)) allowed[key] = String(data[key]).slice(0, 128);
    else allowed[key] = Math.max(0, Math.min(Number(data[key]) || 0, 10_000_000_000));
  }
  return allowed;
}
function voiceError(code, message) { const error = new Error(message); error.code = code; return error; }
function normalizeVoiceError(error) {
  const known = new Set([
    "VOICE_FEATURE_DISABLED","VOICE_AUTH_REQUIRED","VOICE_TOKEN_FAILED","VOICE_TOKEN_EXPIRED",
    "VOICE_PERMISSION_DENIED","VOICE_MIC_UNAVAILABLE","VOICE_CONNECTION_FAILED","VOICE_CONNECTION_CLOSED",
    "VOICE_RECONNECT_FAILED","VOICE_PROTOCOL_ERROR","VOICE_AUDIO_ERROR","VOICE_TOOL_REJECTED","VOICE_MODEL_UNSUPPORTED",
  ]);
  return known.has(error?.code) ? error : voiceError("VOICE_CONNECTION_FAILED", "Voice interaction could not continue.");
}
