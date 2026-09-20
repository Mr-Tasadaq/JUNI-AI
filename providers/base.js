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
  const controller = new AbortController();
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timer) clearTimeout(timer);
    },
  };
}

export async function withTimeout(promise, { signal, timeoutMs = 30_000 } = {}) {
  let timer;
  let abortHandler;

  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new ProviderError("Provider request timed out.", {
        code: "PROVIDER_TIMEOUT",
        retryable: true,
      }));
    }, Math.max(1, timeoutMs));
  });

  const abortPromise = signal
    ? new Promise((_, reject) => {
        abortHandler = () => reject(new ProviderError("Provider request aborted.", {
          code: "PROVIDER_ABORTED",
          retryable: true,
        }));
        if (signal.aborted) abortHandler();
        else signal.addEventListener("abort", abortHandler, { once: true });
      })
    : new Promise(() => {});

  try {
    return await Promise.race([promise, timeoutPromise, abortPromise]);
  } finally {
    clearTimeout(timer);
    if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
  }
}

export function providerUsage(usage) {
  if (!usage) return null;
  return {
    inputTokens: usage.input_tokens ?? usage.prompt_tokens ?? usage.promptTokenCount ?? usage.inputTokens ?? null,
    outputTokens: usage.output_tokens ?? usage.completion_tokens ?? usage.candidatesTokenCount ?? usage.outputTokens ?? null,
    totalTokens: usage.total_tokens ?? usage.totalTokenCount ?? usage.totalTokens ?? null,
    cachedInputTokens: usage.input_cached_tokens ?? usage.cached_input_tokens ?? usage.cachedContentTokenCount ?? null,
  };
}

export function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("");
}
