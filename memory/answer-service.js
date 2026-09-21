
import { randomUUID } from "node:crypto";
import { assertScope } from "./model.js";
import { byteSize, hashString, toJson } from "../storage/serialization.js";

const MIN_SEMANTIC_THRESHOLD = 0.8;
const MAX_SEMANTIC_THRESHOLD = 0.95;
const DEFAULT_SEMANTIC_THRESHOLD = 0.92;

function normalizeThreshold(value = DEFAULT_SEMANTIC_THRESHOLD) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SEMANTIC_THRESHOLD;
  return Math.min(MAX_SEMANTIC_THRESHOLD, Math.max(MIN_SEMANTIC_THRESHOLD, parsed));
}

export function normalizeQuestion(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[!?.,;:()[\]{}'\"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isCacheableAnswerRequest(request = {}) {
  if (request.cacheAnswer === false) return false;

  const metadata = request.metadata ?? {};
  if (metadata.timeSensitive === true || metadata.personalized === true || metadata.turnDependent === true) {
    return false;
  }

  const question = String(request.message ?? request.question ?? "").trim();
  if (!question) return false;

  if (request.task === "research" || metadata.requiresWebResearch === true) return false;
  if (Array.isArray(request.messages) && request.messages.length > 0) return false;

  const timeSensitivePattern =
    /\b(latest|current|currently|today|tonight|tomorrow|yesterday|now|as of|this week|this month|this year|price|prices|stock|stocks|weather|exchange rate)\b/i;
  if (timeSensitivePattern.test(question)) return false;

  const personalizedPattern =
    /\b(my|mine|me|for me|my account|my order|my profile|my subscription|my settings)\b/i;
  if (personalizedPattern.test(question)) return false;

  return true;
}

function parseRow(row) {
  if (!row) return null;
  return {
    ...row,
    needsReview: Boolean(row.needs_review),
    ttlSeconds: Number(row.ttl_seconds),
    hitCount: Number(row.hit_count),
    confidence: row.confidence == null ? null : Number(row.confidence),
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : {},
  };
}

export class SavedAnswerService {
  #client;
  #quota;
  #ledger;
  #vectors;
  #embedder;
  #events;

  constructor({ client, quota, ledger, vectors, embedder = null, events = null }) {
    this.#client = client;
    this.#quota = quota;
    this.#ledger = ledger;
    this.#vectors = vectors;
    this.#embedder = embedder;
    this.#events = events;
  }

  async answerFirst(scope, request, { semanticThreshold = DEFAULT_SEMANTIC_THRESHOLD } = {}) {
    assertScope(scope);
    const question = String(request?.message ?? request?.question ?? "").trim();
    const normalized = normalizeQuestion(question);
    if (!normalized) return { hit: false, reason: "empty_question" };

    const now = new Date().toISOString();
    const exact = await this.#client.execute({
      sql: "SELECT * FROM saved_answers WHERE tenant_id = ? AND user_id = ? AND status = 'approved' AND normalized_question = ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY updated_at DESC LIMIT 1",
      args: [scope.tenantId, scope.userId, normalized, now],
    });

    if (exact.rows[0]) {
      const row = parseRow(exact.rows[0]);
      await this.#recordHit(scope, row, "exact", 1, request?.metadata?.requestId ?? null);
      return {
        hit: true,
        matchType: "exact",
        score: 1,
        answerId: row.id,
        answer: row.answer_text,
        provider: row.provider,
        model: row.model,
        sourceType: row.source_type,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
      };
    }

    let queryVector;
    if (this.#embedder) {
      try {
        const generated = await this.#embedder({
          text: question,
          kind: "query",
          scope,
          request,
        });
        queryVector = generated?.vector;
      } catch (error) {
        this.#events?.emit("answer.semantic_unavailable", {
          code: error?.code ?? error?.name ?? "EMBEDDING_ERROR",
        }, { requestId: request?.metadata?.requestId });
      }
    }

    if (!Array.isArray(queryVector)) {
      await this.#recordMiss(scope, normalized, request?.metadata?.requestId ?? null, "semantic_unavailable");
      return { hit: false, reason: "semantic_unavailable" };
    }

    const threshold = normalizeThreshold(semanticThreshold);
    let semanticResults = [];
    try {
      semanticResults = await this.#vectors.search(scope, queryVector, {
        objectType: "saved_answer",
        minScore: threshold,
        limit: 5,
      });
    } catch (error) {
      await this.#recordMiss(scope, normalized, request?.metadata?.requestId ?? null, "semantic_search_failed");
      this.#events?.emit("answer.semantic_failed", {
        code: error?.code ?? error?.name ?? "VECTOR_ERROR",
      }, { requestId: request?.metadata?.requestId });
      return { hit: false, reason: "semantic_search_failed" };
    }

    for (const candidate of semanticResults) {
      const rowResult = await this.#client.execute({
        sql: "SELECT * FROM saved_answers WHERE tenant_id = ? AND user_id = ? AND id = ? AND status = 'approved' AND (expires_at IS NULL OR expires_at > ?) LIMIT 1",
        args: [scope.tenantId, scope.userId, candidate.objectId, now],
      });
      const row = parseRow(rowResult.rows[0]);
      if (!row) continue;

      await this.#recordHit(scope, row, "semantic", candidate.score, request?.metadata?.requestId ?? null);
      return {
        hit: true,
        matchType: "semantic",
        score: candidate.score,
        answerId: row.id,
        answer: row.answer_text,
        provider: row.provider,
        model: row.model,
        sourceType: row.source_type,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
      };
    }

    await this.#recordMiss(scope, normalized, request?.metadata?.requestId ?? null, "no_match");
    return { hit: false, reason: "no_match" };
  }

  async createCandidate(scope, {
    question,
    answer,
    provider = null,
    model = null,
    sourceType = "model",
    sourceRef = null,
    confidence = null,
    ttlSeconds = 2_592_000,
    metadata = {},
    requestId = null,
  } = {}) {
    assertScope(scope);
    const questionText = String(question ?? "").trim();
    const answerText = String(answer ?? "").trim();
    if (!questionText) throw new TypeError("Candidate question is required.");
    if (!answerText) throw new TypeError("Candidate answer is required.");

    const normalizedQuestion = normalizeQuestion(questionText);
    if (!normalizedQuestion) throw new TypeError("Candidate question is empty after normalization.");

    const safeTtl = Math.max(60, Math.floor(Number(ttlSeconds) || 2_592_000));
    const now = new Date();
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + safeTtl * 1000).toISOString();
    const id = randomUUID();
    const checksum = hashString(answerText);
    const metadataJson = toJson(metadata);
    const sizeBytes = byteSize({
      id,
      tenantId: scope.tenantId,
      userId: scope.userId,
      questionText,
      normalizedQuestion,
      answerText,
      sourceType,
      sourceRef,
      provider,
      model,
      confidence,
      ttlSeconds: safeTtl,
      metadata,
      createdAt,
      expiresAt,
    });

    const tx = await this.#client.transaction("write");
    try {
      await this.#quota.assertWithinQuota(scope, sizeBytes, { category: "memory", executor: tx });
      await tx.execute({
        sql: "INSERT INTO saved_answers (id, tenant_id, user_id, question_text, normalized_question, answer_text, source_type, source_ref, provider, model, status, needs_review, confidence, created_at, updated_at, expires_at, ttl_seconds, hit_count, approved_by, approved_at, checksum, metadata_json, size_bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'needs_review', 1, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?, ?)",
        args: [
          id, scope.tenantId, scope.userId, questionText, normalizedQuestion, answerText,
          sourceType, sourceRef ?? requestId, provider, model, confidence,
          createdAt, createdAt, expiresAt, safeTtl, checksum, metadataJson, sizeBytes,
        ],
      });

      await this.#ledger.appendInTransaction(tx, scope, {
        eventType: "answer_candidate_created",
        actorType: "system",
        actorId: null,
        objectId: id,
        objectVersion: 1,
        payload: {
          normalizedQuestion,
          sourceType,
          provider,
          model,
          expiresAt,
          ttlSeconds: safeTtl,
          needsReview: true,
        },
      });

      await tx.commit();
    } catch (error) {
      await tx.rollback();
      throw error;
    }

    const candidate = await this.get(scope, id);
    this.#events?.emit("answer.candidate_created", {
      answerId: id,
      needsReview: true,
    }, { provider, model, requestId });

    return candidate;
  }

  async get(scope, id) {
    assertScope(scope);
    const result = await this.#client.execute({
      sql: "SELECT * FROM saved_answers WHERE tenant_id = ? AND user_id = ? AND id = ?",
      args: [scope.tenantId, scope.userId, id],
    });
    return parseRow(result.rows[0]);
  }

  async listCandidates(scope, { limit = 50 } = {}) {
    assertScope(scope);
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
    const result = await this.#client.execute({
      sql: "SELECT * FROM saved_answers WHERE tenant_id = ? AND user_id = ? AND status = 'needs_review' ORDER BY created_at DESC LIMIT ?",
      args: [scope.tenantId, scope.userId, safeLimit],
    });
    return result.rows.map(parseRow);
  }

  async approve(scope, id, { approvedBy } = {}) {
    assertScope(scope);
    if (!approvedBy || !String(approvedBy).trim()) {
      const error = new Error("Explicit approval identity is required.");
      error.code = "ANSWER_APPROVAL_REQUIRED";
      throw error;
    }

    const candidate = await this.get(scope, id);
    if (!candidate) {
      const error = new Error("Saved-answer candidate not found.");
      error.code = "ANSWER_CANDIDATE_NOT_FOUND";
      throw error;
    }
    if (candidate.status !== "needs_review") return candidate;

    const approvedAt = new Date().toISOString();
    await this.#client.execute({
      sql: "UPDATE saved_answers SET status = 'approved', needs_review = 0, approved_by = ?, approved_at = ?, updated_at = ? WHERE tenant_id = ? AND user_id = ? AND id = ? AND status = 'needs_review'",
      args: [String(approvedBy).trim(), approvedAt, approvedAt, scope.tenantId, scope.userId, id],
    });

    const approved = await this.get(scope, id);

    if (this.#embedder) {
      try {
        const generated = await this.#embedder({
          text: approved.question_text,
          answer: approved.answer_text,
          kind: "saved_answer",
          scope,
          record: approved,
        });
        if (generated?.vector?.length) {
          await this.#vectors.insert(scope, {
            objectType: "saved_answer",
            objectId: approved.id,
            version: 1,
            vector: generated.vector,
            provider: generated.provider ?? "configured-embedder",
            model: generated.model ?? "saved-answer-embedding",
            sourceType: approved.source_type,
            sourceRef: approved.source_ref,
            metadata: {
              answerId: approved.id,
              status: "approved",
            },
          });
        }
      } catch (error) {
        this.#events?.emit("answer.embedding_failed", {
          answerId: approved.id,
          code: error?.code ?? error?.name ?? "EMBEDDING_ERROR",
        }, {});
      }
    }

    await this.#safeLedger(scope, {
      eventType: "answer_approved",
      objectId: id,
      payload: {
        approvedBy: String(approvedBy).trim(),
        provider: approved.provider,
        model: approved.model,
      },
    });
    this.#events?.emit("answer.approved", {
      answerId: id,
      approvedBy: String(approvedBy).trim(),
    }, { provider: approved.provider, model: approved.model });

    return this.get(scope, id);
  }

  async reject(scope, id, { rejectedBy, reason = null } = {}) {
    assertScope(scope);
    const candidate = await this.get(scope, id);
    if (!candidate) {
      const error = new Error("Saved-answer candidate not found.");
      error.code = "ANSWER_CANDIDATE_NOT_FOUND";
      throw error;
    }
    if (candidate.status !== "needs_review") return candidate;

    const now = new Date().toISOString();
    await this.#client.execute({
      sql: "UPDATE saved_answers SET status = 'rejected', needs_review = 0, updated_at = ? WHERE tenant_id = ? AND user_id = ? AND id = ? AND status = 'needs_review'",
      args: [now, scope.tenantId, scope.userId, id],
    });

    await this.#safeLedger(scope, {
      eventType: "answer_rejected",
      objectId: id,
      payload: { rejectedBy: rejectedBy ?? null, reason },
    });
    this.#events?.emit("answer.rejected", { answerId: id, reason }, {});
    return this.get(scope, id);
  }

  async purgeExpired(scope, now = new Date()) {
    assertScope(scope);
    const timestamp = now.toISOString();
    const expired = await this.#client.execute({
      sql: "SELECT id FROM saved_answers WHERE tenant_id = ? AND user_id = ? AND expires_at IS NOT NULL AND expires_at <= ?",
      args: [scope.tenantId, scope.userId, timestamp],
    });

    for (const row of expired.rows) {
      await this.#client.execute({
        sql: "DELETE FROM embeddings WHERE tenant_id = ? AND user_id = ? AND object_type = 'saved_answer' AND object_id = ?",
        args: [scope.tenantId, scope.userId, row.id],
      });
      await this.#client.execute({
        sql: "DELETE FROM saved_answers WHERE tenant_id = ? AND user_id = ? AND id = ?",
        args: [scope.tenantId, scope.userId, row.id],
      });
    }
    return expired.rows.length;
  }

  async #recordHit(scope, row, matchType, score, requestId) {
    await this.#client.execute({
      sql: "UPDATE saved_answers SET hit_count = hit_count + 1, updated_at = ? WHERE tenant_id = ? AND user_id = ? AND id = ?",
      args: [new Date().toISOString(), scope.tenantId, scope.userId, row.id],
    });

    await this.#safeLedger(scope, {
      eventType: "answer_hit",
      objectId: row.id,
      payload: { matchType, score, requestId },
    });
    this.#events?.emit("answer.hit", {
      answerId: row.id,
      matchType,
      score,
    }, { requestId, provider: row.provider, model: row.model });
  }

  async #recordMiss(scope, normalizedQuestion, requestId, reason) {
    await this.#safeLedger(scope, {
      eventType: "answer_miss",
      payload: {
        normalizedQuestionHash: hashString(normalizedQuestion),
        reason,
        requestId,
      },
    });
    this.#events?.emit("answer.miss", { reason }, { requestId });
  }

  async #safeLedger(scope, event) {
    try {
      await this.#ledger.append(scope, {
        actorType: "system",
        actorId: null,
        ...event,
      });
    } catch (error) {
      this.#events?.emit("answer.audit_failed", {
        code: error?.code ?? error?.name ?? "AUDIT_ERROR",
      }, {});
    }
  }
}

export {
  MIN_SEMANTIC_THRESHOLD,
  MAX_SEMANTIC_THRESHOLD,
  DEFAULT_SEMANTIC_THRESHOLD,
};
