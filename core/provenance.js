export const PROVENANCE_SOURCES = Object.freeze([
  "user",
  "external",
  "generated",
  "tool",
  "model",
  "system",
]);

export const PROVENANCE_EVENTS = Object.freeze([
  "created",
  "updated",
  "deleted",
  "superseded",
  "corrected",
]);

export function createProvenanceRecord({
  subjectId,
  source,
  sourceUri = null,
  sourceHash = null,
  parentIds = [],
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
    sourceHash,
    parentIds: [...parentIds],
    event,
    metadata: structuredClone(metadata),
    createdAt: new Date().toISOString(),
  });
}

// Step 1 contract only. No blockchain ledger is implemented here.
// A later audit/ledger module can persist these records and link them to content hashes.
export const AI_BLOCKCHAIN_BOUNDARY = Object.freeze({
  purpose: "tamper-evident provenance and audit",
  isIntelligenceEngine: false,
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
