import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../core/config.js";
import { createJuniMemoryApplication } from "../memory/app.js";

async function makeApp() {
  const config = loadConfig({
    JUNI_DATABASE_URL: "file:/tmp/juni-context-" + randomUUID() + ".db",
    JUNI_DATABASE_AUTH_TOKEN: "",
    JUNI_STORAGE_BUDGET_BYTES: String(10 * 1024 * 1024),
    JUNI_RETENTION_CONVERSATION_DAYS: "7",
  });
  const app = createJuniMemoryApplication({ config });
  await app.ready();
  return app;
}

test("conversation context is persistent and tenant/user scoped", async (t) => {
  const app = await makeApp();
  t.after(async () => { try { await app.db.client.close?.(); } catch {} });

  const scope = { tenantId: "tenant-a", userId: "user-a" };
  await app.context.append(scope, {
    conversationId: "chat-1",
    role: "user",
    content: "What is JUNI-AI?",
  });
  await app.context.append(scope, {
    conversationId: "chat-1",
    role: "assistant",
    content: "JUNI-AI is a multi-provider assistant.",
  });

  const recent = await app.context.recent(scope, "chat-1");
  assert.deepEqual(recent.map((item) => item.role), ["user", "assistant"]);
  assert.equal(recent[1].content, "JUNI-AI is a multi-provider assistant.");

  assert.equal((await app.context.recent({ tenantId: "tenant-a", userId: "user-b" }, "chat-1")).length, 0);
  assert.equal((await app.context.recent({ tenantId: "tenant-b", userId: "user-a" }, "chat-1")).length, 0);
});

test("approved preferences are returned separately from candidate memories", async (t) => {
  const app = await makeApp();
  t.after(async () => { try { await app.db.client.close?.(); } catch {} });

  const scope = { tenantId: "tenant-a", userId: "user-a" };

  await app.memory.create(scope, {
    memoryType: "user_preference",
    content: "Prefers concise technical answers.",
    sourceType: "user",
    trustLevel: "trusted",
    status: "important",
    approvedBy: "user-a",
  });

  await app.memory.create(scope, {
    memoryType: "user_preference",
    content: "Candidate preference must not be injected.",
    sourceType: "model",
    trustLevel: "generated",
    status: "candidate",
  });

  const preferences = await app.retrieval.preferences(scope, { limit: 10 });
  assert.equal(preferences.length, 1);
  assert.equal(preferences[0].content_text, "Prefers concise technical answers.");
});

test("conversation context retention metadata can expire old turns", async (t) => {
  const app = await makeApp();
  t.after(async () => { try { await app.db.client.close?.(); } catch {} });

  const scope = { tenantId: "tenant-a", userId: "user-a" };
  const expired = new Date(Date.now() - 60_000).toISOString();

  await app.context.append(scope, {
    conversationId: "expired-chat",
    role: "user",
    content: "Old message",
    expiresAt: expired,
  });

  const recent = await app.context.recent(scope, "expired-chat");
  assert.equal(recent.length, 1);

  const cleanup = await app.retention.expired(scope);
  assert.ok(cleanup.some((item) => item.record_type === "context"));
});
