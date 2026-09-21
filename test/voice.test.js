import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { loadConfig } from "../core/config.js";
import {
  VOICE_STATES,
  VoiceSessionController,
  assertVoiceTransition,
  canTransitionVoiceState,
} from "../core/voice.js";
import { EventBus } from "../core/events.js";
import { createJuniMemoryApplication } from "../memory/app.js";
import { createGeminiLiveProvider, voiceLiveConfig, GEMINI_LIVE_WS_ENDPOINT } from "../providers/gemini-live.js";
import { parseLiveServerMessage, buildSetupMessage, buildAudioInputMessage, buildToolResponseMessage } from "../voice/protocol.js";
import { StreamingPcm16Resampler, floatToPcm16 } from "../voice/audio-resampler.js";
import { VoiceAudioOutput, decodeBase64, pcm16ToFloat32, parseAudioRate } from "../voice/audio-output.js";
import { validateWebsiteUrl, executeVoiceTool, VOICE_TOOL_DECLARATIONS } from "../voice/tools.js";
import { VoiceClient } from "../voice/client.js";

const openedApplications = [];
const originalLocalStorage = globalThis.localStorage;

function testConfig(extra = {}) {
  return loadConfig({
    JUNI_FEATURE_VOICE: "true",
    JUNI_API_TOKEN: "test-access",
    GEMINI_API_KEY: "server-only-gemini-key",
    GEMINI_LIVE_MODEL: "gemini-3.8-live",
    JUNI_DATABASE_URL: "file:/tmp/juni-step4-" + randomUUID() + ".db",
    JUNI_STORAGE_BUDGET_BYTES: String(extra.quotaBytes ?? 32 * 1024 * 1024),
    JUNI_VOICE_CAPTIONS_ENABLED: "true",
    JUNI_VOICE_AUDIO_CHUNK_MS: "60",
    JUNI_VOICE_OUTPUT_BUFFER_LIMIT_MS: "1200",
    JUNI_VOICE_MAX_RECONNECT_ATTEMPTS: "2",
    JUNI_VOICE_RECONNECT_BASE_MS: "1",
    JUNI_VOICE_TOKEN_TTL_SECONDS: "1800",
    JUNI_VOICE_NEW_SESSION_TTL_SECONDS: "60",
    ...extra,
  });
}

test.afterEach(async () => {
  globalThis.localStorage = originalLocalStorage;
  while (openedApplications.length) {
    const app = openedApplications.pop();
    try { await app.db.client.close?.(); } catch {}
  }
});

test("voice state machine accepts legal transitions and rejects illegal ones", () => {
  for (const state of VOICE_STATES) assert.equal(typeof state, "string");
  assert.equal(canTransitionVoiceState("idle", "requesting_permission"), true);
  assert.equal(canTransitionVoiceState("requesting_permission", "connecting"), true);
  assert.equal(canTransitionVoiceState("connecting", "listening"), true);
  assert.equal(canTransitionVoiceState("listening", "speaking"), true);
  assert.equal(canTransitionVoiceState("speaking", "interrupted"), true);
  assert.equal(canTransitionVoiceState("interrupted", "listening"), true);
  assert.equal(canTransitionVoiceState("listening", "reconnecting"), true);
  assert.equal(canTransitionVoiceState("reconnecting", "listening"), true);
  assert.equal(canTransitionVoiceState("closing", "closed"), true);
  assert.throws(() => assertVoiceTransition("idle", "speaking"), /Illegal voice state transition/);
});

test("core voice session controller preserves its existing provider-neutral contract", async () => {
  const events = [];
  const session = {
    sendText() {}, sendAudio() {}, sendVideo() {}, interrupt() {}, sendToolResponse() {}, reconnect() {}, async close() {},
  };
  const controller = new VoiceSessionController({
    sessionFactory: async ({ sessionId }) => ({ ...session, sessionId }),
    onEvent: (event) => events.push(event),
  });
  controller.startPermission();
  await controller.connect();
  assert.equal(controller.state, "listening");
  controller.markSpeaking();
  assert.equal(controller.state, "speaking");
  controller.markInterrupted();
  assert.equal(controller.state, "interrupted");
  await controller.close();
  assert.equal(controller.state, "closed");
  assert.ok(events.some((event) => event.type === "voice.session.connected"));
});

test("PCM conversion clips safely and streaming resampling targets 16 kHz chunks", () => {
  assert.equal(floatToPcm16(2), 32767);
  assert.equal(floatToPcm16(-2), -32768);
  assert.equal(floatToPcm16(0), 0);

  const resampler = new StreamingPcm16Resampler({ inputRate: 48_000, outputRate: 16_000, chunkMs: 20 });
  const silence = new Float32Array(4_800);
  const chunks = resampler.push(silence);
  assert.ok(chunks.length >= 4);
  assert.ok(chunks.every((buffer) => buffer.byteLength === 640));
  const flush = resampler.flush();
  if (flush) assert.ok(flush.byteLength <= 640);

  const loud = new Float32Array([2, -2, 0, Number.NaN, Number.POSITIVE_INFINITY]);
  const clipped = [...new Int16Array(new StreamingPcm16Resampler({ inputRate: 16_000, outputRate: 16_000, chunkMs: 20 }).push(loud)[0] ?? new ArrayBuffer(0))];
  assert.ok(clipped.every(Number.isFinite));
});

test("Live protocol emits normalized audio/transcription/tool/interruption/resumption events and tolerates unknown fields", () => {
  const message = {
    serverContent: {
      modelTurn: {
        parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: "AAECAwQ=" } }],
      },
      inputTranscription: { text: "hello" },
      interimInputTranscription: { text: "hel" },
      outputTranscription: { text: "hi" },
      generationComplete: true,
      turnComplete: true,
      interrupted: true,
      waitingForInput: true,
      interactionStatus: "IN_PROGRESS",
      unknownField: { hello: "world" },
    },
    toolCall: { functionCalls: [{ id: "call-1", name: "getCurrentTime", args: {} }] },
    toolCallCancellation: { ids: ["call-1"] },
    sessionResumptionUpdate: { newHandle: "resume-1", resumable: true },
    goAway: { timeLeft: "10s" },
  };
  const events = parseLiveServerMessage(message);
  assert.ok(events.some((event) => event.type === "audio"));
  assert.ok(events.some((event) => event.type === "inputTranscription"));
  assert.ok(events.some((event) => event.type === "interimInputTranscription"));
  assert.ok(events.some((event) => event.type === "outputTranscription"));
  assert.ok(events.some((event) => event.type === "generationComplete"));
  assert.ok(events.some((event) => event.type === "turnComplete"));
  assert.ok(events.some((event) => event.type === "interrupted"));
  assert.ok(events.some((event) => event.type === "waitingForInput"));
  assert.ok(events.some((event) => event.type === "interactionStatus"));
  assert.ok(events.some((event) => event.type === "toolCall"));
  assert.ok(events.some((event) => event.type === "toolCallCancellation"));
  assert.ok(events.some((event) => event.type === "sessionResumptionUpdate"));
  assert.ok(events.some((event) => event.type === "goAway"));
  assert.ok(parseLiveServerMessage({ futureServerField: { anything: true } }).some((event) => event.type === "unknown"));
  assert.equal(parseLiveServerMessage("not-json")[0].type, "protocol.error");
});

test("Live setup contract is audio-only with resumption, compression, captions, and allowlisted tools", () => {
  const setup = buildSetupMessage({
    model: "gemini-3.8-live",
    includeTranscriptions: true,
    resumptionHandle: "resume-1",
    tools: VOICE_TOOL_DECLARATIONS,
  });
  assert.deepEqual(setup.setup.responseModalities, ["AUDIO"]);
  assert.equal(setup.setup.model, "models/gemini-3.8-live");
  assert.deepEqual(setup.setup.sessionResumption, { handle: "resume-1" });
  assert.deepEqual(setup.setup.contextWindowCompression, { slidingWindow: {} });
  assert.equal(setup.setup.inputAudioTranscription !== undefined, true);
  assert.equal(setup.setup.outputAudioTranscription !== undefined, true);
  assert.deepEqual(buildAudioInputMessage("AQI=").realtimeInput.audio, {
    data: "AQI=",
    mimeType: "audio/pcm;rate=16000",
  });
  assert.deepEqual(buildToolResponseMessage([{ id: "1", name: "getCurrentTime", response: { result: { status: "ok" } } }]), {
    toolResponse: { functionResponses: [{ id: "1", name: "getCurrentTime", response: { result: { status: "ok" } } }] },
  });
  assert.equal(voiceLiveConfig({ identity: "Juni", toolDeclarations: VOICE_TOOL_DECLARATIONS }).responseModalities[0], "AUDIO");
  assert.equal(GEMINI_LIVE_WS_ENDPOINT.includes("BidiGenerateContentConstrained"), true);
});

test("audio output decodes little-endian PCM16 and parses the expected 24 kHz format", () => {
  const raw = new Uint8Array([0x00,0x80,0xff,0x7f]);
  const base64 = Buffer.from(raw).toString("base64");
  assert.deepEqual([...decodeBase64(base64)], [...raw]);
  const floats = pcm16ToFloat32(raw);
  assert.equal(floats.length, 2);
  assert.equal(floats[0], -1);
  assert.ok(floats[1] > 0.99);
  assert.equal(parseAudioRate("audio/pcm;rate=24000"), 24000);
});

class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.state = "running";
    this.destination = {};
    this.startedSources = [];
  }
  createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
  createAnalyser() { return { fftSize: 256, connect() {}, disconnect() {}, getByteTimeDomainData(data) { data.fill(128); } }; }
  createBuffer(_channels, length, sampleRate) {
    return {
      duration: length / sampleRate,
      getChannelData() { return new Float32Array(length); },
    };
  }
  createBufferSource() {
    const source = {
      startTime: null,
      stopped: false,
      connect() {},
      disconnect() {},
      start: (time) => { source.startTime = time; this.startedSources.push(source); },
      stop: () => { source.stopped = true; },
      addEventListener(_type, _fn) {},
    };
    return source;
  }
  async resume() { this.state = "running"; }
  async close() { this.state = "closed"; }
}

test("audio output schedules a queue and clears interrupted/stale audio", async () => {
  const context = new FakeAudioContext();
  const output = new VoiceAudioOutput({ maxBufferedMs: 100, audioContextFactory: () => context });
  const oneSecondPcm = new Uint8Array(48_000);
  const pending = output.playPcm24(oneSecondPcm, "audio/pcm;rate=24000");
  await new Promise((resolve) => setTimeout(resolve, 25));
  output.clear();
  const result = await pending;
  assert.equal(result.obsolete, true);
  await output.close();
  assert.equal(context.state, "closed");
});

test("voice tools reject arbitrary browser actions and unsafe URLs", async () => {
  await assert.rejects(() => executeVoiceTool("not-allowed", {}), (error) => error.code === "VOICE_TOOL_REJECTED");
  assert.equal((await executeVoiceTool("getCurrentTime")).status, "ok");
  assert.equal((await executeVoiceTool("openWebsite", { url: "https://example.com/path" })).status, "ready");
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,hello",
    "file:///etc/passwd",
    "https://user:pass@example.com",
    "http://localhost:3000",
    "http://127.0.0.1",
    "https://example.com:8080/",
  ]) {
    assert.throws(() => validateWebsiteUrl(url), /not allowed|allowed|Invalid|credentials/);
  }
});

test("Gemini Live provider locks model, AUDIO modality, identity, compression, resumption, and tools when creating an ephemeral token", async () => {
  let captured;
  const config = testConfig();
  const provider = createGeminiLiveProvider(config, {
    identity: "JUNI TEST IDENTITY",
    clientFactory: async () => ({
      models: {
        get: async ({ model }) => ({
          name: "models/" + model,
          supportedGenerationMethods: ["BIDI_GENERATE_CONTENT"],
        }),
      },
      authTokens: {
        create: async (params) => {
          captured = params;
          return {
            name: "auth_tokens/test-token",
            expireTime: new Date(Date.now() + 1_000_000).toISOString(),
            newSessionExpireTime: new Date(Date.now() + 50_000).toISOString(),
          };
        },
      },
    }),
  });

  const token = await provider.createEphemeralToken({ sessionId: "voice-session-test" });
  assert.equal(token.token, "auth_tokens/test-token");
  assert.equal(token.model, "gemini-3.8-live");
  assert.ok(token.expiresAt);
  assert.ok(token.newSessionExpiresAt);
  assert.equal(token.wsEndpoint, GEMINI_LIVE_WS_ENDPOINT);
  assert.equal(captured.config.uses, 1);
  assert.equal(captured.config.liveConnectConstraints.model, "gemini-3.8-live");
  assert.deepEqual(captured.config.liveConnectConstraints.config.responseModalities, ["AUDIO"]);
  assert.match(captured.config.liveConnectConstraints.config.systemInstruction.parts[0].text, /JUNI TEST IDENTITY/);
  assert.deepEqual(captured.config.liveConnectConstraints.config.contextWindowCompression, { slidingWindow: {} });
  assert.deepEqual(captured.config.liveConnectConstraints.config.sessionResumption, {});
  assert.ok(captured.config.liveConnectConstraints.config.tools[0].functionDeclarations.some((tool) => tool.name === "openWebsite"));
  assert.ok(captured.config.lockAdditionalFields.includes("responseModalities"));
  assert.ok(captured.config.lockAdditionalFields.includes("systemInstruction"));
  assert.ok(captured.config.lockAdditionalFields.includes("sessionResumption"));
  assert.ok(captured.config.lockAdditionalFields.includes("contextWindowCompression"));
  assert.ok(captured.config.lockAdditionalFields.includes("tools"));
  assert.equal(JSON.stringify(captured).includes("server-only-gemini-key"), false);
});

test("voice session metadata is scoped, auditable, and counts toward the existing 10 GiB budget", async () => {
  const config = testConfig();
  const memory = createJuniMemoryApplication({ config, events: new EventBus() });
  openedApplications.push(memory);
  await memory.ready();
  const scope = { tenantId: "tenant-a", userId: "user-a" };
  const before = await memory.quota.usage(scope);
  const created = await memory.voiceSessions.create(scope, {
    sessionId: randomUUID(),
    provider: "gemini",
    model: "gemini-3.8-live",
    retentionExpiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  await memory.voiceSessions.recordEvent(scope, created.id, { type: "voice_session_connected" }, { provider: "gemini", model: "gemini-3.8-live" });
  await memory.voiceSessions.recordEvent(scope, created.id, { type: "voice_reconnect_started" }, { provider: "gemini", model: "gemini-3.8-live" });
  await memory.voiceSessions.recordEvent(scope, created.id, { type: "voice_reconnect_completed", resumed: true }, { provider: "gemini", model: "gemini-3.8-live" });
  await memory.voiceSessions.recordEvent(scope, created.id, { type: "voice_session_interrupted" }, { provider: "gemini", model: "gemini-3.8-live" });
  await memory.voiceSessions.recordEvent(scope, created.id, { type: "voice_tool_call", toolName: "getCurrentTime" }, { provider: "gemini", model: "gemini-3.8-live" });
  const closed = await memory.voiceSessions.recordEvent(scope, created.id, {
    type: "voice_session_completed",
    reason: "user",
    durationMs: 1200,
    reconnectCount: 1,
    interruptionCount: 1,
    toolCallCount: 1,
    inputBytes: 1920,
    outputBytes: 48000,
  }, { provider: "gemini", model: "gemini-3.8-live" });

  assert.equal(closed.status, "completed");
  assert.equal(closed.reconnect_count, 1);
  assert.equal(closed.interruption_count, 1);
  assert.equal(closed.tool_call_count, 1);
  assert.equal((await memory.voiceSessions.get({ tenantId: "tenant-b", userId: "user-a" }, created.id)), null);
  const after = await memory.quota.usage(scope);
  assert.ok(after.categories.logs > before.categories.logs);
  assert.equal((await memory.inspection.verifyProvenance(scope)).valid, true);
});

test("voice token route enforces feature/auth/identity without trusting browser tenant headers", async () => {
  const { handleVoiceToken } = await import("../voice/token-route.js");
  const makeApp = (overrides = {}) => ({
    config: {
      voice: { enabled: true, captionsEnabled: false, maxSessionMinutes: 30, audioChunkMs: 60, outputBufferLimitMs: 1200, maxReconnectAttempts: 2, reconnectBaseMs: 500, ...overrides.voice },
      security: { apiToken: "test-access", allowedOrigin: "https://example.com", ...overrides.security },
      providers: { gemini: { liveModel: "gemini-3.8-live" } },
      retention: { logsDays: 30 },
    },
    memory: {
      async ready() {},
      voiceSessions: {
        async create(scope, input) { return { id: input.sessionId }; },
        async get() { return null; },
        async recordEvent() { return { status: "failed" }; },
      },
    },
    providers: {
      geminiLive: {
        async validateLiveModel() { return { resourceName: "gemini-3.8-live" }; },
        async createEphemeralToken() {
          return {
            token: "auth_tokens/test",
            model: "gemini-3.8-live",
            expiresAt: new Date(Date.now() + 60000).toISOString(),
            newSessionExpiresAt: new Date(Date.now() + 30000).toISOString(),
            wsEndpoint: "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained",
          };
        },
      },
    },
    events: { emit() {} },
    rateLimiter: { async check() { return { allowed: true, limit: 20, remaining: 19, retryAfter: 60 }; } },
  });

  const unauthorized = fakeResponse();
  await handleVoiceToken(
    { method: "POST", headers: { origin: "https://example.com", "x-tenant-id": "attacker", "x-user-id": "attacker" }, body: {} },
    unauthorized,
    makeApp(),
  );
  assert.equal(unauthorized.statusCode, 401);

  const disabled = fakeResponse();
  await handleVoiceToken(
    { method: "POST", headers: { origin: "https://example.com", authorization: "Bearer test-access", "x-tenant-id": "attacker", "x-user-id": "attacker" }, body: {} },
    disabled,
    makeApp({ voice: { enabled: false } }),
  );
  assert.equal(disabled.statusCode, 503);
  assert.equal(disabled.body.code, "VOICE_FEATURE_DISABLED");

  const valid = fakeResponse();
  const secureApp = makeApp();
  secureApp.config.voice.fixedTenantId = "tenant-a";
  secureApp.config.voice.fixedUserId = "user-a";
  await handleVoiceToken(
    { method: "POST", headers: { origin: "https://example.com", authorization: "Bearer test-access" }, body: { captions: true } },
    valid,
    secureApp,
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.model, "gemini-3.8-live");
  assert.equal(valid.body.token, "auth_tokens/test");
  assert.equal(valid.body.newSessionExpiresAt !== undefined, true);
  assert.equal(JSON.stringify(valid.body).includes("server-only-gemini-key"), false);

  const noIdentity = fakeResponse();
  await handleVoiceToken(
    { method: "POST", headers: { origin: "https://example.com", authorization: "Bearer test-access", "x-tenant-id": "attacker", "x-user-id": "attacker" }, body: {} },
    noIdentity,
    makeApp(),
  );
  assert.equal(noIdentity.statusCode, 503);
  assert.equal(noIdentity.body.code, "VOICE_IDENTITY_NOT_CONFIGURED");

});
 
test("voice browser source contains no Gemini API key access and remains audio-only by design", async () => {
  const clientSource = await readFile(new URL("../voice/client.js", import.meta.url), "utf8");
  const inputSource = await readFile(new URL("../voice/audio-input.js", import.meta.url), "utf8");
  assert.equal(clientSource.includes("GEMINI_API_KEY"), false);
  assert.equal(clientSource.includes("AIza"), false);
  assert.equal(inputSource.includes("getUserMedia({"), true);
  assert.match(inputSource, /video:\s*false/);

  const csp = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const security = csp.headers[0].headers;
  const permissions = security.find((header) => header.key === "Permissions-Policy").value;
  const policy = security.find((header) => header.key === "Content-Security-Policy").value;
  assert.match(permissions, /camera=\(\)/);
  assert.match(permissions, /microphone=\(self\)/);
  assert.match(policy, /connect-src 'self' wss:\/\/generativelanguage\.googleapis\.com/);
  assert.doesNotMatch(policy, /unsafe-(inline|eval)/);
  assert.doesNotMatch(policy, /connect-src[^;]*\*/);
});

test("VoiceClient uses ephemeral token, keeps it in memory, handles interruption, tool calls, resumption, GoAway, and bounded reconnect", async () => {
  let persisted = false;
  globalThis.localStorage = {
    getItem(key) {
      return key === "juni-ai-access-token-v1" ? "existing-juni-access" : null;
    },
    setItem() { persisted = true; throw new Error("Voice client must not persist tokens."); },
  };

  const tokens = [
    { token: "auth_tokens/one", model: "gemini-3.8-live", sessionId: "11111111-1111-4111-8111-111111111111", expiresAt: new Date(Date.now() + 60_000).toISOString(), newSessionExpiresAt: new Date(Date.now() + 60_000).toISOString(), wsEndpoint: GEMINI_LIVE_WS_ENDPOINT, captionsEnabled: true, audioChunkMs: 60, outputBufferLimitMs: 1200, maxReconnectAttempts: 2, reconnectBaseMs: 1, maxSessionMinutes: 30 },
    { token: "auth_tokens/two", model: "gemini-3.8-live", sessionId: "11111111-1111-4111-8111-111111111111", expiresAt: new Date(Date.now() + 60_000).toISOString(), newSessionExpiresAt: new Date(Date.now() + 60_000).toISOString(), wsEndpoint: GEMINI_LIVE_WS_ENDPOINT, captionsEnabled: true, audioChunkMs: 60, outputBufferLimitMs: 1200, maxReconnectAttempts: 2, reconnectBaseMs: 1, maxSessionMinutes: 30 },
  ];
  let tokenCalls = 0;
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    async json() { return tokens[Math.min(tokenCalls++, tokens.length - 1)]; },
  });

  const audioInput = {
    muted: false,
    async start() {},
    async close() {},
    async resume() {},
    setMuted(value) { this.muted = Boolean(value); },
    getLevel() { return 0.2; },
  };
  let clearCount = 0;
  const audioOutput = {
    async start() {},
    async close() {},
    clear() { clearCount += 1; },
    async playPcm24() { return { scheduled: true, bufferedMs: 20 }; },
    getLevel() { return 0.4; },
    setVolume(value) { this.volume = value; },
  };

  class MockWebSocket {
    static OPEN = 1;
    static CLOSED = 3;
    static instances = [];
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      this.listeners = new Map();
      MockWebSocket.instances.push(this);
      queueMicrotask(() => this.emit("open", {}));
    }
    addEventListener(type, listener) {
      const list = this.listeners.get(type) ?? [];
      list.push(listener);
      this.listeners.set(type, list);
    }
    send(value) {
      this.sent.push(value);
      const parsed = JSON.parse(value);
      if (parsed.setup) {
        queueMicrotask(() => this.message({ setupComplete: {} }));
      }
    }
    close() {
      this.readyState = MockWebSocket.CLOSED;
      queueMicrotask(() => this.emit("close", { code: 1000, reason: "server-reset" }));
    }
    message(payload) { this.emit("message", { data: JSON.stringify(payload) }); }
    emit(type, value) { for (const listener of this.listeners.get(type) ?? []) listener(value); }
  }

  const events = [];
  const client = new VoiceClient({
    fetchImpl: fakeFetch,
    webSocketImpl: MockWebSocket,
    audioInputFactory: () => audioInput,
    audioOutputFactory: () => audioOutput,
    onEvent: (event) => events.push(event),
    config: { reconnectBaseMs: 1, maxReconnects: 2, maxSessionMinutes: 1 },
  });

  await client.start({ captions: true });
  assert.equal(client.state, "listening");
  const first = MockWebSocket.instances[0];
  const setup = JSON.parse(first.sent[0]);
  assert.deepEqual(setup.setup.responseModalities, ["AUDIO"]);
  assert.equal(setup.setup.model, "models/gemini-3.8-live");
  assert.equal(new URL(first.url).searchParams.get("access_token"), "auth_tokens/one");
  assert.equal(persisted, false);

  first.message({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: "AQID" } }] } } });
  first.message({ serverContent: { interrupted: true } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(clearCount >= 1);
  assert.ok(events.some((event) => event.type === "voice.interrupted"));

  first.message({ sessionResumptionUpdate: { newHandle: "handle-1", resumable: true } });
  first.message({ toolCall: { functionCalls: [{ id: "tool-1", name: "getCurrentTime", args: {} }] } });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(first.sent.some((value) => JSON.parse(value).toolResponse));

  first.message({ goAway: { timeLeft: "1s" } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(MockWebSocket.instances.length >= 2);
  const second = MockWebSocket.instances.at(-1);
  const secondSetup = JSON.parse(second.sent[0]);
  assert.equal(secondSetup.setup.sessionResumption.handle, "handle-1");
  assert.ok(second.url.includes("access_token=auth_tokens%2Ftwo"));

  await client.stop();
  assert.equal(client.state, "closed");
});
 
function fakeResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return value; },
  };
}

function restoreEnv(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}


test("voice token endpoint requires bearer auth and never accepts browser tenant headers as identity", async () => {
  const previous = {
    feature: process.env.JUNI_FEATURE_VOICE,
    token: process.env.JUNI_API_TOKEN,
    db: process.env.JUNI_DATABASE_URL,
    tenant: process.env.JUNI_VOICE_DEFAULT_TENANT_ID,
    user: process.env.JUNI_VOICE_DEFAULT_USER_ID,
    gemini: process.env.GEMINI_API_KEY,
  };
  process.env.JUNI_FEATURE_VOICE = "true";
  process.env.JUNI_API_TOKEN = "test-access";
  process.env.JUNI_DATABASE_URL = "file:/tmp/juni-step4-endpoint-" + randomUUID() + ".db";
  process.env.JUNI_VOICE_DEFAULT_TENANT_ID = "";
  process.env.JUNI_VOICE_DEFAULT_USER_ID = "";
  delete process.env.GEMINI_API_KEY;
  try {
    const module = await import("../api/voice-token.js?auth-test=" + randomUUID());
    const unauthorized = fakeResponse();
    await module.default({ method: "POST", headers: { origin: "https://example.com" }, body: {} }, unauthorized);
    assert.equal(unauthorized.statusCode, 401);

    const noIdentity = fakeResponse();
    await module.default({
      method: "POST",
      headers: { origin: "https://example.com", authorization: "Bearer test-access", "x-tenant-id": "attacker", "x-user-id": "attacker" },
      body: {},
    }, noIdentity);
    assert.equal(noIdentity.statusCode, 503);
    assert.equal(noIdentity.body.code, "VOICE_IDENTITY_NOT_CONFIGURED");
  } finally {
    restoreEnv("JUNI_FEATURE_VOICE", previous.feature);
    restoreEnv("JUNI_API_TOKEN", previous.token);
    restoreEnv("JUNI_DATABASE_URL", previous.db);
    restoreEnv("JUNI_VOICE_DEFAULT_TENANT_ID", previous.tenant);
    restoreEnv("JUNI_VOICE_DEFAULT_USER_ID", previous.user);
    restoreEnv("GEMINI_API_KEY", previous.gemini);
  }
});
