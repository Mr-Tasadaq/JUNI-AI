import { randomUUID } from "node:crypto";
import { assertScope } from "./model.js";
import { byteSize } from "../storage/serialization.js";

const STATUSES = new Set(["started", "connected", "reconnecting", "completed", "failed"]);

export class VoiceSessionService {
  #client;
  #quota;
  #ledger;

  constructor({ client, quota, ledger }) {
    this.#client = client;
    this.#quota = quota;
    this.#ledger = ledger;
  }

  async create(scope, { sessionId = null, provider = "gemini", model = null, retentionExpiresAt = null } = {}) {
    assertScope(scope);
    const id = sessionId ?? randomUUID();
    if (!/^[a-f0-9-]{36}$/i.test(id)) {
      throw codeError("VOICE_SESSION_INVALID", "Invalid voice session identifier.");
    }

    const existing = await this.get(scope, id);
    if (existing) return existing;

    const now = new Date().toISOString();
    const sizeBytes = byteSize({ id, tenantId: scope.tenantId, userId: scope.userId, provider, model, startedAt: now });
    await this.#quota.assertWithinQuota(scope, sizeBytes, { category: "logs" });

    await this.#client.execute({
      sql: "INSERT INTO voice_sessions (id,tenant_id,user_id,provider,model,status,started_at,connected_at,completed_at,last_activity_at,reconnect_count,interruption_count,tool_call_count,audio_input_bytes,audio_output_bytes,duration_ms,close_reason,resumption_updates,retention_expires_at,size_bytes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      args: [id,scope.tenantId,scope.userId,provider,model,"started",now,null,null,now,0,0,0,0,0,0,null,0,retentionExpiresAt,sizeBytes],
    });

    await this.#ledger.append(scope, {
      eventType: "audit_event",
      actorType: "system",
      objectId: id,
      objectVersion: 1,
      payload: { kind: "voice_session_started", sessionId: id, provider, model },
      provider,
      model,
    });

    return this.get(scope, id);
  }

  async get(scope, id) {
    assertScope(scope);
    const result = await this.#client.execute({
      sql: "SELECT * FROM voice_sessions WHERE tenant_id=? AND user_id=? AND id=?",
      args: [scope.tenantId,scope.userId,id],
    });
    return result.rows[0] ? parseVoiceSession(result.rows[0]) : null;
  }

  async update(scope, id, changes = {}) {
    assertScope(scope);
    const current = await this.get(scope, id);
    if (!current) throw codeError("VOICE_SESSION_NOT_FOUND", "Voice session not found.");

    const status = changes.status ?? current.status;
    if (!STATUSES.has(status)) throw codeError("VOICE_SESSION_INVALID_STATUS", "Invalid voice session status.");

    const now = new Date().toISOString();
    const row = {
      ...current,
      status,
      provider: changes.provider ?? current.provider,
      model: changes.model ?? current.model,
      connected_at: changes.connectedAt ?? current.connected_at,
      completed_at: changes.completedAt ?? current.completed_at,
      last_activity_at: now,
      reconnect_count: integerMetric(changes.reconnectCount ?? current.reconnect_count),
      interruption_count: integerMetric(changes.interruptionCount ?? current.interruption_count),
      tool_call_count: integerMetric(changes.toolCallCount ?? current.tool_call_count),
      audio_input_bytes: integerMetric(changes.audioInputBytes ?? current.audio_input_bytes),
      audio_output_bytes: integerMetric(changes.audioOutputBytes ?? current.audio_output_bytes),
      duration_ms: integerMetric(changes.durationMs ?? current.duration_ms),
      close_reason: changes.closeReason ?? current.close_reason,
      resumption_updates: integerMetric(changes.resumptionUpdates ?? current.resumption_updates),
      retention_expires_at: changes.retentionExpiresAt ?? current.retention_expires_at,
    };
    const sizeBytes = byteSize(row);
    const delta = sizeBytes - Number(current.size_bytes);
    if (delta > 0) await this.#quota.assertWithinQuota(scope, delta, { category: "logs" });

    await this.#client.execute({
      sql: "UPDATE voice_sessions SET provider=?,model=?,status=?,connected_at=?,completed_at=?,last_activity_at=?,reconnect_count=?,interruption_count=?,tool_call_count=?,audio_input_bytes=?,audio_output_bytes=?,duration_ms=?,close_reason=?,resumption_updates=?,retention_expires_at=?,size_bytes=? WHERE tenant_id=? AND user_id=? AND id=?",
      args: [row.provider,row.model,row.status,row.connected_at,row.completed_at,row.last_activity_at,row.reconnect_count,row.interruption_count,row.tool_call_count,row.audio_input_bytes,row.audio_output_bytes,row.duration_ms,row.close_reason,row.resumption_updates,row.retention_expires_at,sizeBytes,scope.tenantId,scope.userId,id],
    });
    return this.get(scope, id);
  }

  async recordEvent(scope, id, event = {}, { provider = null, model = null } = {}) {
    assertScope(scope);
    const current = await this.get(scope, id);
    if (!current) throw codeError("VOICE_SESSION_NOT_FOUND", "Voice session not found.");

    const type = String(event.type ?? "");
    const changes = {};

    if (type === "voice_session_connected") {
      changes.status = "connected";
      changes.connectedAt = new Date().toISOString();
    } else if (type === "voice_reconnect_started" || type === "voice_session_reconnected") {
      changes.status = "reconnecting";
      changes.reconnectCount = current.reconnect_count + 1;
    } else if (type === "voice_reconnect_completed") {
      changes.status = "connected";
      changes.reconnectCount = current.reconnect_count;
      if (event.resumed === true) changes.resumptionUpdates = current.resumption_updates + 1;
    } else if (type === "voice_session_interrupted") {
      changes.interruptionCount = current.interruption_count + 1;
    } else if (type === "voice_tool_call") {
      changes.toolCallCount = current.tool_call_count + 1;
    } else if (type === "voice_session_completed") {
      changes.status = "completed";
      changes.completedAt = new Date().toISOString();
      changes.closeReason = event.reason ?? null;
      changes.durationMs = event.durationMs ?? current.duration_ms;
      changes.reconnectCount = event.reconnectCount ?? current.reconnect_count;
      changes.interruptionCount = event.interruptionCount ?? current.interruption_count;
      changes.toolCallCount = event.toolCallCount ?? current.tool_call_count;
      changes.audioInputBytes = event.inputBytes ?? current.audio_input_bytes;
      changes.audioOutputBytes = event.outputBytes ?? current.audio_output_bytes;
    } else if (type === "voice_session_failed") {
      changes.status = "failed";
      changes.completedAt = new Date().toISOString();
      changes.closeReason = event.reason ?? event.code ?? "voice_error";
      changes.durationMs = event.durationMs ?? current.duration_ms;
    } else {
      throw codeError("VOICE_EVENT_REJECTED", "Unsupported voice session event.");
    }

    const updated = await this.update(scope, id, { ...changes, provider: provider ?? current.provider, model: model ?? current.model });
    await this.#ledger.append(scope, {
      eventType: "audit_event",
      actorType: "system",
      objectId: id,
      objectVersion: 1,
      payload: { kind: type, sessionId: id, metadata: safeMetadata(event) },
      provider: provider ?? current.provider,
      model: model ?? current.model,
    });
    return updated;
  }

  async list(scope, { limit = 50, status = null } = {}) {
    assertScope(scope);
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
    const args = [scope.tenantId, scope.userId];
    let sql = "SELECT * FROM voice_sessions WHERE tenant_id=? AND user_id=?";
    if (status) {
      if (!STATUSES.has(status)) throw codeError("VOICE_SESSION_INVALID_STATUS", "Invalid voice session status.");
      sql += " AND status=?";
      args.push(status);
    }
    sql += " ORDER BY started_at DESC LIMIT ?";
    args.push(safeLimit);
    const result = await this.#client.execute({ sql, args });
    return result.rows.map(parseVoiceSession);
  }
}

function parseVoiceSession(row) {
  return {
    ...row,
    reconnect_count: Number(row.reconnect_count),
    interruption_count: Number(row.interruption_count),
    tool_call_count: Number(row.tool_call_count),
    audio_input_bytes: Number(row.audio_input_bytes),
    audio_output_bytes: Number(row.audio_output_bytes),
    duration_ms: Number(row.duration_ms),
    resumption_updates: Number(row.resumption_updates),
  };
}

function integerMetric(value) {
  return Math.max(0, Math.min(Number(value) || 0, 10_000_000_000));
}

function safeMetadata(value) {
  const allowed = ["sessionId","reason","code","resumed","durationMs","reconnectCount","interruptionCount","toolCallCount","inputBytes","outputBytes","toolName","outcome"];
  const out = {};
  for (const key of allowed) {
    if (value?.[key] == null) continue;
    if (typeof value[key] === "number") out[key] = integerMetric(value[key]);
    else if (typeof value[key] === "boolean") out[key] = value[key];
    else out[key] = String(value[key]).slice(0, 128);
  }
  return out;
}

function codeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
