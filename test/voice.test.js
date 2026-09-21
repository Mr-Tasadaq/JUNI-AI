import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  VOICE_STATES,
  VOICE_EVENTS,
  VoiceStateMachine,
  assertVoiceTransition,
  canTransition,
} from "../core/voice.js";
import { createGeminiLiveProvider } from "../providers/gemini-live.js";
import { createVoiceTokenHandler } from "../api/voice-token.js";
import { parseLiveMessage } from "../voice/protocol.js";
import { decodePcm16Base64 } from "../voice/audio-output.js";
import { resampleFloat32ToPcm16, chunkPcm16 } from "../voice/audio-input.js";
import { executeVoiceTool, listVoiceTools } from "../voice/tools.js";
import { VoiceClient } from "../voice/client.js";
import { JuniError, ProviderError } from "../core/errors.js";

const cleanup = [];
afterEach(async () => {
  while (cleanup.length) {
    const fn = cleanup.pop();
    try { await fn(); } catch {}
  }
});

function fakeConfig(overrides = {}) {
  return {
    providers: {
      gemini: {
        apiKey: "REAL_GEMINI_KEY_NEVER_IN_RESPONSE",
        liveModel: "gemini-3.8-live",
        enabled: true,
      },
    },
    voice: {
      enabled: true,
      tokenTtlSeconds: 1800,
      newSessionTtlSeconds: 60,
      maxSessionMinutes: 30,
      captionsEnabled: false,
      audioChunkMs: 40,
      outputBufferLimitMs: 4000,
      reconnectAttempts: 3,
      reconnectBaseDelayMs: 1,
      maxToolCallsPerTurn: 4,
      bargeInRmsThreshold: 0.08,
      bargeInHoldMs: 80,
      websocketUrl: "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained",
      allowedModels: ["gemini-3.8-live"],
    },
    security: { apiToken: "server-auth", allowedOrigin: "https://juni.example.com" },
    storage: { quotaBytes: 10 * 1024 * 1024 },
    routing: { availabilityWeight: 10, capabilityWeight: 8, priorityWeight: 3 },
    observability: { maxEventPayloadBytes: 8192 },
    retention: { researchDays: 30 },
    research: { allowIdentityHeaders: false, fixedTenantId: "tenant-test", fixedUserId: "user-test" },
    ...overrides,
  };
}

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; },
    setHeader(key, value) { this.headers[key] = value; },
    json(body) { this.body = body; return body; },
  };
}

test("voice state machine accepts legal realtime transitions and rejects impossible ones", () => {
  assert.deepEqual(
    VOICE_STATES,
    ["idle","requesting_permission","connecting","listening","speaking","interrupted","reconnecting","error","closing","closed"]
  );
  assert.ok(canTransition("idle", "requesting_permission"));
  assert.ok(canTransition("speaking", "interrupted"));
  assert.ok(canTransition("interrupted", "listening"));
  assert.ok(canTransition("reconnecting", "listening"));
  assert.throws(() => assertVoiceTransition("idle", "speaking"), /Illegal voice state transition/);

  const machine = new VoiceStateMachine({ sessionId: "voice-test" });
  assert.equal(machine.sessionId, "voice-test");
  machine.transition("connecting");
  machine.transition("listening");
  machine.transition("speaking");
  machine.transition("interrupted");
  machine.transition("listening");
  machine.transition("reconnecting");
  machine.transition("listening");
  assert.equal(machine.counters.reconnectCount, 1);
  assert.equal(machine.counters.interruptionCount, 1);
});

test("voice event taxonomy contains required lifecycle events", () => {
  for (const event of [
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
  ]) assert.ok(VOICE_EVENTS.includes(event));
});

test("Gemini Live provider rejects non-AUDIO modality and creates constrained ephemeral token", async () => {
  let authConfig = null;
  const sdkLoader = async () => ({
    GoogleGenAI: class {
      constructor() {
        this.models = {
          get: async ({ model }) => ({
            name: model,
            displayName: "Gemini Live",
            description: "Live API audio model",
          }),
        };
        this.authTokens = {
          create: async ({ config }) => {
            authConfig = config;
            return {
              name: "ephemeral-token-value",
              expireTime: config.expireTime,
              newSessionExpireTime: config.newSessionExpireTime,
            };
          },
        };
        this.live = { connect: async () => ({ close() {} }) };
      }
    },
  });

  const provider = createGeminiLiveProvider(fakeConfig(), { sdkLoader });
  await assert.rejects(
    () => provider.connect({ responseModalities: ["TEXT"] }),
    (error) => error.code === "VOICE_AUDIO_MODALITY_REQUIRED"
  );

  const token = await provider.createEphemeralToken({ sessionId: "s1" });
  assert.equal(token.token, "ephemeral-token-value");
  assert.equal(authConfig.uses, 1);
  assert.equal(authConfig.liveConnectConstraints.model, "gemini-3.8-live");
  assert.deepEqual(authConfig.liveConnectConstraints.config.responseModalities, ["AUDIO"]);
  assert.deepEqual(authConfig.liveConnectConstraints.config.contextWindowCompression, { slidingWindow: {} });
  assert.deepEqual(authConfig.liveConnectConstraints.config.sessionResumption, { transparent: true });
  assert.equal(authConfig.liveConnectConstraints.config.systemInstruction.includes("Juni"), true);
  assert.ok(authConfig.liveConnectConstraints.config.tools?.[0]?.functionDeclarations?.length >= 2);
  assert.equal("REAL_GEMINI_KEY_NEVER_IN_RESPONSE".includes(token.token), false);
});

test("voice token endpoint enforces feature/auth/origin boundaries and returns only minimum safe metadata", async () => {
  const session = [];
  const app = {
    config: fakeConfig(),
    memory: { ready: async () => {} },
    events: { emit() {} },
    voiceSessions: {
      start: async (_scope, data) => { session.push(["start", data]); },
      get: async () => null,
      record: async (_scope, id, event) => { session.push(["record", id, event]); },
    },
    providers: {
      geminiLive: {
        createEphemeralToken: async ({ model, sessionId, resumeHandle }) => ({
          token: "SHORT_LIVED_TOKEN",
          model,
          sessionId,
          resumeHandle,
          expiresAt: "2026-09-21T11:00:00Z",
          newSessionExpiresAt: "2026-09-21T10:35:00Z",
        }),
      },
    },
  };
  const allowRate = () => ({ allowed: true, limit: 10, remaining: 9, retryAfter: 60 });
  const handler = createVoiceTokenHandler({ getApplication: () => app, rateLimiter: allowRate });

  const deniedOrigin = await (async () => {
    const req = { method: "POST", headers: { origin: "https://evil.example", authorization: "Bearer server-auth" }, body: {} };
    const res = responseRecorder();
    await handler(req, res);
    return res;
  })();
  assert.equal(deniedOrigin.statusCode, 403);

  const deniedAuth = await (async () => {
    const req = { method: "POST", headers: { origin: "https://juni.example.com" }, body: {} };
    const res = responseRecorder();
    await handler(req, res);
    return res;
  })();
  assert.equal(deniedAuth.statusCode, 401);

  const res = responseRecorder();
  await handler({
    method: "POST",
    headers: { origin: "https://juni.example.com", authorization: "Bearer server-auth" },
    body: {},
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.token, "SHORT_LIVED_TOKEN");
  assert.equal(res.body.model, "gemini-3.8-live");
  assert.equal(JSON.stringify(res.body).includes("REAL_GEMINI_KEY"), false);
  assert.equal(res.body.apiKey, undefined);
  assert.ok(session.some(([kind]) => kind === "start"));
});

test("voice token endpoint returns a clean feature-disabled error", async () => {
  const app = { config: { ...fakeConfig(), voice: { ...fakeConfig().voice, enabled: false } } };
  const handler = createVoiceTokenHandler({
    getApplication: () => app,
    rateLimiter: () => ({ allowed: true, limit: 10, remaining: 9, retryAfter: 60 }),
  });
  const res = responseRecorder();
  await handler({
    method: "POST",
    headers: { origin: "https://juni.example.com", authorization: "Bearer server-auth" },
    body: {},
  }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "VOICE_FEATURE_DISABLED");
});

test("PCM input conversion clips correctly, resamples to 16 kHz, and chunks into realtime frames", () => {
  const clipped = resampleFloat32ToPcm16(new Float32Array([-2, -1, 0, 1, 2]), 16000, 16000);
  assert.deepEqual([...clipped], [-32768, -32768, 0, 32767, 32767]);

  const zero = resampleFloat32ToPcm16(new Float32Array(480), 48000, 16000);
  assert.equal(zero.length, 160);
  assert.equal(zero.every((value) => value === 0), true);

  const impulse = new Float32Array(480);
  impulse[0] = 1;
  const pcm = resampleFloat32ToPcm16(impulse, 48000, 16000);
  assert.equal(pcm.length, 160);
  assert.equal(pcm[0], 32767);

  const chunks = chunkPcm16(Int16Array.from({ length: 1600 }, (_, i) => i), 640);
  assert.deepEqual(chunks.map((chunk) => chunk.length), [640, 640, 320]);
});

test("PCM output decodes little-endian Int16 at 24 kHz", () => {
  const base64 = btoa(String.fromCharCode(0x01, 0x00, 0xff, 0x7f, 0x00, 0x80));
  const decoded = decodePcm16Base64(base64, "audio/pcm;rate=24000");
  assert.equal(decoded.sampleRate, 24000);
  assert.deepEqual([...decoded.samples], [1, 32767, -32768]);
  assert.throws(() => decodePcm16Base64(btoa("x"), "audio/pcm;rate=24000"), /Malformed PCM16/);
});

test("Live protocol parser handles audio, transcriptions, interruption, resumption, tool calls, GoAway, usage, and unknown fields", () => {
  const message = parseLiveMessage(JSON.stringify({
    serverContent: {
      modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: "AQIDBA==" } }] },
      inputTranscription: { text: "hello", finished: true },
      interimInputTranscription: { text: "hel" },
      outputTranscription: { text: "hi there", finished: true },
      generationComplete: true,
      turnComplete: true,
      interrupted: true,
    },
    sessionResumptionUpdate: { resumable: true, newHandle: "resume-handle", lastConsumedClientMessageIndex: "4" },
    goAway: { timeLeft: "1.5s" },
    usageMetadata: { promptTokenCount: 4, responseTokenCount: 6, totalTokenCount: 10 },
    toolCall: { functionCalls: [{ id: "call-1", name: "getCurrentTime", args: {} }] },
    extraFutureField: { ignored: true },
  }));
  const types = message.map((item) => item.type);
  assert.ok(types.includes("audio.output"));
  assert.ok(types.includes("transcription.input"));
  assert.ok(types.includes("transcription.input.interim"));
  assert.ok(types.includes("transcription.output"));
  assert.ok(types.includes("generation.complete"));
  assert.ok(types.includes("turn.complete"));
  assert.ok(types.includes("interrupted"));
  assert.ok(types.includes("session.resumption.update"));
  assert.ok(types.includes("go.away"));
  assert.ok(types.includes("usage"));
  assert.ok(types.includes("tool.call"));
});

test("malformed Live protocol messages normalize to safe protocol errors", () => {
  const parsed = parseLiveMessage("{bad");
  assert.equal(parsed[0].type, "protocol.error");
  const unknown = parseLiveMessage(JSON.stringify({ futureMessage: { x: 1 } }));
  assert.equal(unknown[0].type, "unknown");
});

test("voice tools allow only safe openWebsite/getCurrentTime and reject arbitrary calls", async () => {
  assert.equal(listVoiceTools().length, 2);
  const time = await executeVoiceTool("getCurrentTime", {});
  assert.equal(time.status, "ok");
  const opened = await executeVoiceTool("openWebsite", { url: "https://example.com" });
  assert.equal(opened.requiresUserClick, true);
  await assert.rejects(() => executeVoiceTool("openWebsite", { url: "javascript:alert(1)" }), (error) => error.code === "VOICE_TOOL_REJECTED");
  await assert.rejects(() => executeVoiceTool("openWebsite", { url: "https://user:pass@example.com" }), (error) => error.code === "VOICE_TOOL_REJECTED");
  await assert.rejects(() => executeVoiceTool("openWebsite", { url: "http://127.0.0.1" }), (error) => error.code === "VOICE_TOOL_REJECTED");
  await assert.rejects(() => executeVoiceTool("openWebsite", { url: "https://example.com:8443" }), (error) => error.code === "VOICE_TOOL_REJECTED");
  await assert.rejects(() => executeVoiceTool("unknownTool", {}), (error) => error.code === "VOICE_TOOL_REJECTED");
});

test("VoiceClient uses only ephemeral token in memory, sends AUDIO setup, handles interruption, and preserves resumption handle", async () => {
  const store = new Map([["juni-ai-access-token-v1", "SERVER_ACCESS"]]);
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  };
  globalThis.window = {
    addEventListener() {},
    open() {},
    prompt() { return null; },
  };
  globalThis.document = {
    visibilityState: "visible",
    addEventListener() {},
  };

  class FakeAudioInput {
    constructor(options) { this.options = options; this.running = false; }
    async start() { this.running = true; }
    async stop() { this.running = false; }
  }
  class FakeAudioOutput {
    constructor(options) { this.options = options; this.enqueued = []; this.cleared = 0; }
    async start() {}
    async enqueue(base64, mime) { this.enqueued.push({ base64, mime }); }
    clear() { this.cleared += 1; }
    async close() {}
    setVolume() {}
    async suspend() {}
    async resume() {}
  }

  const sockets = [];
  class FakeWebSocket {
    static OPEN = 1;
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.listeners = new Map();
      this.sent = [];
      sockets.push(this);
      queueMicrotask(() => {
        this.readyState = 1;
        this.emit("open", {});
      });
    }
    addEventListener(type, fn) {
      const list = this.listeners.get(type) ?? [];
      list.push(fn);
      this.listeners.set(type, list);
    }
    emit(type, event) {
      for (const fn of this.listeners.get(type) ?? []) fn(event);
    }
    send(payload) { this.sent.push(payload); }
    close() {
      this.readyState = 3;
      this.emit("close", { code: 1000, reason: "closed" });
    }
  }

  const sessionPosts = [];
  const fetchImpl = async (url, init) => {
    if (url === "/api/voice-token") {
      return new Response(JSON.stringify({
        sessionId: "server-session-1",
        token: "ephemeral-only",
        model: "gemini-3.8-live",
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        newSessionExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        maxSessionMinutes: 30,
        captionsEnabled: true,
        audioChunkMs: 40,
        outputBufferLimitMs: 4000,
        reconnectAttempts: 1,
        reconnectBaseDelayMs: 1,
        bargeInRmsThreshold: 0.08,
        bargeInHoldMs: 80,
        websocketUrl: DEFAULT_WS,
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url === "/api/voice-session") {
      sessionPosts.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    throw new Error("unexpected fetch");
  };

  const stateEvents = [];
  const clientErrors = [];
  const client = new VoiceClient({
    WebSocketImpl: FakeWebSocket,
    fetchImpl,
    audioInputFactory: (options) => new FakeAudioInput(options),
    audioOutputFactory: (options) => new FakeAudioOutput(options),
    onState: (event) => stateEvents.push(event),
    onError: (error) => clientErrors.push(error),
  });
  cleanup.push(() => client.stop("test_cleanup"));

  await client.start();
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(client.sessionId, "server-session-1", JSON.stringify(clientErrors));
  assert.equal(client.state, "listening");
  assert.equal(sockets.length, 1);
  assert.ok(sockets[0].url.includes("access_token=ephemeral-only"));
  assert.equal(store.get("juni-ai-access-token-v1"), "SERVER_ACCESS");
  assert.equal(JSON.stringify(store).includes("ephemeral-only"), false);

  const setup = JSON.parse(sockets[0].sent[0]);
  assert.deepEqual(setup.setup.generationConfig.responseModalities, ["AUDIO"]);
  assert.equal(setup.setup.model, "models/gemini-3.8-live");
  assert.ok(setup.setup.tools?.[0]?.functionDeclarations?.some((tool) => tool.name === "openWebsite"));

  sockets[0].emit("message", {
    data: JSON.stringify({
      sessionResumptionUpdate: { resumable: true, newHandle: "resume-123" },
      serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: "AQIDBA==" } }] } },
    }),
  });
  await new Promise((resolve) => setTimeout(resolve, 5));

  sockets[0].emit("message", {
    data: JSON.stringify({ serverContent: { interrupted: true } }),
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(client.state, "listening", JSON.stringify(clientErrors));
  assert.ok(stateEvents.some((item) => item.state === "listening"));
  assert.ok(sessionPosts.some((item) => item.kind === "voice_interrupted"));
});

test("VoiceClient reconnects with bounded attempts and latest resumption handle", async () => {
  const store = new Map([["juni-ai-access-token-v1", "SERVER_ACCESS"]]);
  globalThis.localStorage = { getItem: (key) => store.get(key) ?? null };
  globalThis.window = { addEventListener() {}, prompt() { return null; } };
  globalThis.document = { visibilityState: "visible", addEventListener() {} };

  class FakeAudioInput { async start() {} async stop() {} }
  class FakeAudioOutput { async start() {} async close() {} async suspend() {} async resume() {} enqueue() {} clear() {} setVolume() {} }

  const sockets = [];
  class FakeWebSocket {
    constructor(url) {
      this.url = url; this.readyState = 0; this.listeners = new Map(); this.sent = []; sockets.push(this);
      queueMicrotask(() => { this.readyState = 1; this.emit("open", {}); });
    }
    addEventListener(type, fn) { const list=this.listeners.get(type)??[]; list.push(fn); this.listeners.set(type,list); }
    emit(type, event) { for (const fn of this.listeners.get(type)??[]) fn(event); }
    send(value) { this.sent.push(value); }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.emit("close", { code: 1011, reason: "go away" }); }
  }

  let tokenCalls = 0;
  const fetchImpl = async (url, init) => {
    if (url === "/api/voice-token") {
      tokenCalls += 1;
      const body = JSON.parse(init.body);
      return new Response(JSON.stringify({
        sessionId: "resume-session",
        token: "token-" + tokenCalls,
        model: "gemini-3.8-live",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        newSessionExpiresAt: new Date(Date.now() + 30_000).toISOString(),
        maxSessionMinutes: 30,
        captionsEnabled: false,
        audioChunkMs: 40,
        outputBufferLimitMs: 4000,
        reconnectAttempts: 1,
        reconnectBaseDelayMs: 1,
        bargeInRmsThreshold: 0.08,
        bargeInHoldMs: 80,
        websocketUrl: DEFAULT_WS,
        observedResumeHandle: body.resumeHandle ?? null,
      }), { status: 200 });
    }
    if (url === "/api/voice-session") return new Response(JSON.stringify({ ok: true }), { status: 200 });
    throw new Error("unexpected fetch");
  };

  const client = new VoiceClient({
    WebSocketImpl: FakeWebSocket, fetchImpl,
    audioInputFactory: () => new FakeAudioInput(),
    audioOutputFactory: () => new FakeAudioOutput(),
  });
  cleanup.push(() => client.stop("test_cleanup"));
  await client.start();
  await new Promise((resolve) => setTimeout(resolve, 5));
  sockets[0].emit("message", { data: JSON.stringify({ sessionResumptionUpdate: { resumable: true, newHandle: "resume-handle-1" } }) });
  sockets[0].emit("close", { code: 1001, reason: "go away" });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.ok(sockets.length >= 2);
  assert.equal(tokenCalls, 1, "current ephemeral token should be reused before its expiry");
  const setup = JSON.parse(sockets[1].sent[0]);
  assert.equal(setup.setup.sessionResumption.handle, "resume-handle-1");
});

test("VoiceClient maps token expiration and reconnect exhaustion to final error", async () => {
  const store = new Map([["juni-ai-access-token-v1", "SERVER_ACCESS"]]);
  globalThis.localStorage = { getItem: (key) => store.get(key) ?? null };
  globalThis.window = { addEventListener() {}, prompt() { return null; } };
  globalThis.document = { visibilityState: "visible", addEventListener() {} };

  class FakeAudioInput { async start() {} async stop() {} }
  class FakeAudioOutput { async start() {} async close() {} async suspend() {} async resume() {} enqueue() {} clear() {} setVolume() {} }
  class FailWebSocket {
    constructor() { this.readyState = 0; this.listeners = new Map(); queueMicrotask(() => { for (const fn of this.listeners.get("open")??[]) fn({}); }); }
    addEventListener(type, fn) { const list=this.listeners.get(type)??[]; list.push(fn); this.listeners.set(type,list); }
    send() {}
    close() {}
  }
  const errors=[];
  const fetchImpl=async(url)=> url==="/api/voice-token"
    ? new Response(JSON.stringify({
      sessionId:"s",token:"t",model:"gemini-3.8-live",
      expiresAt:new Date(Date.now()-1000).toISOString(),
      newSessionExpiresAt:new Date(Date.now()+1000).toISOString(),
      maxSessionMinutes:1,captionsEnabled:false,audioChunkMs:40,outputBufferLimitMs:1000,reconnectAttempts:0,reconnectBaseDelayMs:1,
      websocketUrl:DEFAULT_WS,
    }),{status:200})
    : new Response(JSON.stringify({ok:true}),{status:200});
  const client=new VoiceClient({
    WebSocketImpl:FailWebSocket,fetchImpl,
    audioInputFactory:()=>new FakeAudioInput(),audioOutputFactory:()=>new FakeAudioOutput(),
    onError:(error)=>errors.push(error),
  });
  await client.start();
  assert.equal(client.state,"error");
  assert.ok(errors.some((error)=>error.code==="VOICE_CONNECTION_FAILED"||error.code==="VOICE_TOKEN_FAILED"));
});

test("Step 4 keeps camera out of microphone request and browser client source contains no Gemini API key literal", async () => {
  const inputSource = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../voice/audio-input.js", import.meta.url), "utf8"));
  const clientSource = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../voice/client.js", import.meta.url), "utf8"));
  assert.match(inputSource, /video:\s*false/);
  assert.equal(/GEMINI_API_KEY/.test(clientSource), false);
});
