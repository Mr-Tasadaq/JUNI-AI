import test from "node:test";
import assert from "node:assert/strict";
import { buildApprovedAnswersIndex, updateGithubContentFile } from "../scripts/export-approved-answers.js";

test("approved-answer export emits one scoped index without credentials", () => {
  const output = buildApprovedAnswersIndex([
    {
      id: "answer-1",
      question_text: "What is JUNI-AI?",
      normalized_question: "what is juni-ai",
      answer_text: "An AI assistant.",
      source_type: "model",
      source_ref: "request-1",
      provider: "openai",
      model: "gpt-5.5",
      created_at: "2026-09-21T00:00:00.000Z",
      updated_at: "2026-09-21T00:00:00.000Z",
      expires_at: "2026-10-21T00:00:00.000Z",
      ttl_seconds: 2592000,
      hit_count: 2,
      checksum: "abc",
      confidence: 0.9,
    },
  ], { tenantId: "tenant-a", userId: "user-a", generatedAt: "2026-09-21T00:00:00.000Z" });

  const index = JSON.parse(output);
  assert.equal(index.answers.length, 1);
  assert.equal(index.scope.tenantId, "tenant-a");
  assert.equal(index.answers[0].id, "answer-1");
  assert.equal(Object.hasOwn(index, "token"), false);
});

test("GitHub export retries 409 conflicts and updates using the current file SHA", async () => {
  const calls = [];
  let getCount = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (options.method === "GET") {
      getCount += 1;
      if (getCount === 1) return new Response(JSON.stringify({ sha: "sha-old" }), { status: 200 });
      return new Response(JSON.stringify({ sha: "sha-new" }), { status: 200 });
    }
    if (calls.filter((call) => call.options.method === "PUT").length === 1) {
      return new Response(JSON.stringify({ message: "conflict" }), { status: 409 });
    }
    return new Response(JSON.stringify({
      content: { sha: "file-sha" },
      commit: { sha: "commit-sha" },
    }), { status: 200 });
  };

  const result = await updateGithubContentFile({
    token: "test-token",
    repository: "Mr-Tasadaq/JUNI-AI",
    path: "data/approved-answers.json",
    branch: "main",
    content: "{\"ok\":true}\n",
    fetchImpl,
    sleepImpl: async () => {},
  });

  assert.equal(result.fileSha, "file-sha");
  const puts = calls.filter((call) => call.options.method === "PUT");
  assert.equal(puts.length, 2);
  assert.match(puts[0].options.body, /sha-old/);
  assert.match(puts[1].options.body, /sha-new/);
});
