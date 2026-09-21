import { createJuniApplication } from "../core/app.js";
import { authorizeRequest, checkOrigin } from "../core/security.js";

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
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
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

  const checks = {
    storage: { ok: false },
    providers: [],
  };

  try {
    await app.memory.ready();
    await app.memory.db.client.execute("SELECT 1");
    checks.storage = {
      ok: true,
      persistent: Boolean(app.config.storage.databaseUrl && !String(app.config.storage.databaseUrl).startsWith("file:")),
    };
  } catch (error) {
    checks.storage = {
      ok: false,
      code: error?.code ?? error?.name ?? "STORAGE_ERROR",
    };
  }

  try {
    checks.providers = await app.juni.providerHealth();
  } catch (error) {
    checks.providers = [{ available: false, configured: false, error: error?.code ?? error?.name ?? "PROVIDER_HEALTH_ERROR" }];
  }

  const configuredProviders = checks.providers.filter((item) => item.configured);
  const availableProviders = checks.providers.filter((item) => item.available);
  const status = checks.storage.ok && availableProviders.length > 0 ? "ok" : "degraded";

  return json(res, status === "ok" ? 200 : 503, {
    status,
    service: "JUNI-AI",
    environment: app.config.app.environment,
    checks: {
      storage: checks.storage,
      providers: {
        configured: configuredProviders.length,
        available: availableProviders.length,
        total: checks.providers.length,
      },
    },
    metrics: app.metrics.snapshot(),
  });
}
