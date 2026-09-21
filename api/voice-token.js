import { createJuniApplication } from "../core/app.js";
import { authorizeRequest, checkOrigin, requestClientKey } from "../core/security.js";
import { createGeminiEphemeralToken } from "../core/voice-token.js";

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


export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "Method not allowed." });
  }

  const app = getApplication();

  if (!app.config.app.featureFlags.voice) {
    return json(res, 404, { error: "Voice is disabled." });
  }

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

  const rate = await app.rateLimiter.check(
    clientKey(req),
    5,
    60,
  );
  res.setHeader("X-RateLimit-Limit", String(rate.limit));
  res.setHeader("X-RateLimit-Remaining", String(rate.remaining));
  if (!rate.allowed) {
    res.setHeader("Retry-After", String(rate.retryAfter));
    return json(res, 429, { error: "Too many voice-session requests. Please try again shortly." });
  }

  try {
    const token = await createGeminiEphemeralToken({
      apiKey: app.config.providers.gemini.apiKey,
      model: app.config.providers.gemini.liveModel,
    });

    return json(res, 200, {
      model: token.model,
      expireTime: token.expireTime,
      newSessionExpireTime: token.newSessionExpireTime,
      websocketUrl: token.websocketUrl,
    });
  } catch (error) {
    console.error("JUNI-AI voice token creation failed", {
      code: error?.code,
      message: error?.message,
    });

    const status = error?.code === "VOICE_CONFIGURATION_REQUIRED" ? 503 : 502;
    return json(res, status, {
      error: "A secure voice session could not be created.",
      code: error?.code ?? "VOICE_TOKEN_ERROR",
    });
  }
}
