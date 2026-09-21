import { VoiceStateMachine } from "./state.js";
import { parseLiveMessage, decodeSocketData } from "./protocol.js";
import { AudioInput } from "./audio-input.js";
import { AudioOutput } from "./audio-output.js";
import { executeVoiceTool, listVoiceTools } from "./tools.js";

const AUTH_KEY = "juni-ai-access-token-v1";
const DEFAULT_WS = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";

export class VoiceClient {
  #elements;
  #fetch;
  #WebSocket;
  #machine;
  #audioInput;
  #audioOutput;
  #socket = null;
  #token = null;
  #tokenExpiresAt = 0;
  #sessionId = null;
  #resumeHandle = null;
  #model = null;
  #config = null;
  #closedByUser = false;
  #setupReady = false;
  #reconnectTimer = null;
  #reconnectAttempts = 0;
  #sessionDeadlineTimer = null;
  #toolCallsThisTurn = 0;
  #cancelledToolIds = new Set();
  #captionEnabled = false;
  #startedAt = 0;
  #goAway = false;
  #muted = false;
  #onState;
  #onCaption;
  #onEvent;
  #onOpenWebsite;
  #onError;
  #onVisibilityChange;
  #onPageHide;
  #audioInputFactory;
  #audioOutputFactory;
  #level = { input: 0, output: 0 };

  constructor({
    elements = {},
    fetchImpl = globalThis.fetch,
    WebSocketImpl = globalThis.WebSocket,
    onState = () => {},
    onCaption = () => {},
    onEvent = () => {},
    onOpenWebsite = () => {},
    onError = () => {},
    audioInputFactory = (options) => new AudioInput(options),
    audioOutputFactory = (options) => new AudioOutput(options),
  } = {}) {
    this.#elements = elements;
    this.#fetch = fetchImpl;
    this.#WebSocket = WebSocketImpl;
    this.#onState = onState;
    this.#onCaption = onCaption;
    this.#onEvent = onEvent;
    this.#onOpenWebsite = onOpenWebsite;
    this.#onError = onError;
    this.#audioInputFactory = audioInputFactory;
    this.#audioOutputFactory = audioOutputFactory;
    this.#captionEnabled = Boolean(elements.captionsToggle?.checked);
    this.#onVisibilityChange = () => {
      if (!this.#machine || this.#closedByUser) return;
      if (document.visibilityState === "visible") {
        this.#audioOutput?.resume().catch(() => {});
      } else {
        this.#audioOutput?.suspend().catch(() => {});
      }
    };
    this.#onPageHide = () => {
      this.stop("page_hidden");
    };
    document.addEventListener("visibilitychange", this.#onVisibilityChange);
    window.addEventListener("pagehide", this.#onPageHide);
    window.addEventListener("beforeunload", this.#onPageHide);
  }

  get state() { return this.#machine?.state ?? "idle"; }
  get sessionId() { return this.#sessionId; }
  get inputLevel() { return this.#level.input; }
  get outputLevel() { return this.#level.output; }

  async start() {
    if (this.#machine && !["idle", "closed", "error"].includes(this.#machine.state)) return;
    this.#closedByUser = false;
    this.#goAway = false;
    this.#reconnectAttempts = 0;
    this.#resumeHandle = null;
    this.#machine = new VoiceStateMachine();
    this.#emitState();
    this.#setState("requesting_permission", { explicitUserAction: true });

    try {
      this.#config = await this.#fetchVoiceToken({ resumeHandle: null, sessionId: null });
      this.#token = this.#config.token;
      this.#tokenExpiresAt = Date.parse(this.#config.expiresAt);
      this.#sessionId = this.#config.sessionId;
      this.#model = this.#config.model;
      this.#onEvent({ type: "voice.session.started", sessionId: this.#sessionId, provider: "gemini", model: this.#model });
      this.#machine = new VoiceStateMachine({ sessionId: this.#sessionId });
      this.#emitState();
      await this.#connectSocket(false);
    } catch (error) {
      await this.#fail(error?.code ?? "VOICE_CONNECTION_FAILED", error?.message ?? "Voice could not start.");
    }
  }

  async stop(reason = "user_stopped") {
    this.#closedByUser = true;
    this.#clearReconnect();
    this.#clearSessionDeadline();
    this.#machine && !["closing", "closed"].includes(this.#machine.state) && this.#safeTransition("closing", { reason });
    try { await this.#audioInput?.stop(); } catch {}
    this.#onEvent({ type: "voice.listening.stopped", sessionId: this.#sessionId, reason });
    try { this.#socket?.close(1000, "voice stopped"); } catch {}
    this.#socket = null;
    this.#setupReady = false;
    try { this.#audioOutput?.clear(); } catch {}
    try { await this.#audioOutput?.close(); } catch {}
    this.#audioInput = null;
    this.#audioOutput = null;
    if (this.#sessionId) {
      await this.#recordSession({
        kind: "voice_session_completed",
        status: "completed",
        endedAt: new Date().toISOString(),
        closeReason: reason,
        inputBytes: this.#machine?.counters.inputBytes ?? 0,
        outputBytes: this.#machine?.counters.outputBytes ?? 0,
        metadata: { reconnectCount: this.#machine?.counters.reconnectCount ?? 0, interruptionCount: this.#machine?.counters.interruptionCount ?? 0 },
      });
    }
    this.#token = null;
    this.#tokenExpiresAt = 0;
    this.#resumeHandle = null;
    this.#safeTransition("closed", { reason });
    this.#onEvent({ type: "voice.session.closed", sessionId: this.#sessionId, reason });
    this.#emitState();
  }

  setCaptionsEnabled(enabled) {
    this.#captionEnabled = Boolean(enabled);
  }

  setVolume(value) {
    this.#audioOutput?.setVolume(value);
  }

  setMuted(muted) {
    this.#muted = Boolean(muted);
    this.#onEvent({ type: "voice.mute.changed", sessionId: this.#sessionId, muted: this.#muted });
  }

  get muted() {
    return this.#muted;
  }

  async retry() {
    if (this.state !== "error") return;
    await this.stop("retry_reset");
    await this.start();
  }

  async #connectSocket(isReconnect, { freshToken = false } = {}) {
    if (!this.#WebSocket) throw voiceError("VOICE_CONNECTION_FAILED", "WebSocket is not available in this browser.");
    this.#setupReady = false;
    this.#safeTransition(isReconnect ? "reconnecting" : "connecting", { reconnect: isReconnect });
    if (freshToken || this.#tokenExpired()) {
      this.#config = await this.#fetchVoiceToken({ resumeHandle: isReconnect ? this.#resumeHandle : null, sessionId: this.#sessionId });
      this.#token = this.#config.token;
      this.#tokenExpiresAt = Date.parse(this.#config.expiresAt);
      this.#model = this.#config.model;
      if (this.#config.sessionId && this.#config.sessionId !== this.#sessionId) {
        this.#sessionId = this.#config.sessionId;
        this.#machine = new VoiceStateMachine({ sessionId: this.#sessionId });
        this.#emitState();
      }
    }

    const token = this.#token || this.#config?.token;
    if (!token) throw voiceError("VOICE_TOKEN_FAILED", "No ephemeral voice token is available.");
    if (this.#tokenExpired()) {
      this.#config = await this.#fetchVoiceToken({ resumeHandle: isReconnect ? this.#resumeHandle : null, sessionId: this.#sessionId });
      this.#token = this.#config.token;
      this.#tokenExpiresAt = Date.parse(this.#config.expiresAt);
      this.#model = this.#config.model;
    }

    const wsUrl = (this.#config?.websocketUrl || DEFAULT_WS) + "?access_token=" + encodeURIComponent(this.#token);
    const socket = new this.#WebSocket(wsUrl);
    this.#socket = socket;

    socket.addEventListener("open", () => {
      try {
        socket.send(JSON.stringify({ setup: this.#buildSetup() }));
      } catch (error) {
        this.#fail("VOICE_CONNECTION_FAILED", "Voice connection setup failed.");
      }
    });

    socket.addEventListener("message", async (event) => {
      await this.#handleSocketMessage(event);
    });

    socket.addEventListener("error", () => {
      if (!this.#closedByUser) this.#onError({ code: "VOICE_CONNECTION_FAILED", message: "Realtime voice connection failed." });
    });

    socket.addEventListener("close", () => {
      this.#handleSocketClose();
    });
  }

  #buildSetup() {
    return {
      model: "models/" + this.#model,
      generationConfig: { responseModalities: ["AUDIO"] },
      tools: [{ functionDeclarations: listVoiceTools() }],
      sessionResumption: this.#resumeHandle ? { transparent: true, handle: this.#resumeHandle } : { transparent: true },
      contextWindowCompression: { slidingWindow: {} },
      ...(this.#config?.captionsEnabled ? {
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      } : {}),
    };
  }

  async #handleSocketMessage(event) {
    let raw;
    try {
      raw = await decodeSocketData(event.data);
    } catch {
      this.#fail("VOICE_PROTOCOL_ERROR", "Voice message could not be decoded.");
      return;
    }

    const parsed = parseLiveMessage(raw);
    for (const message of parsed) {
      switch (message.type) {
        case "setup.complete":
          this.#setupReady = true;
          this.#reconnectAttempts = 0;
          this.#startedAt ||= Date.now();
          this.#setState("listening", { setupComplete: true });
          this.#onEvent({ type: "voice.session.connected", sessionId: this.#sessionId, provider: "gemini", model: this.#model });
          await this.#recordSession({ kind: "voice_session_connected", status: "connected", connected: true, metadata: { providerSessionId: message.sessionId ?? null } });
          await this.#startAudio();
          this.#scheduleSessionDeadline();
          break;
        case "audio.output":
          await this.#handleOutputAudio(message);
          break;
        case "transcription.input":
        case "transcription.input.interim":
        case "transcription.output":
          if (this.#captionEnabled) this.#onCaption({
            type: message.type,
            speaker: message.type === "transcription.output" ? "JUNI" : "YOU",
            text: message.text,
            finished: message.finished,
          });
          break;
        case "interrupted":
          await this.#handleInterruption("server");
          break;
        case "waiting.for.input":
        case "turn.complete":
          this.#toolCallsThisTurn = 0;
          if (this.state === "speaking" || this.state === "interrupted") {
            this.#onEvent({ type: "voice.speaking.stopped", sessionId: this.#sessionId });
            this.#safeTransition("listening", { turnComplete: true });
            this.#onEvent({ type: "voice.listening.started", sessionId: this.#sessionId });
          }
          break;
        case "generation.complete":
          this.#onEvent({ type: "voice.generation.complete", sessionId: this.#sessionId });
          break;
        case "interaction.status":
          this.#onEvent({ type: "voice.interaction.status", sessionId: this.#sessionId, status: message.status });
          break;
        case "tool.call":
          await this.#handleToolCall(message.functionCalls);
          break;
        case "tool.call.cancelled":
          for (const id of message.ids ?? []) this.#cancelledToolIds.add(id);
          break;
        case "session.resumption.update":
          if (message.resumable === true && message.newHandle) {
            this.#resumeHandle = message.newHandle;
            this.#onEvent({ type: "voice.session.resumption.updated", sessionId: this.#sessionId });
          }
          break;
        case "go.away":
          this.#goAway = true;
          this.#onEvent({ type: "voice.reconnect.started", sessionId: this.#sessionId, reason: "go_away", timeLeft: message.timeLeft ?? null });
          break;
        case "server.error":
          await this.#handleServerError(message);
          break;
        case "usage":
          this.#onEvent({
            type: "voice.usage",
            sessionId: this.#sessionId,
            inputTokens: message.inputTokens,
            outputTokens: message.outputTokens,
            totalTokens: message.totalTokens,
          });
          break;
        case "unknown":
          this.#onEvent({ type: "voice.protocol.unknown", sessionId: this.#sessionId, keys: message.keys });
          break;
        case "protocol.error":
          await this.#fail(message.code, message.message);
          break;
        default:
          break;
      }
    }
  }

  async #handleOutputAudio(message) {
    if (this.state === "listening" || this.state === "interrupted") {
      this.#safeTransition("speaking", { audio: true });
      this.#onEvent({ type: "voice.speaking.started", sessionId: this.#sessionId });
    }
    try {
      await this.#audioOutput.enqueue(message.base64, message.mimeType);
      this.#machine.addOutputBytes(decodedByteLength(message.base64));
    } catch (error) {
      await this.#fail(error?.code === "VOICE_AUDIO_BUFFER_LIMIT" ? "VOICE_AUDIO_ERROR" : (error?.code ?? "VOICE_AUDIO_ERROR"), "Voice audio playback could not continue safely.");
    }
  }

  async #handleInterruption(reason) {
    try { this.#audioOutput?.clear(); } catch {}
    if (this.state === "speaking") this.#onEvent({ type: "voice.speaking.stopped", sessionId: this.#sessionId, reason });
    if (["speaking", "listening"].includes(this.state)) this.#safeTransition("interrupted", { reason });
    if (this.state === "interrupted") this.#safeTransition("listening", { reason });
    await this.#recordSession({
      kind: "voice_interrupted",
      status: "listening",
      interruptionIncrement: true,
      metadata: { reason },
    });
    this.#onEvent({ type: "voice.interrupted", sessionId: this.#sessionId, reason });
  }

  async #startAudio() {
    this.#audioOutput ??= this.#audioOutputFactory({
      bufferLimitMs: this.#config.outputBufferLimitMs,
      onLevel: (level) => {
        this.#level.output = level;
        this.#onEvent({ type: "voice.level.output", sessionId: this.#sessionId, level });
      },
    });
    await this.#audioOutput.start();

    this.#audioInput ??= this.#audioInputFactory({
      chunkMs: this.#config.audioChunkMs,
      onChunk: (buffer) => this.#sendAudioBuffer(buffer),
      onLevel: (level) => {
        this.#level.input = level;
        this.#onEvent({ type: "voice.level.input", sessionId: this.#sessionId, level });
        this.#detectBargeIn(level);
      },
    });
    try {
      await this.#audioInput.start();
      this.#onEvent({ type: "voice.listening.started", sessionId: this.#sessionId });
      await this.#recordSession({ kind: "voice_session_started", status: "listening", metadata: { provider: "gemini", model: this.#model } });
    } catch (error) {
      throw error?.code ? error : voiceError("VOICE_MIC_UNAVAILABLE", "Microphone could not be started.");
    }
  }

  #sendAudioBuffer(buffer) {
    if (this.#muted || !this.#socket || this.#socket.readyState !== 1 || !this.#setupReady || this.#closedByUser) return;
    try {
      const bytes = new Uint8Array(buffer);
      const base64 = toBase64(bytes);
      this.#socket.send(JSON.stringify({
        realtimeInput: {
          audio: {
            mimeType: "audio/pcm;rate=16000",
            data: base64,
          },
        },
      }));
      this.#machine.addInputBytes(bytes.byteLength);
    } catch {
      this.#onError({ code: "VOICE_AUDIO_ERROR", message: "Microphone audio could not be sent." });
    }
  }

  #detectBargeIn(level) {
    if (this.state !== "speaking" || !this.#config) return;
    const threshold = Number(this.#config.bargeInRmsThreshold ?? 0.08);
    const holdMs = Number(this.#config.bargeInHoldMs ?? 120);
    if (level >= threshold) {
      if (!this.#bargeStart) this.#bargeStart = performance.now();
      if (performance.now() - this.#bargeStart >= holdMs) {
        this.#bargeStart = 0;
        this.#handleInterruption("client_barge_in");
      }
    } else {
      this.#bargeStart = 0;
    }
  }

  async #handleToolCall(functionCalls) {
    const calls = Array.isArray(functionCalls) ? functionCalls.slice(0, Number(this.#config?.maxToolCallsPerTurn ?? 4)) : [];
    for (const call of calls) {
      if (!call?.id || !call.name) continue;
      this.#machine.addToolCall();
      this.#toolCallsThisTurn += 1;
      this.#onEvent({ type: "voice.tool.started", sessionId: this.#sessionId, toolName: call.name });
      await this.#recordSession({ kind: "voice_tool_call", status: "tool_running", toolCallIncrement: true, toolName: call.name, metadata: { callId: call.id } });

      let result;
      try {
        if (this.#cancelledToolIds.has(call.id)) throw voiceError("VOICE_TOOL_REJECTED", "Tool call was cancelled.");
        result = await executeVoiceTool(call.name, call.args);
        if (call.name === "openWebsite" && result?.requiresUserClick) this.#onOpenWebsite(result.url);
        result = sanitizeToolResult(result);
        this.#onEvent({ type: "voice.tool.completed", sessionId: this.#sessionId, toolName: call.name });
      } catch (error) {
        result = { status: "error", code: "VOICE_TOOL_REJECTED", message: sanitizeText(error?.message ?? "Voice tool rejected.") };
        this.#onEvent({ type: "voice.tool.failed", sessionId: this.#sessionId, toolName: call.name, code: error?.code ?? "VOICE_TOOL_REJECTED" });
      }

      try {
        this.#socket?.send(JSON.stringify({
          toolResponse: {
            functionResponses: [{
              id: call.id,
              name: call.name,
              response: result,
            }],
          },
        }));
      } catch {
        this.#onError({ code: "VOICE_CONNECTION_FAILED", message: "Voice tool response could not be sent." });
      }
    }
    this.#cancelledToolIds.clear();
  }

  async #handleServerError(message) {
    const code = String(message.code || "");
    if (/EXPIRED|TOKEN/i.test(code)) {
      this.#tokenExpiresAt = 0;
      if (!this.#closedByUser) {
        await this.#scheduleReconnect("token_expired", true);
        return;
      }
    }
    await this.#fail("VOICE_CONNECTION_FAILED", message.message || "Gemini Live reported a connection error.");
  }

  #handleSocketClose() {
    this.#setupReady = false;
    if (this.#closedByUser) return;
    if (this.#goAway || ["listening", "speaking", "reconnecting", "connecting"].includes(this.state)) {
      this.#scheduleReconnect(this.#goAway ? "go_away" : "connection_closed");
    }
  }

  async #scheduleReconnect(reason, freshToken = false) {
    if (this.#closedByUser || this.#reconnectTimer) return;
    const max = Number(this.#config?.reconnectAttempts ?? 3);
    if (this.#reconnectAttempts >= max) {
      await this.#fail("VOICE_RECONNECT_FAILED", "Realtime voice could not reconnect.");
      return;
    }
    this.#reconnectAttempts += 1;
    this.#safeTransition("reconnecting", { reason, attempt: this.#reconnectAttempts });
    await this.#recordSession({ kind: "voice_reconnect_started", status: "reconnecting", reconnectIncrement: true, metadata: { reason, attempt: this.#reconnectAttempts } });

    const base = Number(this.#config?.reconnectBaseDelayMs ?? 400);
    const delay = Math.min(8_000, base * (2 ** (this.#reconnectAttempts - 1))) + Math.floor(Math.random() * 200);
    this.#reconnectTimer = setTimeout(async () => {
      this.#reconnectTimer = null;
      try {
        await this.#connectSocket(true, { freshToken });
        await this.#recordSession({ kind: "voice_reconnect_completed", status: "reconnecting", metadata: { attempt: this.#reconnectAttempts, resumed: Boolean(this.#resumeHandle) } });
      } catch (error) {
        if (!this.#closedByUser) await this.#scheduleReconnect("retry_after_failure", true);
      }
    }, delay);
  }

  async #fetchVoiceToken({ resumeHandle, sessionId }) {
    if (typeof this.#fetch !== "function") throw voiceError("VOICE_TOKEN_FAILED", "Voice token endpoint is unavailable.");
    const accessToken = localStorage.getItem(AUTH_KEY);
    const headers = { "Content-Type": "application/json" };
    if (accessToken) headers.Authorization = "Bearer " + accessToken;
    let response;
    try {
      response = await this.#fetch("/api/voice-token", {
        method: "POST",
        headers,
        body: JSON.stringify({
          sessionId: sessionId || undefined,
          resumeHandle: resumeHandle || undefined,
        }),
      });
    } catch {
      throw voiceError("VOICE_TOKEN_FAILED", "Voice authentication could not be reached.");
    }
    if (response.status === 401) {
      const supplied = window.prompt("Enter your JUNI-AI access code:");
      if (supplied?.trim()) {
        localStorage.setItem(AUTH_KEY, supplied.trim());
        headers.Authorization = "Bearer " + supplied.trim();
        response = await this.#fetch("/api/voice-token", {
          method: "POST",
          headers,
          body: JSON.stringify({ sessionId: sessionId || undefined, resumeHandle: resumeHandle || undefined }),
        });
      }
    }
    if (!response.ok) {
      let message = "Realtime voice token could not be created.";
      try {
        const body = await response.json();
        if (body?.code === "VOICE_FEATURE_DISABLED") throw voiceError("VOICE_FEATURE_DISABLED", body.error || "Realtime voice is disabled.");
        if (body?.code === "VOICE_MODEL_UNSUPPORTED") throw voiceError("VOICE_MODEL_UNSUPPORTED", body.error || "Configured Live model is unsupported.");
        if (typeof body?.error === "string") message = body.error;
      } catch (error) {
        if (error?.code) throw error;
      }
      throw voiceError(response.status === 503 ? "VOICE_TOKEN_FAILED" : "VOICE_TOKEN_FAILED", sanitizeText(message));
    }
    const data = await response.json();
    if (!data?.token || !data?.sessionId || !data?.model) throw voiceError("VOICE_TOKEN_FAILED", "Voice token response was incomplete.");
    return data;
  }

  #tokenExpired() {
    return !this.#tokenExpiresAt || Date.now() >= this.#tokenExpiresAt - 5000;
  }

  async #recordSession(event) {
    if (!this.#sessionId || this.#closedByUser && event.kind === "voice_token_requested") return;
    const accessToken = localStorage.getItem(AUTH_KEY);
    const headers = { "Content-Type": "application/json" };
    if (accessToken) headers.Authorization = "Bearer " + accessToken;
    try {
      await this.#fetch("/api/voice-session", {
        method: "POST",
        headers,
        body: JSON.stringify({
          sessionId: this.#sessionId,
          kind: event.kind,
          status: event.status,
          connected: event.connected,
          reconnectIncrement: event.reconnectIncrement,
          interruptionIncrement: event.interruptionIncrement,
          toolCallIncrement: event.toolCallIncrement,
          inputBytes: event.inputBytes,
          outputBytes: event.outputBytes,
          endedAt: event.endedAt,
          closeReason: event.closeReason,
          errorCode: event.errorCode,
          toolName: event.toolName,
          metadata: event.metadata,
        }),
        keepalive: true,
      });
    } catch {
      // Observability must not break voice interaction.
    }
  }

  #scheduleSessionDeadline() {
    this.#clearSessionDeadline();
    const minutes = Number(this.#config?.maxSessionMinutes ?? 30);
    this.#sessionDeadlineTimer = setTimeout(() => {
      this.stop("session_lifetime_limit");
    }, Math.max(1, minutes) * 60_000);
  }

  #clearSessionDeadline() {
    if (this.#sessionDeadlineTimer) clearTimeout(this.#sessionDeadlineTimer);
    this.#sessionDeadlineTimer = null;
  }

  async #fail(code, message) {
    this.#onError({ code, message });
    this.#onEvent({ type: "voice.session.failed", sessionId: this.#sessionId, code });
    await this.#recordSession({
      kind: "voice_session_failed",
      status: "error",
      errorCode: code,
      inputBytes: this.#machine?.counters.inputBytes ?? 0,
      outputBytes: this.#machine?.counters.outputBytes ?? 0,
      metadata: {
        message: sanitizeText(message),
        reconnectCount: this.#machine?.counters.reconnectCount ?? 0,
        interruptionCount: this.#machine?.counters.interruptionCount ?? 0,
      },
    });
    this.#safeTransition("error", { code });
    try { await this.#audioInput?.stop(); } catch {}
    try { this.#socket?.close(); } catch {}
    this.#socket = null;
    try { this.#audioOutput?.clear(); } catch {}
  }

  #setState(next, metadata) {
    if (this.#machine.state === next) return;
    try {
      this.#machine.transition(next, metadata);
    } catch {
      return;
    }
    this.#emitState();
    this.#syncUi();
  }

  #safeTransition(next, metadata) {
    if (this.#machine && this.#machine.state !== next) {
      try { this.#machine.transition(next, metadata); } catch {}
      this.#emitState();
      this.#syncUi();
    }
  }

  #emitState() {
    this.#onState({ state: this.state, sessionId: this.#machine?.sessionId ?? this.#sessionId, counters: this.#machine?.counters ?? {} });
    this.#syncUi();
  }

  #syncUi() {
    const state = this.state;
    const labelMap = {
      idle: "Ready",
      requesting_permission: "Microphone permission…",
      connecting: "Connecting…",
      listening: "Listening",
      speaking: "Juni is speaking",
      interrupted: "Interrupted — listening",
      reconnecting: "Reconnecting…",
      error: "Voice error",
      closing: "Stopping…",
      closed: "Voice stopped",
    };
    if (this.#elements.stateLabel) this.#elements.stateLabel.textContent = labelMap[state] || state;
    if (this.#elements.startButton) {
      const active = !["idle", "closed", "error"].includes(state);
      this.#elements.startButton.disabled = active;
      this.#elements.startButton.textContent = active ? "Voice active" : "Start voice";
    }
    if (this.#elements.stopButton) this.#elements.stopButton.disabled = ["idle", "closed"].includes(state);
    if (this.#elements.retryButton) this.#elements.retryButton.hidden = state !== "error";
    if (this.#elements.connectionDot) this.#elements.connectionDot.dataset.state = state;
    if (this.#elements.voicePanel) this.#elements.voicePanel.dataset.state = state;
  }

  #clearReconnect() {
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
  }
}

function toBase64(bytes) {
  let binary = "";
  const step = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += step) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + step));
  }
  return btoa(binary);
}

function decodedByteLength(base64) {
  try { return atob(String(base64)).length; } catch { return 0; }
}

function sanitizeToolResult(value) {
  if (!value || typeof value !== "object") return { status: "ok" };
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|key|password|credential|audio|pcm|system/i.test(key)) continue;
    if (item == null || ["string", "number", "boolean"].includes(typeof item)) result[key] = item;
  }
  return result;
}

function sanitizeText(value) {
  const text = String(value ?? "Voice request failed.");
  return text.length > 240 ? text.slice(0, 240) + "…" : text;
}

function voiceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
