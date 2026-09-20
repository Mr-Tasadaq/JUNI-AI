import { assertScope } from "./model.js";

export class MemoryRetrievalService {
  #memory;
  #knowledge;
  #vectors;
  #context;
  #provenance;

  constructor({ memory, knowledge, vectors, context, provenance }) {
    this.#memory = memory;
    this.#knowledge = knowledge;
    this.#vectors = vectors;
    this.#context = context;
    this.#provenance = provenance;
  }

  async recentContext(scope, conversationId, options = {}) {
    assertScope(scope);
    return this.#context.recent(scope, conversationId, options);
  }

  async preferences(scope, options = {}) {
    assertScope(scope);
    return this.#memory.list(scope, {
      ...options,
      memoryType: "user_preference",
      statuses: ["important", "permanent", "candidate"],
    });
  }

  async semanticMemory(scope, queryVector, options = {}) {
    assertScope(scope);
    return this.#vectors.search(scope, queryVector, {
      ...options,
      metadataFilter: {
        status: options.includeCandidates ? undefined : "approved",
        ...(options.metadataFilter ?? {}),
      },
      objectType: "memory",
    }).then((results) => results.map((item) => ({
      ...item,
      source: item.sourceType,
    })));
  }

  async relevantKnowledge(scope, queryVector, options = {}) {
    assertScope(scope);
    if (queryVector) {
      return this.#vectors.search(scope, queryVector, {
        ...options,
        objectType: "knowledge",
      });
    }

    const text = String(options.queryText ?? "").trim();
    if (!text) return [];
    const words = text.split(/s+/).filter((word) => word.length > 2).slice(0, 8);
    if (!words.length) return [];

    const clauses = words.map(() => "content_text LIKE ?").join(" OR ");
    const args = words.map((word) => "%" + word.replace(/[%_]/g, "") + "%");
    const result = await this.#knowledge.clientExecuteScoped(scope, clauses, args, options.limit);
    return result;
  }

  async provenance(scope, subjectId, options = {}) {
    assertScope(scope);
    return this.#provenance.list(scope, { subjectId, limit: options.limit ?? 20 });
  }
}
