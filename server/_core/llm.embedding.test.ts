import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./env", () => ({
  ENV: {
    openAiApiKey: "server-only-embedding-key",
    embeddingModel: "text-embedding-3-small",
  },
}));

import { invokeEmbeddings } from "./llm";

const responseOk = (body: unknown) =>
  ({
    ok: true,
    json: async () => body,
    headers: new Headers(),
  }) as Response;

describe("invokeEmbeddings transport", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses the server model, float encoding, and server-derived user identifier", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      responseOk({
        object: "list",
        model: "text-embedding-3-small",
        data: [
          {
            object: "embedding",
            index: 0,
            embedding: [0.1, -0.2, 0.3],
          },
          {
            object: "embedding",
            index: 1,
            embedding: [0.4, -0.5, 0.6],
          },
        ],
        usage: { prompt_tokens: 7, total_tokens: 7 },
      })
    );

    await expect(
      invokeEmbeddings({
        inputs: ["first private text", "second private text"],
        userIdentifier: "hashed-server-user",
      })
    ).resolves.toEqual({
      model: "text-embedding-3-small",
      vectors: [
        [0.1, -0.2, 0.3],
        [0.4, -0.5, 0.6],
      ],
      dimensions: 3,
      inputCount: 2,
      usage: { promptTokens: 7, totalTokens: 7 },
    });

    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/embeddings");
    expect(request?.headers).toMatchObject({
      Authorization: "Bearer server-only-embedding-key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(request?.body))).toEqual({
      input: ["first private text", "second private text"],
      model: "text-embedding-3-small",
      encoding_format: "float",
      user: "hashed-server-user",
    });
  });

  it("normalizes provider vectors to number arrays and omits unavailable usage", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      responseOk({
        data: [{ embedding: [1, 2] }],
        model: "text-embedding-3-small",
      })
    );

    const result = await invokeEmbeddings({ inputs: ["private text"] });
    expect(result.vectors).toEqual([[1, 2]]);
    expect(result.dimensions).toBe(2);
    expect(result.usage).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("server-only-embedding-key");
  });
});
