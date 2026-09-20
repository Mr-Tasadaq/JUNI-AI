import { randomUUID } from "node:crypto";
import { assertScope, assertSourceType } from "./model.js";
import { byteSize, hashString, toJson, fromJson } from "../storage/serialization.js";

export class VectorStore {
  async insert() { throw new Error("VectorStore.insert() is not implemented."); }
  async update() { throw new Error("VectorStore.update() is not implemented."); }
  async delete() { throw new Error("VectorStore.delete() is not implemented."); }
  async search() { throw new Error("VectorStore.search() is not implemented."); }
}

function cosineSimilarity(a, b) {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function validateVector(vector) {
  if (!Array.isArray(vector) || !vector.length || vector.some((value) => !Number.isFinite(Number(value)))) {
    throw new TypeError("Embedding vector must be a non-empty numeric array.");
  }
  return vector.map(Number);
}

function metadataMatches(metadata, filter = {}) {
  return Object.entries(filter).every(([key, value]) => metadata?.[key] === value);
}

export class LibsqlVectorStore extends VectorStore {
  #client;
  #quota;
  #ledger;

  constructor({ client, quota, ledger }) {
    super();
    this.#client = client;
    this.#quota = quota;
    this.#ledger = ledger;
  }

  async insert(scope, input) {
    assertScope(scope);
    assertSourceType(input.sourceType ?? "model");
    const vector = validateVector(input.vector);
    const id = input.id ?? randomUUID();
    const createdAt = new Date().toISOString();
    const metadata = input.metadata && typeof input.metadata === "object" ? structuredClone(input.metadata) : {};
    const vectorJson = toJson(vector);
    const checksum = hashString(vectorJson);
    const sizeBytes = byteSize({
      id, tenantId: scope.tenantId, userId: scope.userId, objectType: input.objectType,
      objectId: input.objectId, version: input.version ?? 1, vector, provider: input.provider,
      model: input.model, sourceType: input.sourceType, sourceRef: input.sourceRef,
      metadata, createdAt,
    });

    const tx = await this.#client.transaction("write");
    try {
      await this.#quota.assertWithinQuota(scope, sizeBytes, { category: "embeddings", executor: tx });
      await tx.execute({
        sql: `INSERT INTO embeddings (
          id, tenant_id, user_id, object_type, object_id, version, vector_json, dimensions,
          provider, model, source_type, source_ref, metadata_json, checksum,
          created_at, updated_at, deleted_at, size_bytes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id, scope.tenantId, scope.userId, input.objectType, input.objectId, input.version ?? 1,
          vectorJson, vector.length, input.provider, input.model, input.sourceType,
          input.sourceRef ?? null, toJson(metadata), checksum, createdAt, createdAt, null, sizeBytes,
        ],
      });

      await this.#ledger.appendInTransaction(tx, scope, {
        eventType: "embedding_created",
        actorType: input.actorType ?? "system",
        actorId: input.actorId ?? null,
        objectId: input.objectId,
        objectVersion: input.version ?? 1,
        payload: {
          embeddingId: id,
          objectType: input.objectType,
          dimensions: vector.length,
          provider: input.provider,
          model: input.model,
          checksum,
        },
        sourceHash: input.sourceHash ?? null,
        provider: input.provider,
        model: input.model,
      });

      await tx.commit();
      return { id, objectType: input.objectType, objectId: input.objectId, version: input.version ?? 1, dimensions: vector.length, provider: input.provider, model: input.model, checksum, metadata };
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  async update(scope, id, changes = {}) {
    assertScope(scope);
    const existing = await this.get(scope, id);
    if (!existing) throw new Error("Embedding not found.");

    const vector = validateVector(changes.vector ?? existing.vector);
    const updatedAt = new Date().toISOString();
    const metadata = changes.metadata ?? existing.metadata;
    const vectorJson = toJson(vector);
    const checksum = changes.checksum ?? hashString(vectorJson);
    const newSize = byteSize({ id, objectType: existing.object_type, objectId: existing.object_id, version: existing.version, vector, metadata, provider: changes.provider ?? existing.provider, model: changes.model ?? existing.model, updatedAt });

    const tx = await this.#client.transaction("write");
    try {
      await this.#quota.assertWithinQuota(scope, newSize - Number(existing.size_bytes), { category: "embeddings", executor: tx });
      await tx.execute({
        sql: "UPDATE embeddings SET vector_json = ?, dimensions = ?, provider = ?, model = ?, source_type = ?, source_ref = ?, metadata_json = ?, checksum = ?, updated_at = ?, size_bytes = ? WHERE tenant_id = ? AND user_id = ? AND id = ?",
        args: [
          vectorJson, vector.length, changes.provider ?? existing.provider, changes.model ?? existing.model,
          changes.sourceType ?? existing.source_type, changes.sourceRef ?? existing.source_ref,
          toJson(metadata), checksum, updatedAt, newSize, scope.tenantId, scope.userId, id,
        ],
      });

      await this.#ledger.appendInTransaction(tx, scope, {
        eventType: "embedding_updated",
        actorType: changes.actorType ?? "system",
        actorId: changes.actorId ?? null,
        objectId: existing.object_id,
        objectVersion: existing.version,
        payload: { embeddingId: id, checksum },
        provider: changes.provider ?? existing.provider,
        model: changes.model ?? existing.model,
      });

      await tx.commit();
      return this.get(scope, id);
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  async delete(scope, id, { actorType = "system", actorId = null } = {}) {
    assertScope(scope);
    const existing = await this.get(scope, id);
    if (!existing) return null;

    const tx = await this.#client.transaction("write");
    try {
      await tx.execute({
        sql: "UPDATE embeddings SET deleted_at = ?, updated_at = ? WHERE tenant_id = ? AND user_id = ? AND id = ?",
        args: [new Date().toISOString(), new Date().toISOString(), scope.tenantId, scope.userId, id],
      });
      await this.#ledger.appendInTransaction(tx, scope, {
        eventType: "embedding_updated",
        actorType, actorId, objectId: existing.object_id, objectVersion: existing.version,
        payload: { embeddingId: id, deleted: true },
        provider: existing.provider, model: existing.model,
      });
      await tx.commit();
      return { ...existing, deleted: true };
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  async get(scope, id) {
    assertScope(scope);
    const result = await this.#client.execute({
      sql: "SELECT * FROM embeddings WHERE tenant_id = ? AND user_id = ? AND id = ? AND deleted_at IS NULL",
      args: [scope.tenantId, scope.userId, id],
    });
    const row = result.rows[0];
    if (!row) return null;
    return {
      ...row,
      vector: fromJson(row.vector_json, []),
      metadata: fromJson(row.metadata_json, {}),
    };
  }

  async search(scope, queryVector, {
    limit = 10,
    minScore = -1,
    metadataFilter = {},
    sourceType = null,
    objectType = null,
    objectId = null,
    version = null,
  } = {}) {
    assertScope(scope);
    const query = validateVector(queryVector);
    const boundedLimit = Math.max(1, Math.min(100, Number(limit) || 10));
    const result = await this.#client.execute({
      sql: `SELECT * FROM embeddings
        WHERE tenant_id = ? AND user_id = ? AND deleted_at IS NULL
          AND (? IS NULL OR source_type = ?)
          AND (? IS NULL OR object_type = ?)
          AND (? IS NULL OR object_id = ?)
          AND (? IS NULL OR version = ?)
        ORDER BY id ASC`,
      args: [scope.tenantId, scope.userId, sourceType, sourceType, objectType, objectType, objectId, objectId, version, version],
    });

    return result.rows
      .map((row) => {
        const vector = fromJson(row.vector_json, []);
        const metadata = fromJson(row.metadata_json, {});
        return {
          id: row.id,
          objectType: row.object_type,
          objectId: row.object_id,
          version: Number(row.version),
          score: cosineSimilarity(query, vector),
          provider: row.provider,
          model: row.model,
          sourceType: row.source_type,
          sourceRef: row.source_ref,
          metadata,
          matchesMetadata: metadataMatches(metadata, metadataFilter),
        };
      })
      .filter((item) => item.matchesMetadata && item.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, boundedLimit);
  }
}

export { cosineSimilarity, validateVector };
