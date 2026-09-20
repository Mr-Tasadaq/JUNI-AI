import { ProviderError } from "../core/errors.js";

export function requireApiKey(provider, apiKey) {
  if (!apiKey) {
    throw new ProviderError(provider + " provider is not configured.", {
      provider,
      code: "MISSING_API_KEY",
      retryable: false,
    });
  }
}

export function withAbortTimeout(signal, timeoutMs) {
  if (!timeoutMs || timeoutMs <= 0) return { signal, cleanup: () => {} };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
  };
}

export function providerUsage(usage) {
  if (!usage) return null;
  return {
    inputTokens: usage.input_tokens ?? usage.prompt_tokens ?? usage.inputTokens ?? null,
    outputTokens: usage.output_tokens ?? usage.completion_tokens ?? usage.outputTokens ?? null,
    totalTokens: usage.total_tokens ?? usage.totalTokens ?? null,
    cachedInputTokens: usage.input_cached_tokens ?? usage.cached_input_tokens ?? null,
  };
}

export function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((item) => item?.type === "text" && typeof item.text === "string").map((item) => item.text).join("");
}
