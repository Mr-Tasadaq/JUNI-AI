export class JuniError extends Error {
  constructor(message, { code = "JUNI_ERROR", cause, details } = {}) {
    super(message, { cause });
    this.name = "JuniError";
    this.code = code;
    this.details = details;
  }
}

export class ProviderError extends JuniError {
  constructor(message, { provider, code = "PROVIDER_ERROR", status, retryable = false, cause, details } = {}) {
    super(message, { code, cause, details });
    this.name = "ProviderError";
    this.provider = provider;
    this.status = status;
    this.retryable = Boolean(retryable);
  }
}

export class RouterError extends JuniError {
  constructor(message, { attempts = [], cause } = {}) {
    super(message, { code: "ROUTER_ERROR", cause });
    this.name = "RouterError";
    this.attempts = attempts;
  }
}

export function normalizeProviderError(provider, error) {
  if (error instanceof ProviderError) return error;

  const status = Number(error?.status) || Number(error?.statusCode) || undefined;
  const code = error?.code || error?.name || "PROVIDER_ERROR";
  const retryable =
    status === 408 ||
    status === 409 ||
    status === 429 ||
    (status >= 500 && status <= 599) ||
    ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "AbortError"].includes(code);

  return new ProviderError(
    typeof error?.message === "string" ? error.message : "Provider request failed.",
    { provider, code, status, retryable, cause: error }
  );
}
