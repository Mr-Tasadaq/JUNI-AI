import { randomUUID } from "node:crypto";
import { canonicalJson, hashObject, hashString, byteSize, fromJson } from "../storage/serialization.js";
import { assertScope } from "../memory/model.js";

export const LEDGER_EVENT_TYPES = Object.freeze([
  "memory_created",
  "memory_updated",
  "memory_deleted",
  "knowledge_created",
  "knowledge_updated",
  "document_ingested",
  "document_changed",
  "source_registered",
  "research_started",
  "research_completed",
  "research_failed",
  "learning_event",
  "embedding_created",
  "embedding_updated",
  "model_used",
  "provider_used",
  "user_correction",
  "audit_event",
  "answer_candidate_created",
  "answer_cache_hit",
  "answer_cache_miss",
  "answer_indexed",
  "answer_approved",
  "answer_rejected",
]);

const GENESIS_HASH = "GENESIS";

function assertEventType(type) {
  if (!LEDGER_EVENT_TYPES.includes(type)) {
    throw new TypeError("Invalid provenance event type.");
  }
}

function buildHashInput(event) {
  return {
    eventId: event.eventId,
    tenantId: event.tenantId,
    userId: event.userId,
    sequence: event.sequence,
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    actorType: event.actorType,
    actorId: event.actorId,
    objectId: event.objectId,
    objectVersion: event.objectVersion,
    payloadHash: event.payloadHash,
    previousHash: event.previousHash,
    sourceHash: event.sourceHash,
    provider: event.provider,
    model: event.model,
  };
}

export class TamperEvidentLedger {
  #client;
  #quota;

  constructor({ client, quota = null }) {
    this.#client = client;
    this.#quota = quota;
  }

  async appendInTransaction(tx, scope, {
    eventType,
    actorType,
    actorId = null,
    objectId = null,
    objectVersion = null,
    payload = {},
    sourceHash = null,
    provider = null,
    model = null,
    eventId = randomUUID(),
    occurredAt = new Date().toISOString(),
  }) {
    assertScope(scope);
    assertEventType(eventType);
    if (!actorType) throw new TypeError("actorType is required.");

    const duplicate = await tx.execute({
      sql: "SELECT event_id FROM ledger_events WHERE event_id = ?",
      args: [eventId],
    });
    if (duplicate.rows.length) {
      const error = new Error("Duplicate provenance event ID.");
      error.code = "DUPLICATE_LEDGER_EVENT";
      throw error;
    }

    const previous = await tx.execute({
      sql: "SELECT sequence, current_hash FROM ledger_events WHERE tenant_id = ? ORDER BY sequence DESC LIMIT 1",
      args: [scope.tenantId],
    });

    const previousHash = previous.rows[0]?.current_hash ?? GENESIS_HASH;
    const sequence = Number(previous.rows[0]?.sequence ?? 0) + 1;
    const safePayload = payload && typeof payload === "object"
      ? structuredClone(payload)
      : { value: payload };
    const payloadHash = hashObject(safePayload);

    const event = {
      eventId,
      tenantId: scope.tenantId,
      userId: scope.userId,
      sequence,
      eventType,
      occurredAt,
      actorType,
      actorId,
      objectId,
      objectVersion,
      payloadHash,
      previousHash,
      sourceHash,
      provider,
      model,
    };

    const currentHash = hashString(canonicalJson(buildHashInput(event)));
    const ledgerSizeBytes = byteSize({ ...event, payload: safePayload, currentHash });
    const auditBytes = byteSize({
      eventId,
      eventType,
      objectId,
      actorType,
      actorId,
      occurredAt,
    });

    if (this.#quota) {
      await this.#quota.assertWithinQuota(
        scope,
        ledgerSizeBytes,
        { category: "provenance", executor: tx }
      );
      await this.#quota.assertWithinQuota(
        scope,
        auditBytes,
        { category: "logs", executor: tx }
      );
    }

    await tx.execute({
      sql: `INSERT INTO ledger_events (
        event_id, tenant_id, user_id, sequence, event_type, occurred_at,
        actor_type, actor_id, object_id, object_version, payload_json,
        payload_hash, previous_hash, current_hash, source_hash, provider, model, size_bytes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        eventId,
        scope.tenantId,
        scope.userId,
        sequence,
        eventType,
        occurredAt,
        actorType,
        actorId,
        objectId,
        objectVersion,
        canonicalJson(safePayload),
        payloadHash,
        previousHash,
        currentHash,
        sourceHash,
        provider,
        model,
        ledgerSizeBytes,
      ],
    });

    await tx.execute({
      sql: `INSERT INTO audit_records (
        event_id, tenant_id, user_id, event_type, object_id, actor_type, actor_id,
        summary, created_at, size_bytes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        eventId,
        scope.tenantId,
        scope.userId,
        eventType,
        objectId,
        actorType,
        actorId,
        "Provenance event: " + eventType,
        occurredAt,
        auditBytes,
      ],
    });

    return Object.freeze({
      ...event,
      payload: safePayload,
      currentHash,
    });
  }

  async append(scope, input) {
    assertScope(scope);
    const tx = await this.#client.transaction("write");
    try {
      const result = await this.appendInTransaction(tx, scope, input);
      await tx.commit();
      return result;
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  async list(scope, { limit = 100, beforeSequence = null } = {}) {
    assertScope(scope);
    const boundedLimit = Math.max(1, Math.min(100, Number(limit) || 100));
    const sql = beforeSequence == null
      ? `SELECT * FROM ledger_events
         WHERE tenant_id = ? AND user_id = ?
         ORDER BY sequence DESC LIMIT ?`
      : `SELECT * FROM ledger_events
         WHERE tenant_id = ? AND user_id = ? AND sequence < ?
         ORDER BY sequence DESC LIMIT ?`;
    const args = beforeSequence == null
      ? [scope.tenantId, scope.userId, boundedLimit]
      : [scope.tenantId, scope.userId, beforeSequence, boundedLimit];

    const result = await this.#client.execute({ sql, args });
    return result.rows.map((row) => ({
      ...row,
      payload: fromJson(row.payload_json),
    }));
  }

  async get(scope, eventId) {
    assertScope(scope);
    const result = await this.#client.execute({
      sql: "SELECT * FROM ledger_events WHERE tenant_id = ? AND user_id = ? AND event_id = ?",
      args: [scope.tenantId, scope.userId, eventId],
    });
    const row = result.rows[0];
    return row ? { ...row, payload: fromJson(row.payload_json) } : null;
  }

  async verify(scope) {
    assertScope(scope);
    const result = await this.#client.execute({
      sql: "SELECT * FROM ledger_events WHERE tenant_id = ? ORDER BY sequence ASC",
      args: [scope.tenantId],
    });

    const issues = [];
    let expectedPrevious = GENESIS_HASH;
    let expectedSequence = 1;

    for (const row of result.rows) {
      const actualSequence = Number(row.sequence);

      if (actualSequence !== expectedSequence) {
        issues.push({
          type: "sequence_gap",
          expected: expectedSequence,
          actual: actualSequence,
          eventId: row.event_id,
        });
      }

      if (!row.previous_hash) {
        issues.push({
          type: "missing_previous_hash",
          eventId: row.event_id,
        });
      }

      if (row.previous_hash !== expectedPrevious) {
        issues.push({
          type: "previous_hash_mismatch",
          eventId: row.event_id,
          expected: expectedPrevious,
          actual: row.previous_hash,
        });
      }

      const payload = fromJson(row.payload_json);
      const expectedPayloadHash = hashObject(payload);
      if (row.payload_hash !== expectedPayloadHash) {
        issues.push({
          type: "payload_hash_mismatch",
          eventId: row.event_id,
        });
      }

      const rebuilt = {
        eventId: row.event_id,
        tenantId: row.tenant_id,
        userId: row.user_id,
        sequence: actualSequence,
        eventType: row.event_type,
        occurredAt: row.occurred_at,
        actorType: row.actor_type,
        actorId: row.actor_id,
        objectId: row.object_id,
        objectVersion: row.object_version == null ? null : Number(row.object_version),
        payloadHash: row.payload_hash,
        previousHash: row.previous_hash,
        sourceHash: row.source_hash,
        provider: row.provider,
        model: row.model,
      };
      const expectedCurrent = hashString(canonicalJson(rebuilt));

      if (row.current_hash !== expectedCurrent) {
        issues.push({
          type: "current_hash_mismatch",
          eventId: row.event_id,
        });
      }

      expectedPrevious = row.current_hash;
      expectedSequence = actualSequence + 1;
    }

    return {
      valid: issues.length === 0,
      eventCount: result.rows.length,
      issues,
      checkedAt: new Date().toISOString(),
    };
  }

  async audit(scope, options = {}) {
    assertScope(scope);
    const boundedLimit = Math.max(1, Math.min(100, Number(options.limit) || 100));
    const result = await this.#client.execute({
      sql: "SELECT * FROM audit_records WHERE tenant_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?",
      args: [scope.tenantId, scope.userId, boundedLimit],
    });
    return result.rows;
  }
}

export { GENESIS_HASH };
