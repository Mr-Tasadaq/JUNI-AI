export const PROVENANCE_SOURCES = Object.freeze([
  "user",
  "external",
  "generated",
  "model",
  "tool",
  "system",
]);

export const PROVENANCE_EVENTS = Object.freeze([
  "created",
  "updated",
  "deleted",
  "superseded",
  "corrected",
  "source_registered",
  "research_started",
  "research_completed",
  "research_failed",
]);

export function createProvenanceRecord({
  subjectId,
  source,
  sourceUri = null,
  sourceTitle = null,
  retrievedAt = null,
  sourceHash = null,
  parentIds = [],
  provider = null,
  tool = null,
  event = "created",
  metadata = {},
} = {}) {
  if (!subjectId) throw new TypeError("Provenance subjectId is required.");
  if (!PROVENANCE_SOURCES.includes(source)) throw new TypeError("Unknown provenance source.");
  if (!PROVENANCE_EVENTS.includes(event)) throw new TypeError("Unknown provenance event.");

  return Object.freeze({
    subjectId,
    source,
    sourceUri,
    sourceTitle,
    retrievedAt,
    sourceHash,
    parentIds: [...parentIds],
    provider,
    tool,
    event,
    metadata: structuredClone(metadata),
    createdAt: new Date().toISOString(),
  });
}

// Step 1 compatibility contract. Step 2 persists this information through
// the database-backed ProvenanceService and TamperEvidentLedger.
export const AI_BLOCKCHAIN_BOUNDARY = Object.freeze({
  purpose: "tamper-evident provenance and audit",
  isIntelligenceEngine: false,
  implementation: "append-oriented cryptographic hash chain",
  distributedConsensus: false,
  externalAnchoring: false,
  records: Object.freeze([
    "important memories",
    "knowledge versions",
    "source hashes",
    "document fingerprints",
    "learning events",
    "research events",
    "model/version metadata",
    "memory history",
    "audit history",
    "provenance relationships",
  ]),
});
