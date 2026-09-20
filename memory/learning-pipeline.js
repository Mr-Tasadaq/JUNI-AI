import { randomUUID } from "node:crypto";
import { assertScope, assertSourceType } from "./model.js";
import { byteSize, toJson } from "../storage/serialization.js";

const DEFAULT_CLASSIFICATION = Object.freeze({
  memoryType: "learned_knowledge",
  target: "memory",
  status: "candidate",
});

export class LearningPipeline {
  #client;
  #quota;
  #ledger;
  #provenance;
  #memory;
  #knowledge;
  #embedder;
  #events;
  #classifier;

  constructor({ client, quota, ledger, provenance, memory, knowledge, embedder = null, events = null, classifier = null }) {
    this.#client = client;
    this.#quota = quota;
    this.#ledger = ledger;
    this.#provenance = provenance;
    this.#memory = memory;
    this.#knowledge = knowledge;
    this.#embedder = embedder;
    this.#events = events;
    this.#classifier = classifier;
  }

  async process(scope, input) {
    assertScope(scope);
    if (!input?.content) throw new TypeError("Learning input content is required.");
    const sourceType = input.sourceType ?? "model";
    assertSourceType(sourceType);

    const id = input.id ?? randomUUID();
    await this.#recordStage(scope, id, "normalize", { sourceType });

    const classification = this.#classifier
      ? await this.#classifier(input)
      : DEFAULT_CLASSIFICATION;

    await this.#recordStage(scope, id, "classify", classification);

    if (input.source?.url) {
      new URL(input.source.url);
    }

    await this.#recordStage(scope, id, "validate", { valid: true });

    let provenance = null;
    if (input.source) {
      provenance = await this.#provenance.registerSource(scope, {
        subjectId: id,
        sourceType,
        url: input.source.url ?? null,
        title: input.source.title ?? null,
        retrievedAt: input.source.retrievedAt ?? null,
        checksum: input.source.hash ?? null,
        provider: input.provider ?? input.source.provider ?? null,
        tool: input.tool ?? input.source.tool ?? null,
        relatedIds: [id],
        metadata: input.source.metadata ?? {},
      });
    }
    await this.#recordStage(scope, id, "provenance", { provenanceId: provenance?.provenance?.id ?? null });

    const approved = input.approved === true;
    const status = approved
      ? (input.status ?? "important")
      : "candidate";

    const writeInput = {
      ...input,
      id,
      memoryType: classification.memoryType,
      knowledgeType: classification.memoryType,
      status,
      approvedBy: approved ? (input.approvedBy ?? input.actorId ?? "user") : null,
      provenanceRef: provenance?.provenance?.id ?? input.provenanceRef ?? null,
    };

    const record = classification.target === "knowledge"
      ? await this.#knowledge.create(scope, writeInput)
      : await this.#memory.create(scope, writeInput);

    await this.#recordStage(scope, id, "write", {
      objectType: classification.target,
      objectId: record.id,
      status,
    });

    let embedding = null;
    if (this.#embedder) {
      embedding = await this.#embedder(record);
      await this.#recordStage(scope, id, "embedding", {
        created: Boolean(embedding),
      });
    } else {
      await this.#recordStage(scope, id, "embedding", { created: false, reason: "no_embedder_configured" });
    }

    this.#events?.emit("learning.recorded", {
      learningId: id,
      objectId: record.id,
      status,
      approved,
    });

    return {
      learningId: id,
      status,
      approved,
      provenance,
      record,
      embedding,
    };
  }

  async #recordStage(scope, objectId, stage, payload) {
    const eventId = randomUUID();
    const createdAt = new Date().toISOString();
    const payloadJson = toJson(payload);
    const sizeBytes = byteSize({ eventId, objectId, stage, payload, createdAt });
    await this.#quota.assertWithinQuota(scope, sizeBytes, { category: "logs" });

    await this.#client.execute({
      sql: "INSERT INTO learning_events (id, tenant_id, user_id, object_id, object_type, stage, actor_type, actor_id, approved, payload_json, created_at, size_bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      args: [eventId, scope.tenantId, scope.userId, objectId, null, stage, "system", null, 0, payloadJson, createdAt, sizeBytes],
    });

    await this.#ledger.append(scope, {
      eventType: "learning_event",
      actorType: "system",
      actorId: null,
      objectId,
      payload: { stage, ...payload },
    });
  }
}
