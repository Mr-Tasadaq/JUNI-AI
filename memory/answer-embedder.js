async function loadOpenAI() {
  const module = await import("openai");
  return module.default;
}

export function createOpenAIAnswerEmbedder(config) {
  const provider = config?.providers?.openai;
  const model = config?.answerFirst?.embeddingModel ?? "text-embedding-3-small";

  if (!provider?.apiKey) return null;

  let client;

  return async function answerEmbedder({ text } = {}) {
    const input = String(text ?? "").trim();
    if (!input) throw new TypeError("Embedding text is required.");

    const OpenAI = await loadOpenAI();
    client ??= new OpenAI({
      apiKey: provider.apiKey,
      timeout: provider.timeoutMs,
    });

    const response = await client.embeddings.create({
      model,
      input,
      encoding_format: "float",
    });

    const vector = response?.data?.[0]?.embedding;
    if (!Array.isArray(vector) || !vector.length) {
      const error = new Error("OpenAI returned no embedding vector.");
      error.code = "EMBEDDING_EMPTY";
      throw error;
    }

    return {
      vector,
      provider: "openai",
      model: response.model ?? model,
    };
  };
}
