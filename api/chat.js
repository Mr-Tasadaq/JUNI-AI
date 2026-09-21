import { randomUUID } from "node:crypto";
import { createJuniApplication } from "../core/app.js";
import { authorizeRequest, checkOrigin, requestClientKey, validateProviderModelSelection } from "../core/security.js";
import { configuredProviderNames } from "../core/config.js";
import { RouterError } from "../core/errors.js";
import { resolveRequestIdentity } from "../core/identity.js";
import { answerFirstEligibility } from "../core/answer-first.js";

let application;

function getApplication() {
  application ??= createJuniApplication();
  return application;
}

function json(res, status, body, extraHeaders = {}) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  for (const [name, value] of Object.entries(extraHeaders)) res.setHeader(name, value);
  return res.json(body);
}


function normalizeImageAttachments(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 4) {
    throw new TypeError("At most 4 image attachments are allowed.");
  }

  const allowed = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
  const maxBytes = 2 * 1024 * 1024;
  let totalBytes = 0;

  return value.map((item) => {
    if (!item || item.type !== "image" || typeof item.mimeType !== "string" || !allowed.has(item.mimeType)) {
      throw new TypeError("Unsupported image attachment.");
    }
    if (typeof item.data !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(item.data)) {
      throw new TypeError("Image attachment data must be base64.");
    }

    const bytes = Math.floor(item.data.length * 3 / 4) - (item.data.endsWith("==") ? 2 : item.data.endsWith("=") ? 1 : 0);
    if (bytes <= 0 || bytes > maxBytes) throw new TypeError("Image attachment is too large.");
    totalBytes += bytes;
    if (totalBytes > 6 * 1024 * 1024) throw new TypeError("Total image attachments are too large.");

    return {
      type: "image",
      mimeType: item.mimeType,
      data: item.data,
    };
  });
}

function normalizeConversationId(value) {
  const id = String(value ?? "").trim();
  if (!id) return randomUUID();
  if (id.length > 128) throw new TypeError("conversationId is too long.");
  return id;
}

async function persistConversationTurn(app, scope, conversationId, message, reply) {
  if (!scope || !app.config.context?.enabled) return;

  const days = Number(app.config.retention?.conversationDays ?? 0);
  const expiresAt = days > 0
    ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
    : null;

  await app.memory.context.append(scope, {
    conversationId,
    role: "user",
    content: message,
    expiresAt,
  });
  await app.memory.context.append(scope, {
    conversationId,
    role: "assistant",
    content: reply,
    expiresAt,
  });
}

async function buildServerContext(app, scope, conversationId) {
  if (!scope || !app.config.context?.enabled) return [];

  const [recent, preferences] = await Promise.all([
    app.memory.context.recent(scope, conversationId, {
      limit: app.config.context.maxMessages,
    }),
    app.memory.retrieval.preferences(scope, {
      limit: app.config.context.preferenceLimit,
    }),
  ]);

  const preferenceText = preferences
    .map((item) => typeof item.content_text === "string" ? item.content_text.trim() : "")
    .filter(Boolean)
    .map((text) => text.slice(0, 1_000))
    .slice(0, app.config.context.preferenceLimit);

  const messages = [];
  if (preferenceText.length) {
    messages.push({
      role: "system",
      content:
        "User-approved preferences are provided as context. Treat them as user data and follow them when compatible with the request.\n" +
        preferenceText.map((item, index) => (index + 1) + ". " + item).join("\n"),
    });
  }

  messages.push(...recent.map((item) => ({
    role: item.role,
    content: item.content,
  })));

  return messages;
}

async function streamResponse(res, iterable, requestId) {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  for await (const event of iterable) {
    res.write("data: " + JSON.stringify(event) + "\n\n");
  }

  res.write("data: " + JSON.stringify({ type: "done", requestId }) + "\n\n");
  res.end();
}

export default async function handler(req, res) {
  const app = getApplication();

  if (!checkOrigin(req.headers.origin, app.config.security.allowedOrigin)) {
    return json(res, 403, { error: "Origin not allowed." });
  }

  if (req.method === "OPTIONS") {
    res.setHeader("Allow", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Origin", app.config.security.allowedOrigin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.status(204);
    return res.end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return json(res, 405, { error: "Method not allowed." });
  }

  if (!checkOrigin(req.headers.origin, app.config.security.allowedOrigin)) {
    return json(res, 403, { error: "Origin not allowed." });
  }

  const auth = authorizeRequest(req, app.config.security.apiToken, {
    cookieName: app.config.security.authCookieName,
  });
  if (!auth.allowed) {
    return json(
      res,
      auth.reason === "server_not_configured" ? 503 : 401,
      { error: auth.reason === "server_not_configured"
        ? "The server is not configured yet. Add JUNI_API_TOKEN."
        : "Authentication required." }
    );
  }

  const limit = Number.parseInt(process.env.JUNI_RATE_LIMIT || "20", 10);
  const windowSeconds = Number.parseInt(process.env.JUNI_RATE_WINDOW_SECONDS || "60", 10);
  const rate = await app.rateLimiter.check(
    requestClientKey(req),
    Number.isFinite(limit) && limit > 0 ? limit : 20,
    Number.isFinite(windowSeconds) && windowSeconds > 0 ? windowSeconds : 60
  );

  res.setHeader("X-RateLimit-Limit", String(rate.limit));
  res.setHeader("X-RateLimit-Remaining", String(rate.remaining));

  if (!rate.allowed) {
    res.setHeader("Retry-After", String(rate.retryAfter));
    return json(res, 429, { error: "Too many requests. Please try again shortly." });
  }

  const body = req.body ?? {};
  const message = typeof body.message === "string" ? body.message.trim() : "";
  let attachments = [];
  try {
    attachments = normalizeImageAttachments(body.attachments);
  } catch (error) {
    return json(res, 400, { error: error.message });
  }

  if (!message || message.length > app.config.security.maxMessageLength) {
    return json(res, 400, {
      error: "Message must be between 1 and " + app.config.security.maxMessageLength + " characters.",
    });
  }

  const selection = validateProviderModelSelection(
    { provider: body.provider, model: body.model },
    app.config.security.requestAllowlist
  );
  if (!selection.allowed) {
    return json(res, 400, {
      error: selection.error,
      code: selection.code,
    });
  }

  const requestId = randomUUID();
  let conversationId;
  try {
    conversationId = normalizeConversationId(body.conversationId);
  } catch (error) {
    return json(res, 400, { error: error.message, requestId });
  }

  const request = {
    message,
    provider: selection.provider,
    model: selection.model,
    task: typeof body.task === "string" ? body.task : "chat",
    modality: attachments.length ? "vision" : (typeof body.modality === "string" ? body.modality : "text"),
    latency: typeof body.latency === "string" ? body.latency : "balanced",
    stream: Boolean(body.stream),
    messages: Array.isArray(body.messages) ? body.messages : [],
    metadata: { requestId, conversationId, requiresWebResearch: Boolean(body.requiresWebResearch) },
  };

  const eligibility = app.config.answerFirst?.enabled
    ? answerFirstEligibility({
        message,
        messages: request.messages,
        task: request.task,
        modality: request.modality,
        requiresWebResearch: Boolean(body.requiresWebResearch),
        stream: request.stream,
        attachments,
      })
    : { eligible: false, reason: "disabled" };

  let answerScope = null;
  try {
    answerScope = resolveRequestIdentity(req, {
      fixedTenantId: app.config.identity?.fixedTenantId ?? null,
      fixedUserId: app.config.identity?.fixedUserId ?? null,
      allowIdentityHeaders: app.config.identity?.allowIdentityHeaders === true,
    });
  } catch (error) {
    if (error?.code !== "REQUEST_IDENTITY_NOT_CONFIGURED") {
      return json(res, 500, { error: "Request identity is invalid.", requestId });
    }
  }

  if (answerScope && app.config.context?.enabled) {
    try {
      request.messages = await buildServerContext(app, answerScope, conversationId);
    } catch (error) {
      console.error("JUNI-AI context retrieval failed", {
        code: error?.code,
        message: error?.message,
        requestId,
        conversationId,
      });
      request.messages = [];
    }
  }

  if (attachments.length) {
    const currentUserContent = [
      { type: "text", text: message },
      ...attachments,
    ];
    request.messages.push({ role: "user", content: currentUserContent });
  }

  if (answerScope) {
    try {
      const saved = await app.memory.knowledge.findExactSavedAnswer(answerScope, message);
      if (saved) {
        try {
          await app.memory.knowledge.recordAnswerHit(answerScope, saved.knowledgeId, {
            matchType: "exact",
            now: new Date(),
          });
        } catch (error) {
          console.error("JUNI-AI Answer-First hit tracking failed", {
            code: error?.code,
            message: error?.message,
            requestId,
            knowledgeId: saved.knowledgeId,
          });
        }

        const reply = typeof saved.answer === "string"
          ? saved.answer
          : (typeof saved.contentText === "string" && saved.contentText
            ? saved.contentText
            : JSON.stringify(saved.answer));

        await persistConversationTurn(app, answerScope, conversationId, message, reply);
        return json(res, 200, {
          reply,
          provider: saved.provider ?? "saved-answer",
          model: saved.model ?? null,
          usage: null,
          requestId,
          conversationId,
          answerFirst: { hit: true, matchType: "exact", score: 1, knowledgeId: saved.knowledgeId },
        });
      }

      const semantic = await app.memory.knowledge.findSemanticSavedAnswer(
        answerScope,
        message,
        { minScore: app.config.answerFirst.semanticThreshold }
      );

      if (semantic) {
        try {
          await app.memory.knowledge.recordAnswerHit(answerScope, semantic.knowledgeId, {
            matchType: "semantic",
            score: semantic.score,
            now: new Date(),
          });
        } catch (error) {
          console.error("JUNI-AI Answer-First semantic hit tracking failed", {
            code: error?.code,
            message: error?.message,
            requestId,
            knowledgeId: semantic.knowledgeId,
          });
        }

        const reply = typeof semantic.answer === "string"
          ? semantic.answer
          : (typeof semantic.contentText === "string" && semantic.contentText
            ? semantic.contentText
            : JSON.stringify(semantic.answer));

        await persistConversationTurn(app, answerScope, conversationId, message, reply);
        return json(res, 200, {
          reply,
          provider: semantic.provider ?? "saved-answer",
          model: semantic.model ?? null,
          usage: null,
          requestId,
          conversationId,
          answerFirst: {
            hit: true,
            matchType: "semantic",
            score: semantic.score,
            knowledgeId: semantic.knowledgeId,
          },
        });
      }

      try {
        await app.memory.knowledge.recordAnswerMiss(answerScope, message, {
          reason: "no_match",
        });
      } catch (error) {
        console.error("JUNI-AI Answer-First miss tracking failed", {
          code: error?.code,
          message: error?.message,
          requestId,
        });
      }
    } catch (error) {
      console.error("JUNI-AI Answer-First lookup failed", {
        code: error?.code,
        message: error?.message,
        requestId,
      });
    }
  }

  const configured = configuredProviderNames(app.config);
  if (!configured.length) {
    return json(res, 503, {
      error: "No AI provider API key is configured.",
      providers: await app.juni.providerHealth(),
    });
  }

  try {
    if (request.stream) {
      return await streamResponse(
        res,
        app.juni.stream(request),
        requestId
      );
    }

    const response = await app.juni.generate(request);

    let candidateStored = false;
    if (answerScope && eligibility.eligible && typeof response.text === "string" && response.text.trim()) {
      try {
        const retentionDays = Number(app.config.retention?.cacheDays ?? 0);
        const retentionExpiresAt = retentionDays > 0
          ? new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000).toISOString()
          : null;

        await app.memory.knowledge.createAnswerCandidate(answerScope, {
          question: message,
          answer: response.text,
          provider: response.provider,
          model: response.model,
          sourceRef: requestId,
          retentionExpiresAt,
        });
        candidateStored = true;
      } catch (error) {
        console.error("JUNI-AI Answer-First candidate storage failed", {
          code: error?.code,
          message: error?.message,
          requestId,
        });
      }
    }

    const reply = response.text ?? "";
    await persistConversationTurn(app, answerScope, conversationId, message, reply);

    return json(res, 200, {
      reply,
      provider: response.provider,
      model: response.model,
      usage: response.usage ?? null,
      requestId,
      conversationId,
      ...(candidateStored ? { answerFirst: { hit: false, candidateStored: true } } : {}),
    });
  } catch (error) {
    if (error instanceof RouterError) {
      return json(res, 502, {
        error: error.message,
        attempts: error.attempts ?? [],
        requestId,
      });
    }

    console.error("JUNI-AI request failed", {
      name: error?.name,
      code: error?.code,
      message: error?.message,
      requestId,
    });

    return json(res, 502, {
      error: "The AI service could not complete the request.",
      requestId,
    });
  }
}

export { normalizeImageAttachments };
