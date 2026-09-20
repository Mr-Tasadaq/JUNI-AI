import { randomUUID } from "node:crypto";
import { assertScope, assertMemoryType, assertSourceType, assertStatus, assertTrustLevel, parseMemory } from "./model.js";
import { toJson, byteSize, hashString, fromJson } from "../storage/serialization.js";

const PROMOTED = new Set(["important", "permanent"]);

function requireApproval(status, approvedBy) {
  if (PROMOTED.has(status) && !approvedBy) {
    const error = new Error("Important or permanent memory requires explicit approval.");
    error.code = "MEMORY_APPROVAL_REQUIRED";
    throw error;
  }
}

function retentionValue(value) {
  return value instanceof Date ? value.toISOString() : value ?? null;
}

export class MemoryService {
  #client;
  #quota;
  #ledger;
  #provenance;
  #events;

  constructor({ client, quota, ledger, provenance, events }) {
    this.#client = client;
    this.#quota = quota;
    this.#ledger = ledger;
    this.#provenance = provenance;
    this.#events = events;
  }

  async create(scope, input) {
    assertScope(scope);
    assertMemoryType(input.memoryType);
    assertSourceType(input.sourceType ?? "model");
    const status = input.status ?? "candidate";
    assertStatus(status);
    const trustLevel = input.trustLevel ?? (input.sourceType === "user" ? "trusted" : input.sourceType === "model" ? "generated" : "untrusted");
    assertTrustLevel(trustLevel);
    requireApproval(status, input.approvedBy);

    const id = input.id ?? randomUUID();
    const createdAt = new Date().toISOString();
    const contentJson = toJson(input.content);
    const contentText = input.contentText ?? (typeof input.content === "string" ? input.content : "");
    const checksum = input.checksum ?? hashString(contentJson);
    const record = {
      id, tenant_id: scope.tenantId, user_id: scope.userId, memory_type: input.memoryType,
      content_json: contentJson, content_text: contentText, source_type: input.sourceType ?? "model",
      source_ref: input.sourceRef ?? null, confidence: input.confidence ?? null,
      importance: input.importance ?? 0, trust_level: trustLevel, status, version: 1,
      embedding_ref: input.embeddingRef ?? null, provenance_ref: input.provenanceRef ?? null,
      retention_expires_at: retentionValue(input.retentionExpiresAt), checksum,
      deleted_at: null, created_at: createdAt, updated_at: createdAt,
    };
    record.size_bytes = byteSize(record);

    const tx = await this.#client.transaction("write");
    try {
      let provenanceRef = record.provenance_ref;
      if (input.source && !record.provenance_ref) {
        const provenance = await this.#provenance.createInTransaction(tx, scope, {
          subjectId: id,
          sourceType: input.source.type ?? input.sourceType ?? "external",
          sourceUrl: input.source.url ?? null,
          sourceTitle: input.source.title ?? null,
          retrievalTimestamp: input.source.retrievedAt ?? null,
          sourceHash: input.source.hash ?? checksum,
          provider: input.source.provider ?? input.provider ?? null,
          tool: input.source.tool ?? null,
          relatedIds: [id],
          metadata: input.source.metadata ?? {},
        });
        provenanceRef = provenance.id;
      }
      record.provenance_ref = provenanceRef;
      record.size_bytes = byteSize(record);

      await this.#quota.assertWithinQuota(scope, record.size_bytes, { category: "memory", executor: tx });

      await tx.execute({
        sql: `INSERT INTO memory_records (
          id, tenant_id, user_id, memory_type, content_json, content_text,
          source_type, source_ref, confidence, importance, trust_level, status,
          version, embedding_ref, provenance_ref, retention_expires_at, checksum,
          deleted_at, created_at, updated_at, size_bytes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          record.id, record.tenant_id, record.user_id, record.memory_type,
          record.content_json, record.content_text, record.source_type, record.source_ref,
          record.confidence, record.importance, record.trust_level, record.status,
          record.version, record.embedding_ref, record.provenance_ref, record.retention_expires_at,
          record.checksum, record.deleted_at, record.created_at, record.updated_at, record.size_bytes,
        ],
      });

      await this.#writeVersion(tx, scope, record, {
        changeType: "created",
        changeSummary: "Initial memory record.",
        actorType: input.actorType ?? "user",
        actorId: input.actorId ?? input.approvedBy ?? null,
      });

      await this.#ledger.appendInTransaction(tx, scope, {
        eventType: "memory_created",
        actorType: input.actorType ?? "user",
        actorId: input.actorId ?? input.approvedBy ?? null,
        objectId: id,
        objectVersion: 1,
        payload: {
          memoryType: record.memory_type,
          status,
          sourceType: record.source_type,
          checksum,
          provenanceRef,
          approvedBy: input.approvedBy ?? null,
        },
        sourceHash: input.source?.hash ?? checksum,
        provider: input.provider ?? input.source?.provider ?? null,
        model: input.model ?? null,
      });

      await tx.commit();
      const parsed = parseMemory(record);
      this.#events?.emit("memory.created", {
        memoryId: id, memoryType: record.memory_type, status,
      }, { provider: input.provider, model: input.model });

      return parsed;
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  async get(scope, id, { includeDeleted = false } = {}) {
    assertScope(scope);
    const sql = includeDeleted
      ? "SELECT * FROM memory_records WHERE tenant_id = ? AND user_id = ? AND id = ?"
      : "SELECT * FROM memory_records WHERE tenant_id = ? AND user_id = ? AND id = ? AND deleted_at IS NULL";
    const result = await this.#client.execute({ sql, args: [scope.tenantId, scope.userId, id] });
    return result.rows[0] ? parseMemory(result.rows[0]) : null;
  }

  async list(scope, { memoryType = null, statuses = ["transient", "candidate", "important", "permanent", "archived"], limit = 50 } = {}) {
    assertScope(scope);
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
    const normalizedStatuses = statuses.filter((value) => {
      try { assertStatus(value); return value !== "deleted"; } catch { return false; }
    });
    if (!normalizedStatuses.length) return [];

    const placeholders = normalizedStatuses.map(() => "?").join(",");
    const args = [scope.tenantId, scope.userId, ...normalizedStatuses];
    let sql = `SELECT * FROM memory_records WHERE tenant_id = ? AND user_id = ? AND status IN (${placeholders})`;
    if (memoryType) {
      assertMemoryType(memoryType);
      sql += " AND memory_type = ?";
      args.push(memoryType);
    }
    sql += " ORDER BY importance DESC, updated_at DESC LIMIT ?";
    args.push(safeLimit);

    const result = await this.#client.execute({ sql, args });
    return result.rows.map(parseMemory);
  }

  async recent(scope, options = {}) {
    return this.list(scope, { ...options, limit: Math.min(100, options.limit ?? 20) });
  }

  async update(scope, id, changes = {}) {
    assertScope(scope);
    const existing = await this.get(scope, id, { includeDeleted: true });
    if (!existing) {
      const error = new Error("Memory not found.");
      error.code = "MEMORY_NOT_FOUND";
      throw error;
    }
    if (existing.deleted_at) {
      const error = new Error("Deleted memory cannot be updated.");
      error.code = "MEMORY_TOMBSTONED";
      throw error;
    }

    const next = {
      ...existing,
      content: changes.content ?? existing.content,
      contentText: changes.contentText ?? existing.content_text,
      sourceType: changes.sourceType ?? existing.source_type,
      sourceRef: changes.sourceRef ?? existing.source_ref,
      confidence: changes.confidence ?? existing.confidence,
      importance: changes.importance ?? existing.importance,
      trustLevel: changes.trustLevel ?? existing.trust_level,
      status: changes.status ?? existing.status,
      embeddingRef: changes.embeddingRef ?? existing.embedding_ref,
      provenanceRef: changes.provenanceRef ?? existing.provenance_ref,
      retentionExpiresAt: changes.retentionExpiresAt ?? existing.retention_expires_at,
    };
    assertMemoryType(next.memory_type);
    assertSourceType(next.sourceType);
    assertStatus(next.status);
    assertTrustLevel(next.trustLevel);
    requireApproval(next.status, changes.approvedBy);

    const updatedAt = new Date().toISOString();
    const nextVersion = Number(existing.version) + 1;
    const contentJson = toJson(next.content);
    const checksum = changes.checksum ?? hashString(contentJson);
    const newRecord = {
      id: id, tenant_id: scope.tenantId, user_id: scope.userId, memory_type: next.memory_type,
      content_json: contentJson, content_text: next.contentText ?? "",
      source_type: next.sourceType, source_ref: next.sourceRef, confidence: next.confidence,
      importance: next.importance, trust_level: next.trustLevel, status: next.status,
      version: nextVersion, embedding_ref: next.embeddingRef, provenance_ref: next.provenanceRef,
      retention_expires_at: retentionValue(next.retentionExpiresAt), checksum, deleted_at: null,
      created_at: existing.created_at, updated_at: updatedAt,
    };
    newRecord.size_bytes = byteSize(newRecord);

    const tx = await this.#client.transaction("write");
    try {
      const delta = newRecord.size_bytes - Number(existing.size_bytes);
      await this.#quota.assertWithinQuota(scope, delta, { category: "memory", executor: tx });

      await tx.execute({
        sql: `UPDATE memory_records SET
          content_json = ?, content_text = ?, source_type = ?, source_ref = ?,
          confidence = ?, importance = ?, trust_level = ?, status = ?, version = ?,
          embedding_ref = ?, provenance_ref = ?, retention_expires_at = ?, checksum = ?,
          deleted_at = NULL, updated_at = ?, size_bytes = ?
          WHERE tenant_id = ? AND user_id = ? AND id = ?`,
        args: [
          newRecord.content_json, newRecord.content_text, newRecord.source_type, newRecord.source_ref,
          newRecord.confidence, newRecord.importance, newRecord.trust_level, newRecord.status,
          newRecord.version, newRecord.embedding_ref, newRecord.provenance_ref,
          newRecord.retention_expires_at, newRecord.checksum, newRecord.updated_at,
          newRecord.size_bytes, scope.tenantId, scope.userId, id,
        ],
      });

      await this.#writeVersion(tx, scope, newRecord, {
        changeType: changes.changeType ?? "updated",
        changeSummary: changes.changeSummary ?? "Memory updated.",
        actorType: changes.actorType ?? "user",
        actorId: changes.actorId ?? changes.approvedBy ?? null,
      });

      await this.#ledger.appendInTransaction(tx, scope, {
        eventType: changes.changeType === "correction" ? "user_correction" : "memory_updated",
        actorType: changes.actorType ?? "user",
        actorId: changes.actorId ?? changes.approvedBy ?? null,
        objectId: id,
        objectVersion: nextVersion,
        payload: {
          previousVersion: existing.version,
          nextVersion,
          changeSummary: changes.changeSummary ?? "Memory updated.",
          checksum,
          status: newRecord.status,
        },
        provider: changes.provider ?? null,
        model: changes.model ?? null,
      });

      await tx.commit();
      const parsed = parseMemory(newRecord);
      this.#events?.emit(changes.changeType === "correction" ? "memory.updated" : "memory.updated", {
        memoryId: id, version: nextVersion, status: newRecord.status,
      }, { provider: changes.provider, model: changes.model });
      return parsed;
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  async correct(scope, id, changes = {}) {
    return this.update(scope, id, { ...changes, changeType: "correction", actorType: "user" });
  }

  async delete(scope, id, { actorType = "user", actorId = null, summary = "Memory deleted.", provider = null, model = null } = {}) {
    assertScope(scope);
    const existing = await this.get(scope, id, { includeDeleted: true });
    if (!existing) {
      const error = new Error("Memory not found.");
      error.code = "MEMORY_NOT_FOUND";
      throw error;
    }
    if (existing.deleted_at) return existing;

    const updatedAt = new Date().toISOString();
    const nextVersion = Number(existing.version) + 1;
    const tombstone = {
      id, tenant_id: scope.tenantId, user_id: scope.userId, memory_type: existing.memory_type,
      content_json: existing.content_json, content_text: existing.content_text,
      source_type: existing.source_type, source_ref: existing.source_ref,
      confidence: existing.confidence, importance: existing.importance,
      trust_level: existing.trust_level, status: "deleted", version: nextVersion,
      embedding_ref: existing.embedding_ref, provenance_ref: existing.provenance_ref,
      retention_expires_at: existing.retention_expires_at, checksum: existing.checksum,
      deleted_at: updatedAt, created_at: existing.created_at, updated_at: updatedAt,
    };
    tombstone.size_bytes = byteSize(tombstone);

    const tx = await this.#client.transaction("write");
    try {
      const delta = tombstone.size_bytes + byteSize({ id, version: nextVersion, changeType: "deleted", summary }) - Number(existing.size_bytes);
      await this.#quota.assertWithinQuota(scope, delta, { category: "memory", executor: tx });

      await tx.execute({
        sql: `UPDATE memory_records SET status = 'deleted', version = ?, deleted_at = ?, updated_at = ?, size_bytes = ? WHERE tenant_id = ? AND user_id = ? AND id = ?`,
        args: [nextVersion, updatedAt, updatedAt, tombstone.size_bytes, scope.tenantId, scope.userId, id],
      });

      await this.#writeVersion(tx, scope, tombstone, {
        changeType: "deleted",
        changeSummary: summary,
        actorType,
        actorId,
      });

      await this.#ledger.appendInTransaction(tx, scope, {
        eventType: "memory_deleted",
        actorType,
        actorId,
        objectId: id,
        objectVersion: nextVersion,
        payload: { previousVersion: existing.version, summary },
        provider,
        model,
      });

      await tx.commit();
      this.#events?.emit("memory.deleted", { memoryId: id, version: nextVersion }, {});
      return parseMemory(tombstone);
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  async versions(scope, id, { limit = 100 } = {}) {
    assertScope(scope);
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 100));
    const result = await this.#client.execute({
      sql: "SELECT * FROM memory_versions WHERE tenant_id = ? AND user_id = ? AND memory_id = ? ORDER BY version DESC LIMIT ?",
      args: [scope.tenantId, scope.userId, id, safeLimit],
    });
    return result.rows.map((row) => ({
      ...row,
      content: fromJson(row.content_json),
    }));
  }

  async #writeVersion(tx, scope, record, { changeType, changeSummary, actorType, actorId }) {
    const versionSize = byteSize({
      memoryId: record.id, version: record.version, content: record.content_json,
      status: record.status, changeType, changeSummary, actorType, actorId,
    });
    await this.#quota.assertWithinQuota(scope, versionSize, { category: "memory", executor: tx });
    await tx.execute({
      sql: `INSERT INTO memory_versions (
        memory_id, tenant_id, user_id, version, memory_type, content_json, content_text,
        source_type, source_ref, confidence, importance, trust_level, status,
        embedding_ref, provenance_ref, retention_expires_at, checksum,
        change_type, change_summary, actor_type, actor_id, created_at, size_bytes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        record.id, scope.tenantId, scope.userId, record.version, record.memory_type,
        record.content_json, record.content_text, record.source_type, record.source_ref,
        record.confidence, record.importance, record.trust_level, record.status,
        record.embedding_ref, record.provenance_ref, record.retention_expires_at,
        record.checksum, changeType, changeSummary, actorType, actorId, record.updated_at, versionSize,
      ],
    });
  }
}
