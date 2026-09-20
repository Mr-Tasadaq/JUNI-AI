async function asyncLoadGeminiLive() {
  const module = await import("@google/genai");
  return { GoogleGenAI: module.GoogleGenAI, Modality: module.Modality };
}
import { ProviderError } from "../core/errors.js";
import { requireApiKey } from "./base.js";

function asConfig(options = {}) {
  return {
    responseModalities: options.responseModalities ?? ["AUDIO"],
    systemInstruction: options.systemInstruction,
    tools: options.tools,
    inputAudioTranscription: options.inputAudioTranscription,
    outputAudioTranscription: options.outputAudioTranscription,
    realtimeInputConfig: options.realtimeInputConfig,
  };
}

export function createGeminiLiveProvider(config) {
  const providerConfig = config.providers.gemini;

  return {
    name: "gemini-live",
    defaultModel: providerConfig.liveModel,

    capabilities() {
      return ["audioInput", "audioOutput", "streaming", "toolCalling", "liveVoice"];
    },

    async connect(options = {}) {
      requireApiKey("gemini", providerConfig.apiKey);
      const { GoogleGenAI } = await asyncLoadGeminiLive();
      const client = new GoogleGenAI({ apiKey: providerConfig.apiKey });
      const model = options.model || providerConfig.liveModel;

      try {
        const session = await client.live.connect({
          model,
          config: asConfig(options),
          callbacks: options.callbacks,
        });

        return {
          provider: "gemini",
          model,
          sendText(text) {
            session.sendRealtimeInput({ text });
          },
          sendAudio(data, mimeType = "audio/pcm;rate=16000") {
            session.sendRealtimeInput({
              audio: {
                data: Buffer.isBuffer(data) ? data.toString("base64") : data,
                mimeType,
              },
            });
          },
          sendVideo(data, mimeType = "image/jpeg") {
            session.sendRealtimeInput({
              video: {
                data: Buffer.isBuffer(data) ? data.toString("base64") : data,
                mimeType,
              },
            });
          },
          interrupt() {
            session.sendRealtimeInput({ activityEnd: {} });
          },
          sendToolResponse(functionResponses) {
            session.sendToolResponse({ functionResponses });
          },
          reconnect() {
            throw new ProviderError("Gemini Live reconnect must create a new session.", {
              provider: "gemini",
              code: "VOICE_RECONNECT_REQUIRES_FACTORY",
              retryable: true,
            });
          },
          close() {
            return session.close();
          },
          raw: session,
        };
      } catch (error) {
        throw new ProviderError("Gemini Live session failed.", {
          provider: "gemini",
          code: error?.code || error?.name || "GEMINI_LIVE_ERROR",
          status: error?.status,
          retryable: true,
          cause: error,
        });
      }
    },
  };
}
