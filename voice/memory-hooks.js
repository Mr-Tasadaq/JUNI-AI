import { assertScope } from "../memory/model.js";

const MAX = 20;

export function createVoiceMemoryHooks({ retrieval } = {}) {
  if (!retrieval) throw new TypeError("retrieval is required.");

  return Object.freeze({
    async recentContext(scope, conversationId, options = {}) {
      assertScope(scope);
      return retrieval.recentContext(scope, conversationId, {
        ...options,
        limit: clamp(options.limit, 8),
      });
    },

    async preferences(scope, options = {}) {
      assertScope(scope);
      return retrieval.preferences(scope, {
        ...options,
        limit: clamp(options.limit, 10),
      });
    },

    async approvedKnowledge(scope, queryVector, options = {}) {
      assertScope(scope);
      return retrieval.relevantKnowledge(scope, queryVector, {
        ...options,
        limit: clamp(options.limit, 10),
        includeCandidates: false,
      });
    },

    async approvedMemory(scope, queryVector, options = {}) {
      assertScope(scope);
      return retrieval.semanticMemory(scope, queryVector, {
        ...options,
        limit: clamp(options.limit, 10),
        includeCandidates: false,
      });
    },
  });
}

function clamp(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.max(1, Math.min(MAX, parsed)) : fallback;
}
