import { byteSize } from "../storage/serialization.js";

export const STORAGE_CATEGORIES = Object.freeze([
  "documents",
  "memory",
  "embeddings",
  "logs",
  "cache",
  "provenance",
  "other",
]);

const CATEGORY_QUERIES = Object.freeze({
  documents: [
    "SELECT COALESCE(SUM(size_bytes),0) AS bytes FROM documents WHERE tenant_id = ? AND user_id = ?",
    "SELECT COALESCE(SUM(size_bytes),0) AS bytes FROM document_versions WHERE tenant_id = ? AND user_id = ?",
  ],
  memory: [
    "SELECT COALESCE(SUM(size_bytes),0) AS bytes FROM memory_records WHERE tenant_id = ? AND user_id = ?",
    "SELECT COALESCE(SUM(size_bytes),0) AS bytes FROM memory_versions WHERE tenant_id = ? AND user_id = ?",
    "SELECT COALESCE(SUM(size_bytes),0) AS bytes FROM conversation_context WHERE tenant_id = ? AND user_id = ?",
    "SELECT COALESCE(SUM(size_bytes),0) AS bytes FROM knowledge_records WHERE tenant_id = ? AND user_id = ?",
    "SELECT COALESCE(SUM(size_bytes),0) AS bytes FROM knowledge_versions WHERE tenant_id = ? AND user_id = ?",
  ],
  embeddings: [
    "SELECT COALESCE(SUM(size_bytes),0) AS bytes FROM embeddings WHERE tenant_id = ? AND user_id = ? AND deleted_at IS NULL",
  ],
  logs: [
    "SELECT COALESCE(SUM(size_bytes),0) AS bytes FROM learning_events WHERE tenant_id = ? AND user_id = ?",
    "SELECT COALESCE(SUM(size_bytes),0) AS bytes FROM audit_records WHERE tenant_id = ? AND user_id = ?",
  ],
  cache: [
    "SELECT COALESCE(SUM(size_bytes),0) AS bytes FROM cache_entries WHERE tenant_id = ? AND user_id = ?",
  ],
  provenance: [
    "SELECT COALESCE(SUM(size_bytes),0) AS bytes FROM sources WHERE tenant_id = ? AND user_id = ?",
    "SELECT COALESCE(SUM(size_bytes),0) AS bytes FROM provenance_records WHERE tenant_id = ? AND user_id = ?",
    "SELECT COALESCE(SUM(payload_hash) IS NOT NULL,0) AS bytes FROM ledger_events WHERE tenant_id = ? AND user_id = ?",
  ],
  other: [
    "SELECT COALESCE(SUM(size_bytes),0) AS bytes FROM research_results WHERE tenant_id = ? AND user_id = ?",
    "SELECT COALESCE(SUM(size_bytes),0) AS bytes FROM media_metadata WHERE tenant_id = ? AND user_id = ?",
    "SELECT COALESCE(SUM(size_bytes),0) AS bytes FROM model_provider_metadata WHERE tenant_id = ? AND user_id = ?",
  ],
});

function toNumber(value) {
  return Number(value ?? 0);
}

export function createStorageQuotaManager({ client, quotaBytes, warningThresholds = [0.8, 0.9] }) {
  if (!Number.isFinite(quotaBytes) || quotaBytes <= 0) {
    throw new TypeError("A positive storage quota is required.");
  }

  async function usage(scope) {
    const args = [scope.tenantId, scope.userId];
    const categories = {};

    for (const category of STORAGE_CATEGORIES) {
      let total = 0;
      for (const sql of CATEGORY_QUERIES[category]) {
        const result = await client.execute({ sql, args });
        total += toNumber(result.rows[0]?.bytes);
      }
      categories[category] = total;
    }

    const usedBytes = Object.values(categories).reduce((sum, value) => sum + value, 0);

    return {
      quotaBytes,
      usedBytes,
      remainingBytes: Math.max(0, quotaBytes - usedBytes),
      usagePercentage: usedBytes / quotaBytes * 100,
      categories,
      warnings: warningThresholds
        .filter((threshold) => usedBytes / quotaBytes >= threshold)
        .map((threshold) => ({
          threshold,
          percentage: threshold * 100,
        })),
      enforcement: {
        canWriteBytes: Math.max(0, quotaBytes - usedBytes),
        hardLimit: true,
      },
    };
  }

  async function assertWithinQuota(scope, deltaBytes = 0, { category = "other" } = {}) {
    if (!STORAGE_CATEGORIES.includes(category)) throw new TypeError("Invalid storage category.");
    if (deltaBytes <= 0) return;

    const current = await usage(scope);
    if (current.usedBytes + deltaBytes > quotaBytes) {
      const error = new Error("JUNI storage quota exceeded.");
      error.code = "STORAGE_QUOTA_EXCEEDED";
      error.category = category;
      error.quotaBytes = quotaBytes;
      error.usedBytes = current.usedBytes;
      error.requestedBytes = deltaBytes;
      throw error;
    }
  }

  return Object.freeze({
    usage,
    assertWithinQuota,
    estimateBytes: byteSize,
    quotaBytes,
  });
}

export function parseQuotaBytes(value, fallback = 10 * 1024 ** 3) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
