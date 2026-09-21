import { GoogleGenAI } from "@google/genai";

function required(value, name) {
  if (!value || !String(value).trim()) {
    const error = new Error(name + " is required.");
    error.code = "VOICE_CONFIGURATION_REQUIRED";
    throw error;
  }
  return String(value).trim();
}

export async function createGeminiEphemeralToken({
  apiKey,
  model,
  expireMinutes = 30,
  newSessionMinutes = 1,
  clientFactory = (key) => new GoogleGenAI({ apiKey: key }),
  now = Date.now(),
} = {}) {
  const key = required(apiKey, "Gemini API key");
  const liveModel = required(model, "Gemini Live model");
  const client = clientFactory(key);

  const safeExpireMinutes = Math.max(5, Math.min(30, Number(expireMinutes) || 30));
  const safeNewSessionMinutes = Math.max(1, Math.min(5, Number(newSessionMinutes) || 1));
  const expireTime = new Date(now + safeExpireMinutes * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(
    now + safeNewSessionMinutes * 60 * 1000
  ).toISOString();

  const token = await client.authTokens.create({
    config: {
      uses: 1,
      expireTime,
      newSessionExpireTime,
      liveConnectConstraints: {
        model: liveModel,
        config: {
          responseModalities: ["AUDIO"],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          sessionResumption: {},
        },
      },
    },
  });

  const tokenName = token?.name;
  if (!tokenName) {
    const error = new Error("Gemini did not return an ephemeral token.");
    error.code = "VOICE_TOKEN_EMPTY";
    throw error;
  }

  return Object.freeze({
    token: tokenName,
    model: liveModel,
    expireTime,
    newSessionExpireTime,
    websocketUrl:
      "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta." +
      "GenerativeService.BidiGenerateContentConstrained?access_token=" +
      encodeURIComponent(tokenName),
  });
}
