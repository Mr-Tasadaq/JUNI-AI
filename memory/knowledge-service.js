import { randomUUID } from "node:crypto";
import { assertScope, assertSourceType, assertStatus, assertTrustLevel } from "./model.js";
import { byteSize, toJson, hashString, fromJson } from "../storage/serialization.js";

const PROMOTED = new Set(["important", "permanent"]);

function requireApproval(status, approvedBy) {
  if (PROMOTED.has(status) && !approvedBy) {
    const error = new Error("Important or permanent knowledge requires explicit approval.");
    error.code = "KNOWLEDGE_APPROVAL_REQUIRED";
    throw error;
  }
}

export class KnowledgeService {
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
    assertSourceType(input.sourceType ?? "model");
    assertStatus(input.status ?? "candidate");
    assertTrustLevel(input.trustLevel ?? "untrusted");
    requireApproval(input.status ?? "candidate", input.approvedBy);

    const id = input.id ?? randomUUID();
    const createdAt = new Date().toISOString();
    const contentJson = toJson(input.content);
    const contentText = input.contentText ?? (typeof input.content === "string" ? input.content : "");
    const checksum = input.checksum ?? hashString(contentJson);
    const record = {
      id, tenant_id: scope.tenantId, user_id: scope.userId,
      knowledge_type: input.knowledgeType ?? "learned_knowledge",
      title: input.title ?? null,
      content_json: contentJson, content_text: contentText,
      source_type: input.sourceType ?? "model", source_ref: input.sourceRef ?? null,
      confidence: input.confidence ?? null, importance: input.importance ?? 0,
      trust_level: input.trustLevel ?? "untrusted", status: input.status ?? "candidate",
      version: 1, embedding_ref: input.embeddingRef ?? null, provenance_ref: input.provenanceRef ?? null,
      retention_expires_at: input.retentionExpiresAt instanceof Date ? input.retentionExpiresAt.toISOString() : input.retentionExpiresAt ?? null,
      checksum, deleted_at: null, created_at: createdAt, updated_at: createdAt,
    };
    record.size_bytes = byteSize(record);

    const tx = await this.#client.transaction("write");
    try {
      await this.#quota.assertWithinQuota(scope, record.size_bytes, { category: "memory", executor: tx });
      if (input.source) {
        const provenance = await this.#provenance.createInTransaction(tx, scope, {
          subjectId: id,
          sourceType: input.source.type ?? record.source_type,
          sourceUrl: input.source.url ?? null,
          sourceTitle: input.source.title ?? null,
          retrievalTimestamp: input.source.retrievedAt ?? null,
          sourceHash: input.source.hash ?? checksum,
          provider: input.source.provider ?? input.provider ?? null,
          tool: input.source.tool ?? null,
          relatedIds: [id],
          metadata: input.source.metadata ?? {},
        });
        record.provenance_ref = provenance.id;
      }

      await tx.execute({
        sql: `INSERT INTO knowledge_records (
          id, tenant_id, user_id, knowledge_type, title, content_json, content_text,
          source_type, source_ref, confidence, importance, trust_level, status, version,
          embedding_ref, provenance_ref, retention_expires_at, checksum, deleted_at,
          created_at, updated_at, size_bytes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          record.id, record.tenant_id, record.user_id, record.knowledge_type, record.title,
          record.content_json, record.content_text, record.source_type, record.source_ref,
          record.confidence, record.importance, record.trust_level, record.status, record.version,
          record.embedding_ref, record.provenance_ref, record.retention_expires_at, record.checksum,
          record.deleted_at, record.created_at, record.updated_at, record.size_bytes,
        ],
      });

      await this.#writeVersion(tx, scope, record, {
        changeType: "created", changeSummary: "Initial knowledge record.",
        actorType: input.actorType ?? "user", actorId: input.actorId ?? input.approvedBy ?? null,
      });

      await this.#ledger.appendInTransaction(tx, scope, {
        eventType: "knowledge_created",
        actorType: input.actorType ?? "user",
        actorId: input.actorId ?? input.approvedBy ?? null,
        objectId: id,
        objectVersion: 1,
        payload: { knowledgeType: record.knowledge_type, status: record.status, checksum: record.checksum, provenanceRef: record.provenance_ref },
        sourceHash: input.source?.hash ?? checksum,
        provider: input.provider ?? input.source?.provider ?? null,
        model: input.model ?? null,
      });

      await tx.commit();
      const parsed = parseKnowledge(record);
      this.#events?.emit("memory.created", { knowledgeId: id, knowledgeType: record.knowledge_type, status: record.status }, {});
      return parsed;
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  async get(scope, id, { includeDeleted = false, version = null } = {}) {
    assertScope(scope);
    if (version != null) return this.getVersion(scope, id, version);

    const sql = includeDeleted
      ? "SELECT * FROM knowledge_records WHERE tenant_id = ? AND user_id = ? AND id = ?"
      : "SELECT * FROM knowledge_records WHERE tenant_id = ? AND user_id = ? AND id = ? AND deleted_at IS NULL";
    const result = await this.#client.execute({ sql, args: [scope.tenantId, scope.userId, id] });
    return result.rows[0] ? parseKnowledge(result.rows[0]) : null;
  }

  async list(scope, { knowledgeType = null, statuses = ["candidate", "important", "permanent", "archived"], limit = 50 } = {}) {
    assertScope(scope);
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
    const validStatuses = statuses.filter((status) => {
      try { assertStatus(status); return status !== "deleted"; } catch { return false; }
    });
    if (!validStatuses.length) return [];
    const placeholders = validStatuses.map(() => "?").join(",");
    const args = [scope.tenantId, scope.userId, ...validStatuses];
    let sql = `SELECT * FROM knowledge_records WHERE tenant_id = ? AND user_id = ? AND status IN (${placeholders})`;
    if (knowledgeType) {
      sql += " AND knowledge_type = ?";
      args.push(knowledgeType);
    }
    sql += " ORDER BY importance DESC, updated_at DESC LIMIT ?";
    args.push(safeLimit);
    const result = await this.#client.execute({ sql, args });
    return result.rows.map(parseKnowledge);
  }

  async searchText(scope, words, { limit = 10 } = {}) {
    assertScope(scope);
    const terms = (Array.isArray(words) ? words : [words])
      .map((word) => String(word).trim())
      .filter((word) => word.length > 2)
      .slice(0, 8);

    if (!terms.length) return [];
    const clauses = terms.map(() => "content_text LIKE ?").join(" OR ");
    const args = [scope.tenantId, scope.userId, ...terms.map((word) => "%" + word.replace(/[%_]/g, "") + "%")];
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 10));

    const result = await this.#client.execute({
      sql: `SELECT * FROM knowledge_records
        WHERE tenant_id = ? AND user_id = ?
          AND deleted_at IS NULL
          AND status IN ('important','permanent')
          AND (${clauses})
        ORDER BY importance DESC, updated_at DESC
        LIMIT ?`,
      args: [...args, safeLimit],
    });

    return result.rows.map(parseKnowledge);
  }

  async update(scope, id, changes = {}) {
    assertScope(scope);
    const existing = await this.get(scope, id, { includeDeleted: true });
    if (!existing) {
      const error = new Error("Knowledge not found.");
      error.code = "KNOWLEDGE_NOT_FOUND";
      throw error;
    }
    if (existing.deleted_at) {
      const error = new Error("Deleted knowledge cannot be updated.");
      error.code = "KNOWLEDGE_TOMBSTONED";
      throw error;
    }

    const status = changes.status ?? existing.status;
    assertStatus(status);
    requireApproval(status, changes.approvedBy);

    const version = Number(existing.version) + 1;
    const updatedAt = new Date().toISOString();
    const contentJson = toJson(changes.content ?? existing.content);
    const checksum = changes.checksum ?? hashString(contentJson);
    const record = {
      id, tenant_id: scope.tenantId, user_id: scope.userId,
      knowledge_type: changes.knowledgeType ?? existing.knowledge_type,
      title: changes.title ?? existing.title, content_json: contentJson,
      content_text: changes.contentText ?? existing.content_text,
      source_type: changes.sourceType ?? existing.source_type,
      source_ref: changes.sourceRef ?? existing.source_ref, confidence: changes.confidence ?? existing.confidence,
      importance: changes.importance ?? existing.importance, trust_level: changes.trustLevel ?? existing.trust_level,
      status, version, embedding_ref: changes.embeddingRef ?? existing.embedding_ref,
      provenance_ref: changes.provenanceRef ?? existing.provenance_ref,
      retention_expires_at: changes.retentionExpiresAt ?? existing.retention_expires_at,
      checksum, deleted_at: null, created_at: existing.created_at, updated_at: updatedAt,
    };
    assertSourceType(record.source_type);
    assertTrustLevel(record.trust_level);
    record.size_bytes = byteSize(record);

    const tx = await this.#client.transaction("write");
    try {
      const delta = record.size_bytes + byteSize({ id, version, contentJson, checksum }) - Number(existing.size_bytes);
      await this.#quota.assertWithinQuota(scope, delta, { category: "memory", executor: tx });

      await tx.execute({
        sql: `UPDATE knowledge_records SET knowledge_type = ?, title = ?, content_json = ?, content_text = ?,
          source_type = ?, source_ref = ?, confidence = ?, importance = ?, trust_level = ?, status = ?,
          version = ?, embedding_ref = ?, provenance_ref = ?, retention_expires_at = ?, checksum = ?,
          updated_at = ?, size_bytes = ? WHERE tenant_id = ? AND user_id = ? AND id = ?`,
        args: [
          record.knowledge_type, record.title, record.content_json, record.content_text,
          record.source_type, record.source_ref, record.confidence, record.importance, record.trust_level,
          record.status, record.version, record.embedding_ref, record.provenance_ref,
          record.retention_expires_at, record.checksum, record.updated_at, record.size_bytes,
          scope.tenantId, scope.userId, id,
        ],
      });

      await this.#writeVersion(tx, scope, record, {
        changeType: changes.changeType ?? "updated",
        changeSummary: changes.changeSummary ?? "Knowledge updated.",
        actorType: changes.actorType ?? "user",
        actorId: changes.actorId ?? changes.approvedBy ?? null,
      });

      await this.#ledger.appendInTransaction(tx, scope, {
        eventType: changes.changeType === "correction" ? "user_correction" : "knowledge_updated",
        actorType: changes.actorType ?? "user",
        actorId: changes.actorId ?? changes.approvedBy ?? null,
        objectId: id,
        objectVersion: version,
        payload: {
          previousVersion: existing.version,
          nextVersion: version,
          changeSummary: changes.changeSummary ?? "Knowledge updated.",
          checksum: record.checksum,
        },
        provider: changes.provider ?? null,
        model: changes.model ?? null,
      });

      await tx.commit();
      const parsed = parseKnowledge(record);
      this.#events?.emit("memory.updated", { knowledgeId: id, version }, {});
      return parsed;
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  async getVersion(scope, id, version) {
    assertScope(scope);
    const result = await this.#client.execute({
      sql: "SELECT * FROM knowledge_versions WHERE tenant_id = ? AND user_id = ? AND knowledge_id = ? AND version = ?",
      args: [scope.tenantId, scope.userId, id, version],
    });
    const row = result.rows[0];
    return row ? { ...row, content: fromJson(row.content_json) } : null;
  }

  async versions(scope, id, { limit = 100 } = {}) {
    assertScope(scope);
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 100));
    const result = await this.#client.execute({
      sql: "SELECT * FROM knowledge_versions WHERE tenant_id = ? AND user_id = ? AND knowledge_id = ? ORDER BY version DESC LIMIT ?",
      args: [scope.tenantId, scope.userId, id, safeLimit],
    });
    return result.rows.map((row) => ({ ...row, content: fromJson(row.content_json) }));
  }

  async delete(scope, id, options = {}) {
    const existing = await this.get(scope, id, { includeDeleted: true });
    if (!existing) {
      const error = new Error("Knowledge not found.");
      error.code = "KNOWLEDGE_NOT_FOUND";
      throw error;
    }
    if (existing.deleted_at) return existing;

    return this.update(scope, id, {
      status: "deleted",
      changeType: "deleted",
      changeSummary: options.summary ?? "Knowledge deleted.",
      actorType: options.actorType ?? "user",
      actorId: options.actorId ?? null,
      approvedBy: options.approvedBy ?? null,
    });
  }

  async #writeVersion(tx, scope, record, { changeType, changeSummary, actorType, actorId }) {
    const versionSize = byteSize({
      knowledgeId: record.id, version: record.version, content: record.content_json,
      status: record.status, changeType, changeSummary, actorType, actorId,
    });
    await this.#quota.assertWithinQuota(scope, versionSize, { category: "memory", executor: tx });
    await tx.execute({
      sql: `INSERT INTO knowledge_versions (
        knowledge_id, tenant_id, user_id, version, knowledge_type, title, content_json, content_text,
        source_type, source_ref, confidence, importance, trust_level, status, embedding_ref,
        provenance_ref, retention_expires_at, checksum, change_type, change_summary, actor_type,
        actor_id, created_at, size_bytes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        record.id, scope.tenantId, scope.userId, record.version, record.knowledge_type, record.title,
        record.content_json, record.content_text, record.source_type, record.source_ref, record.confidence,
        record.importance, record.trust_level, record.status, record.embedding_ref, record.provenance_ref,
        record.retention_expires_at, record.checksum, changeType, changeSummary, actorType, actorId,
        record.updated_at, versionSize,
      ],
    });
  }
}

function parseKnowledge(row) {
  return {
    ...row,
    content: fromJson(row.content_json),
    confidence: row.confidence == null ? null : Number(row.confidence),
    importance: Number(row.importance),
  };
}
