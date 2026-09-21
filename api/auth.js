import { createJuniApplication } from "../core/app.js";
import { checkOrigin, clearAuthCookie, safeTokenEquals, serializeAuthCookie } from "../core/security.js";

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
  return req.ip
    || req.headers["x-real-ip"]
    || req.headers["x-forwarded-for"]?.split(",").at(-1)?.trim()
    || "unknown";
}
export default async function handler(req, res) {
  const app = getApplication();
  if (!checkOrigin(req.headers.origin, app.config.security.allowedOrigin)) {
    return json(res, 403, { error: "Origin not allowed." });
  }

  const limit = Number.parseInt(process.env.JUNI_RATE_LIMIT || "20", 10);
  const windowSeconds = Number.parseInt(process.env.JUNI_RATE_WINDOW_SECONDS || "60", 10);
  const rate = await app.rateLimiter.check(clientKey(req), Number.isFinite(limit) && limit > 0 ? limit : 20, Number.isFinite(windowSeconds) && windowSeconds > 0 ? windowSeconds : 60);

  res.setHeader("X-RateLimit-Limit", String(rate.limit));
  res.setHeader("X-RateLimit-Remaining", String(rate.remaining));
  res.setHeader("X-RateLimit-Store", rate.store);

  if (!rate.allowed) {
    res.setHeader("Retry-After", String(rate.retryAfter));
    return json(res, 429, { error: "Too many access-code attempts. Please try again shortly." });
  }

  const secure = String(process.env.NODE_ENV || "").toLowerCase() === "production"
    || String(process.env.VERCEL || "") === "1";

  if (req.method === "POST") {
    if (!app.config.security.apiToken) {
      return json(res, 503, { error: "The server is not configured yet. Add JUNI_API_TOKEN." });
    }

    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    if (!token || token.length > 4096 || !safeTokenEquals(token, app.config.security.apiToken)) {
      return json(res, 401, { error: "Invalid access code." });
    }

    res.setHeader("Set-Cookie", serializeAuthCookie(token, {
      name: app.config.security.authCookieName,
      maxAgeSeconds: app.config.security.authCookieMaxAgeSeconds,
      secure,
    }));
    return json(res, 200, { ok: true });
  }

  if (req.method === "DELETE") {
    res.setHeader("Set-Cookie", clearAuthCookie({
      name: app.config.security.authCookieName,
      secure,
    }));
    return json(res, 200, { ok: true });
  }

  res.setHeader("Allow", "POST, DELETE");
  return json(res, 405, { error: "Method not allowed." });
}
