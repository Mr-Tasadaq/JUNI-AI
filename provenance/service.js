import { randomUUID } from "node:crypto";
import { assertScope, assertSourceType } from "../memory/model.js";
import { byteSize, hashString, toJson, fromJson } from "../storage/serialization.js";
import { LEDGER_EVENT_TYPES } from "./ledger.js";

function validateOptionalUrl(url) {
  if (url == null || url === "") return null;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new TypeError("Source URL must use http or https.");
    }
    return parsed.toString();
  } catch {
    throw new TypeError("Invalid source URL.");
  }
}

export class ProvenanceService {
  #client;
  #ledger;
  #quota;

  constructor({ client, ledger, quota }) {
    this.#client = client;
    this.#ledger = ledger;
    this.#quota = quota;
  }

  async createInTransaction(tx, scope, {
    subjectId,
    sourceType,
    sourceUrl = null,
    sourceTitle = null,
    retrievalTimestamp = null,
    sourceHash = null,
    provider = null,
    tool = null,
    relatedIds = [],
    metadata = {},
    id = randomUUID(),
  }) {
    assertScope(scope);
    assertSourceType(sourceType);
    const url = validateOptionalUrl(sourceUrl);
    const safeMetadata = metadata && typeof metadata === "object" ? structuredClone(metadata) : {};
    const json = toJson(safeMetadata);
    const createdAt = new Date().toISOString();
    const sizeBytes = byteSize({
      id, subjectId, sourceType, sourceUrl: url, sourceTitle, retrievalTimestamp,
      sourceHash, provider, tool, relatedIds, metadata: safeMetadata, createdAt,
    });

    await this.#quota.assertWithinQuota(scope, sizeBytes, { category: "provenance", executor: tx });

    await tx.execute({
      sql: `INSERT INTO provenance_records (
        id, tenant_id, user_id, subject_id, source_type, source_url, source_title,
        retrieval_timestamp, source_hash, provider, tool, related_ids_json,
        metadata_json, created_at, size_bytes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id, scope.tenantId, scope.userId, subjectId, sourceType, url, sourceTitle,
        retrievalTimestamp, sourceHash, provider, tool, toJson([...relatedIds]),
        json, createdAt, sizeBytes,
      ],
    });

    await this.#ledger.appendInTransaction(tx, scope, {
      eventType: "source_registered",
      objectId: subjectId,
      actorType: "system",
      objectVersion: null,
      payload: {
        provenanceId: id,
        sourceType,
        sourceUrl: url,
        sourceTitle,
        provider,
        tool,
        relatedIds,
      },
      sourceHash,
      provider,
    });

    return {
      id,
      subjectId,
      sourceType,
      sourceUrl: url,
      sourceTitle,
      retrievalTimestamp,
      sourceHash,
      provider,
      tool,
      relatedIds: [...relatedIds],
      metadata: safeMetadata,
      createdAt,
      sizeBytes,
    };
  }

  async registerSourceInTransaction(tx, scope, input) {
    assertScope(scope);
    const sourceId = input.id ?? randomUUID();
    const sourceUrl = validateOptionalUrl(input.url ?? input.sourceUrl ?? null);
    const createdAt = new Date().toISOString();
    const metadata = input.metadata && typeof input.metadata === "object" ? structuredClone(input.metadata) : {};
    const checksum = input.checksum ?? (input.content == null ? null : hashString(String(input.content)));
    const sourceSize = byteSize({ ...input, id: sourceId, url: sourceUrl, metadata, createdAt });
    await this.#quota.assertWithinQuota(scope, sourceSize, { category: "provenance", executor: tx });
    await tx.execute({
      sql: "INSERT INTO sources (id,tenant_id,user_id,source_type,url,title,retrieved_at,checksum,provider,tool,metadata_json,created_at,size_bytes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      args: [sourceId, scope.tenantId, scope.userId, input.sourceType ?? "external", sourceUrl, input.title ?? null, input.retrievedAt ?? createdAt, checksum, input.provider ?? null, input.tool ?? null, toJson(metadata), createdAt, sourceSize],
    });
    const provenance = await this.createInTransaction(tx, scope, {
      subjectId: input.subjectId ?? sourceId, sourceType: input.sourceType ?? "external",
      sourceUrl, sourceTitle: input.title ?? null, retrievalTimestamp: input.retrievedAt ?? createdAt,
      sourceHash: checksum, provider: input.provider ?? null, tool: input.tool ?? null,
      relatedIds: input.relatedIds ?? [], metadata,
    });
    return { sourceId, provenance };
  }

  async registerSource(scope, input) {
    assertScope(scope);
    const tx = await this.#client.transaction("write");
    try {
      const result = await this.registerSourceInTransaction(tx, scope, input);
      await tx.commit();
      return result;
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  async get(scope, id) {
    assertScope(scope);
    const result = await this.#client.execute({
      sql: "SELECT * FROM provenance_records WHERE tenant_id = ? AND user_id = ? AND id = ?",
      args: [scope.tenantId, scope.userId, id],
    });
    const row = result.rows[0];
    if (!row) return null;
    return {
      ...row,
      relatedIds: fromJson(row.related_ids_json, []),
      metadata: fromJson(row.metadata_json, {}),
    };
  }

  async list(scope, { subjectId = null, limit = 100 } = {}) {
    assertScope(scope);
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 100));
    const result = subjectId
      ? await this.#client.execute({
          sql: "SELECT * FROM provenance_records WHERE tenant_id = ? AND user_id = ? AND subject_id = ? ORDER BY created_at DESC LIMIT ?",
          args: [scope.tenantId, scope.userId, subjectId, safeLimit],
        })
      : await this.#client.execute({
          sql: "SELECT * FROM provenance_records WHERE tenant_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?",
          args: [scope.tenantId, scope.userId, safeLimit],
        });

    return result.rows.map((row) => ({
      ...row,
      relatedIds: fromJson(row.related_ids_json, []),
      metadata: fromJson(row.metadata_json, {}),
    }));
  }

  async verify(scope) {
    return this.#ledger.verify(scope);
  }
}

export { LEDGER_EVENT_TYPES, validateOptionalUrl };
