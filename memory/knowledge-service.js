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

export function normalizeAnswerQuestion(question) {
  const normalized = String(question ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (!normalized) throw new TypeError("Answer question is required.");
  if (normalized.length > 4_000) throw new TypeError("Answer question is too long.");
  return normalized;
}

export function answerQuestionHash(question) {
  return hashString(normalizeAnswerQuestion(question));
}

export class KnowledgeService {
  #client;
  #quota;
  #ledger;
  #provenance;
  #events;
  #vectors;
  #answerEmbedder;

  constructor({ client, quota, ledger, provenance, events, vectors = null, answerEmbedder = null }) {
    this.#client = client;
    this.#quota = quota;
    this.#ledger = ledger;
    this.#provenance = provenance;
    this.#events = events;
    this.#vectors = vectors;
    this.#answerEmbedder = answerEmbedder;
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
      if (input.source && !record.provenance_ref) {
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

  async createAnswerCandidate(scope, {
    question,
    answer,
    provider = null,
    model = null,
    retentionExpiresAt = null,
  } = {}) {
    assertScope(scope);

    const normalizedQuestion = normalizeAnswerQuestion(question);
    const answerText = String(answer ?? "").trim();
    if (!answerText) throw new TypeError("Answer text is required.");

    if (retentionExpiresAt != null) {
      const expiry = new Date(retentionExpiresAt);
      if (Number.isNaN(expiry.getTime())) throw new TypeError("Invalid candidate retention expiry.");
      retentionExpiresAt = expiry.toISOString();
    }

    const existing = await this.#client.execute({
      sql: "SELECT * FROM knowledge_records " +
        "WHERE tenant_id = ? AND user_id = ? " +
        "AND knowledge_type = 'saved_answer' " +
        "AND title = ? " +
        "AND status = 'candidate' " +
        "AND deleted_at IS NULL " +
        "ORDER BY updated_at DESC LIMIT 1",
      args: [scope.tenantId, scope.userId, normalizedQuestion],
    });

    if (existing.rows[0]) return parseKnowledge(existing.rows[0]);

    return this.create(scope, {
      knowledgeType: "saved_answer",
      title: normalizedQuestion,
      content: answerText,
      contentText: answerText,
      sourceType: "model",
      trustLevel: "generated",
      status: "candidate",
      retentionExpiresAt,
      provider,
      model,
      actorType: "system",
      source: {
        type: "model",
        provider,
        metadata: {
          answerFirstCandidate: true,
          questionHash: hashString(normalizedQuestion),
        },
      },
    });
  }
  async createAnswerIndex(scope, {
    knowledgeId,
    question,
    expiresAt = null,
    cacheable = true,
    provider = null,
    model = null,
    embedding = null,
  } = {}) {
    assertScope(scope);

    const normalizedQuestion = normalizeAnswerQuestion(question);
    const questionHash = hashString(normalizedQuestion);
    const knowledge = await this.get(scope, knowledgeId);

    if (!knowledge) {
      const error = new Error("Knowledge not found.");
      error.code = "KNOWLEDGE_NOT_FOUND";
      throw error;
    }

    if (!PROMOTED.has(knowledge.status)) {
      const error = new Error("Only approved knowledge can be indexed as a saved answer.");
      error.code = "KNOWLEDGE_APPROVAL_REQUIRED";
      throw error;
    }

    if (expiresAt != null) {
      const expiry = new Date(expiresAt);
      if (Number.isNaN(expiry.getTime())) throw new TypeError("Invalid answer expiry.");
      expiresAt = expiry.toISOString();
    }

    const id = knowledge.id;
    const now = new Date().toISOString();
    const sizeBytes = byteSize({
      knowledgeId: id,
      tenantId: scope.tenantId,
      userId: scope.userId,
      question: normalizedQuestion,
      questionHash,
      expiresAt,
      cacheable: Boolean(cacheable),
      provider,
      model,
      now,
    });

    const tx = await this.#client.transaction("write");
    try {
      const existing = await tx.execute({
        sql: "SELECT size_bytes, hit_count FROM answer_index WHERE tenant_id = ? AND user_id = ? AND knowledge_id = ?",
        args: [scope.tenantId, scope.userId, id],
      });
      const delta = sizeBytes - Number(existing.rows[0]?.size_bytes ?? 0);
      await this.#quota.assertWithinQuota(scope, delta, { category: "memory", executor: tx });

      await tx.execute({
        sql: `INSERT INTO answer_index (
          knowledge_id, tenant_id, user_id, question_text, normalized_question,
          question_hash, expires_at, cacheable, provider, model, hit_count,
          last_hit_at, created_at, updated_at, size_bytes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)
        ON CONFLICT(knowledge_id) DO UPDATE SET
          question_text = excluded.question_text,
          normalized_question = excluded.normalized_question,
          question_hash = excluded.question_hash,
          expires_at = excluded.expires_at,
          cacheable = excluded.cacheable,
          provider = excluded.provider,
          model = excluded.model,
          updated_at = excluded.updated_at,
          size_bytes = excluded.size_bytes`,
        args: [
          id, scope.tenantId, scope.userId, String(question).trim(), normalizedQuestion,
          questionHash, expiresAt, cacheable ? 1 : 0, provider, model, now, now, sizeBytes,
        ],
      });

      await this.#ledger.appendInTransaction(tx, scope, {
        eventType: "answer_indexed",
        actorType: "system",
        actorId: null,
        objectId: id,
        objectVersion: knowledge.version,
        payload: {
          questionHash,
          cacheable: Boolean(cacheable),
          expiresAt,
          provider,
          model,
        },
        provider,
        model,
      });

      await tx.commit();

      if (embedding?.vector?.length && this.#vectors) {
        await this.#vectors.insert(scope, {
          objectType: "knowledge",
          objectId: id,
          version: knowledge.version,
          vector: embedding.vector,
          provider: embedding.provider ?? "answer-embedder",
          model: embedding.model ?? "answer-embedding",
          sourceType: "model",
          sourceRef: knowledge.id,
          metadata: {
            answerFirst: true,
            questionHash,
          },
        });
      }

      return {
        knowledgeId: id,
        question: String(question).trim(),
        normalizedQuestion,
        questionHash,
        expiresAt,
        cacheable: Boolean(cacheable),
        provider,
        model,
        hitCount: Number(existing.rows[0]?.hit_count ?? 0),
        lastHitAt: null,
        createdAt: now,
        updatedAt: now,
      };
    } catch (error) {
      try { await tx.rollback(); } catch {}
      throw error;
    }
  }

  async findExactSavedAnswer(scope, question, { now = new Date() } = {}) {
    assertScope(scope);

    const normalizedQuestion = normalizeAnswerQuestion(question);
    const questionHash = hashString(normalizedQuestion);
    const timestamp = now instanceof Date ? now.toISOString() : new Date(now).toISOString();

    const result = await this.#client.execute({
      sql: `SELECT
          a.*,
          k.knowledge_type,
          k.title,
          k.content_json,
          k.content_text,
          k.source_type,
          k.source_ref,
          k.confidence,
          k.importance,
          k.trust_level,
          k.status AS knowledge_status,
          k.version,
          k.embedding_ref,
          k.provenance_ref,
          k.retention_expires_at,
          k.checksum,
          k.updated_at AS knowledge_updated_at
        FROM answer_index a
        JOIN knowledge_records k
          ON k.id = a.knowledge_id
         AND k.tenant_id = a.tenant_id
         AND k.user_id = a.user_id
        WHERE a.tenant_id = ?
          AND a.user_id = ?
          AND a.question_hash = ?
          AND a.cacheable = 1
          AND k.deleted_at IS NULL
          AND k.status IN ('important','permanent')
          AND (a.expires_at IS NULL OR a.expires_at > ?)
          AND (k.retention_expires_at IS NULL OR k.retention_expires_at > ?)
        ORDER BY k.importance DESC, k.updated_at DESC
        LIMIT 1`,
      args: [
        scope.tenantId,
        scope.userId,
        questionHash,
        timestamp,
        timestamp,
      ],
    });

    const row = result.rows[0];
    if (!row) return null;

    return {
      knowledgeId: row.knowledge_id,
      question: row.question_text,
      normalizedQuestion: row.normalized_question,
      questionHash: row.question_hash,
      answer: fromJson(row.content_json),
      contentText: row.content_text,
      title: row.title,
      status: row.knowledge_status,
      version: Number(row.version),
      sourceType: row.source_type,
      sourceRef: row.source_ref,
      confidence: row.confidence == null ? null : Number(row.confidence),
      importance: Number(row.importance),
      trustLevel: row.trust_level,
      provenanceRef: row.provenance_ref,
      expiresAt: row.expires_at,
      retentionExpiresAt: row.retention_expires_at,
      provider: row.provider,
      model: row.model,
      hitCount: Number(row.hit_count),
      lastHitAt: row.last_hit_at,
      updatedAt: row.knowledge_updated_at,
    };
  }

  async recordAnswerHit(scope, knowledgeId, {
    matchType = "exact",
    score = null,
    now = new Date(),
  } = {}) {
    assertScope(scope);

    const timestamp = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
    const tx = await this.#client.transaction("write");

    try {
      const current = await tx.execute({
        sql: "SELECT * FROM answer_index WHERE tenant_id = ? AND user_id = ? AND knowledge_id = ?",
        args: [scope.tenantId, scope.userId, knowledgeId],
      });

      if (!current.rows[0]) {
        const error = new Error("Saved answer index not found.");
        error.code = "ANSWER_INDEX_NOT_FOUND";
        throw error;
      }

      await tx.execute({
        sql: `UPDATE answer_index
          SET hit_count = hit_count + 1,
              last_hit_at = ?,
              updated_at = ?
          WHERE tenant_id = ? AND user_id = ? AND knowledge_id = ?`,
        args: [timestamp, timestamp, scope.tenantId, scope.userId, knowledgeId],
      });

      await this.#ledger.appendInTransaction(tx, scope, {
        eventType: "answer_cache_hit",
        actorType: "system",
        actorId: null,
        objectId: knowledgeId,
        objectVersion: null,
        payload: {
          matchType,
          score: Number.isFinite(Number(score)) ? Number(score) : null,
          occurredAt: timestamp,
        },
      });

      await tx.commit();

      const updated = await this.#client.execute({
        sql: "SELECT hit_count, last_hit_at FROM answer_index WHERE tenant_id = ? AND user_id = ? AND knowledge_id = ?",
        args: [scope.tenantId, scope.userId, knowledgeId],
      });

      return {
        knowledgeId,
        hitCount: Number(updated.rows[0]?.hit_count ?? 0),
        lastHitAt: updated.rows[0]?.last_hit_at ?? null,
        matchType,
        score: Number.isFinite(Number(score)) ? Number(score) : null,
      };
    } catch (error) {
      try { await tx.rollback(); } catch {}
      throw error;
    }
  }

  async findSemanticSavedAnswer(scope, question, { minScore = 0.92, now = new Date(), embedding = null } = {}) {
    assertScope(scope);
    if (!this.#vectors) return null;

    const threshold = Math.max(0.8, Math.min(0.95, Number(minScore) || 0.92));
    let queryEmbedding = embedding;

    if (!queryEmbedding && this.#answerEmbedder) {
      queryEmbedding = await this.#answerEmbedder({
        text: String(question ?? ""),
        kind: "query",
        scope,
      });
    }

    if (!queryEmbedding?.vector?.length) return null;

    const candidates = await this.#vectors.search(scope, queryEmbedding.vector, {
      objectType: "knowledge",
      metadataFilter: { answerFirst: true },
      minScore: threshold,
      limit: 5,
    });

    const timestamp = now instanceof Date ? now.toISOString() : new Date(now).toISOString();

    for (const candidate of candidates) {
      const result = await this.#client.execute({
        sql: `SELECT
            a.*,
            k.title,
            k.content_json,
            k.content_text,
            k.source_type,
            k.source_ref,
            k.confidence,
            k.importance,
            k.trust_level,
            k.status AS knowledge_status,
            k.version,
            k.provenance_ref,
            k.retention_expires_at,
            k.updated_at AS knowledge_updated_at
          FROM answer_index a
          JOIN knowledge_records k
            ON k.id = a.knowledge_id
           AND k.tenant_id = a.tenant_id
           AND k.user_id = a.user_id
          WHERE a.tenant_id = ?
            AND a.user_id = ?
            AND a.knowledge_id = ?
            AND a.cacheable = 1
            AND k.deleted_at IS NULL
            AND k.knowledge_type = 'saved_answer'
            AND k.status IN ('important','permanent')
            AND (a.expires_at IS NULL OR a.expires_at > ?)
            AND (k.retention_expires_at IS NULL OR k.retention_expires_at > ?)
          LIMIT 1`,
        args: [scope.tenantId, scope.userId, candidate.objectId, timestamp, timestamp],
      });

      const row = result.rows[0];
      if (!row) continue;

      return {
        knowledgeId: row.knowledge_id,
        question: row.question_text,
        normalizedQuestion: row.normalized_question,
        questionHash: row.question_hash,
        answer: fromJson(row.content_json),
        contentText: row.content_text,
        status: row.knowledge_status,
        version: Number(row.version),
        sourceType: row.source_type,
        sourceRef: row.source_ref,
        confidence: row.confidence == null ? null : Number(row.confidence),
        importance: Number(row.importance),
        trustLevel: row.trust_level,
        provenanceRef: row.provenance_ref,
        expiresAt: row.expires_at,
        retentionExpiresAt: row.retention_expires_at,
        provider: row.provider,
        model: row.model,
        hitCount: Number(row.hit_count),
        lastHitAt: row.last_hit_at,
        updatedAt: row.knowledge_updated_at,
        score: candidate.score,
      };
    }

    return null;
  }

  async recordAnswerMiss(scope, question, { reason = "no_match", now = new Date() } = {}) {
    assertScope(scope);
    const normalizedQuestion = normalizeAnswerQuestion(question);
    await this.#ledger.append(scope, {
      eventType: "answer_cache_miss",
      actorType: "system",
      actorId: null,
      objectId: null,
      payload: {
        questionHash: hashString(normalizedQuestion),
        reason,
        occurredAt: now instanceof Date ? now.toISOString() : new Date(now).toISOString(),
      },
    });
    return { questionHash: hashString(normalizedQuestion), reason };
  }

  async approveAnswerCandidate(scope, knowledgeId, { approvedBy, actorId = approvedBy } = {}) {
    assertScope(scope);
    if (!approvedBy) {
      const error = new Error("Explicit answer approval identity is required.");
      error.code = "ANSWER_APPROVAL_REQUIRED";
      throw error;
    }

    const candidate = await this.get(scope, knowledgeId);
    if (!candidate) {
      const error = new Error("Saved-answer candidate not found.");
      error.code = "ANSWER_CANDIDATE_NOT_FOUND";
      throw error;
    }

    if (candidate.knowledge_type !== "saved_answer") {
      const error = new Error("Only saved-answer candidates can be approved here.");
      error.code = "ANSWER_CANDIDATE_INVALID";
      throw error;
    }

    if (candidate.status !== "candidate") return candidate;

    const updated = await this.update(scope, knowledgeId, {
      status: "important",
      approvedBy,
      actorType: "user",
      actorId,
      changeType: "approved",
      changeSummary: "Answer-First candidate approved.",
    });

    let embedding = null;
    if (this.#answerEmbedder) {
      embedding = await this.#answerEmbedder({
        text: candidate.title,
        answer: candidate.content,
        kind: "saved-answer",
        scope,
        record: updated,
      });
    }

    await this.createAnswerIndex(scope, {
      knowledgeId: updated.id,
      question: candidate.title,
      expiresAt: updated.retention_expires_at,
      cacheable: true,
      provider: updated.source_type === "model" ? null : updated.source_type,
      model: null,
      embedding,
    });

    await this.#ledger.append(scope, {
      eventType: "answer_approved",
      actorType: "user",
      actorId,
      objectId: updated.id,
      objectVersion: updated.version,
      payload: {
        approvedBy,
        questionHash: hashString(normalizeAnswerQuestion(candidate.title)),
      },
    });

    return this.findExactSavedAnswer(scope, candidate.title);
  }

  async rejectAnswerCandidate(scope, knowledgeId, { rejectedBy = null, reason = null } = {}) {
    assertScope(scope);
    const candidate = await this.get(scope, knowledgeId);
    if (!candidate) {
      const error = new Error("Saved-answer candidate not found.");
      error.code = "ANSWER_CANDIDATE_NOT_FOUND";
      throw error;
    }
    if (candidate.knowledge_type !== "saved_answer") {
      const error = new Error("Only saved-answer candidates can be rejected here.");
      error.code = "ANSWER_CANDIDATE_INVALID";
      throw error;
    }
    if (candidate.status !== "candidate") return candidate;

    const updated = await this.update(scope, knowledgeId, {
      status: "archived",
      actorType: "user",
      actorId: rejectedBy,
      changeSummary: reason ? "Answer-First candidate rejected: " + String(reason) : "Answer-First candidate rejected.",
    });

    await this.#ledger.append(scope, {
      eventType: "answer_rejected",
      actorType: "user",
      actorId: rejectedBy,
      objectId: knowledgeId,
      objectVersion: updated.version,
      payload: { reason },
    });

    return updated;
  }

  async listAnswerCandidates(scope, { limit = 50 } = {}) {
    return this.list(scope, {
      knowledgeType: "saved_answer",
      statuses: ["candidate"],
      limit,
    });
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
      const delta = record.size_bytes - Number(existing.size_bytes);
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
