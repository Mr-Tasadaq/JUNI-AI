export const MEMORY_STATUSES = Object.freeze([
  "transient",
  "candidate",
  "important",
  "permanent",
  "archived",
  "deleted",
]);

export const MEMORY_TYPES = Object.freeze([
  "short_term_context",
  "long_term_memory",
  "user_preference",
  "important_fact",
  "learned_knowledge",
  "document_knowledge",
  "document_metadata",
  "extracted_document_knowledge",
  "embedding_record",
  "research_result",
  "cached_knowledge",
  "media_metadata",
  "learning_event",
  "audit_record",
  "provenance_record",
  "model_provider_metadata",
]);

export const SOURCE_TYPES = Object.freeze([
  "user",
  "external",
  "model",
  "tool",
  "system",
]);

export const TRUST_LEVELS = Object.freeze([
  "trusted",
  "reviewed",
  "untrusted",
  "generated",
]);

export function assertScope(scope) {
  if (!scope?.tenantId || !scope?.userId) {
    throw new TypeError("tenantId and userId are required.");
  }
}

export function assertStatus(status) {
  if (!MEMORY_STATUSES.includes(status)) throw new TypeError("Invalid memory status.");
}

export function assertMemoryType(type) {
  if (!MEMORY_TYPES.includes(type)) throw new TypeError("Invalid memory type.");
}

export function assertSourceType(source) {
  if (!SOURCE_TYPES.includes(source)) throw new TypeError("Invalid source type.");
}

export function assertTrustLevel(trust) {
  if (!TRUST_LEVELS.includes(trust)) throw new TypeError("Invalid trust level.");
}

export function parseMemory(row) {
  if (!row) return null;
  return {
    ...row,
    content: JSON.parse(row.content_json),
    confidence: row.confidence == null ? null : Number(row.confidence),
    importance: Number(row.importance),
  };
}
