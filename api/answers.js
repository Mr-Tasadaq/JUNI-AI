import { createJuniApplication } from "../core/app.js";
import { authorizeRequest, checkOrigin } from "../core/security.js";
import { resolveRequestIdentity } from "../core/identity.js";

let application;
function getApplication() {
  application ??= createJuniApplication();
  return application;
}

function json(res, status, body) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.json(body);
}

function clientKey(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
    || req.headers["x-real-ip"]
    || "unknown";
}

function resolveScope(req, app) {
  return resolveRequestIdentity(req, {
    fixedTenantId: app.config.identity?.fixedTenantId ?? null,
    fixedUserId: app.config.identity?.fixedUserId ?? null,
    allowIdentityHeaders: app.config.identity?.allowIdentityHeaders === true,
  });
}

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
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
    return json(res, auth.reason === "server_not_configured" ? 503 : 401, {
      error: auth.reason === "server_not_configured"
        ? "The server is not configured yet. Add JUNI_API_TOKEN."
        : "Authentication required.",
    });
  }

  const limit = Number.parseInt(process.env.JUNI_RATE_LIMIT || "20", 10);
  const windowSeconds = Number.parseInt(process.env.JUNI_RATE_WINDOW_SECONDS || "60", 10);
  const rate = await app.rateLimiter.check(
    clientKey(req),
    Number.isFinite(limit) && limit > 0 ? limit : 20,
    Number.isFinite(windowSeconds) && windowSeconds > 0 ? windowSeconds : 60,
  );

  res.setHeader("X-RateLimit-Limit", String(rate.limit));
  res.setHeader("X-RateLimit-Remaining", String(rate.remaining));
  if (!rate.allowed) {
    res.setHeader("Retry-After", String(rate.retryAfter));
    return json(res, 429, { error: "Too many requests. Please try again shortly." });
  }

  let scope;
  try {
    scope = resolveScope(req, app);
  } catch (error) {
    return json(res, 503, { error: error.message, code: error.code });
  }

  try {
    if (req.method === "GET") {
      const action = String(req.query?.action ?? "candidates");

      if (action === "candidates") {
        return json(res, 200, {
          candidates: await app.memory.knowledge.listAnswerCandidates(scope, {
            limit: req.query?.limit,
          }),
        });
      }

      if (action === "candidate") {
        return json(res, 200, {
          candidate: await app.memory.knowledge.get(
            scope,
            String(req.query?.id ?? ""),
          ),
        });
      }

      return json(res, 400, { error: "Unknown answer action." });
    }

    const action = String(req.body?.action ?? "");
    const id = String(req.body?.id ?? "");

    if (action === "approve") {
      return json(res, 200, {
        candidate: await app.memory.knowledge.approveAnswerCandidate(scope, id, {
          approvedBy: scope.actorId,
          actorId: scope.actorId,
        }),
      });
    }

    if (action === "reject") {
      return json(res, 200, {
        candidate: await app.memory.knowledge.rejectAnswerCandidate(scope, id, {
          rejectedBy: scope.actorId,
          reason: req.body?.reason ?? null,
        }),
      });
    }

    return json(res, 400, { error: "Unknown answer action." });
  } catch (error) {
    const status = error?.code === "ANSWER_APPROVAL_REQUIRED"
      ? 400
      : error?.code === "ANSWER_CANDIDATE_NOT_FOUND"
        ? 404
        : error?.code === "ANSWER_CANDIDATE_INVALID"
          ? 400
          : 500;

    return json(res, status, {
      error: error?.message ?? "Answer operation failed.",
      code: error?.code ?? "ANSWER_ERROR",
    });
  }
}
