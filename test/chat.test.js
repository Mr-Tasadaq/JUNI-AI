import test from "node:test";
import assert from "node:assert/strict";
import handler, { normalizeImageAttachments } from "../api/chat.js";

function makeResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = String(value); return this; },
    json(value) { this.body = value; return this; },
  };
}

function makeRequest(overrides = {}) {
  return {
    method: "POST",
    headers: { authorization: "Bearer test-token", "x-forwarded-for": "203.0.113.10" },
    body: { message: "Hello", messages: [] },
    ...overrides,
  };
}

test("rejects missing authentication", async () => {
  process.env.JUNI_API_TOKEN = "test-token";
  const req = makeRequest({ headers: {} });
  const res = makeResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, "Authentication required.");
});

test("rejects non-POST requests", async () => {
  process.env.JUNI_API_TOKEN = "test-token";
  const req = makeRequest({ method: "GET" });
  const res = makeResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "POST, OPTIONS");
});

test("preserves legacy chat request shape when providers are unconfigured", async () => {
  process.env.JUNI_API_TOKEN = "test-token";
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const req = makeRequest();
  const res = makeResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, "No AI provider API key is configured.");
});

test("rejects overlong messages", async () => {
  process.env.JUNI_API_TOKEN = "test-token";
  process.env.OPENAI_API_KEY = "test-key";
  const req = makeRequest({ body: { message: "x".repeat(4001), messages: [] } });
  const res = makeResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /4000/);
});

test("validates multimodal image attachments", () => {
  const valid = normalizeImageAttachments([{
    type: "image",
    mimeType: "image/png",
    data: "aGVsbG8=",
  }]);

  assert.equal(valid.length, 1);
  assert.equal(valid[0].mimeType, "image/png");

  assert.throws(
    () => normalizeImageAttachments([{
      type: "image",
      mimeType: "text/plain",
      data: "aGVsbG8=",
    }]),
    /Unsupported image attachment/
  );

  assert.throws(
    () => normalizeImageAttachments([{
      type: "image",
      mimeType: "image/png",
      data: "not base64!",
    }]),
    /base64/
  );
});

