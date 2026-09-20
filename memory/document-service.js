import { randomUUID } from "node:crypto";
import { assertScope, assertSourceType } from "./model.js";
import { byteSize, hashString, toJson, fromJson } from "../storage/serialization.js";

export const DOCUMENT_TYPES = Object.freeze([
  "pdf",
  "txt",
  "markdown",
  "doc",
  "docx",
  "web",
  "image",
  "audio",
  "video",
  "other",
]);

function validateUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
    return parsed.toString();
  } catch {
    throw new TypeError("Invalid document source URL.");
  }
}

export class DocumentService {
  #client;
  #quota;
  #ledger;
  #provenance;

  constructor({ client, quota, ledger, provenance }) {
    this.#client = client;
    this.#quota = quota;
    this.#ledger = ledger;
    this.#provenance = provenance;
  }

  async register(scope, input) {
    assertScope(scope);
    const type = input.documentType ?? inferDocumentType(input.name, input.mimeType);
    if (!DOCUMENT_TYPES.includes(type)) throw new TypeError("Invalid document type.");

    const id = input.id ?? randomUUID();
    const createdAt = new Date().toISOString();
    const metadata = input.metadata && typeof input.metadata === "object" ? structuredClone(input.metadata) : {};
    const sourceUrl = validateUrl(input.sourceUrl ?? null);
    const sizeBytes = Math.max(0, Number(input.sizeBytes ?? 0));
    const checksum = input.checksum ?? (input.content == null ? hashString(id) : hashString(String(input.content)));
    const row = {
      id, tenant_id: scope.tenantId, user_id: scope.userId, name: String(input.name ?? id),
      mime_type: input.mimeType ?? null, document_type: type, source_url: sourceUrl,
      title: input.title ?? null, size_bytes: sizeBytes, checksum, storage_uri: input.storageUri ?? null,
      current_version: 1, processing_status: input.processingStatus ?? "registered",
      retention_expires_at: input.retentionExpiresAt instanceof Date ? input.retentionExpiresAt.toISOString() : input.retentionExpiresAt ?? null,
      created_at: createdAt, updated_at: createdAt, metadata_json: toJson(metadata),
    };
    const metadataSize = byteSize({ ...row, size_bytes: sizeBytes });

    const tx = await this.#client.transaction("write");
    try {
      await this.#quota.assertWithinQuota(scope, metadataSize + sizeBytes, { category: "documents", executor: tx });
      await tx.execute({
        sql: `INSERT INTO documents (
          id, tenant_id, user_id, name, mime_type, document_type, source_url, title,
          size_bytes, checksum, storage_uri, current_version, processing_status,
          retention_expires_at, created_at, updated_at, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          row.id, row.tenant_id, row.user_id, row.name, row.mime_type, row.document_type,
          row.source_url, row.title, row.size_bytes, row.checksum, row.storage_uri,
          row.current_version, row.processing_status, row.retention_expires_at,
          row.created_at, row.updated_at, row.metadata_json,
        ],
      });

      await this.#provenance.createInTransaction(tx, scope, {
        subjectId: id,
        sourceType: input.sourceType ?? "user",
        sourceUrl,
        sourceTitle: input.title ?? row.name,
        retrievalTimestamp: input.retrievedAt ?? createdAt,
        sourceHash: checksum,
        provider: input.provider ?? null,
        tool: input.tool ?? null,
        relatedIds: [id],
        metadata: { mimeType: row.mime_type, documentType: type },
      });

      await this.#ledger.appendInTransaction(tx, scope, {
        eventType: "document_ingested",
        actorType: input.actorType ?? "user",
        actorId: input.actorId ?? null,
        objectId: id,
        objectVersion: 1,
        payload: {
          name: row.name,
          documentType: type,
          mimeType: row.mime_type,
          checksum,
          semanticProcessingPerformed: false,
        },
        sourceHash: checksum,
        provider: input.provider ?? null,
        model: input.model ?? null,
      });

      await tx.commit();
      return serializeDocument(row);
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  async addVersion(scope, documentId, input = {}) {
    assertScope(scope);
    const current = await this.get(scope, documentId);
    if (!current) {
      const error = new Error("Document not found.");
      error.code = "DOCUMENT_NOT_FOUND";
      throw error;
    }

    const version = Number(current.current_version) + 1;
    const createdAt = new Date().toISOString();
    const extractedText = input.extractedText == null ? null : String(input.extractedText);
    const metadata = input.metadata && typeof input.metadata === "object" ? structuredClone(input.metadata) : {};
    const checksum = input.checksum ?? (extractedText == null ? current.checksum : hashString(extractedText));
    const versionSize = byteSize({
      documentId, version, extractedText, metadata, checksum,
      extractionMethod: input.extractionMethod ?? null,
    });

    const tx = await this.#client.transaction("write");
    try {
      await this.#quota.assertWithinQuota(scope, versionSize, { category: "documents", executor: tx });
      await tx.execute({
        sql: `INSERT INTO document_versions (
          document_id, tenant_id, user_id, version, extracted_text, extraction_method,
          extracted_at, source_url, checksum, metadata_json, size_bytes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          documentId, scope.tenantId, scope.userId, version, extractedText,
          input.extractionMethod ?? null, extractedText == null ? null : createdAt,
          input.sourceUrl ?? current.source_url, checksum, toJson(metadata), versionSize, createdAt,
        ],
      });

      await tx.execute({
        sql: "UPDATE documents SET current_version = ?, processing_status = ?, checksum = ?, updated_at = ? WHERE tenant_id = ? AND user_id = ? AND id = ?",
        args: [
          version, extractedText == null ? "registered" : "extracted",
          checksum, createdAt, scope.tenantId, scope.userId, documentId,
        ],
      });

      await this.#ledger.appendInTransaction(tx, scope, {
        eventType: "document_changed",
        actorType: input.actorType ?? "user",
        actorId: input.actorId ?? null,
        objectId: documentId,
        objectVersion: version,
        payload: {
          previousVersion: current.current_version,
          extractionMethod: input.extractionMethod ?? null,
          semanticProcessingPerformed: extractedText != null,
          checksum,
        },
        sourceHash: checksum,
        provider: input.provider ?? null,
        model: input.model ?? null,
      });

      await tx.commit();
      return this.get(scope, documentId);
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  async get(scope, id) {
    assertScope(scope);
    const result = await this.#client.execute({
      sql: "SELECT * FROM documents WHERE tenant_id = ? AND user_id = ? AND id = ?",
      args: [scope.tenantId, scope.userId, id],
    });
    return result.rows[0] ? serializeDocument(result.rows[0]) : null;
  }

  async version(scope, id, version) {
    assertScope(scope);
    const result = await this.#client.execute({
      sql: "SELECT * FROM document_versions WHERE tenant_id = ? AND user_id = ? AND document_id = ? AND version = ?",
      args: [scope.tenantId, scope.userId, id, version],
    });
    const row = result.rows[0];
    return row ? {
      ...row,
      metadata: fromJson(row.metadata_json, []),
    } : null;
  }
}

function inferDocumentType(name = "", mimeType = "") {
  const normalizedMime = String(mimeType).toLowerCase();
  if (normalizedMime.includes("pdf")) return "pdf";
  if (normalizedMime.includes("markdown")) return "markdown";
  if (normalizedMime.includes("text/plain")) return "txt";
  if (normalizedMime.includes("wordprocessingml") || normalizedMime.includes("msword")) return "docx";
  if (normalizedMime.startsWith("image/")) return "image";
  if (normalizedMime.startsWith("audio/")) return "audio";
  if (normalizedMime.startsWith("video/")) return "video";

  const ext = String(name).toLowerCase().split(".").pop();
  return ({
    md: "markdown",
    markdown: "markdown",
    txt: "txt",
    pdf: "pdf",
    doc: "doc",
    docx: "docx",
    html: "web",
    htm: "web",
  })[ext] ?? "other";
}

function serializeDocument(row) {
  return {
    ...row,
    metadata: fromJson(row.metadata_json, {}),
  };
}
