import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../core/config.js";
import { answerFirstEligibility } from "../core/answer-first.js";
import { createJuniMemoryApplication } from "../memory/app.js";

const apps = [];

async function makeApp() {
  const config = loadConfig({
    JUNI_DATABASE_URL: "file:/tmp/juni-answer-first-" + randomUUID() + ".db",
    JUNI_DATABASE_AUTH_TOKEN: "",
    JUNI_STORAGE_BUDGET_BYTES: String(10 * 1024 * 1024),
    JUNI_RETENTION_CACHE_DAYS: "7",
  });
  const app = createJuniMemoryApplication({ config });
  await app.ready();
  apps.push(app);
  return app;
}

test("Answer-First eligibility excludes live, personal, research, conversational, and streaming requests", () => {
  assert.equal(answerFirstEligibility({ message: "How do I install JUNI-AI?" }).eligible, true);
  assert.equal(answerFirstEligibility({ message: "What is the latest JUNI-AI release?" }).eligible, false);
  assert.equal(answerFirstEligibility({ message: "What is my account status?" }).eligible, false);
  assert.equal(answerFirstEligibility({ message: "What is the weather today?" }).eligible, false);
  assert.equal(answerFirstEligibility({ message: "Search the web for JUNI-AI docs.", requiresWebResearch: true }).eligible, false);
  assert.equal(answerFirstEligibility({
    message: "Explain that again.",
    messages: [{ role: "user", content: "Earlier question" }],
  }).eligible, false);
  assert.equal(answerFirstEligibility({ message: "Explain this", stream: true }).eligible, false);
});

test("Answer-First candidate creation is scoped, reviewable, and deduplicated", async (t) => {
  const app = await makeApp();
  t.after(async () => {
    try { await app.db.client.close?.(); } catch {}
  });

  const scope = { tenantId: "tenant-a", userId: "user-a" };
  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const first = await app.knowledge.createAnswerCandidate(scope, {
    question: "  How   do I reset JUNI? ",
    answer: "Use the reset flow in the account settings.",
    provider: "openai",
    model: "gpt-5.5",
    retentionExpiresAt: future,
  });

  assert.equal(first.knowledge_type, "saved_answer");
  assert.equal(first.status, "candidate");
  assert.equal(first.title, "how do i reset juni?");
  assert.equal(first.content, "Use the reset flow in the account settings.");
  assert.equal(first.source_type, "model");

  const second = await app.knowledge.createAnswerCandidate(scope, {
    question: "HOW DO I RESET JUNI?",
    answer: "Different draft.",
    provider: "gemini",
    model: "gemini-3.8-flash",
  });
  assert.equal(second.id, first.id);

  assert.equal(
    await app.knowledge.findExactSavedAnswer(scope, "how do i reset juni?"),
    null
  );
  assert.equal(
    (await app.knowledge.list({ tenantId: "tenant-a", userId: "user-b" }, { knowledgeType: "saved_answer" })).length,
    0
  );
});

test("chat serves an exact saved answer before provider availability is checked", async (t) => {
  const databaseUrl = "file:/tmp/juni-chat-answer-first-" + randomUUID() + ".db";

  process.env.JUNI_API_TOKEN = "test-token";
  process.env.JUNI_DATABASE_URL = databaseUrl;
  process.env.JUNI_DATABASE_AUTH_TOKEN = "";
  process.env.JUNI_IDENTITY_DEFAULT_TENANT_ID = "tenant-chat";
  process.env.JUNI_IDENTITY_DEFAULT_USER_ID = "user-chat";
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;

  const config = loadConfig(process.env);
  const seed = createJuniMemoryApplication({ config });
  await seed.ready();

  const scope = { tenantId: "tenant-chat", userId: "user-chat" };
  const answer = await seed.knowledge.create(scope, {
    knowledgeType: "saved_answer",
    content: "JUNI-AI uses a locked package manifest for deterministic installs.",
    sourceType: "user",
    trustLevel: "trusted",
    status: "important",
    approvedBy: "user-chat",
  });

  await seed.knowledge.createAnswerIndex(scope, {
    knowledgeId: answer.id,
    question: "How do I install JUNI-AI?",
    provider: "openai",
    model: "gpt-5.5",
  });

  await seed.db.client.close?.();

  const handlerModule = await import("../api/chat.js?answer-first-test=" + randomUUID());
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = String(value); return this; },
    json(value) { this.body = value; return this; },
  };

  await handlerModule.default({
    method: "POST",
    headers: {
      authorization: "Bearer test-token",
      "x-forwarded-for": "203.0.113.20",
    },
    body: {
      message: "  HOW   DO I INSTALL juni-ai? ",
      messages: [],
    },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reply, "JUNI-AI uses a locked package manifest for deterministic installs.");
  assert.equal(res.body.answerFirst.hit, true);
  assert.equal(res.body.provider, "openai");
  assert.equal(res.body.model, "gpt-5.5");
  assert.ok(res.body.requestId);

  const verify = createJuniMemoryApplication({ config });
  await verify.ready();
  const tracked = await verify.knowledge.findExactSavedAnswer(scope, "how do I install JUNI-AI?");
  assert.equal(tracked.hitCount, 1);
  await verify.db.client.close?.();
});

test("approved answer indexing creates a semantic vector and rejects weak matches below the configured threshold", async (t) => {
  const embedder = async ({ text }) => ({
    vector: text.includes("install") ? [1, 0] : [0, 1],
    provider: "test",
    model: "test-embedding",
  });

  const config = loadConfig({
    JUNI_DATABASE_URL: "file:/tmp/juni-answer-first-semantic-" + randomUUID() + ".db",
    JUNI_DATABASE_AUTH_TOKEN: "",
    JUNI_STORAGE_BUDGET_BYTES: String(20 * 1024 * 1024),
    JUNI_ANSWER_FIRST_SEMANTIC_THRESHOLD: "0.92",
  });
  const app = createJuniMemoryApplication({ config, answerEmbedder: embedder });
  await app.ready();
  t.after(async () => {
    try { await app.db.client.close?.(); } catch {}
  });

  const scope = { tenantId: "tenant-semantic", userId: "user-semantic" };
  const candidate = await app.knowledge.createAnswerCandidate(scope, {
    question: "How do I install JUNI-AI?",
    answer: "Use the locked package manifest.",
    provider: "openai",
    model: "gpt-5.5",
    sourceRef: "request-semantic",
    retentionExpiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
  });

  assert.equal(candidate.status, "candidate");

  const approved = await app.knowledge.approveAnswerCandidate(scope, candidate.id, {
    approvedBy: "user-semantic",
  });
  assert.equal(approved.status, "important");

  const vectorRows = await app.db.client.execute({
    sql: "SELECT object_type, object_id FROM embeddings WHERE tenant_id = ? AND user_id = ? AND object_type = 'knowledge' AND object_id = ? AND deleted_at IS NULL",
    args: [scope.tenantId, scope.userId, candidate.id],
  });
  assert.equal(vectorRows.rows.length, 1);

  const weak = await app.knowledge.findSemanticSavedAnswer(scope, "a different question", {
    minScore: 0.95,
  });
  assert.equal(weak, null);

  const strong = await app.knowledge.findSemanticSavedAnswer(scope, "please explain how to install this", {
    minScore: 0.8,
  });
  assert.equal(strong?.knowledgeId, candidate.id);
  assert.ok(strong.score >= 0.8);

  const events = await app.ledger.list(scope, { limit: 20 });
  assert.ok(events.some((event) => event.event_type === "answer_approved"));
  assert.ok(events.some((event) => event.event_type === "answer_indexed"));
});

test("answer misses are auditable and do not expose the original question", async (t) => {
  const app = await makeApp();
  t.after(async () => {
    try { await app.db.client.close?.(); } catch {}
  });

  const scope = { tenantId: "tenant-miss", userId: "user-miss" };
  await app.knowledge.recordAnswerMiss(scope, "A private question that should not enter logs.", {
    reason: "no_match",
  });

  const events = await app.ledger.list(scope, { limit: 10 });
  const miss = events.find((event) => event.event_type === "answer_cache_miss");
  assert.ok(miss);
  assert.equal(typeof miss.payload.questionHash, "string");
  assert.equal(miss.payload.questionHash.includes("private"), false);
});
