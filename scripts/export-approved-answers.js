import { createJuniDatabase } from "../storage/database.js";

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_RETRIES = 3;
const DEFAULT_BRANCH = "main";
const DEFAULT_PATH = "data/approved-answers.json";
const GITHUB_API_VERSION = "2026-03-10";

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

function githubContentEndpoint(repository, path) {
  if (!/^[^/]+\/[^/]+$/.test(repository)) {
    throw new TypeError("JUNI_GITHUB_REPOSITORY must be owner/name.");
  }

  return "https://api.github.com/repos/" + repository + "/contents/" +
    path.split("/").map(encodeURIComponent).join("/");
}

export function buildApprovedAnswersIndex(rows, {
  tenantId,
  userId,
  generatedAt = new Date().toISOString(),
} = {}) {
  return JSON.stringify({
    schemaVersion: 1,
    generatedAt,
    scope: { tenantId, userId },
    answers: rows.map((row) => ({
      id: row.knowledge_id,
      question: row.question_text,
      normalizedQuestion: row.normalized_question,
      answer: row.content_text,
      sourceType: row.source_type,
      sourceRef: row.source_ref,
      provider: row.provider ?? null,
      model: row.model ?? null,
      createdAt: row.knowledge_created_at,
      updatedAt: row.knowledge_updated_at,
      expiresAt: row.expires_at,
      hitCount: Number(row.hit_count ?? 0),
      lastHitAt: row.last_hit_at ?? null,
      checksum: row.checksum,
      confidence: row.confidence == null ? null : Number(row.confidence),
    })),
  }, null, 2) + "\n";
}

export async function readApprovedAnswers(
  client,
  { tenantId, userId, batchSize = DEFAULT_BATCH_SIZE } = {},
) {
  const rows = [];
  let offset = 0;
  const safeBatchSize = boundedInt(batchSize, DEFAULT_BATCH_SIZE, 1, 500);

  while (true) {
    const result = await client.execute({
      sql: `SELECT
        a.knowledge_id,
        a.question_text,
        a.normalized_question,
        a.expires_at,
        a.provider,
        a.model,
        a.hit_count,
        a.last_hit_at,
        k.content_text,
        k.source_type,
        k.source_ref,
        k.checksum,
        k.confidence,
        k.created_at AS knowledge_created_at,
        k.updated_at AS knowledge_updated_at
      FROM answer_index a
      JOIN knowledge_records k
        ON k.id = a.knowledge_id
       AND k.tenant_id = a.tenant_id
       AND k.user_id = a.user_id
      WHERE a.tenant_id = ?
        AND a.user_id = ?
        AND a.cacheable = 1
        AND k.knowledge_type = 'saved_answer'
        AND k.deleted_at IS NULL
        AND k.status IN ('important','permanent')
        AND (a.expires_at IS NULL OR a.expires_at > ?)
        AND (k.retention_expires_at IS NULL OR k.retention_expires_at > ?)
      ORDER BY a.created_at ASC, a.knowledge_id ASC
      LIMIT ? OFFSET ?`,
      args: [
        tenantId,
        userId,
        new Date().toISOString(),
        new Date().toISOString(),
        safeBatchSize,
        offset,
      ],
    });

    rows.push(...result.rows);
    if (result.rows.length < safeBatchSize) break;
    offset += safeBatchSize;
  }

  return rows;
}

export async function updateGithubContentFile({
  token,
  repository,
  path,
  branch = DEFAULT_BRANCH,
  content,
  fetchImpl = globalThis.fetch,
  sleepImpl = sleep,
  maxRetries = DEFAULT_RETRIES,
} = {}) {
  required(token, "JUNI_GITHUB_TOKEN");
  required(repository, "JUNI_GITHUB_REPOSITORY");
  required(path, "JUNI_GITHUB_INDEX_PATH");
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function.");

  const endpoint = githubContentEndpoint(repository, path);
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: "Bearer " + token,
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    "Content-Type": "application/json",
  };

  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const currentResponse = await fetchImpl(
      endpoint + "?ref=" + encodeURIComponent(branch),
      { method: "GET", headers },
    );

    let currentSha = null;
    if (currentResponse.ok) {
      const current = await currentResponse.json();
      currentSha = current?.sha ?? null;
    } else if (currentResponse.status !== 404) {
      throw new Error("GitHub read failed with HTTP " + currentResponse.status + ".");
    }

    const response = await fetchImpl(endpoint, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        message: "chore: export approved JUNI-AI answers",
        content: Buffer.from(content, "utf8").toString("base64"),
        branch,
        ...(currentSha ? { sha: currentSha } : {}),
      }),
    });

    if (response.ok) {
      const result = await response.json();
      return {
        status: response.status,
        fileSha: result?.content?.sha ?? null,
        commitSha: result?.commit?.sha ?? null,
      };
    }

    if (![409, 422].includes(response.status) || attempt === maxRetries) {
      throw new Error("GitHub write failed with HTTP " + response.status + ".");
    }

    lastError = new Error("GitHub content update conflict.");
    await sleepImpl(250 * (2 ** attempt));
  }

  throw lastError ?? new Error("GitHub content update failed.");
}

export async function exportApprovedAnswers(env = process.env, fetchImpl = globalThis.fetch) {
  const enabled = String(env.JUNI_APPROVED_ANSWER_EXPORT_ENABLED ?? "").trim().toLowerCase();
  if (!["1", "true", "yes", "on"].includes(enabled)) {
    return { exported: 0, skipped: true, reason: "approved_answer_export_disabled" };
  }

  const database = createJuniDatabase({
    url: required(env.JUNI_DATABASE_URL, "JUNI_DATABASE_URL"),
    authToken: env.JUNI_DATABASE_AUTH_TOKEN?.trim() || undefined,
  });

  try {
    await database.ready();

    const tenantId = required(env.JUNI_EXPORT_TENANT_ID, "JUNI_EXPORT_TENANT_ID");
    const userId = required(env.JUNI_EXPORT_USER_ID, "JUNI_EXPORT_USER_ID");
    const rows = await readApprovedAnswers(database.client, {
      tenantId,
      userId,
      batchSize: env.JUNI_EXPORT_BATCH_SIZE,
    });

    const content = buildApprovedAnswersIndex(rows, { tenantId, userId });
    const result = await updateGithubContentFile({
      token: env.JUNI_GITHUB_TOKEN,
      repository: env.JUNI_GITHUB_REPOSITORY,
      path: env.JUNI_GITHUB_INDEX_PATH?.trim() || DEFAULT_PATH,
      branch: env.JUNI_GITHUB_BRANCH?.trim() || DEFAULT_BRANCH,
      content,
      fetchImpl,
      maxRetries: boundedInt(env.JUNI_GITHUB_MAX_RETRIES, DEFAULT_RETRIES, 0, 8),
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
