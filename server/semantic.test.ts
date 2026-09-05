import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteSemanticChunksForOwnerSource: vi.fn(),
  getCanonicalConversationMessageForSemantic: vi.fn(),
  listSemanticChunksForOwner: vi.fn(),
  replaceSemanticChunksForOwnerSource: vi.fn(),
  invokeEmbedding: vi.fn(),
}));

vi.mock("./db", () => ({
  deleteSemanticChunksForOwnerSource: mocks.deleteSemanticChunksForOwnerSource,
  getCanonicalConversationMessageForSemantic:
    mocks.getCanonicalConversationMessageForSemantic,
  listSemanticChunksForOwner: mocks.listSemanticChunksForOwner,
  replaceSemanticChunksForOwnerSource:
    mocks.replaceSemanticChunksForOwnerSource,
}));

vi.mock("./capabilities", () => ({
  JuniProviderError: class JuniProviderError extends Error {
    category: string;
    providerId?: string;
    constructor(
      category: string,
      message: string,
      options: { providerId?: string } = {}
    ) {
      super(message);
      this.name = "JuniProviderError";
      this.category = category;
      this.providerId = options.providerId;
    }
  },
  resolveCapability: vi.fn(() => ({
    adapter: { invokeEmbedding: mocks.invokeEmbedding },
  })),
}));

import {
  SEMANTIC_MAX_RESULTS,
  chunkSemanticText,
  createSemanticChunkId,
  deleteSemanticSource,
  hashSemanticContent,
  ingestSemanticSource,
  searchSemanticIndex,
} from "./semantic";

describe("semantic index foundation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.replaceSemanticChunksForOwnerSource.mockResolvedValue(undefined);
    mocks.deleteSemanticChunksForOwnerSource.mockResolvedValue(undefined);
    mocks.getCanonicalConversationMessageForSemantic.mockResolvedValue({
      id: "message-1",
      ownerId: 7,
      content: "private source text",
    });
    mocks.invokeEmbedding.mockResolvedValue({
      model: "text-embedding-3-small",
      vectors: [[1, 0]],
      dimensions: 2,
      inputCount: 1,
      usage: { promptTokens: 3, totalTokens: 3 },
    });
    mocks.listSemanticChunksForOwner.mockResolvedValue([]);
  });

  it("chunks deterministically, preserves order, and stays bounded", () => {
    const content = "alpha ".repeat(8) + "omega";
    const first = chunkSemanticText(content, 20);
    const second = chunkSemanticText(content, 20);

    expect(first).toEqual(second);
    expect(first.map(chunk => chunk.index)).toEqual(
      first.map((_, index) => index)
    );
    expect(first.map(chunk => chunk.content).join(" ")).toContain("alpha");
    expect(first.map(chunk => chunk.content).join(" ")).toContain("omega");
    expect(first.every(chunk => chunk.content.length <= 20)).toBe(true);
  });

  it("normalizes line endings and rejects excessive chunk counts", () => {
    expect(chunkSemanticText(" a\r\nb ", 20)[0].content).toBe("a\nb");
    expect(() => chunkSemanticText("x".repeat(65), 1)).toThrow(
      "too many chunks"
    );
  });

  it("uses stable cryptographic content and chunk identities", () => {
    const contentHash = hashSemanticContent("same content");
    expect(contentHash).toBe(hashSemanticContent("same content"));
    expect(contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      createSemanticChunkId(
        7,
        "conversation_message",
        "message-1",
        0,
        contentHash
      )
    ).toBe(
      createSemanticChunkId(
        7,
        "conversation_message",
        "message-1",
        0,
        contentHash
      )
    );
    expect(
      createSemanticChunkId(
        7,
        "conversation_message",
        "message-1",
        0,
        contentHash
      )
    ).not.toBe(
      createSemanticChunkId(
        8,
        "conversation_message",
        "message-1",
        0,
        contentHash
      )
    );
  });

  it("reuses EMBEDDING and atomically replaces an owner/source index", async () => {
    const result = await ingestSemanticSource({
      ownerId: 7,
      sourceType: "conversation_message",
      sourceId: "message-1",
    });

    expect(result).toMatchObject({
      sourceType: "conversation_message",
      sourceId: "message-1",
      chunkCount: 1,
      embeddingModel: "text-embedding-3-small",
      embeddingDimensions: 2,
    });
    expect(mocks.invokeEmbedding).toHaveBeenCalledWith({
      input: ["private source text"],
      userIdentifier: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(mocks.invokeEmbedding.mock.calls[0][0].userIdentifier).not.toBe("7");
    expect(mocks.replaceSemanticChunksForOwnerSource).toHaveBeenCalledWith(
      7,
      "conversation_message",
      "message-1",
      [
        expect.objectContaining({
          ownerId: 7,
          sourceId: "message-1",
          chunkIndex: 0,
          content: "private source text",
          embedding: [1, 0],
          embeddingDimensions: 2,
          distanceMetric: "cosine",
        }),
      ]
    );
  });

  it("rejects invalid ownership/source inputs before provider calls", async () => {
    await expect(
      ingestSemanticSource({
        ownerId: 0,
        sourceType: "conversation_message",
        sourceId: "message-1",
      })
    ).rejects.toThrow("authenticated owner");
    mocks.getCanonicalConversationMessageForSemantic.mockResolvedValueOnce(
      undefined
    );
    await expect(
      ingestSemanticSource({
        ownerId: 7,
        sourceType: "conversation_message",
        sourceId: "missing-message",
      })
    ).rejects.toThrow("Semantic source not found");
    mocks.getCanonicalConversationMessageForSemantic.mockResolvedValueOnce({
      id: "message-1",
      ownerId: 8,
      content: "another user's content",
    });
    await expect(
      ingestSemanticSource({
        ownerId: 7,
        sourceType: "conversation_message",
        sourceId: "message-1",
      })
    ).rejects.toThrow("Semantic source not found");
    mocks.getCanonicalConversationMessageForSemantic.mockResolvedValueOnce({
      id: "message-1",
      ownerId: 7,
      content: "   ",
    });
    await expect(
      ingestSemanticSource({
        ownerId: 7,
        sourceType: "conversation_message",
        sourceId: "message-1",
      })
    ).rejects.toThrow("outside the supported limits");
    expect(mocks.invokeEmbedding).not.toHaveBeenCalled();
  });

  it("uses canonical content even when an untyped caller supplies replacement text", async () => {
    await ingestSemanticSource({
      ownerId: 7,
      sourceType: "conversation_message",
      sourceId: "message-1",
      ...({ content: "attacker-controlled replacement" } as Record<
        string,
        string
      >),
    } as unknown as Parameters<typeof ingestSemanticSource>[0]);

    expect(mocks.invokeEmbedding).toHaveBeenCalledWith(
      expect.objectContaining({ input: ["private source text"] })
    );
  });

  it("rejects inconsistent provider dimensions before persistence", async () => {
    mocks.invokeEmbedding.mockResolvedValue({
      model: "text-embedding-3-small",
      vectors: [[1, 0, 0]],
      dimensions: 2,
      inputCount: 1,
    });

    await expect(
      ingestSemanticSource({
        ownerId: 7,
        sourceType: "conversation_message",
        sourceId: "message-1",
      })
    ).rejects.toMatchObject({ category: "invalid_request" });
    expect(mocks.replaceSemanticChunksForOwnerSource).not.toHaveBeenCalled();
  });

  it("does not hide database failures or persist partial index state", async () => {
    mocks.replaceSemanticChunksForOwnerSource.mockRejectedValue(
      new Error("Database unavailable")
    );

    await expect(
      ingestSemanticSource({
        ownerId: 7,
        sourceType: "conversation_message",
        sourceId: "message-1",
      })
    ).rejects.toThrow("Database unavailable");
  });

  it("returns owner-scoped cosine-ranked results with bounded top-K", async () => {
    mocks.invokeEmbedding.mockResolvedValue({
      model: "text-embedding-3-small",
      vectors: [[1, 0]],
      dimensions: 2,
      inputCount: 1,
    });
    mocks.listSemanticChunksForOwner.mockResolvedValue([
      {
        id: "best",
        ownerId: 7,
        sourceType: "conversation_message",
        sourceId: "message-1",
        chunkIndex: 0,
        content: "best private match",
        contentHash: hashSemanticContent("best private match"),
        embedding: [1, 0],
        embeddingModel: "text-embedding-3-small",
        embeddingDimensions: 2,
        distanceMetric: "cosine",
        createdAt: new Date(),
        updatedAt: new Date(),
        canonicalContent: "best private match",
      },
      {
        id: "other-owner",
        ownerId: 8,
        sourceType: "conversation_message",
        sourceId: "message-2",
        chunkIndex: 0,
        content: "must not leak",
        contentHash: hashSemanticContent("must not leak"),
        embedding: [1, 0],
        embeddingModel: "text-embedding-3-small",
        embeddingDimensions: 2,
        distanceMetric: "cosine",
        createdAt: new Date(),
        updatedAt: new Date(),
        canonicalContent: "must not leak",
      },
      {
        id: "orthogonal",
        ownerId: 7,
        sourceType: "conversation_message",
        sourceId: "message-3",
        chunkIndex: 0,
        content: "weaker match",
        contentHash: hashSemanticContent("weaker match"),
        embedding: [0, 1],
        embeddingModel: "text-embedding-3-small",
        embeddingDimensions: 2,
        distanceMetric: "cosine",
        createdAt: new Date(),
        updatedAt: new Date(),
        canonicalContent: "weaker match",
      },
    ]);

    const results = await searchSemanticIndex({
      ownerId: 7,
      query: "private query",
      limit: SEMANTIC_MAX_RESULTS + 100,
    });

    expect(results).toEqual([
      expect.objectContaining({
        chunkId: "best",
        content: "best private match",
        score: 1,
      }),
      expect.objectContaining({
        chunkId: "orthogonal",
        content: "weaker match",
        score: 0,
      }),
    ]);
    expect(results).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ chunkId: "other-owner" }),
      ])
    );
    expect(mocks.listSemanticChunksForOwner).toHaveBeenCalledWith(7, undefined);
  });

  it("does not compare inconsistent model or dimensions", async () => {
    mocks.listSemanticChunksForOwner.mockResolvedValue([
      {
        id: "wrong-dimension",
        ownerId: 7,
        sourceType: "conversation_message",
        sourceId: "message-1",
        chunkIndex: 0,
        content: "private content",
        contentHash: hashSemanticContent("private content"),
        embedding: [1, 0, 0],
        embeddingModel: "text-embedding-3-small",
        embeddingDimensions: 3,
        distanceMetric: "cosine",
        createdAt: new Date(),
        updatedAt: new Date(),
        canonicalContent: "private content",
      },
    ]);
    await expect(
      searchSemanticIndex({ ownerId: 7, query: "query" })
    ).resolves.toEqual([]);
  });

  it("deletes only the exact owner/source identity", async () => {
    await deleteSemanticSource(7, "conversation_message", "message-1");
    expect(mocks.deleteSemanticChunksForOwnerSource).toHaveBeenCalledWith(
      7,
      "conversation_message",
      "message-1"
    );
  });
});
