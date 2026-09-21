import { assertScope } from "../memory/model.js";
import { byteSize, toJson } from "../storage/serialization.js";
import { randomUUID } from "node:crypto";

const SAFE_KINDS = new Set([
  "voice_session_started",
  "voice_session_connected",
  "voice_reconnect_started",
  "voice_reconnect_completed",
  "voice_interrupted",
  "voice_tool_call",
  "voice_session_completed",
  "voice_session_failed",
  "voice_session_closed",
  "voice_token_requested",
]);

export class VoiceSessionService {
  #client;
  #quota;
  #ledger;

  constructor({ client, quota, ledger }) {
    this.#client = client;
    this.#quota = quota;
    this.#ledger = ledger;
  }

  async start(scope, { sessionId = randomUUID(), provider = "gemini", model, metadata = {} } = {}) {
    assertScope(scope);
    if (!model) throw new TypeError("Voice session model is required.");
    const now = new Date().toISOString();
    const sizeBytes = byteSize({ sessionId, scope, provider, model, metadata, now });
    const tx = await this.#client.transaction("write");
    try {
      await this.#quota.assertWithinQuota(scope, sizeBytes, { category: "other", executor: tx });
      await tx.execute({
        sql: "INSERT INTO voice_sessions (id,tenant_id,user_id,provider,model,status,started_at,connected_at,ended_at,reconnect_count,interruption_count,tool_call_count,input_bytes,output_bytes,duration_ms,close_reason,error_code,metadata_json,created_at,updated_at,size_bytes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        args: [sessionId, scope.tenantId, scope.userId, provider, model, "starting", now, null, null, 0, 0, 0, 0, 0, null, null, null, toJson(metadata), now, now, sizeBytes],
      });
      await this.#appendAudit(tx, scope, sessionId, "voice_session_started", { provider, model, metadata: safeMetadata(metadata) });
      await tx.commit();
      return this.get(scope, sessionId);
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  async record(scope, sessionId, event = {}) {
    assertScope(scope);
    const current = await this.get(scope, sessionId);
    if (!current) throw codeError("VOICE_SESSION_NOT_FOUND", "Voice session not found.");
    const kind = String(event.kind ?? "");
    if (!SAFE_KINDS.has(kind)) throw codeError("VOICE_AUDIT_EVENT_REJECTED", "Unsupported voice audit event.");

    const now = new Date().toISOString();
    const connectedAt = event.connected ? (current.connected_at ?? now) : current.connected_at;
    const reconnectCount = current.reconnect_count + (event.reconnectIncrement ? 1 : 0);
    const interruptionCount = current.interruption_count + (event.interruptionIncrement ? 1 : 0);
    const toolCallCount = current.tool_call_count + (event.toolCallIncrement ? 1 : 0);
    const inputBytes = current.input_bytes + Math.max(0, Number(event.inputBytes) || 0);
    const outputBytes = current.output_bytes + Math.max(0, Number(event.outputBytes) || 0);
    const endedAt = event.endedAt ?? current.ended_at;
    const durationMs = endedAt ? Math.max(0, new Date(endedAt).getTime() - new Date(current.started_at).getTime()) : current.duration_ms;
    const status = event.status ?? current.status;
    const closeReason = event.closeReason ?? current.close_reason;
    const errorCode = event.errorCode ?? current.error_code;
    const metadata = { ...(current.metadata ?? {}), ...safeMetadata(event.metadata) };
    const sizeBytes = byteSize({ id: sessionId, provider: current.provider, model: current.model, status, connectedAt, endedAt, reconnectCount, interruptionCount, toolCallCount, inputBytes, outputBytes, durationMs, closeReason, errorCode, metadata });
    const delta = sizeBytes - Number(current.size_bytes);

    const tx = await this.#client.transaction("write");
    try {
      await this.#quota.assertWithinQuota(scope, delta, { category: "other", executor: tx });
      await tx.execute({
        sql: "UPDATE voice_sessions SET status=?,connected_at=?,ended_at=?,reconnect_count=?,interruption_count=?,tool_call_count=?,input_bytes=?,output_bytes=?,duration_ms=?,close_reason=?,error_code=?,metadata_json=?,updated_at=?,size_bytes=? WHERE tenant_id=? AND user_id=? AND id=?",
        args: [status, connectedAt, endedAt, reconnectCount, interruptionCount, toolCallCount, inputBytes, outputBytes, durationMs, closeReason, errorCode, toJson(metadata), now, sizeBytes, scope.tenantId, scope.userId, sessionId],
      });
      await this.#appendAudit(tx, scope, sessionId, kind, {
        status, provider: current.provider, model: current.model, toolName: event.toolName ?? null,
        reconnectCount, interruptionCount, toolCallCount, inputBytes, outputBytes, closeReason, errorCode,
      });
      await tx.commit();
      return this.get(scope, sessionId);
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  async get(scope, sessionId) {
    assertScope(scope);
    const result = await this.#client.execute({
      sql: "SELECT * FROM voice_sessions WHERE tenant_id=? AND user_id=? AND id=?",
      args: [scope.tenantId, scope.userId, sessionId],
    });
    const row = result.rows[0];
    return row ? { ...row, metadata: parseJson(row.metadata_json) } : null;
  }

  async list(scope, { limit = 50 } = {}) {
    assertScope(scope);
    const safe = Math.max(1, Math.min(100, Number(limit) || 50));
    const result = await this.#client.execute({
      sql: "SELECT * FROM voice_sessions WHERE tenant_id=? AND user_id=? ORDER BY created_at DESC LIMIT ?",
      args: [scope.tenantId, scope.userId, safe],
    });
    return result.rows.map((row) => ({ ...row, metadata: parseJson(row.metadata_json) }));
  }

  async verify(scope) {
    assertScope(scope);
    return this.#ledger.verify(scope);
  }

  async #appendAudit(tx, scope, sessionId, kind, metadata) {
    return this.#ledger.appendInTransaction(tx, scope, {
      eventType: "audit_event",
      actorType: "system",
      objectId: sessionId,
      objectVersion: 1,
      payload: { kind, ...safeMetadata(metadata) },
      provider: metadata.provider ?? "gemini",
      model: metadata.model ?? null,
    });
  }
}

function safeMetadata(value = {}) {
  const out = {};
  if (!value || typeof value !== "object") return out;
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|key|password|credential|audio|pcm|prompt|system/i.test(key)) continue;
    if (item == null || ["string", "number", "boolean"].includes(typeof item)) out[key] = item;
  }
  return out;
}

function parseJson(value) {
  try { return value ? JSON.parse(value) : {}; } catch { return {}; }
}

function codeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
