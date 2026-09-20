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
      statuses: options.includeCandidates ? ["important", "permanent", "candidate"] : ["important", "permanent"],
    });
  }

  async semanticMemory(scope, queryVector, options = {}) {
    assertScope(scope);
    const results = await this.#vectors.search(scope, queryVector, {
      ...options,
      objectType: "memory",
    });

    const visible = [];
    for (const item of results) {
      const record = await this.#memory.get(scope, item.objectId);
      if (!record) continue;
      if (!options.includeCandidates && !["important", "permanent"].includes(record.status)) continue;
      visible.push({ ...item, source: record.source_type, status: record.status });
    }
    return visible;
  }

  async relevantKnowledge(scope, queryVector, options = {}) {
    assertScope(scope);
    if (queryVector) {
      const results = await this.#vectors.search(scope, queryVector, {
        ...options,
        objectType: "knowledge",
      });
      const visible = [];
      for (const item of results) {
        const record = await this.#knowledge.get(scope, item.objectId);
        if (!record) continue;
        if (!options.includeCandidates && !["important", "permanent"].includes(record.status)) continue;
        visible.push({ ...item, status: record.status, source: record.source_type });
      }
      return visible;
    }

    const text = String(options.queryText ?? "").trim();
    if (!text) return [];
    const words = text.split(/\s+/).filter((word) => word.length > 2).slice(0, 8);
    if (!words.length) return [];

    const clauses = words.map(() => "content_text LIKE ?").join(" OR ");
    const args = words.map((word) => "%" + word.replace(/[%_]/g, "") + "%");
    return this.#knowledge.searchText(scope, words, { limit: options.limit ?? 10 });
  }

  async provenance(scope, subjectId, options = {}) {
    assertScope(scope);
    return this.#provenance.list(scope, { subjectId, limit: options.limit ?? 20 });
  }
}
