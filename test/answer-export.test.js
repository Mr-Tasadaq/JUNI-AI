import test from "node:test";
import assert from "node:assert/strict";
import { buildApprovedAnswersIndex, updateGithubContentFile } from "../scripts/export-approved-answers.js";

test("approved-answer index contains only approved answer fields", () => {
  const content = buildApprovedAnswersIndex([
    {
      knowledge_id: "k-1",
      question_text: "What is JUNI-AI?",
      normalized_question: "what is juni-ai",
      content_text: "JUNI-AI is an AI assistant.",
      source_type: "model",
      source_ref: "request-1",
      provider: "openai",
      model: "gpt-5.5",
      knowledge_created_at: "2026-09-21T00:00:00.000Z",
      knowledge_updated_at: "2026-09-21T00:00:00.000Z",
      expires_at: "2026-10-21T00:00:00.000Z",
      hit_count: 4,
      last_hit_at: "2026-09-21T00:10:00.000Z",
      checksum: "hash-1",
      confidence: 0.91,
    },
  ], {
    tenantId: "tenant-a",
    userId: "user-a",
    generatedAt: "2026-09-21T00:20:00.000Z",
  });

  const parsed = JSON.parse(content);
  assert.equal(parsed.scope.tenantId, "tenant-a");
  assert.equal(parsed.answers.length, 1);
  assert.equal(parsed.answers[0].id, "k-1");
  assert.equal(parsed.answers[0].answer, "JUNI-AI is an AI assistant.");
  assert.equal(Object.hasOwn(parsed.answers[0], "token"), false);
});

test("GitHub export retries 409/422 using the latest file SHA", async () => {
  const calls = [];
  let getCount = 0;
  let putCount = 0;

  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (options.method === "GET") {
      getCount += 1;
      return new Response(JSON.stringify({ sha: getCount === 1 ? "sha-old" : "sha-new" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    putCount += 1;
    if (putCount === 1) {
      return new Response(JSON.stringify({ message: "conflict" }), { status: 409 });
    }

    return new Response(JSON.stringify({
      content: { sha: "blob-sha" },
      commit: { sha: "commit-sha" },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await updateGithubContentFile({
    token: "test-token",
    repository: "Mr-Tasadaq/JUNI-AI",
    path: "data/approved-answers.json",
    branch: "main",
    content: "{\"answers\":[]}\n",
    fetchImpl,
    sleepImpl: async () => {},
  });

  assert.equal(result.fileSha, "blob-sha");
  assert.equal(getCount, 2);
  assert.equal(putCount, 2);

  const puts = calls.filter((call) => call.options.method === "PUT");
  assert.match(puts[0].options.body, /sha-old/);
  assert.match(puts[1].options.body, /sha-new/);
});
