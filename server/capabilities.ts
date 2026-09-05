import { ENV } from "./_core/env";
import { invokeLLM, type InvokeParams, type InvokeResult } from "./_core/llm";

export const CAPABILITIES = [
  "FAST_GENERAL",
  "SMART_GENERAL",
  "VISION",
  "VOICE_REALTIME",
  "VIDEO",
  "EMBEDDING",
  "RESEARCH",
  "CODE",
] as const;

export type Capability = (typeof CAPABILITIES)[number];
export type ImplementedCapability = "SMART_GENERAL";

export type ProviderHealthState =
  | "healthy"
  | "unhealthy"
  | "unconfigured"
  | "disabled";

export type ProviderHealth = {
  providerId: string;
  enabled: boolean;
  capabilities: readonly Capability[];
  state: ProviderHealthState;
  lastErrorCategory?: ProviderErrorCategory;
};

export type ProviderErrorCategory =
  | "unavailable"
  | "configuration"
  | "rate_limited"
  | "timeout"
  | "invalid_request"
  | "provider_error"
  | "unsupported_capability";

export class JuniProviderError extends Error {
  readonly category: ProviderErrorCategory;
  readonly providerId?: string;

  constructor(
    category: ProviderErrorCategory,
    message: string,
    options: { providerId?: string; cause?: unknown } = {}
  ) {
    super(message, { cause: options.cause });
    this.name = "JuniProviderError";
    this.category = category;
    this.providerId = options.providerId;
  }
}

export type ProviderAdapter = {
  id: string;
  capabilities: readonly ImplementedCapability[];
  getHealth(): ProviderHealth;
  invoke(params: InvokeParams): Promise<InvokeResult>;
};

export type CapabilityResolution = {
  capability: Capability;
  adapter: ProviderAdapter;
  provider: string;
};

export type CapabilityRegistry = {
  adapters: readonly ProviderAdapter[];
};

function normalizeProviderError(
  error: unknown,
  providerId: string
): JuniProviderError {
  if (error instanceof JuniProviderError) return error;

  const message =
    error instanceof Error ? error.message : "Provider request failed";
  const lower = message.toLowerCase();
  let category: ProviderErrorCategory = "provider_error";
  if (lower.includes("not configured") || lower.includes("api key")) {
    category = "configuration";
  } else if (lower.includes("timeout") || lower.includes("timed out")) {
    category = "timeout";
  } else if (lower.includes("rate limit") || lower.includes("429")) {
    category = "rate_limited";
  } else if (lower.includes("invalid") || lower.includes("400")) {
    category = "invalid_request";
  } else if (lower.includes("network") || lower.includes("unavailable")) {
    category = "unavailable";
  }

  return new JuniProviderError(
    category,
    "The requested AI service is temporarily unavailable.",
    { providerId, cause: error }
  );
}

export function createForgeLLMAdapter(
  invoke: (params: InvokeParams) => Promise<InvokeResult> = invokeLLM,
  configured: boolean = Boolean(ENV.forgeApiKey)
): ProviderAdapter {
  let lastErrorCategory: ProviderErrorCategory | undefined;

  return {
    id: "manus-forge-llm",
    capabilities: ["SMART_GENERAL"],
    getHealth: () => ({
      providerId: "manus-forge-llm",
      enabled: configured,
      capabilities: ["SMART_GENERAL"],
      state: configured
        ? lastErrorCategory
          ? "unhealthy"
          : "healthy"
        : "unconfigured",
      ...(lastErrorCategory ? { lastErrorCategory } : {}),
    }),
    async invoke(params) {
      if (!configured) {
        const error = new JuniProviderError(
          "configuration",
          "The requested AI service is temporarily unavailable.",
          { providerId: "manus-forge-llm" }
        );
        lastErrorCategory = error.category;
        throw error;
      }

      try {
        const result = await invoke(params);
        lastErrorCategory = undefined;
        return result;
      } catch (error) {
        const normalized = normalizeProviderError(error, "manus-forge-llm");
        lastErrorCategory = normalized.category;
        throw normalized;
      }
    },
  };
}

export function createCapabilityRegistry(
  adapters: readonly ProviderAdapter[] = [createForgeLLMAdapter()]
): CapabilityRegistry {
  return { adapters };
}

const defaultRegistry = createCapabilityRegistry();

export function resolveCapability(
  capability: Capability,
  registry: CapabilityRegistry = defaultRegistry
): CapabilityResolution {
  const adapter = registry.adapters.find(candidate =>
    candidate.capabilities.includes(capability as ImplementedCapability)
  );

  if (!adapter) {
    throw new JuniProviderError(
      "unsupported_capability",
      `Capability ${capability} is not currently available.`
    );
  }

  const health = adapter.getHealth();
  if (
    !health.enabled ||
    health.state === "disabled" ||
    health.state === "unconfigured"
  ) {
    throw new JuniProviderError(
      health.state === "unconfigured" ? "configuration" : "unavailable",
      `Capability ${capability} is not currently available.`,
      { providerId: adapter.id }
    );
  }

  return { capability, adapter, provider: adapter.id };
}

export function getCapabilityStatus(
  registry: CapabilityRegistry = defaultRegistry
): Array<
  ProviderHealth & {
    capability: Capability;
    status: "implemented" | "unavailable" | "unsupported";
  }
> {
  return CAPABILITIES.map(capability => {
    const adapter = registry.adapters.find(candidate =>
      candidate.capabilities.includes(capability as ImplementedCapability)
    );
    if (!adapter) {
      return {
        capability,
        providerId: "none",
        enabled: false,
        capabilities: [],
        state: "disabled",
        status: "unsupported" as const,
      };
    }
    const health = adapter.getHealth();
    return {
      ...health,
      capability,
      status:
        health.enabled && health.state === "healthy"
          ? "implemented"
          : "unavailable",
    };
  });
}

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}

export function normalizeCapabilityError(error: unknown): JuniProviderError {
  return error instanceof JuniProviderError
    ? error
    : normalizeProviderError(error, "unknown");
}

export const capabilityHealth = getCapabilityStatus;

export const IMPLEMENTED_CAPABILITIES: readonly ImplementedCapability[] = [
  "SMART_GENERAL",
];

export const SEPARATE_REALTIME_CAPABILITY: Capability = "VOICE_REALTIME";

export const capabilityContracts = {
  FAST_GENERAL: "unsupported",
  SMART_GENERAL: "implemented",
  VISION: "unsupported",
  VOICE_REALTIME: "separate-realtime-path",
  VIDEO: "unsupported",
  EMBEDDING: "unsupported",
  RESEARCH: "unsupported",
  CODE: "unsupported",
} as const satisfies Record<Capability, string>;
