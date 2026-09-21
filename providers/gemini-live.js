import { buildSystemIdentity } from "../core/identity.js";
import { ProviderError } from "../core/errors.js";
import { requireApiKey } from "./base.js";
import { VOICE_TOOL_DECLARATIONS } from "../voice/tools.js";

async function asyncLoadGeminiLive() {
  const module = await import("@google/genai");
  return { GoogleGenAI: module.GoogleGenAI, Modality: module.Modality };
}

function requireGeminiProvider(config) {
  const providerConfig = config.providers.gemini;
  if (!providerConfig?.enabled) throw voiceError("VOICE_PROVIDER_DISABLED", "Gemini voice provider is disabled.");
  requireApiKey("gemini", providerConfig.apiKey);
  return providerConfig;
}

export const GEMINI_LIVE_WS_ENDPOINT =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";

export function voiceLiveConfig({ identity, toolDeclarations = [], captionsEnabled = false, resumptionHandle = null } = {}) {
  return {
    responseModalities: ["AUDIO"],
    systemInstruction: {
      parts: [{ text: String(identity ?? buildSystemIdentity("Use audio-first conversational behavior.")) }],
    },
    sessionResumption: resumptionHandle ? { handle: resumptionHandle } : {},
    contextWindowCompression: { slidingWindow: {} },
    tools: toolDeclarations.length ? [{ functionDeclarations: toolDeclarations }] : [],
    ...(captionsEnabled ? { inputAudioTranscription: {}, outputAudioTranscription: {} } : {}),
  };
}

export function createGeminiLiveProvider(config, { identity = buildSystemIdentity(), clientFactory = null } = {}) {
  const providerConfig = config.providers.gemini;
  let clientPromise = null;
  let validatedCache = new Map();

  async function getClient() {
    if (!clientPromise) {
      clientPromise = (async () => {
        if (typeof clientFactory === "function") {
          return clientFactory({ apiKey: providerConfig.apiKey, apiVersion: config.voice.liveApiVersion });
        }
        const { GoogleGenAI } = await asyncLoadGeminiLive();
        return new GoogleGenAI({ apiKey: providerConfig.apiKey, httpOptions: { apiVersion: config.voice.liveApiVersion } });
      })();
    }
    return clientPromise;
  }

  const provider = {
    name: "gemini-live",
    defaultModel: providerConfig.liveModel,

    capabilities() {
      return ["audioInput", "audioOutput", "streaming", "toolCalling", "liveVoice"];
    },

    async validateLiveModel({ model = providerConfig.liveModel, forceRefresh = false } = {}) {
      requireGeminiProvider(config);
      if (!model || typeof model !== "string") throw voiceError("VOICE_MODEL_UNSUPPORTED", "A Gemini Live model is required.");
      const cached = validatedCache.get(model);
      if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.value;

      const client = await getClient();
      let info;
      try {
        info = await client.models.get({ model });
      } catch (error) {
        throw new ProviderError("Configured Gemini Live model could not be validated.", {
          provider: "gemini", code: "VOICE_MODEL_UNSUPPORTED", retryable: false, cause: error,
        });
      }
      const resourceName = String(info?.name ?? "").replace(/^models\//, "");
      const supportedActions = Array.isArray(info?.supportedActions) ? info.supportedActions.map(String) : [];
      const supportedGenerationMethods = Array.isArray(info?.supportedGenerationMethods)
        ? info.supportedGenerationMethods.map(String)
        : [];
      const hasLiveSignal = /(^|[-_.])live($|[-_.])/i.test(resourceName || model)
        || supportedActions.some((action) => /bidi.*generate|live/i.test(action))
        || supportedGenerationMethods.some((method) => /bidi.*generate|live/i.test(method));
      if (!hasLiveSignal) throw voiceError("VOICE_MODEL_UNSUPPORTED", "Configured Gemini model is not advertised as a Live model.");

      const value = Object.freeze({
        model,
        resourceName: resourceName || model,
        supportedActions,
        supportedGenerationMethods,
        liveValidatedAt: new Date().toISOString(),
      });
      validatedCache.set(model, { value, expiresAt: Date.now() + 300_000 });
      return value;
    },

    async createEphemeralToken({ model = providerConfig.liveModel, captionsEnabled = config.voice.captionsEnabled, sessionId = null, resumptionHandle = null } = {}) {
      requireGeminiProvider(config);
      const validation = await provider.validateLiveModel({ model });
      const client = await getClient();
      const now = Date.now();
      const expireTime = new Date(now + config.voice.tokenTtlSeconds * 1000).toISOString();
      const newSessionExpireTime = new Date(now + config.voice.newSessionTtlSeconds * 1000).toISOString();
      const liveConfig = voiceLiveConfig({
        identity,
        toolDeclarations: VOICE_TOOL_DECLARATIONS,
        captionsEnabled,
        resumptionHandle: safeResumptionHandle(resumptionHandle),
      });
      try {
        const response = await client.authTokens.create({
          config: {
            uses: 1,
            expireTime,
            newSessionExpireTime,
            liveConnectConstraints: {
              model: validation.resourceName,
              config: liveConfig,
            },
            lockAdditionalFields: [
              "model",
              "responseModalities",
              "systemInstruction",
              "sessionResumption",
              "contextWindowCompression",
              "tools",
              ...(captionsEnabled ? ["inputAudioTranscription", "outputAudioTranscription"] : []),
            ],
          },
        });
        if (!response?.name) throw voiceError("VOICE_TOKEN_FAILED", "Gemini returned no ephemeral token.");
        return {
          token: response.name,
          model: validation.resourceName,
          expiresAt: response.expireTime ?? expireTime,
          newSessionExpiresAt: response.newSessionExpireTime ?? newSessionExpireTime,
          sessionId,
          wsEndpoint: GEMINI_LIVE_WS_ENDPOINT,
        };
      } catch (error) {
        if (error?.code === "VOICE_MODEL_UNSUPPORTED") throw error;
        throw new ProviderError("Gemini ephemeral voice token could not be created.", {
          provider: "gemini",
          code: error?.code || "VOICE_TOKEN_FAILED",
          retryable: error?.status === 408 || error?.status === 429 || (error?.status >= 500),
          cause: error,
        });
      }
    },

    async connect(options = {}) {
      requireGeminiProvider(config);
      const client = await getClient();
      const validation = await provider.validateLiveModel({ model: options.model || provider.defaultModel });
      const model = validation.model;
      const liveConfig = voiceLiveConfig({ identity, toolDeclarations: options.toolDeclarations ?? [], captionsEnabled: options.captionsEnabled ?? false, resumptionHandle: options.resumptionHandle ?? null });

      try {
        const session = await client.live.connect({
          model,
          config: liveConfig,
          callbacks: options.callbacks,
        });

        return {
          provider: "gemini",
          model,
          sessionId: options.sessionId ?? null,
          sendText(text) { session.sendRealtimeInput({ text }); },
          sendAudio(data, mimeType = "audio/pcm;rate=16000") {
            session.sendRealtimeInput({ audio: { data: Buffer.isBuffer(data) ? data.toString("base64") : data, mimeType } });
          },
          sendVideo(data, mimeType = "image/jpeg") {
            session.sendRealtimeInput({ video: { data: Buffer.isBuffer(data) ? data.toString("base64") : data, mimeType } });
          },
          interrupt() { session.sendRealtimeInput({ activityEnd: {} }); },
          sendToolResponse(functionResponses) { session.sendToolResponse({ functionResponses }); },
          reconnect() { throw new ProviderError("Gemini Live reconnect must create a new session.", { provider: "gemini", code: "VOICE_RECONNECT_REQUIRES_FACTORY", retryable: true }); },
          close() { return session.close(); },
          raw: session,
        };
      } catch (error) {
        throw new ProviderError("Gemini Live session failed.", {
          provider: "gemini", code: error?.code || error?.name || "GEMINI_LIVE_ERROR", status: error?.status, retryable: true, cause: error,
        });
      }
    },
  };

  return provider;
}

function voiceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}


function safeResumptionHandle(handle) {
  if (handle == null || handle === "") return null;
  const value = String(handle);
  return value.length <= 4096 ? value : null;
}
