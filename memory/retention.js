import { assertScope } from "./model.js";

export const RETENTION_DEFAULTS = Object.freeze({
  transient_context: 1,
  logs: 30,
  cache: 7,
  media_metadata: 365,
  conversation_history: 90,
  memory: 0,
  research_artifacts: 30,
});

export function parseRetentionConfig(env = process.env) {
  const read = (name, fallback) => {
    const value = Number.parseInt(env[name] ?? "", 10);
    return Number.isInteger(value) && value >= 0 ? value : fallback;
  };

  return Object.freeze({
    transient_context: read("JUNI_RETENTION_TRANSIENT_DAYS", RETENTION_DEFAULTS.transient_context),
    logs: read("JUNI_RETENTION_LOGS_DAYS", RETENTION_DEFAULTS.logs),
    cache: read("JUNI_RETENTION_CACHE_DAYS", RETENTION_DEFAULTS.cache),
    media_metadata: read("JUNI_RETENTION_MEDIA_DAYS", RETENTION_DEFAULTS.media_metadata),
    conversation_history: read("JUNI_RETENTION_CONVERSATION_DAYS", RETENTION_DEFAULTS.conversation_history),
    memory: read("JUNI_RETENTION_MEMORY_DAYS", RETENTION_DEFAULTS.memory),
    research_artifacts: read("JUNI_RETENTION_RESEARCH_DAYS", RETENTION_DEFAULTS.research_artifacts),
  });
}

export class RetentionService {
  #client;
  #policies;

  constructor({ client, policies }) {
    this.#client = client;
    this.#policies = policies;
  }

  policies() {
    return this.#policies;
  }

  async expiredCandidates(scope, now = new Date()) {
    assertScope(scope);
    const timestamp = now.toISOString();
    const result = await this.#client.execute({
      sql: `SELECT 'context' AS record_type, id, expires_at AS expires_at FROM conversation_context
        WHERE tenant_id = ? AND user_id = ? AND expires_at IS NOT NULL AND expires_at <= ?
        UNION ALL
        SELECT 'memory', id, retention_expires_at FROM memory_records
        WHERE tenant_id = ? AND user_id = ? AND retention_expires_at IS NOT NULL AND retention_expires_at <= ?
          AND status NOT IN ('important','permanent','deleted')
        UNION ALL
        SELECT 'cache', id, expires_at FROM cache_entries
        WHERE tenant_id = ? AND user_id = ? AND expires_at IS NOT NULL AND expires_at <= ?
        UNION ALL
        SELECT 'research', id, retention_expires_at FROM research_results
        WHERE tenant_id = ? AND user_id = ? AND retention_expires_at IS NOT NULL AND retention_expires_at <= ?`,
      args: [
        scope.tenantId, scope.userId, timestamp,
        scope.tenantId, scope.userId, timestamp,
        scope.tenantId, scope.userId, timestamp,
        scope.tenantId, scope.userId, timestamp,
      ],
    });
    return result.rows;
  }

  async purge(scope, { confirm = false, allowMemoryTombstone = false } = {}) {
    assertScope(scope);
    if (!confirm) throw new Error("Retention purge requires explicit confirmation.");

    const candidates = await this.expiredCandidates(scope);
    const actions = [];

    for (const candidate of candidates) {
      if (candidate.record_type === "memory") {
        if (!allowMemoryTombstone) continue;
        actions.push({ recordType: "memory", id: candidate.id, action: "tombstone_required" });
        continue;
      }

      const table = candidate.record_type === "context"
        ? "conversation_context"
        : candidate.record_type === "cache"
          ? "cache_entries"
          : "research_results";

      await this.#client.execute({
        sql: "DELETE FROM " + table + " WHERE tenant_id = ? AND user_id = ? AND id = ?",
        args: [scope.tenantId, scope.userId, candidate.id],
      });
      actions.push({ recordType: candidate.record_type, id: candidate.id, action: "deleted" });
    }

    return { actions, confirmed: true };
  }
}
