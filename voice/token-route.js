import { randomUUID } from "node:crypto";
import { authorizeRequest, checkOrigin } from "../core/security.js";
import { checkRateLimit } from "../lib/rate-limit.js";
import { resolveVoiceScope } from "./http-identity.js";

export async function handleVoiceToken(req, res, current) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Method not allowed.", code: "VOICE_METHOD_NOT_ALLOWED" });
  }
  if (!checkOrigin(req.headers.origin, current.config.security.allowedOrigin)) {
    return send(res, 403, { error: "Origin not allowed.", code: "VOICE_ORIGIN_REJECTED" });
  }

  const auth = authorizeRequest(req, current.config.security.apiToken);
  if (!auth.allowed) {
    return send(res, auth.reason === "server_not_configured" ? 503 : 401, {
      error: auth.reason === "server_not_configured" ? "The server is not configured yet. Add JUNI_API_TOKEN." : "Authentication required.",
      code: auth.reason === "server_not_configured" ? "VOICE_SERVER_NOT_CONFIGURED" : "VOICE_AUTH_REQUIRED",
    });
  }

  if (!current.config.voice.enabled) {
    return send(res, 503, { error: "Real-time voice is disabled.", code: "VOICE_FEATURE_DISABLED" });
  }

  const rate = checkRateLimit(
    clientKey(req),
    current.config.security.voiceRateLimit ?? 20,
    current.config.security.voiceRateWindowSeconds ?? 60,
  );
  res.setHeader("X-RateLimit-Limit", String(rate.limit));
  res.setHeader("X-RateLimit-Remaining", String(rate.remaining));
  if (!rate.allowed) {
    res.setHeader("Retry-After", String(rate.retryAfter));
    return send(res, 429, { error: "Too many requests.", code: "VOICE_RATE_LIMITED" });
  }

  let scope;
  try {
    scope = resolveVoiceScope(req, current.config);
  } catch (error) {
    return send(res, 503, { error: error.message, code: error.code || "VOICE_IDENTITY_NOT_CONFIGURED" });
  }

  await current.memory.ready();
  const body = req.body && typeof req.body === "object" ? req.body : {};
  if (body.sessionId != null && !isUuid(body.sessionId)) {
    return send(res, 400, { error: "Invalid voice session identifier.", code: "VOICE_SESSION_INVALID" });
  }

  const requestId = typeof body.requestId === "string" ? body.requestId.slice(0, 128) : randomUUID();
  const sessionId = body.sessionId || randomUUID();

  try {
    const provider = current.providers.geminiLive;
    const validation = await provider.validateLiveModel({
      model: current.config.providers.gemini.liveModel,
    });

    const session = await current.memory.voiceSessions.create(scope, {
      sessionId,
      provider: "gemini",
      model: validation.resourceName,
      retentionExpiresAt: new Date(Date.now() + current.config.retention.logsDays * 86400000).toISOString(),
    });

    const resumptionHandle = validateResumptionHandle(body.resumptionHandle);
    const token = await provider.createEphemeralToken({
      model: validation.resourceName,
      captionsEnabled: Boolean(body.captions) && current.config.voice.captionsEnabled,
      sessionId: session.id,
      resumptionHandle,
    });

    current.events.emit("voice.session.started", {
      sessionId: session.id,
      model: token.model,
    }, {
      requestId,
      provider: "gemini",
      model: token.model,
    });

    return send(res, 200, {
      sessionId: session.id,
      token: token.token,
      model: token.model,
      expiresAt: token.expiresAt,
      newSessionExpiresAt: token.newSessionExpiresAt,
      wsEndpoint: token.wsEndpoint,
      captionsEnabled: Boolean(body.captions) && current.config.voice.captionsEnabled,
      audioChunkMs: current.config.voice.audioChunkMs,
      outputBufferLimitMs: current.config.voice.outputBufferLimitMs,
      maxSessionMinutes: current.config.voice.maxSessionMinutes,
      maxReconnectAttempts: current.config.voice.maxReconnectAttempts,
      reconnectBaseMs: current.config.voice.reconnectBaseMs,
    });
  } catch (error) {
    try {
      if (await current.memory.voiceSessions.get(scope, sessionId)) {
        await current.memory.voiceSessions.recordEvent(scope, sessionId, {
          type: "voice_session_failed",
          code: error?.code || "VOICE_TOKEN_FAILED",
          reason: "token_creation_failed",
        });
      }
    } catch {}

    console.error("JUNI voice token error", {
      code: error?.code || "VOICE_TOKEN_FAILED",
      requestId,
      sessionId,
    });

    const code = error?.code === "VOICE_MODEL_UNSUPPORTED" ? "VOICE_MODEL_UNSUPPORTED" : "VOICE_TOKEN_FAILED";
    const status = error?.code === "STORAGE_QUOTA_EXCEEDED" ? 507 : error?.code === "VOICE_MODEL_UNSUPPORTED" ? 503 : 502;
    return send(res, status, {
      error: code === "VOICE_MODEL_UNSUPPORTED"
        ? "Configured Gemini Live model is unsupported."
        : "Unable to create a voice session.",
      code,
      requestId,
    });
  }
}

function send(res, status, body) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.json(body);
}
function clientKey(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
    || req.headers["x-real-ip"]
    || "unknown";
}
function isUuid(value) {
  return typeof value === "string"
    && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
}


function validateResumptionHandle(value) {
  if (value == null || value === "") return null;
  const handle = String(value);
  return handle.length <= 4096 ? handle : null;
}
