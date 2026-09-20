export const PROVIDER_NAMES = Object.freeze(["anthropic", "openai", "gemini"]);

export const CAPABILITIES = Object.freeze([
  "text",
  "vision",
  "audioInput",
  "audioOutput",
  "streaming",
  "toolCalling",
  "webResearch",
  "liveVoice",
]);

export const TASKS = Object.freeze([
  "chat",
  "reasoning",
  "coding",
  "research",
  "vision",
  "voice",
]);

export function assertProviderContract(provider) {
  if (!provider || typeof provider !== "object") throw new TypeError("Provider must be an object.");
  for (const method of ["generate", "stream", "capabilities", "health"]) {
    if (typeof provider[method] !== "function") {
      throw new TypeError("Provider " + (provider.name ?? "unknown") + " must implement " + method + "().");
    }
  }
  if (!PROVIDER_NAMES.includes(provider.name)) {
    throw new TypeError("Unsupported provider name: " + (provider.name ?? "unknown") + ".");
  }
  return provider;
}

export function normalizeRequest(request, defaults = {}) {
  return {
    message: typeof request?.message === "string" ? request.message : undefined,
    messages: Array.isArray(request?.messages) ? request.messages : [],
    task: request?.task ?? "chat",
    modality: request?.modality ?? "text",
    latency: request?.latency ?? "balanced",
    provider: request?.provider ?? defaults.provider,
    model: request?.model ?? defaults.model,
    stream: Boolean(request?.stream),
    tools: Array.isArray(request?.tools) ? request.tools : [],
    metadata: request?.metadata && typeof request.metadata === "object" ? request.metadata : {},
    signal: request?.signal,
  };
}

export function capabilitySupports(capabilities, required) {
  if (!required) return true;
  return required.every((name) => capabilities?.includes(name));
}
