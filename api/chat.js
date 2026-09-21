import { randomUUID } from "node:crypto";
import { createJuniApplication } from "../core/app.js";
import { authorizeRequest, checkOrigin, validateProviderModelSelection } from "../core/security.js";
import { configuredProviderNames } from "../core/config.js";
import { RouterError } from "../core/errors.js";
import { resolveResearchScope } from "../research/http-identity.js";
import { isCacheableAnswerRequest } from "../memory/answer-service.js";

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

function clientKey(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
    || req.headers["x-real-ip"]
    || "unknown";
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
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "Method not allowed." });
  }

  const app = getApplication();

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
    clientKey(req),
    Number.isFinite(limit) && limit > 0 ? limit : 20,
    Number.isFinite(windowSeconds) && windowSeconds > 0 ? windowSeconds : 60
  );

  res.setHeader("X-RateLimit-Limit", String(rate.limit));
  res.setHeader("X-RateLimit-Remaining", String(rate.remaining));
  res.setHeader("X-RateLimit-Store", rate.store);

  if (!rate.allowed) {
    res.setHeader("Retry-After", String(rate.retryAfter));
    return json(res, 429, { error: "Too many requests. Please try again shortly." });
  }

  const body = req.body ?? {};
  const message = typeof body.message === "string" ? body.message.trim() : "";
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

  const configured = configuredProviderNames(app.config);
  if (!configured.length) {
    return json(res, 503, {
      error: "No AI provider API key is configured.",
      providers: await app.juni.providerHealth(),
    });
  }

  const requestId = randomUUID();
  const request = {
    message,
    provider: selection.provider,
    model: selection.model,
    task: typeof body.task === "string" ? body.task : "chat",
    modality: typeof body.modality === "string" ? body.modality : "text",
    latency: typeof body.latency === "string" ? body.latency : "balanced",
    stream: Boolean(body.stream),
    messages: Array.isArray(body.messages) ? body.messages : [],
    metadata: { requestId, requiresWebResearch: Boolean(body.requiresWebResearch) },
  };

  let answerScope = null;
  if (app.config.app.featureFlags.answerFirst && app.config.storage.enabled) {
    try {
      answerScope = resolveResearchScope(req, app.config);
    } catch {
      answerScope = null;
    }
  }

  if (answerScope) {
    try {
      const match = await app.memory.answers.answerFirst(answerScope, {
        message,
        task: request.task,
        messages: request.messages,
        cacheAnswer: body.cacheAnswer,
        metadata: {
          ...request.metadata,
          timeSensitive: body.timeSensitive === true,
          personalized: body.personalized === true,
          turnDependent: body.turnDependent === true,
        },
      }, {
        semanticThreshold: app.config.app.answerFirst.semanticThreshold,
      });

      if (match.hit) {
        return json(res, 200, {
          reply: match.answer,
          provider: match.provider,
          model: match.model,
          usage: null,
          requestId,
          answerFirst: {
            hit: true,
            matchType: match.matchType,
            score: match.score,
            answerId: match.answerId,
          },
        });
      }
    } catch (error) {
      console.error("JUNI-AI answer-first lookup failed", {
        code: error?.code,
        message: error?.message,
        requestId,
      });
    }
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

    let candidateId = null;
    if (
      answerScope
      && isCacheableAnswerRequest({
        message,
        task: request.task,
        messages: request.messages,
        cacheAnswer: body.cacheAnswer,
        metadata: {
          requiresWebResearch: request.metadata.requiresWebResearch,
          timeSensitive: body.timeSensitive === true,
          personalized: body.personalized === true,
          turnDependent: body.turnDependent === true,
        },
      })
      && typeof response.text === "string"
      && response.text.trim()
    ) {
      try {
        const candidate = await app.memory.answers.createCandidate(answerScope, {
          question: message,
          answer: response.text,
          provider: response.provider,
          model: response.model,
          sourceType: "model",
          sourceRef: requestId,
          ttlSeconds: app.config.app.answerFirst.candidateTtlSeconds,
          metadata: {
            requestId,
            task: request.task,
            kind: "knowledge_answer",
          },
          requestId,
        });
        candidateId = candidate?.id ?? null;
      } catch (error) {
        console.error("JUNI-AI answer candidate write failed", {
          code: error?.code,
          message: error?.message,
          requestId,
        });
      }
    }

    return json(res, 200, {
      reply: response.text ?? "",
      provider: response.provider,
      model: response.model,
      usage: response.usage ?? null,
      requestId,
      answerFirst: {
        hit: false,
        candidateId,
      },
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
