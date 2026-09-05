import { createHash } from "node:crypto";
import {
  JuniProviderError,
  resolveCapability,
  type EmbeddingResult,
} from "./capabilities";
import {
  deleteSemanticChunksForOwnerSource,
  getCanonicalConversationMessageForSemantic,
  listSemanticChunksForOwner,
  replaceSemanticChunksForOwnerSource,
  type SemanticChunkRow,
  type SemanticChunkWrite,
  type SemanticSourceType,
} from "./db";

export const SEMANTIC_CHUNK_MAX_CHARS = 4_000;
export const SEMANTIC_MAX_CHUNKS = 64;
export const SEMANTIC_MAX_CONTENT_CHARS = 256_000;
export const SEMANTIC_MAX_QUERY_CHARS = 24_000;
export const SEMANTIC_MAX_RESULTS = 20;
export const SEMANTIC_MAX_DIMENSIONS = 4_096;
export const SEMANTIC_DISTANCE_METRIC = "cosine" as const;

export type SemanticChunk = {
  index: number;
  content: string;
  contentHash: string;
};

export type SemanticIngestRequest = {
  ownerId: number;
  sourceType: SemanticSourceType;
  sourceId: string;
};

export type SemanticIngestResult = {
  sourceType: SemanticSourceType;
  sourceId: string;
  chunkCount: number;
  embeddingModel: string;
  embeddingDimensions: number;
};

export type SemanticSearchRequest = {
  ownerId: number;
  query: string;
  limit?: number;
  sourceType?: SemanticSourceType;
};

export type SemanticSearchResult = {
  chunkId: string;
  sourceType: SemanticSourceType;
  sourceId: string;
  chunkIndex: number;
  content: string;
  score: number;
};

function assertOwnerId(ownerId: number): void {
  if (!Number.isSafeInteger(ownerId) || ownerId <= 0) {
    throw new Error("A valid authenticated owner is required");
  }
}

function assertSource(sourceType: SemanticSourceType, sourceId: string): void {
  if (sourceType !== "conversation_message") {
    throw new Error("Unsupported semantic source type");
  }
  if (!/^[A-Za-z0-9_-]{1,36}$/.test(sourceId)) {
    throw new Error("Invalid semantic source identifier");
  }
}

function normalizeContent(content: string, maxChars: number): string {
  if (typeof content !== "string") {
    throw new Error("Semantic content must be text");
  }
  const normalized = content.replace(/\r\n?/g, "\n").trim();
  if (normalized.length === 0 || normalized.length > maxChars) {
    throw new Error("Semantic content is outside the supported limits");
  }
  return normalized;
}

export function hashSemanticContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function createSemanticChunkId(
  ownerId: number,
  sourceType: SemanticSourceType,
  sourceId: string,
  chunkIndex: number,
  contentHash: string
): string {
  return createHash("sha256")
    .update(
      `${ownerId}\u0000${sourceType}\u0000${sourceId}\u0000${chunkIndex}\u0000${contentHash}`,
      "utf8"
    )
    .digest("hex");
}

/** Deterministic bounded character segmentation that preserves source order. */
export function chunkSemanticText(
  content: string,
  maxChars = SEMANTIC_CHUNK_MAX_CHARS
): SemanticChunk[] {
  if (!Number.isSafeInteger(maxChars) || maxChars < 1) {
    throw new Error("Invalid semantic chunk size");
  }
  const normalized = normalizeContent(content, SEMANTIC_MAX_CONTENT_CHARS);
  const chunks: SemanticChunk[] = [];
  let offset = 0;

  while (offset < normalized.length) {
    if (chunks.length >= SEMANTIC_MAX_CHUNKS) {
      throw new Error("Semantic content has too many chunks");
    }
    const remaining = normalized.length - offset;
    let end = Math.min(offset + maxChars, normalized.length);
    if (end < normalized.length) {
      const boundary = normalized.lastIndexOf(" ", end);
      if (boundary > offset + Math.floor(maxChars * 0.6)) end = boundary;
    }
    const chunkContent = normalized.slice(offset, end).trim();
    if (chunkContent.length === 0) {
      offset = end + 1;
      continue;
    }
    chunks.push({
      index: chunks.length,
      content: chunkContent,
      contentHash: hashSemanticContent(chunkContent),
    });
    offset += end - offset;
    while (offset < normalized.length && /\s/.test(normalized[offset]))
      offset += 1;
    if (remaining === normalized.length && offset === 0) {
      throw new Error("Semantic chunker failed to advance");
    }
  }

  return chunks;
}

function assertEmbeddingResult(
  result: EmbeddingResult,
  expectedCount: number
): void {
  if (
    !result.model ||
    !Number.isSafeInteger(result.dimensions) ||
    result.dimensions < 1 ||
    result.dimensions > SEMANTIC_MAX_DIMENSIONS ||
    result.inputCount !== expectedCount ||
    result.vectors.length !== expectedCount ||
    result.vectors.some(
      vector =>
        vector.length !== result.dimensions ||
        vector.some(
          value => typeof value !== "number" || !Number.isFinite(value)
        )
    )
  ) {
    throw new JuniProviderError(
      "invalid_request",
      "The embedding provider returned an incompatible result.",
      { providerId: "openai-embeddings" }
    );
  }
}

function serverUserIdentifier(ownerId: number): string {
  return createHash("sha256")
    .update(`juni-semantic-owner:${ownerId}`, "utf8")
    .digest("hex");
}

export async function ingestSemanticSource(
  request: SemanticIngestRequest
): Promise<SemanticIngestResult> {
  assertOwnerId(request.ownerId);
  assertSource(request.sourceType, request.sourceId);
  const canonical =
    request.sourceType === "conversation_message"
      ? await getCanonicalConversationMessageForSemantic(
          request.ownerId,
          request.sourceId
        )
      : undefined;
  if (
    !canonical ||
    canonical.id !== request.sourceId ||
    canonical.ownerId !== request.ownerId
  ) {
    throw new Error("Semantic source not found");
  }
  const chunks = chunkSemanticText(canonical.content);
  const resolution = resolveCapability("EMBEDDING");
  const embedding = await resolution.adapter.invokeEmbedding!({
    input: chunks.map(chunk => chunk.content),
    userIdentifier: serverUserIdentifier(request.ownerId),
  });
  assertEmbeddingResult(embedding, chunks.length);

  const now = new Date();
  const rows: SemanticChunkWrite[] = chunks.map((chunk, index) => ({
    id: createSemanticChunkId(
      request.ownerId,
      request.sourceType,
      request.sourceId,
      chunk.index,
      chunk.contentHash
    ),
    ownerId: request.ownerId,
    sourceType: request.sourceType,
    sourceId: request.sourceId,
    chunkIndex: chunk.index,
    content: chunk.content,
    contentHash: chunk.contentHash,
    embedding: embedding.vectors[index],
    embeddingModel: embedding.model,
    embeddingDimensions: embedding.dimensions,
    distanceMetric: SEMANTIC_DISTANCE_METRIC,
    createdAt: now,
    updatedAt: now,
  }));

  await replaceSemanticChunksForOwnerSource(
    request.ownerId,
    request.sourceType,
    request.sourceId,
    rows
  );
  return {
    sourceType: request.sourceType,
    sourceId: request.sourceId,
    chunkCount: rows.length,
    embeddingModel: embedding.model,
    embeddingDimensions: embedding.dimensions,
  };
}

function cosineSimilarity(
  left: readonly number[],
  right: readonly number[]
): number {
  if (left.length !== right.length || left.length === 0) return -1;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) return -1;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return -1;
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

export async function searchSemanticIndex(
  request: SemanticSearchRequest
): Promise<SemanticSearchResult[]> {
  assertOwnerId(request.ownerId);
  const query = normalizeContent(request.query, SEMANTIC_MAX_QUERY_CHARS);
  const limit = Math.min(
    Math.max(Math.trunc(request.limit ?? 5), 1),
    SEMANTIC_MAX_RESULTS
  );
  if (request.sourceType && request.sourceType !== "conversation_message") {
    throw new Error("Unsupported semantic source type");
  }

  const resolution = resolveCapability("EMBEDDING");
  const queryEmbedding = await resolution.adapter.invokeEmbedding!({
    input: query,
    userIdentifier: serverUserIdentifier(request.ownerId),
  });
  assertEmbeddingResult(queryEmbedding, 1);
  const rows = await listSemanticChunksForOwner(
    request.ownerId,
    request.sourceType
  );

  return rows
    .filter(
      row =>
        row.ownerId === request.ownerId &&
        row.canonicalContent !== undefined &&
        isCurrentCanonicalChunk(row) &&
        row.distanceMetric === SEMANTIC_DISTANCE_METRIC &&
        row.embeddingModel === queryEmbedding.model &&
        row.embeddingDimensions === queryEmbedding.dimensions
    )
    .map(row => ({
      row,
      score: cosineSimilarity(row.embedding, queryEmbedding.vectors[0]),
    }))
    .filter(({ score }) => score >= 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.row.chunkIndex - right.row.chunkIndex ||
        left.row.id.localeCompare(right.row.id)
    )
    .slice(0, limit)
    .map(({ row, score }) => ({
      chunkId: row.id,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      chunkIndex: row.chunkIndex,
      content: row.content,
      score,
    }));
}

function isCurrentCanonicalChunk(row: SemanticChunkRow): boolean {
  if (row.canonicalContent === undefined) return false;
  return chunkSemanticText(row.canonicalContent).some(
    chunk =>
      chunk.index === row.chunkIndex && chunk.contentHash === row.contentHash
  );
}

export async function deleteSemanticSource(
  ownerId: number,
  sourceType: SemanticSourceType,
  sourceId: string
): Promise<void> {
  assertOwnerId(ownerId);
  assertSource(sourceType, sourceId);
  await deleteSemanticChunksForOwnerSource(ownerId, sourceType, sourceId);
}

export function isSemanticChunkRow(value: unknown): value is SemanticChunkRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<SemanticChunkRow>;
  return (
    typeof row.id === "string" &&
    Number.isSafeInteger(row.ownerId) &&
    row.sourceType === "conversation_message" &&
    typeof row.sourceId === "string" &&
    Number.isSafeInteger(row.chunkIndex) &&
    typeof row.content === "string" &&
    typeof row.contentHash === "string" &&
    Array.isArray(row.embedding) &&
    row.embedding.every(
      value => typeof value === "number" && Number.isFinite(value)
    ) &&
    typeof row.embeddingModel === "string" &&
    Number.isSafeInteger(row.embeddingDimensions) &&
    row.distanceMetric === SEMANTIC_DISTANCE_METRIC
  );
}
