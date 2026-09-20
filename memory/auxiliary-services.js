import { randomUUID } from "node:crypto";
import { assertScope } from "./model.js";
import { byteSize, hashString, toJson, fromJson } from "../storage/serialization.js";

function optionalUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
    return parsed.toString();
  } catch {
    throw new TypeError("Invalid URL.");
  }
}

export class ResearchService {
  #client; #quota; #ledger;
  constructor({ client, quota, ledger }) { this.#client = client; this.#quota = quota; this.#ledger = ledger; }

  async record(scope, input) {
    assertScope(scope);
    const id = input.id ?? randomUUID();
    const createdAt = new Date().toISOString();
    const url = optionalUrl(input.url);
    const metadata = input.metadata ?? {};
    const sizeBytes = byteSize({ ...input, id, metadata, createdAt });
    const tx = await this.#client.transaction("write");
    try {
      await this.#quota.assertWithinQuota(scope, sizeBytes, { category: "other", executor: tx });
      await tx.execute({
        sql: "INSERT INTO research_results (id, tenant_id, user_id, query, title, url, retrieved_at, content, source_hash, provider, tool, metadata_json, retention_expires_at, created_at, size_bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: [
          id, scope.tenantId, scope.userId, input.query, input.title ?? null, url,
          input.retrievedAt ?? createdAt, String(input.content ?? ""), input.sourceHash ?? null,
          input.provider ?? null, input.tool ?? null, toJson(metadata),
          input.retentionExpiresAt ?? null, createdAt, sizeBytes,
        ],
      });
      await this.#ledger.appendInTransaction(tx, scope, {
        eventType: "research_completed",
        actorType: input.actorType ?? "tool",
        actorId: input.actorId ?? null,
        objectId: id,
        objectVersion: 1,
        payload: { query: input.query, url, sourceHash: input.sourceHash ?? null, provider: input.provider ?? null, tool: input.tool ?? null },
        sourceHash: input.sourceHash ?? null,
        provider: input.provider ?? null,
      });
      await tx.commit();
      return { id, ...input, url, createdAt, sizeBytes };
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }
}

export class CacheService {
  #client; #quota;
  constructor({ client, quota }) { this.#client = client; this.#quota = quota; }

  async set(scope, { cacheKey, value, sourceRef = null, expiresAt = null }) {
    assertScope(scope);
    if (!cacheKey) throw new TypeError("cacheKey is required.");
    const id = randomUUID();
    const valueJson = toJson(value);
    const sizeBytes = byteSize({ cacheKey, value, sourceRef, expiresAt, id });
    const existing = await this.get(scope, cacheKey);
    const delta = sizeBytes - Number(existing?.size_bytes ?? 0);
    await this.#quota.assertWithinQuota(scope, delta, { category: "cache" });

    await this.#client.execute({
      sql: existing
        ? "UPDATE cache_entries SET value_json = ?, source_ref = ?, expires_at = ?, created_at = ?, size_bytes = ? WHERE tenant_id = ? AND user_id = ? AND cache_key = ?"
        : "INSERT INTO cache_entries (id, tenant_id, user_id, cache_key, value_json, source_ref, expires_at, created_at, size_bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      args: existing
        ? [valueJson, sourceRef, expiresAt, new Date().toISOString(), sizeBytes, scope.tenantId, scope.userId, cacheKey]
        : [id, scope.tenantId, scope.userId, cacheKey, valueJson, sourceRef, expiresAt, new Date().toISOString(), sizeBytes],
    });
    return this.get(scope, cacheKey);
  }

  async get(scope, cacheKey) {
    assertScope(scope);
    const result = await this.#client.execute({
      sql: "SELECT * FROM cache_entries WHERE tenant_id = ? AND user_id = ? AND cache_key = ?",
      args: [scope.tenantId, scope.userId, cacheKey],
    });
    const row = result.rows[0];
    return row ? { ...row, value: fromJson(row.value_json) } : null;
  }

  async delete(scope, cacheKey) {
    assertScope(scope);
    await this.#client.execute({
      sql: "DELETE FROM cache_entries WHERE tenant_id = ? AND user_id = ? AND cache_key = ?",
      args: [scope.tenantId, scope.userId, cacheKey],
    });
  }
}

export class MediaMetadataService {
  #client; #quota;
  constructor({ client, quota }) { this.#client = client; this.#quota = quota; }

  async upsert(scope, input) {
    assertScope(scope);
    const id = input.id ?? randomUUID();
    const now = new Date().toISOString();
    const metadata = input.metadata ?? {};
    const sizeBytes = byteSize({ ...input, id, metadata, now });
    const existing = await this.#client.execute({
      sql: "SELECT * FROM media_metadata WHERE tenant_id = ? AND user_id = ? AND id = ?",
      args: [scope.tenantId, scope.userId, id],
    });
    const oldSize = Number(existing.rows[0]?.size_bytes ?? 0);
    await this.#quota.assertWithinQuota(scope, sizeBytes - oldSize, { category: "other" });
    await this.#client.execute({
      sql: existing.rows.length
        ? "UPDATE media_metadata SET media_type = ?, storage_uri = ?, metadata_json = ?, checksum = ?, retention_expires_at = ?, updated_at = ?, size_bytes = ? WHERE tenant_id = ? AND user_id = ? AND id = ?"
        : "INSERT INTO media_metadata (id, tenant_id, user_id, media_type, storage_uri, metadata_json, checksum, retention_expires_at, created_at, updated_at, size_bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      args: existing.rows.length
        ? [input.mediaType, input.storageUri ?? null, toJson(metadata), input.checksum ?? null, input.retentionExpiresAt ?? null, now, sizeBytes, scope.tenantId, scope.userId, id]
        : [id, scope.tenantId, scope.userId, input.mediaType, input.storageUri ?? null, toJson(metadata), input.checksum ?? null, input.retentionExpiresAt ?? null, now, now, sizeBytes],
    });
    return { id, ...input, updatedAt: now, sizeBytes };
  }
}

export class ModelProviderMetadataService {
  #client; #quota;
  constructor({ client, quota }) { this.#client = client; this.#quota = quota; }

  async record(scope, input) {
    assertScope(scope);
    if (!input.provider || !input.model) throw new TypeError("provider and model are required.");
    const id = input.id ?? randomUUID();
    const now = new Date().toISOString();
    const metadata = input.metadata ?? {};
    const sizeBytes = byteSize({ id, provider: input.provider, model: input.model, metadata, now });
    await this.#quota.assertWithinQuota(scope, sizeBytes, { category: "other" });
    await this.#client.execute({
      sql: "INSERT INTO model_provider_metadata (id, tenant_id, user_id, provider, model, metadata_json, observed_at, created_at, size_bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      args: [id, scope.tenantId, scope.userId, input.provider, input.model, toJson(metadata), input.observedAt ?? now, now, sizeBytes],
    });
    return { id, provider: input.provider, model: input.model, metadata, observedAt: input.observedAt ?? now, sizeBytes };
  }
}
