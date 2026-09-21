
import { createJuniDatabase } from "../storage/database.js";

const DEFAULT_PATH = "data/approved-answers.json";
const DEFAULT_BRANCH = "main";
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_RETRIES = 3;

function required(value, name) {
  if (!value || !String(value).trim()) throw new Error(name + " is required.");
  return String(value).trim();
}

function boundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readApprovedAnswers(client, tenantId, userId, batchSize) {
  const rows = [];
  let offset = 0;

  while (true) {
    const result = await client.execute({
      sql: "SELECT id, question_text, normalized_question, answer_text, source_type, source_ref, provider, model, created_at, updated_at, expires_at, ttl_seconds, hit_count, checksum, confidence FROM saved_answers WHERE tenant_id = ? AND user_id = ? AND status = 'approved' AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at ASC, id ASC LIMIT ? OFFSET ?",
      args: [tenantId, userId, new Date().toISOString(), batchSize, offset],
    });

    rows.push(...result.rows);
    if (result.rows.length < batchSize) break;
    offset += batchSize;
  }

  return rows;
}

export function buildApprovedAnswersIndex(rows, { tenantId, userId, generatedAt = new Date().toISOString() }) {
  return JSON.stringify({
    schemaVersion: 1,
    generatedAt,
    scope: { tenantId, userId },
    answers: rows.map((row) => ({
      id: row.id,
      question: row.question_text,
      normalizedQuestion: row.normalized_question,
      answer: row.answer_text,
      sourceType: row.source_type,
      sourceRef: row.source_ref,
      provider: row.provider,
      model: row.model,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
      ttlSeconds: Number(row.ttl_seconds),
      hitCount: Number(row.hit_count),
      checksum: row.checksum,
      confidence: row.confidence == null ? null : Number(row.confidence),
    })),
  }, null, 2) + "\n";
}

export async function updateGithubContentFile({
  token,
  repository,
  path,
  branch = DEFAULT_BRANCH,
  content,
  fetchImpl = globalThis.fetch,
  maxRetries = DEFAULT_RETRIES,
  sleepImpl = sleep,
} = {}) {
  required(token, "GitHub token");
  required(repository, "GitHub repository");
  required(path, "GitHub file path");

  const endpoint = "https://api.github.com/repos/" + repository + "/contents/" +
    path.split("/").map(encodeURIComponent).join("/");

  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: "Bearer " + token,
    "X-GitHub-Api-Version": "2026-03-10",
    "Content-Type": "application/json",
  };

  let lastConflict = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await fetchImpl(endpoint + "?ref=" + encodeURIComponent(branch), {
      method: "GET",
      headers,
    });

    let currentSha = null;
    if (response.ok) {
      const current = await response.json();
      currentSha = current?.sha ?? null;
    } else if (response.status !== 404) {
      throw new Error("GitHub read failed with HTTP " + response.status + ".");
    }

    const put = await fetchImpl(endpoint, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        message: "chore: export approved JUNI-AI answers",
        content: Buffer.from(content, "utf8").toString("base64"),
        branch,
        ...(currentSha ? { sha: currentSha } : {}),
      }),
    });

    if (put.ok) {
      const result = await put.json();
      return {
        status: put.status,
        fileSha: result?.content?.sha ?? null,
        commitSha: result?.commit?.sha ?? null,
      };
    }

    if (![409, 422].includes(put.status) || attempt === maxRetries) {
      throw new Error("GitHub write failed with HTTP " + put.status + ".");
    }

    lastConflict = new Error("GitHub write conflict; retrying.");
    await sleepImpl(250 * (2 ** attempt));
  }

  throw lastConflict ?? new Error("GitHub write failed.");
}

export async function exportApprovedAnswers(env = process.env, fetchImpl = globalThis.fetch) {
  const repository = required(env.JUNI_GITHUB_REPOSITORY, "JUNI_GITHUB_REPOSITORY");
  const token = required(env.JUNI_GITHUB_TOKEN, "JUNI_GITHUB_TOKEN");
  const tenantId = required(env.JUNI_EXPORT_TENANT_ID, "JUNI_EXPORT_TENANT_ID");
  const userId = required(env.JUNI_EXPORT_USER_ID, "JUNI_EXPORT_USER_ID");

  const database = createJuniDatabase({
    url: required(env.JUNI_DATABASE_URL, "JUNI_DATABASE_URL"),
    authToken: env.JUNI_DATABASE_AUTH_TOKEN?.trim() || undefined,
  });

  try {
    await database.ready();

    const batchSize = boundedInt(env.JUNI_EXPORT_BATCH_SIZE, DEFAULT_BATCH_SIZE, 1, 500);
    const rows = await readApprovedAnswers(database.client, tenantId, userId, batchSize);
    const content = buildApprovedAnswersIndex(rows, { tenantId, userId });

    const result = await updateGithubContentFile({
      token,
      repository,
      path: env.JUNI_GITHUB_INDEX_PATH?.trim() || DEFAULT_PATH,
      branch: env.JUNI_GITHUB_BRANCH?.trim() || DEFAULT_BRANCH,
      content,
      fetchImpl,
    });

    return {
      exported: rows.length,
      ...result,
    };
  } finally {
    try { await database.client.close?.(); } catch {}
  }
}

if (import.meta.url === "file://" + process.argv[1]?.replace(/\\/g, "/")) {
  exportApprovedAnswers()
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
