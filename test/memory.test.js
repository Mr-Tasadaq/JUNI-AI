import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../core/config.js";
import { createJuniMemoryApplication } from "../memory/app.js";
import { STORAGE_CATEGORIES } from "../memory/storage-quota.js";

const apps = [];

async function makeApp(quotaBytes = 10 * 1024 * 1024) {
  const config = loadConfig({
    JUNI_DATABASE_URL: "file:/tmp/juni-step2-" + randomUUID() + ".db",
    JUNI_DATABASE_AUTH_TOKEN: "",
    JUNI_STORAGE_BUDGET_BYTES: String(quotaBytes),
    JUNI_STORAGE_WARNING_THRESHOLDS: "0.5,0.8,0.9",
    JUNI_RETENTION_TRANSIENT_DAYS: "1",
  });

  const app = createJuniMemoryApplication({ config });
  await app.ready();
  apps.push(app);
  return app;
}

function scope(tenantId = "tenant-a", userId = "user-a") {
  return { tenantId, userId };
}

afterEach(async () => {
  for (const app of apps.splice(0)) {
    try { await app.db.client.close?.(); } catch {}
  }
});

test("creates, retrieves, versions, corrects, and tombstones memory", async () => {
  const app = await makeApp();
  const item = await app.memory.create(scope(), {
    memoryType: "long_term_memory",
    content: "User prefers concise answers.",
    sourceType: "user",
    trustLevel: "trusted",
    status: "candidate",
    confidence: 0.95,
    importance: 0.7,
    actorType: "user",
    actorId: "user-a",
  });

  assert.equal(item.version, 1);
  assert.equal((await app.memory.get(scope(), item.id)).content, "User prefers concise answers.");

  const updated = await app.memory.correct(scope(), item.id, {
    content: "User prefers concise, direct answers.",
    changeSummary: "User corrected wording.",
    actorId: "user-a",
  });

  assert.equal(updated.version, 2);
  const versions = await app.memory.versions(scope(), item.id);
  assert.deepEqual(versions.map((version) => version.version), [2, 1]);

  const deleted = await app.memory.delete(scope(), item.id, {
    actorId: "user-a",
    summary: "User requested deletion.",
  });

  assert.equal(deleted.status, "deleted");
  assert.equal(await app.memory.get(scope(), item.id), null);
  assert.equal((await app.memory.get(scope(), item.id, { includeDeleted: true })).status, "deleted");
});

test("important and permanent records require explicit approval", async () => {
  const app = await makeApp();

  await assert.rejects(
    () => app.memory.create(scope(), {
      memoryType: "important_fact",
      content: "Unreviewed fact.",
      sourceType: "model",
      trustLevel: "generated",
      status: "permanent",
    }),
    (error) => error.code === "MEMORY_APPROVAL_REQUIRED"
  );

  const approved = await app.memory.create(scope(), {
    memoryType: "important_fact",
    content: "Approved fact.",
    sourceType: "user",
    trustLevel: "trusted",
    status: "permanent",
    approvedBy: "user-a",
    actorId: "user-a",
  });

  assert.equal(approved.status, "permanent");
});

test("tenant and user scope isolate reads and writes", async () => {
  const app = await makeApp();
  const item = await app.memory.create(scope("tenant-a", "user-a"), {
    memoryType: "long_term_memory",
    content: "Private data",
    sourceType: "user",
    trustLevel: "trusted",
    status: "candidate",
  });

  const otherUser = scope("tenant-a", "user-b");
  const otherTenant = scope("tenant-b", "user-a");

  assert.equal(await app.memory.get(otherUser, item.id), null);
  assert.equal(await app.memory.get(otherTenant, item.id), null);
  assert.equal((await app.memory.list(otherUser)).length, 0);

  await assert.rejects(
    () => app.memory.update(otherUser, item.id, { content: "attack" }),
    (error) => error.code === "MEMORY_NOT_FOUND"
  );
});

test("malformed memory objects and scopes are rejected", async () => {
  const app = await makeApp();

  await assert.rejects(
    () => app.memory.create({ userId: "user-a" }, {
      memoryType: "long_term_memory",
      content: "x",
      sourceType: "user",
    }),
    /tenantId and userId are required/
  );

  await assert.rejects(
    () => app.memory.create(scope(), {
      memoryType: "not-a-memory-type",
      content: "x",
      sourceType: "user",
    }),
    /Invalid memory type/
  );
});

test("storage usage answers how much of the 10GB-style budget is used", async () => {
  const quota = 10 * 1024 * 1024;
  const app = await makeApp(quota);

  await app.memory.create(scope(), {
    memoryType: "user_preference",
    content: "Prefers Markdown.",
    sourceType: "user",
    trustLevel: "trusted",
    status: "candidate",
  });

  const usage = await app.inspection.storageUsage(scope());
  assert.equal(usage.quotaBytes, quota);
  assert.ok(usage.usedBytes > 0);
  assert.equal(usage.usedBytes + usage.remainingBytes, quota);
  assert.ok(usage.categories.memory > 0);
  assert.ok(STORAGE_CATEGORIES.every((category) => Object.hasOwn(usage.categories, category)));
});

test("quota enforcement rejects writes that exceed the logical budget", async () => {
  const app = await makeApp(1_000);

  await assert.rejects(
    () => app.memory.create(scope(), {
      memoryType: "long_term_memory",
      content: "x".repeat(10_000),
      sourceType: "user",
      trustLevel: "trusted",
      status: "candidate",
    }),
    (error) => error.code === "STORAGE_QUOTA_EXCEEDED"
  );
});

test("documents keep metadata separate from extracted semantic content", async () => {
  const app = await makeApp();
  const document = await app.documents.register(scope(), {
    name: "notes.md",
    mimeType: "text/markdown",
    documentType: "markdown",
    sizeBytes: 1200,
    checksum: "doc-hash-1",
    sourceType: "user",
    title: "Research notes",
  });

  assert.equal(document.processing_status, "registered");

  const version = await app.documents.addVersion(scope(), document.id, {
    extractedText: "# Notes\n\nOnly this text was actually extracted.",
    extractionMethod: "text-parser",
    checksum: "extracted-hash-1",
    actorId: "user-a",
  });

  assert.equal(version.current_version, 2);
  assert.equal(version.processing_status, "extracted");
  const stored = await app.documents.version(scope(), document.id, 2);
  assert.match(stored.extracted_text, /actually extracted/);
});

test("provider-independent vectors support metadata, source, and version filtering", async () => {
  const app = await makeApp();

  const first = await app.vectors.insert(scope(), {
    objectType: "memory",
    objectId: "memory-1",
    version: 1,
    vector: [1, 0, 0],
    provider: "openai",
    model: "embedding-test",
    sourceType: "user",
    metadata: { status: "approved", topic: "preferences" },
  });

  await app.vectors.insert(scope(), {
    objectType: "memory",
    objectId: "memory-2",
    version: 1,
    vector: [0, 1, 0],
    provider: "gemini",
    model: "embedding-test",
    sourceType: "external",
    metadata: { status: "approved", topic: "research" },
  });

  const results = await app.vectors.search(scope(), [1, 0, 0], {
    metadataFilter: { topic: "preferences" },
    sourceType: "user",
    version: 1,
    limit: 10,
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].id, first.id);
  assert.equal(results[0].objectId, "memory-1");

  await app.vectors.delete(scope(), first.id);
  assert.equal(await app.vectors.get(scope(), first.id), null);
});

test("learning pipeline keeps unapproved model knowledge in candidate state", async () => {
  const app = await makeApp();

  const candidate = await app.learning.process(scope(), {
    content: "A model-generated claim.",
    sourceType: "model",
    provider: "openai",
    model: "gpt-test",
  });

  assert.equal(candidate.status, "candidate");
  assert.equal(candidate.approved, false);
  assert.equal((await app.memory.list(scope(), {
    memoryType: "learned_knowledge",
    statuses: ["candidate"],
  })).length, 1);

  const approved = await app.learning.process(scope(), {
    id: randomUUID(),
    content: "User-approved learning.",
    sourceType: "user",
    approved: true,
    approvedBy: "user-a",
    actorId: "user-a",
    status: "important",
  });

  assert.equal(approved.status, "important");
  assert.equal(approved.approved, true);

  const events = await app.inspection.learningEvents(scope());
  assert.ok(events.length >= 4);
});

test("source provenance preserves URL, title, retrieval time, hash, provider, and tool", async () => {
  const app = await makeApp();

  const result = await app.provenance.registerSource(scope(), {
    subjectId: "knowledge-1",
    sourceType: "external",
    url: "https://example.com/article",
    title: "Example article",
    retrievedAt: "2026-09-21T00:00:00.000Z",
    checksum: "source-sha",
    provider: "gemini",
    tool: "web.search",
  });

  const stored = await app.provenance.get(scope(), result.provenance.id);
  assert.equal(stored.source_url, "https://example.com/article");
  assert.equal(stored.source_title, "Example article");
  assert.equal(stored.source_hash, "source-sha");
  assert.equal(stored.provider, "gemini");
  assert.equal(stored.tool, "web.search");
});

test("invalid source URLs are rejected", async () => {
  const app = await makeApp();

  await assert.rejects(
    () => app.provenance.registerSource(scope(), {
      subjectId: "bad-source",
      sourceType: "external",
      url: "ftp://example.com/not-allowed",
    }),
    /Invalid source URL/
  );
});

test("ledger starts at a genesis link, chains records, and detects tampering", async () => {
  const app = await makeApp();
  const created = await app.memory.create(scope(), {
    memoryType: "important_fact",
    content: "Fact",
    sourceType: "user",
    trustLevel: "trusted",
    status: "important",
    approvedBy: "user-a",
  });

  const ledger = await app.ledger.list(scope(), { limit: 50 });
  assert.ok(ledger.length >= 1);

  const ordered = [...ledger].sort((a, b) => Number(a.sequence) - Number(b.sequence));
  assert.equal(ordered[0].previous_hash, "GENESIS");
  if (ordered.length > 1) assert.equal(ordered[1].previous_hash, ordered[0].current_hash);

  assert.equal((await app.inspection.verifyProvenance(scope())).valid, true);

  await app.db.client.execute({
    sql: "UPDATE ledger_events SET payload_json = ? WHERE tenant_id = ? AND user_id = ? AND event_id = ?",
    args: ['{"tampered":true}', scope().tenantId, scope().userId, ledger[0].event_id],
  });

  const verification = await app.inspection.verifyProvenance(scope());
  assert.equal(verification.valid, false);
  assert.ok(verification.issues.some((issue) => issue.type === "payload_hash_mismatch"));

  assert.equal(created.id.length > 0, true);
});

test("ledger detects missing previous hash and duplicate event IDs", async () => {
  const app = await makeApp();
  const event = await app.ledger.append(scope(), {
    eventType: "audit_event",
    actorType: "user",
    actorId: "user-a",
    objectId: "audit-1",
    eventId: "duplicate-event",
    payload: { action: "created" },
  });

  await assert.rejects(
    () => app.ledger.append(scope(), {
      eventType: "audit_event",
      actorType: "user",
      actorId: "user-a",
      eventId: event.eventId,
      payload: { action: "duplicate" },
    }),
    (error) => error.code === "DUPLICATE_LEDGER_EVENT"
  );

  await app.db.client.execute({
    sql: "UPDATE ledger_events SET previous_hash = '' WHERE tenant_id = ? AND user_id = ? AND event_id = ?",
    args: [scope().tenantId, scope().userId, event.eventId],
  });

  const verification = await app.ledger.verify(scope());
  assert.equal(verification.valid, false);
  assert.ok(verification.issues.some((issue) => issue.type === "missing_previous_hash"));
});

test("audit inspection remains user-scoped", async () => {
  const app = await makeApp();

  await app.ledger.append(scope("tenant-a", "user-a"), {
    eventType: "audit_event",
    actorType: "user",
    actorId: "user-a",
    objectId: "secret-a",
    payload: { secret: "redacted-from-event-by-contract" },
  });

  await app.ledger.append(scope("tenant-a", "user-b"), {
    eventType: "audit_event",
    actorType: "user",
    actorId: "user-b",
    objectId: "secret-b",
    payload: { secret: "private" },
  });

  const userA = await app.inspection.audit(scope("tenant-a", "user-a"));
  const userB = await app.inspection.audit(scope("tenant-a", "user-b"));

  assert.equal(userA.length, 1);
  assert.equal(userA[0].object_id, "secret-a");
  assert.equal(userB.length, 1);
  assert.equal(userB[0].object_id, "secret-b");
});

test("knowledge versions preserve historical content", async () => {
  const app = await makeApp();

  const knowledge = await app.knowledge.create(scope(), {
    knowledgeType: "learned_knowledge",
    title: "Fact",
    content: "Version one",
    sourceType: "user",
    trustLevel: "trusted",
    status: "candidate",
  });

  const updated = await app.knowledge.update(scope(), knowledge.id, {
    content: "Version two",
    changeSummary: "Corrected wording.",
    actorId: "user-a",
  });

  assert.equal(updated.version, 2);
  assert.equal((await app.knowledge.getVersion(scope(), knowledge.id, 1)).content, "Version one");
  assert.equal((await app.knowledge.get(scope(), knowledge.id)).content, "Version two");
  assert.equal((await app.inspection.knowledgeVersions(scope(), knowledge.id)).length, 2);
});

test("inspection service exposes memory, provenance, usage, learning events, and chain verification", async () => {
  const app = await makeApp();
  const memory = await app.memory.create(scope(), {
    memoryType: "long_term_memory",
    content: "Inspect me",
    sourceType: "user",
    status: "candidate",
  });

  assert.equal((await app.inspection.memory(scope(), memory.id)).id, memory.id);
  assert.equal((await app.inspection.memoryVersions(scope(), memory.id)).length, 1);
  assert.ok((await app.inspection.storageUsage(scope())).usedBytes > 0);
  assert.equal((await app.inspection.audit(scope())).length >= 1, true);
  assert.equal((await app.inspection.verifyProvenance(scope())).valid, true);
});
