import { loadConfig, configuredProviderNames } from "../core/config.js";

const env = process.env;
const isProduction = String(env.VERCEL_ENV || "").toLowerCase() === "production"
  || String(env.NODE_ENV || "").toLowerCase() === "production";

if (!isProduction) {
  console.log("JUNI-AI production configuration check skipped outside production.");
  process.exit(0);
}

const config = loadConfig(env);
const errors = [];
const add = (condition, message) => { if (condition) errors.push(message); };

add(!config.security.apiToken, "JUNI_API_TOKEN must be configured in production.");
add(!env.JUNI_ALLOWED_ORIGIN, "JUNI_ALLOWED_ORIGIN must be configured in production.");
if (env.JUNI_ALLOWED_ORIGIN) {
  try {
    const origin = new URL(env.JUNI_ALLOWED_ORIGIN);
    add(origin.protocol !== "https:", "JUNI_ALLOWED_ORIGIN must use HTTPS in production.");
  } catch {
    errors.push("JUNI_ALLOWED_ORIGIN must be a valid absolute HTTPS origin.");
  }
}

add(configuredProviderNames(config).length === 0, "At least one enabled AI provider API key must be configured in production.");

if (config.storage.enabled) {
  const databaseUrl = String(env.JUNI_DATABASE_URL || "").trim();
  add(!databaseUrl, "JUNI_DATABASE_URL must point to a hosted/remote LibSQL-compatible database in production.");
  add(/^file:/i.test(databaseUrl), "JUNI_DATABASE_URL cannot use a file: database in production.");
  add(Boolean(databaseUrl) && !/^(https?|libsql|wss?):/i.test(databaseUrl),
    "JUNI_DATABASE_URL must use an HTTPS, LibSQL, or WSS-compatible remote scheme in production.");
}

add(config.identity.allowIdentityHeaders,
  "JUNI_IDENTITY_ALLOW_HEADERS must remain false in production.");

if (config.context.enabled || config.answerFirst.enabled) {
  add(!config.identity.fixedTenantId || !config.identity.fixedUserId,
    "Current access-code authentication requires JUNI_IDENTITY_DEFAULT_TENANT_ID and JUNI_IDENTITY_DEFAULT_USER_ID for durable context/Answer-First persistence.");
}

if (config.research.enabled) {
  add(!config.research.fixedTenantId || !config.research.fixedUserId,
    "Enabled web research requires JUNI_RESEARCH_DEFAULT_TENANT_ID and JUNI_RESEARCH_DEFAULT_USER_ID with the current access-code authentication model.");
  add(config.research.allowIdentityHeaders,
    "JUNI_RESEARCH_ALLOW_IDENTITY_HEADERS must remain false in production.");
}

if (config.app.featureFlags.voice) {
  add(!config.providers.gemini.apiKey, "Voice is enabled but GEMINI_API_KEY is not configured.");
}

if (config.export.approvedAnswersEnabled) {
  add(!env.JUNI_GITHUB_TOKEN, "Approved-answer export is enabled but JUNI_GITHUB_TOKEN is missing.");
  add(!env.JUNI_EXPORT_TENANT_ID || !env.JUNI_EXPORT_USER_ID,
    "Approved-answer export is enabled but export tenant/user scope is missing.");
  add(!env.JUNI_GITHUB_REPOSITORY, "Approved-answer export is enabled but JUNI_GITHUB_REPOSITORY is missing.");
}

if (errors.length) {
  console.error("JUNI-AI production configuration validation failed:");
  for (const error of errors) console.error("- " + error);
  process.exit(1);
}

console.log("JUNI-AI production configuration is valid.");
