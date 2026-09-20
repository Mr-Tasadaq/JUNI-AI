import { randomUUID } from "node:crypto";
import { assertScope } from "./model.js";
import { toJson, byteSize } from "../storage/serialization.js";

export class ConversationContextService {
  #client;
  #quota;
  #ledger;

  constructor({ client, quota, ledger }) {
    this.#client = client;
    this.#quota = quota;
    this.#ledger = ledger;
  }

  async append(scope, {
    conversationId,
    messageId = null,
    role,
    content,
    expiresAt = null,
    id = randomUUID(),
  }) {
    assertScope(scope);
    if (!conversationId || !role) throw new TypeError("conversationId and role are required.");
    const contentJson = toJson(content);
    const createdAt = new Date().toISOString();
    const sizeBytes = byteSize({ id, conversationId, messageId, role, content, expiresAt, createdAt });

    const tx = await this.#client.transaction("write");
    try {
      await this.#quota.assertWithinQuota(scope, sizeBytes, { category: "memory", executor: tx });
      await tx.execute({
        sql: "INSERT INTO conversation_context (id, tenant_id, user_id, conversation_id, message_id, role, content_json, created_at, expires_at, size_bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: [id, scope.tenantId, scope.userId, conversationId, messageId, role, contentJson, createdAt, expiresAt instanceof Date ? expiresAt.toISOString() : expiresAt, sizeBytes],
      });
      await this.#ledger.appendInTransaction(tx, scope, {
        eventType: "memory_created",
        actorType: "system",
        actorId: null,
        objectId: id,
        objectVersion: 1,
        payload: { memoryType: "short_term_context", conversationId, role },
      });
      await tx.commit();
      return { id, conversationId, messageId, role, content, createdAt, expiresAt, sizeBytes };
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  async recent(scope, conversationId, { limit = 20 } = {}) {
    assertScope(scope);
    const bounded = Math.max(1, Math.min(100, Number(limit) || 20));
    const result = await this.#client.execute({
      sql: "SELECT * FROM conversation_context WHERE tenant_id = ? AND user_id = ? AND conversation_id = ? ORDER BY created_at DESC LIMIT ?",
      args: [scope.tenantId, scope.userId, conversationId, bounded],
    });
    return result.rows.reverse().map((row) => ({
      ...row,
      content: JSON.parse(row.content_json),
    }));
  }
}
