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

function parseJsonArrayMap(value, fallback = {}) {
  const parsed = parseJsonObject(value, null);
  if (!parsed) return fallback;

  const result = {};
  for (const [key, models] of Object.entries(parsed)) {
    if (!Array.isArray(models)) continue;
    const normalized = models
      .filter((model) => typeof model === "string")
      .map((model) => model.trim())
      .filter(Boolean);
    if (normalized.length) result[key] = [...new Set(normalized)];
  }
  return result;
}

function splitCsv(value) {
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function buildRequestAllowlist(providers, env) {
  const configuredProviders = Object.keys(providers);
  const requestedProviders = env.JUNI_REQUEST_ALLOWED_PROVIDERS == null
    ? configuredProviders
    : splitCsv(env.JUNI_REQUEST_ALLOWED_PROVIDERS);

  const allowedProviders = [...new Set(
    requestedProviders.filter((name) => configuredProviders.includes(name))
  )];

  const explicitModels = parseJsonArrayMap(env.JUNI_REQUEST_ALLOWED_MODELS_JSON);
  const modelsByProvider = Object.fromEntries(
    allowedProviders.map((provider) => {
      const configuredModel = providers[provider].defaultModel;
      const explicit = explicitModels[provider] ?? [];
      const models = configuredModel
        ? [configuredModel, ...explicit]
        : explicit;
      return [provider, Object.freeze([...new Set(models)])];
    })
  );

  return Object.freeze({
    providers: Object.freeze(allowedProviders),
    modelsByProvider: Object.freeze(modelsByProvider),
  });
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
    providers: Object.freeze(providers),
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
    identity: {
      fixedTenantId: stringOrUndefined(env.JUNI_IDENTITY_DEFAULT_TENANT_ID),
      fixedUserId: stringOrUndefined(env.JUNI_IDENTITY_DEFAULT_USER_ID),
      allowIdentityHeaders: boolOrDefault(env.JUNI_IDENTITY_ALLOW_HEADERS, false),
    },
    security: {
      apiToken: stringOrUndefined(env.JUNI_API_TOKEN),
      allowedOrigin: stringOrUndefined(env.JUNI_ALLOWED_ORIGIN),
      authCookieName: stringOrUndefined(env.JUNI_AUTH_COOKIE_NAME) ?? "juni_auth",
      authCookieMaxAgeSeconds: intOrDefault(env.JUNI_AUTH_COOKIE_MAX_AGE_SECONDS, 2_592_000, 60),
      maxMessageLength: intOrDefault(env.JUNI_MAX_MESSAGE_LENGTH, 4_000, 1),
      maxHistory: intOrDefault(env.JUNI_MAX_HISTORY, 20, 1),
      requestAllowlist: buildRequestAllowlist(providers, env),
    },
    research: {
      enabled: boolOrDefault(env.JUNI_FEATURE_WEB_RESEARCH, false),
      maxSources: intOrDefault(env.JUNI_RESEARCH_MAX_SOURCES, 8, 1),
      maxSearchQueries: intOrDefault(env.JUNI_RESEARCH_MAX_SEARCH_QUERIES, 3, 1),
      maxRetrievedBytes: intOrDefault(env.JUNI_RESEARCH_MAX_RETRIEVED_BYTES, 5 * 1024 * 1024, 32_768),
      maxSourceBytes: intOrDefault(env.JUNI_RESEARCH_MAX_SOURCE_BYTES, 512 * 1024, 16_384),
      maxRedirects: intOrDefault(env.JUNI_RESEARCH_MAX_REDIRECTS, 3, 0),
      maxConcurrentRetrievals: intOrDefault(env.JUNI_RESEARCH_MAX_CONCURRENT_RETRIEVALS, 3, 1),
      retrievalTimeoutMs: intOrDefault(env.JUNI_RESEARCH_RETRIEVAL_TIMEOUT_MS, 12_000, 1_000),
      providerTimeoutMs: intOrDefault(env.JUNI_RESEARCH_PROVIDER_TIMEOUT_MS, 60_000, 1_000),
      cacheTtlSeconds: intOrDefault(env.JUNI_RESEARCH_CACHE_TTL_SECONDS, 900, 0),
      userAgent: stringOrUndefined(env.JUNI_RESEARCH_USER_AGENT) ?? "JUNI-AI-Research/1.0",
      allowedDomains: Object.freeze(splitCsv(env.JUNI_RESEARCH_ALLOWED_DOMAINS)),
      blockedDomains: Object.freeze(splitCsv(env.JUNI_RESEARCH_BLOCKED_DOMAINS)),
      anthropicToolType: stringOrUndefined(env.JUNI_ANTHROPIC_WEB_SEARCH_TOOL_TYPE) ?? "web_search_20260318",
      geminiSearchToolType: stringOrUndefined(env.JUNI_GEMINI_SEARCH_TOOL_TYPE) ?? "google_search",
      geminiUrlToolType: stringOrUndefined(env.JUNI_GEMINI_URL_CONTEXT_TOOL_TYPE) ?? "url_context",
      openaiSearchToolType: stringOrUndefined(env.JUNI_OPENAI_SEARCH_TOOL_TYPE) ?? "web_search",
      fixedTenantId: stringOrUndefined(env.JUNI_RESEARCH_DEFAULT_TENANT_ID),
      fixedUserId: stringOrUndefined(env.JUNI_RESEARCH_DEFAULT_USER_ID),
      allowIdentityHeaders: boolOrDefault(env.JUNI_RESEARCH_ALLOW_IDENTITY_HEADERS, false),
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
