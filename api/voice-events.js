import { createJuniApplication } from "../core/app.js";
import { authorizeRequest, checkOrigin } from "../core/security.js";
import { resolveVoiceScope } from "../voice/http-identity.js";

let application;
function app() {
  application ??= createJuniApplication();
  return application;
}
function send(res, status, body) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.json(body);
}
function clientKey(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.headers["x-real-ip"] || "unknown";
}

const EVENTS = new Set([
  "voice_session_connected",
  "voice_reconnect_started",
  "voice_reconnect_completed",
  "voice_session_reconnected",
  "voice_session_interrupted",
  "voice_tool_call",
  "voice_session_completed",
  "voice_session_failed",
]);

export default async function handler(req, res) {
  const current = app();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Method not allowed.", code: "VOICE_METHOD_NOT_ALLOWED" });
  }
  if (!current.config.voice.enabled) {
    return send(res, 503, { error: "Real-time voice is disabled.", code: "VOICE_FEATURE_DISABLED" });
  }
  if (!checkOrigin(req.headers.origin, current.config.security.allowedOrigin)) {
    return send(res, 403, { error: "Origin not allowed.", code: "VOICE_ORIGIN_REJECTED" });
  }
  const auth = authorizeRequest(req, current.config.security.apiToken, {
    cookieName: current.config.security.authCookieName,
  });
  if (!auth.allowed) {
    return send(res, auth.reason === "server_not_configured" ? 503 : 401, {
      error: auth.reason === "server_not_configured" ? "The server is not configured yet. Add JUNI_API_TOKEN." : "Authentication required.",
      code: auth.reason === "server_not_configured" ? "VOICE_SERVER_NOT_CONFIGURED" : "VOICE_AUTH_REQUIRED",
    });
  }

  const limit = Number.parseInt(process.env.JUNI_RATE_LIMIT || "20", 10);
  const windowSeconds = Number.parseInt(process.env.JUNI_RATE_WINDOW_SECONDS || "60", 10);
  const rate = await current.rateLimiter.check(
    clientKey(req),
    Number.isFinite(limit) && limit > 0 ? limit : 20,
    Number.isFinite(windowSeconds) && windowSeconds > 0 ? windowSeconds : 60,
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
  const eventName = String(body.event || "");
  const sessionId = String(body.sessionId || "");
  if (!EVENTS.has(eventName)) return send(res, 400, { error: "Unsupported voice event.", code: "VOICE_EVENT_REJECTED" });
  if (!/^[a-f0-9-]{36}$/i.test(sessionId)) return send(res, 400, { error: "Invalid voice session identifier.", code: "VOICE_SESSION_INVALID" });

  const metadata = sanitizeMetadata(body.metadata);
  try {
    const updated = await current.memory.voiceSessions.recordEvent(
      scope,
      sessionId,
      { type: eventName, ...metadata },
      { provider: "gemini", model: current.config.providers.gemini.liveModel },
    );
    return send(res, 200, { ok: true, sessionId: updated.id, status: updated.status });
  } catch (error) {
    console.error("JUNI voice event error", { code: error?.code || "VOICE_EVENT_FAILED", sessionId });
    const status = error?.code === "VOICE_SESSION_NOT_FOUND" ? 404 : 400;
    return send(res, status, { error: error?.code?.startsWith("VOICE_") ? error.message : "Voice event rejected.", code: error?.code || "VOICE_EVENT_FAILED" });
  }
}

function sanitizeMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const allowed = ["sessionId","reason","code","resumed","durationMs","reconnectCount","interruptionCount","toolCallCount","inputBytes","outputBytes","toolName","outcome"];
  const out = {};
  for (const key of allowed) {
    if (value[key] == null) continue;
    if (typeof value[key] === "number") out[key] = Math.max(0, Math.min(value[key], 10_000_000_000));
    else if (typeof value[key] === "boolean") out[key] = value[key];
    else out[key] = String(value[key]).slice(0, 128);
  }
  return out;
}
