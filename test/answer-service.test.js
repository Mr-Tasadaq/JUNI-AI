import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../core/config.js";
import { createJuniMemoryApplication } from "../memory/app.js";
import {
  DEFAULT_SEMANTIC_THRESHOLD,
  normalizeQuestion,
  isCacheableAnswerRequest,
} from "../memory/answer-service.js";

const apps = [];

function makeConfig(extra = {}) {
  return loadConfig({
    JUNI_DATABASE_URL: "file:/tmp/juni-answer-first-" + randomUUID() + ".db",
    JUNI_STORAGE_BUDGET_BYTES: String(20 * 1024 * 1024),
    JUNI_ANSWER_FIRST_SEMANTIC_THRESHOLD: String(extra.threshold ?? DEFAULT_SEMANTIC_THRESHOLD),
  });
}

function scope(tenantId = "tenant-a", userId = "user-a") {
  return { tenantId, userId };
}

async function makeApp({ answerEmbedder = null, threshold = DEFAULT_SEMANTIC_THRESHOLD } = {}) {
  const config = makeConfig({ threshold });
  const app = createJuniMemoryApplication({ config, answerEmbedder });
  await app.ready();
  apps.push(app);
  return app;
}

afterEach(async () => {
  for (const app of apps.splice(0)) {
    try { await app.db.client.close?.(); } catch {}
  }
});

test("normalizes equivalent question punctuation and whitespace", () => {
  assert.equal(normalizeQuestion(" What is JUNI-AI? "), "what is juni-ai");
  assert.equal(normalizeQuestion("WHAT  IS  JUNI-AI!!!"), "what is juni-ai");
});

test("answer-first excludes time-sensitive, personalized, research, and prior-turn requests", () => {
  assert.equal(isCacheableAnswerRequest({ message: "What is JUNI-AI?" }), true);
  assert.equal(isCacheableAnswerRequest({ message: "What is the latest JUNI-AI price?" }), false);
  assert.equal(isCacheableAnswerRequest({ message: "What is my account status?" }), false);
  assert.equal(isCacheableAnswerRequest({ message: "Research JUNI-AI", task: "research" }), false);
  assert.equal(isCacheableAnswerRequest({
    message: "Continue that explanation",
    messages: [{ role: "user", content: "previous" }],
  }), false);
});

test("unapproved candidates never answer; approval enables exact hits and hit counters", async () => {
  const app = await makeApp();
  const candidate = await app.answers.createCandidate(scope(), {
    question: "What is JUNI-AI?",
    answer: "JUNI-AI is an AI assistant.",
    provider: "openai",
    model: "gpt-5.5",
    sourceType: "model",
    sourceRef: "request-1",
    ttlSeconds: 3600,
    requestId: "request-1",
  });

  const beforeApproval = await app.answers.answerFirst(scope(), {
    message: "What is JUNI-AI?",
    metadata: { requestId: "request-2" },
  });
  assert.equal(beforeApproval.hit, false);
  assert.equal(candidate.status, "needs_review");

  await assert.rejects(
    () => app.answers.approve(scope(), candidate.id, {}),
    (error) => error.code === "ANSWER_APPROVAL_REQUIRED"
  );

  const approved = await app.answers.approve(scope(), candidate.id, { approvedBy: "user-a" });
  assert.equal(approved.status, "approved");
  assert.equal(approved.needsReview, false);

  const hit = await app.answers.answerFirst(scope(), {
    message: " what is juni-ai?! ",
    metadata: { requestId: "request-3" },
  });

  assert.equal(hit.hit, true);
  assert.equal(hit.matchType, "exact");
  assert.equal(hit.answerId, candidate.id);
  assert.equal(hit.answer, "JUNI-AI is an AI assistant.");

  const stored = await app.answers.get(scope(), candidate.id);
  assert.equal(stored.hitCount, 1);

  const ledger = await app.ledger.list(scope(), { limit: 20 });
  assert.ok(ledger.some((event) => event.event_type === "answer_hit"));
});

test("semantic matching uses the configured threshold and tenant/user scope", async () => {
  const embedder = async () => ({ vector: [1, 0], provider: "test", model: "embedding-v1" });
  const app = await makeApp({ answerEmbedder: embedder, threshold: 0.92 });

  const candidate = await app.answers.createCandidate(scope(), {
    question: "Explain the JUNI-AI platform",
    answer: "JUNI-AI is the assistant platform.",
    provider: "openai",
    model: "gpt-5.5",
    sourceRef: "request-semantic",
    ttlSeconds: 3600,
  });

  await app.answers.approve(scope(), candidate.id, { approvedBy: "user-a" });

  const hit = await app.answers.answerFirst(scope(), {
    message: "Tell me about the assistant platform",
    metadata: { requestId: "request-semantic-hit" },
  });
  assert.equal(hit.hit, true);
  assert.equal(hit.matchType, "semantic");
  assert.ok(hit.score >= 0.92);

  const otherScope = await app.answers.answerFirst(scope("tenant-b", "user-b"), {
    message: "Tell me about the assistant platform",
    metadata: { requestId: "request-other" },
  });
  assert.equal(otherScope.hit, false);
});

test("expired approved answers are not served", async () => {
  const app = await makeApp();
  const candidate = await app.answers.createCandidate(scope(), {
    question: "An expiring answer",
    answer: "This should expire.",
    ttlSeconds: 60,
  });
  await app.answers.approve(scope(), candidate.id, { approvedBy: "user-a" });

  await app.db.client.execute({
    sql: "UPDATE saved_answers SET expires_at = ? WHERE tenant_id = ? AND user_id = ? AND id = ?",
    args: ["2000-01-01T00:00:00.000Z", scope().tenantId, scope().userId, candidate.id],
  });

  const result = await app.answers.answerFirst(scope(), {
    message: "An expiring answer",
    metadata: { requestId: "request-expired" },
  });
  assert.equal(result.hit, false);
});
