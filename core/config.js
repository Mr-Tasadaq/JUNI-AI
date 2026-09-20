const BOOL_TRUE = new Set(["1", "true", "yes", "on"]);
const BOOL_FALSE = new Set(["0", "false", "no", "off"]);

function stringOrUndefined(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function intOrDefault(value, fallback, min = Number.MIN_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

function boolOrDefault(value, fallback = false) {
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (BOOL_TRUE.has(normalized)) return true;
  if (BOOL_FALSE.has(normalized)) return false;
  return fallback;
}

function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function splitCsv(value) {
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

export function loadConfig(env = process.env) {
  const providers = {
    anthropic: {
      apiKey: stringOrUndefined(env.ANTHROPIC_API_KEY),
      defaultModel: stringOrUndefined(env.ANTHROPIC_MODEL) ?? "claude-opus-5",
      timeoutMs: intOrDefault(env.ANTHROPIC_TIMEOUT_MS, 30_000, 1_000),
      enabled: boolOrDefault(env.JUNI_PROVIDER_ANTHROPIC_ENABLED, true),
    },
    openai: {
      apiKey: stringOrUndefined(env.OPENAI_API_KEY),
      defaultModel: stringOrUndefined(env.OPENAI_MODEL) ?? "gpt-5.5",
      timeoutMs: intOrDefault(env.OPENAI_TIMEOUT_MS, 30_000, 1_000),
      enabled: boolOrDefault(env.JUNI_PROVIDER_OPENAI_ENABLED, true),
    },
    gemini: {
      apiKey: stringOrUndefined(env.GEMINI_API_KEY),
      defaultModel: stringOrUndefined(env.GEMINI_MODEL) ?? "gemini-3.8-flash",
      liveModel: stringOrUndefined(env.GEMINI_LIVE_MODEL) ?? "gemini-3.8-live",
      timeoutMs: intOrDefault(env.GEMINI_TIMEOUT_MS, 30_000, 1_000),
      enabled: boolOrDefault(env.JUNI_PROVIDER_GEMINI_ENABLED, true),
    },
  };

  return Object.freeze({
    app: {
      name: "JUNI-AI",
      environment: stringOrUndefined(env.NODE_ENV) ?? "development",
      featureFlags: Object.freeze({
        multimodal: boolOrDefault(env.JUNI_FEATURE_MULTIMODAL, true),
        streaming: boolOrDefault(env.JUNI_FEATURE_STREAMING, true),
        tools: boolOrDefault(env.JUNI_FEATURE_TOOLS, true),
        webResearch: boolOrDefault(env.JUNI_FEATURE_WEB_RESEARCH, false),
        voice: boolOrDefault(env.JUNI_FEATURE_VOICE, false),
      }),
      defaultProvider: stringOrUndefined(env.JUNI_DEFAULT_PROVIDER) ?? "openai",
      defaultModel: stringOrUndefined(env.JUNI_DEFAULT_MODEL),
      providerPriority: Object.freeze(splitCsv(env.JUNI_PROVIDER_PRIORITY ?? "openai,anthropic,gemini")),
      fallbackProviders: Object.freeze(splitCsv(env.JUNI_FALLBACK_PROVIDERS ?? "anthropic,gemini")),
      maxToolRounds: intOrDefault(env.JUNI_MAX_TOOL_ROUNDS, 4, 0),
      maxProviderRetries: intOrDefault(env.JUNI_MAX_PROVIDER_RETRIES, 1, 0),
      retryBaseDelayMs: intOrDefault(env.JUNI_PROVIDER_RETRY_DELAY_MS, 250, 0),
      modelOverrides: Object.freeze(parseJsonObject(env.JUNI_MODEL_CAPABILITIES_JSON)),
    },
    storage: {
      enabled: boolOrDefault(env.JUNI_STORAGE_ENABLED, true),
      required: boolOrDefault(env.JUNI_STORAGE_REQUIRED, false),
      databaseUrl: stringOrUndefined(env.JUNI_DATABASE_URL),
      databaseAuthToken: stringOrUndefined(env.JUNI_DATABASE_AUTH_TOKEN),
      quotaBytes: intOrDefault(env.JUNI_STORAGE_BUDGET_BYTES, 10 * 1024 * 1024 * 1024, 1),
      warningThresholds: splitCsv(env.JUNI_STORAGE_WARNING_THRESHOLDS ?? "0.8,0.9")
        .map(Number)
        .filter((value) => Number.isFinite(value) && value > 0 && value < 1),
    },
    retention: {
      transientContextDays: intOrDefault(env.JUNI_RETENTION_TRANSIENT_DAYS, 1, 0),
      logsDays: intOrDefault(env.JUNI_RETENTION_LOGS_DAYS, 30, 0),
      cacheDays: intOrDefault(env.JUNI_RETENTION_CACHE_DAYS, 7, 0),
      mediaDays: intOrDefault(env.JUNI_RETENTION_MEDIA_DAYS, 365, 0),
      conversationDays: intOrDefault(env.JUNI_RETENTION_CONVERSATION_DAYS, 90, 0),
      memoryDays: intOrDefault(env.JUNI_RETENTION_MEMORY_DAYS, 0, 0),
      researchDays: intOrDefault(env.JUNI_RETENTION_RESEARCH_DAYS, 30, 0),
    },
    providers,
    security: {
      apiToken: stringOrUndefined(env.JUNI_API_TOKEN),
      allowedOrigin: stringOrUndefined(env.JUNI_ALLOWED_ORIGIN),
      maxMessageLength: intOrDefault(env.JUNI_MAX_MESSAGE_LENGTH, 4_000, 1),
      maxHistory: intOrDefault(env.JUNI_MAX_HISTORY, 20, 1),
    },
    routing: {
      latencyWeight: Number(env.JUNI_ROUTER_LATENCY_WEIGHT ?? 1),
      priorityWeight: Number(env.JUNI_ROUTER_PRIORITY_WEIGHT ?? 3),
      capabilityWeight: Number(env.JUNI_ROUTER_CAPABILITY_WEIGHT ?? 8),
      availabilityWeight: Number(env.JUNI_ROUTER_AVAILABILITY_WEIGHT ?? 10),
    },
    observability: {
      maxEventPayloadBytes: intOrDefault(env.JUNI_MAX_EVENT_PAYLOAD_BYTES, 8_192, 256),
    },
    provenance: {
      storageBudgetBytes: intOrDefault(env.JUNI_STORAGE_BUDGET_BYTES, 10 * 1024 * 1024 * 1024, 1),
    },
  });
}

export function configuredProviderNames(config) {
  return Object.entries(config.providers)
    .filter(([, provider]) => provider.enabled && Boolean(provider.apiKey))
    .map(([name]) => name);
}

export function hasProviderKey(config, providerName) {
  return Boolean(config.providers?.[providerName]?.apiKey);
}

export { splitCsv };
