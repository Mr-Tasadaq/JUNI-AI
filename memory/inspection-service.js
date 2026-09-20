import { assertScope } from "./model.js";

export class MemoryInspectionService {
  #memory;
  #knowledge;
  #provenance;
  #ledger;
  #quota;
  #client;

  constructor({ client, memory, knowledge, provenance, ledger, quota }) {
    this.#client = client;
    this.#memory = memory;
    this.#knowledge = knowledge;
    this.#provenance = provenance;
    this.#ledger = ledger;
    this.#quota = quota;
  }

  async memory(scope, id, options = {}) {
    assertScope(scope);
    return this.#memory.get(scope, id, options);
  }

  async memoryVersions(scope, id, options = {}) {
    assertScope(scope);
    return this.#memory.versions(scope, id, options);
  }

  async knowledge(scope, id, options = {}) {
    assertScope(scope);
    return this.#knowledge.get(scope, id, options);
  }

  async knowledgeVersions(scope, id, options = {}) {
    assertScope(scope);
    return this.#knowledge.versions(scope, id, options);
  }

  async provenance(scope, subjectId, options = {}) {
    assertScope(scope);
    return this.#provenance.list(scope, { subjectId, limit: options.limit ?? 50 });
  }

  async storageUsage(scope) {
    assertScope(scope);
    return this.#quota.usage(scope);
  }

  async audit(scope, options = {}) {
    assertScope(scope);
    return this.#ledger.audit(scope, options);
  }

  async learningEvents(scope, { limit = 100 } = {}) {
    assertScope(scope);
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 100));
    const result = await this.#client.execute({
      sql: "SELECT * FROM learning_events WHERE tenant_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?",
      args: [scope.tenantId, scope.userId, safeLimit],
    });
    return result.rows.map((row) => ({
      ...row,
      approved: Boolean(Number(row.approved)),
      payload: JSON.parse(row.payload_json),
    }));
  }

  async verifyProvenance(scope) {
    assertScope(scope);
    return this.#ledger.verify(scope);
  }
}
