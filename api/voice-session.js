import { randomUUID } from "node:crypto";
import { createJuniApplication } from "../core/app.js";
import { authorizeRequest, checkOrigin } from "../core/security.js";
import { checkRateLimit } from "../lib/rate-limit.js";
import { resolveResearchScope } from "../research/http-identity.js";

let application;
function getApplication() { application ??= createJuniApplication(); return application; }
function json(res, status, body, extraHeaders = {}) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  for (const [key, value] of Object.entries(extraHeaders)) res.setHeader(key, value);
  return res.json(body);
}
function clientKey(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.headers["x-real-ip"] || "unknown";
}
function boundedBytes(value) { return Math.max(0, Math.min(10 * 1024 * 1024, Number(value) || 0)); }

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return json(res, 405, { error: "Method not allowed." }); }
  const app = getApplication();
  if (!checkOrigin(req.headers.origin, app.config.security.allowedOrigin)) return json(res, 403, { error: "Origin not allowed." });
  const auth = authorizeRequest(req, app.config.security.apiToken);
  if (!auth.allowed) return json(res, auth.reason === "server_not_configured" ? 503 : 401, { error: auth.reason === "server_not_configured" ? "The server is not configured yet." : "Authentication required.", code: auth.reason === "server_not_configured" ? "VOICE_SERVER_NOT_CONFIGURED" : "VOICE_AUTH_REQUIRED" });

  const rate = checkRateLimit(clientKey(req) + ":voice-session", 30, 60);
  res.setHeader("X-RateLimit-Limit", String(rate.limit));
  res.setHeader("X-RateLimit-Remaining", String(rate.remaining));
  if (!rate.allowed) { res.setHeader("Retry-After", String(rate.retryAfter)); return json(res, 429, { error: "Too many voice session events.", code: "VOICE_EVENT_RATE_LIMITED" }); }

  if (!app.config.voice.enabled) return json(res, 503, { error: "Realtime voice is disabled.", code: "VOICE_FEATURE_DISABLED" });

  let scope;
  try { scope = resolveResearchScope(req, app.config); await app.memory.ready(); }
  catch (error) { return json(res, 503, { error: error?.message || "Voice identity is not configured.", code: error?.code || "VOICE_AUTH_REQUIRED" }); }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const sessionId = typeof body.sessionId === "string" && body.sessionId.length <= 128 ? body.sessionId : "";
  const kind = typeof body.kind === "string" ? body.kind : "";
  if (!sessionId || !kind) return json(res, 400, { error: "sessionId and kind are required.", code: "VOICE_PROTOCOL_ERROR" });

  const event = {
    kind,
    status: typeof body.status === "string" ? body.status : undefined,
    connected: body.connected === true,
    reconnectIncrement: body.reconnectIncrement === true,
    interruptionIncrement: body.interruptionIncrement === true,
    toolCallIncrement: body.toolCallIncrement === true,
    inputBytes: boundedBytes(body.inputBytes),
    outputBytes: boundedBytes(body.outputBytes),
    endedAt: typeof body.endedAt === "string" ? body.endedAt : undefined,
    closeReason: typeof body.closeReason === "string" ? body.closeReason.slice(0, 160) : undefined,
    errorCode: typeof body.errorCode === "string" ? body.errorCode.slice(0, 100) : undefined,
    toolName: typeof body.toolName === "string" ? body.toolName.slice(0, 80) : undefined,
    metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : {},
  };

  try {
    const result = await app.voiceSessions.record(scope, sessionId, event);
    const safeContext = { requestId: randomUUID(), provider: result.provider, model: result.model };
    app.events.emit(kind.replace(/^voice_/, "voice.").replaceAll("_", "."), {
      sessionId,
      status: result.status,
      reconnectCount: result.reconnect_count,
      interruptionCount: result.interruption_count,
      toolCallCount: result.tool_call_count,
    }, safeContext);
    return json(res, 200, { session: result });
  } catch (error) {
    const status = error?.code === "VOICE_SESSION_NOT_FOUND" ? 404 : error?.code === "VOICE_AUDIT_EVENT_REJECTED" ? 400 : 502;
    console.error("JUNI-AI voice session event failed", { code: error?.code, message: error?.message });
    return json(res, status, { error: error?.message || "Voice session event failed.", code: error?.code || "VOICE_EVENT_FAILED" });
  }
}
