import { randomUUID } from "node:crypto";
import { createJuniApplication } from "../core/app.js";
import { authorizeRequest, checkOrigin } from "../core/security.js";
import { hasProviderKey } from "../core/config.js";
import { checkRateLimit } from "../lib/rate-limit.js";
import { resolveResearchScope } from "../research/http-identity.js";

function defaultGetApplication() {
  return createJuniApplication();
}

function json(res, status, body, extraHeaders = {}) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  for (const [key, value] of Object.entries(extraHeaders)) res.setHeader(key, value);
  return res.json(body);
}

function clientKey(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
    || req.headers["x-real-ip"]
    || "unknown";
}

export function createVoiceTokenHandler({ getApplication = defaultGetApplication, rateLimiter = checkRateLimit } = {}) {
  return async function handler(req, res) {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return json(res, 405, { error: "Method not allowed.", code: "VOICE_METHOD_NOT_ALLOWED" });
    }

    const app = getApplication();
    if (!checkOrigin(req.headers.origin, app.config.security.allowedOrigin)) {
      return json(res, 403, { error: "Origin not allowed.", code: "VOICE_ORIGIN_REJECTED" });
    }

    const auth = authorizeRequest(req, app.config.security.apiToken);
    if (!auth.allowed) {
      return json(res, auth.reason === "server_not_configured" ? 503 : 401, {
        error: auth.reason === "server_not_configured" ? "The server is not configured yet." : "Authentication required.",
        code: auth.reason === "server_not_configured" ? "VOICE_SERVER_NOT_CONFIGURED" : "VOICE_AUTH_REQUIRED",
      });
    }

    const limit = Number.parseInt(process.env.JUNI_VOICE_TOKEN_RATE_LIMIT || process.env.JUNI_RATE_LIMIT || "10", 10);
    const windowSeconds = Number.parseInt(process.env.JUNI_VOICE_TOKEN_RATE_WINDOW_SECONDS || process.env.JUNI_RATE_WINDOW_SECONDS || "60", 10);
    const rate = rateLimiter(
      clientKey(req) + ":voice-token",
      Number.isFinite(limit) && limit > 0 ? limit : 10,
      Number.isFinite(windowSeconds) && windowSeconds > 0 ? windowSeconds : 60
    );
    res.setHeader("X-RateLimit-Limit", String(rate.limit));
    res.setHeader("X-RateLimit-Remaining", String(rate.remaining));
    if (!rate.allowed) {
      res.setHeader("Retry-After", String(rate.retryAfter));
      return json(res, 429, { error: "Too many voice token requests.", code: "VOICE_TOKEN_RATE_LIMITED" });
    }

    const requestId = randomUUID();
    if (!app.config.voice.enabled) {
      return json(res, 503, { error: "Realtime voice is disabled.", code: "VOICE_FEATURE_DISABLED", requestId });
    }
    if (!hasProviderKey(app.config, "gemini") || !app.config.providers.gemini.enabled) {
      return json(res, 503, { error: "Gemini Live is not configured.", code: "VOICE_TOKEN_FAILED", requestId });
    }

    let scope;
    try {
      scope = resolveResearchScope(req, app.config);
      await app.memory.ready();
    } catch (error) {
      return json(res, 503, {
        error: error?.message || "Voice identity is not configured.",
        code: error?.code || "VOICE_AUTH_REQUIRED",
        requestId,
      });
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const resumeHandle = typeof body.resumeHandle === "string" && body.resumeHandle.length <= 8192
      ? body.resumeHandle
      : null;
    const requestedSessionId = typeof body.sessionId === "string" && body.sessionId.length <= 128
      ? body.sessionId
      : null;
    let sessionId = requestedSessionId;

    try {
      const model = app.config.providers.gemini.liveModel;
      if (resumeHandle) {
        if (!sessionId || !(await app.voiceSessions.get(scope, sessionId))) {
          return json(res, 404, { error: "Voice session not found for resumption.", code: "VOICE_SESSION_NOT_FOUND", requestId });
        }
      } else {
        sessionId = randomUUID();
        await app.voiceSessions.start(scope, {
          sessionId,
          provider: "gemini",
          model,
          metadata: { requestId },
        });
      }

      const token = await app.providers.geminiLive.createEphemeralToken({
        model,
        sessionId,
        resumeHandle,
      });

      await app.voiceSessions.record(scope, sessionId, {
        kind: "voice_token_requested",
        status: "ready",
        metadata: { requestId, resumed: Boolean(resumeHandle), expiresAt: token.expiresAt },
      });

      app.events.emit(
        "voice.token.requested",
        { sessionId, resumed: Boolean(resumeHandle) },
        { requestId, provider: "gemini", model: token.model }
      );

      return json(res, 200, {
        sessionId,
        token: token.token,
        model: token.model,
        expiresAt: token.expiresAt,
        newSessionExpiresAt: token.newSessionExpiresAt,
        maxSessionMinutes: app.config.voice.maxSessionMinutes,
        captionsEnabled: app.config.voice.captionsEnabled,
        audioChunkMs: app.config.voice.audioChunkMs,
        outputBufferLimitMs: app.config.voice.outputBufferLimitMs,
        websocketUrl: app.config.voice.websocketUrl,
      });
    } catch (error) {
      if (sessionId) {
        try {
          await app.voiceSessions.record(scope, sessionId, {
            kind: "voice_session_failed",
            status: "error",
            errorCode: error?.code || "VOICE_TOKEN_FAILED",
            metadata: { requestId },
          });
        } catch {}
      }

      console.error("JUNI-AI voice token request failed", {
        code: error?.code,
        name: error?.name,
        message: error?.message,
        requestId,
      });

      const unsupported = error?.code === "VOICE_MODEL_UNSUPPORTED";
      return json(res, unsupported ? 503 : 502, {
        error: unsupported
          ? "The configured Gemini Live model is not supported for realtime voice."
          : "A realtime voice token could not be created.",
        code: unsupported ? "VOICE_MODEL_UNSUPPORTED" : "VOICE_TOKEN_FAILED",
        requestId,
      });
    }
  };
}

export default createVoiceTokenHandler();
