import test from "node:test";
import assert from "node:assert/strict";
import { createGeminiEphemeralToken } from "../core/voice-token.js";

test("Gemini ephemeral voice token is constrained and short-lived", async () => {
  const calls = [];
  const client = {
    authTokens: {
      create: async (input) => {
        calls.push(input);
        return { name: "token-123" };
      },
    },
  };

  const result = await createGeminiEphemeralToken({
    apiKey: "server-key",
    model: "gemini-3.8-live",
    clientFactory: () => client,
    now: Date.parse("2026-09-21T00:00:00.000Z"),
  });

  assert.equal(result.token, "token-123");
  assert.equal(result.model, "gemini-3.8-live");
  assert.match(result.websocketUrl, /BidiGenerateContentConstrained\?access_token=token-123/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].config.uses, 1);
  assert.equal(calls[0].config.liveConnectConstraints.model, "gemini-3.8-live");
  assert.deepEqual(calls[0].config.liveConnectConstraints.config.responseModalities, ["AUDIO"]);
  assert.deepEqual(calls[0].config.liveConnectConstraints.config.sessionResumption, {});
});

test("Gemini ephemeral token service fails closed without an API key", async () => {
  await assert.rejects(
    () => createGeminiEphemeralToken({
      model: "gemini-3.8-live",
      clientFactory: () => { throw new Error("client should not be created"); },
    }),
    (error) => error.code === "VOICE_CONFIGURATION_REQUIRED"
  );
});
