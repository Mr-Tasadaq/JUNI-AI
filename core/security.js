import { timingSafeEqual } from "node:crypto";

const MAX_SELECTION_IDENTIFIER_LENGTH = 128;

export function safeTokenEquals(supplied, expected) {
  if (!supplied || !expected) return false;
  const a = Buffer.from(String(supplied));
  const b = Buffer.from(String(expected));
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseCookies(header) {
  if (typeof header !== "string") return {};
  const result = {};
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const index = trimmed.indexOf("=");
    if (index < 1) continue;
    const name = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    try { result[name] = decodeURIComponent(value); } catch { result[name] = value; }
  }
  return result;
}

export function requestClientKey(req) {
  return req?.ip
    || req?.headers?.["x-real-ip"]
    || req?.headers?.["x-forwarded-for"]?.split(",")[0]?.trim()
    || "unknown";
}

export function authorizeRequest(req, expectedToken, { cookieName = "juni_auth" } = {}) {
  if (!expectedToken) return { allowed: false, reason: "server_not_configured" };
  const header = req?.headers?.authorization ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const cookieToken = parseCookies(req?.headers?.cookie ?? "")[cookieName]?.trim() ?? "";
  const supplied = bearer || cookieToken;
  if (!supplied) return { allowed: false, reason: "missing_bearer" };
  return safeTokenEquals(supplied, expectedToken)
    ? { allowed: true, reason: "authorized", source: bearer ? "bearer" : "cookie" }
    : { allowed: false, reason: "invalid_token" };
}

export function serializeAuthCookie(token, {
  name = "juni_auth",
  maxAgeSeconds = 2_592_000,
  secure = true,
} = {}) {
  const encoded = encodeURIComponent(String(token ?? "").trim());
  const parts = [
    name + "=" + encoded,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=" + Math.max(60, Math.floor(Number(maxAgeSeconds) || 2_592_000)),
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearAuthCookie({ name = "juni_auth", secure = true } = {}) {
  const parts = [name + "=", "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function validateProviderModelSelection({ provider, model } = {}, policy = {}) {
  const normalizedProvider = provider == null ? undefined : provider;
  const normalizedModel = model == null ? undefined : model;

  if (normalizedProvider !== undefined && typeof normalizedProvider !== "string") {
    return {
      allowed: false,
      code: "INVALID_PROVIDER",
      error: "provider must be a string.",
    };
  }

  if (normalizedModel !== undefined && typeof normalizedModel !== "string") {
    return {
      allowed: false,
      code: "INVALID_MODEL",
      error: "model must be a string.",
    };
  }

  const selectedProvider = typeof normalizedProvider === "string"
    ? normalizedProvider.trim()
    : undefined;
  const selectedModel = typeof normalizedModel === "string"
    ? normalizedModel.trim()
    : undefined;

  if (selectedProvider && selectedProvider.length > MAX_SELECTION_IDENTIFIER_LENGTH) {
    return {
      allowed: false,
      code: "INVALID_PROVIDER",
      error: "provider is too long.",
    };
  }

  if (selectedModel && selectedModel.length > MAX_SELECTION_IDENTIFIER_LENGTH) {
    return {
      allowed: false,
      code: "INVALID_MODEL",
      error: "model is too long.",
    };
  }

  const allowedProviders = Array.isArray(policy.providers) ? policy.providers : [];
  if (selectedProvider && !allowedProviders.includes(selectedProvider)) {
    return {
      allowed: false,
      code: "PROVIDER_NOT_ALLOWED",
      error: "The requested provider is not allowed.",
    };
  }

  if (selectedModel && !selectedProvider) {
    return {
      allowed: false,
      code: "MODEL_REQUIRES_PROVIDER",
      error: "provider is required when model is specified.",
    };
  }

  if (selectedModel) {
    const allowedModels = Array.isArray(policy.modelsByProvider?.[selectedProvider])
      ? policy.modelsByProvider[selectedProvider]
      : [];

    if (!allowedModels.includes(selectedModel)) {
      return {
        allowed: false,
        code: "MODEL_NOT_ALLOWED",
        error: "The requested model is not allowed for the selected provider.",
      };
    }
  }

  return {
    allowed: true,
    provider: selectedProvider,
    model: selectedModel,
  };
}

export function checkOrigin(origin, allowedOrigin) {
  if (!allowedOrigin || !origin) return true;
  try {
    return new URL(origin).origin === new URL(allowedOrigin).origin;
  } catch {
    return false;
  }
}

const SECRET_PATTERNS = [
  /(sk-[A-Za-z0-9_-]{12,})/g,
  /(AIza[A-Za-z0-9_-]{20,})/g,
  /(anthropic[-_ ]api[-_ ]key\s*[:=]\s*)([^\s,]+)/gi,
  /(openai[-_ ]api[-_ ]key\s*[:=]\s*)([^\s,]+)/gi,
  /(gemini[-_ ]api[-_ ]key\s*[:=]\s*)([^\s,]+)/gi,
  /(authorization\s*[:=]\s*bearer\s+)([^\s,]+)/gi,
];

export function redactSecrets(value) {
  if (typeof value !== "string") return value;
  return SECRET_PATTERNS.reduce(
    (text, pattern) => text.replace(pattern, (_match, prefix) => prefix + "[REDACTED]"),
    value
  );
}

export function sanitizeEventData(value, maxBytes = 8_192) {
  const seen = new WeakSet();

  function sanitize(input) {
    if (typeof input === "string") return redactSecrets(input);
    if (input == null || typeof input === "number" || typeof input === "boolean") return input;
    if (typeof input === "object") {
      if (seen.has(input)) return "[CIRCULAR]";
      seen.add(input);
      if (Array.isArray(input)) return input.map(sanitize);

      const result = {};
      for (const [key, item] of Object.entries(input)) {
        result[key] = /key|secret|token|authorization|password|credential/i.test(key)
          ? "[REDACTED]"
          : sanitize(item);
      }
      return result;
    }
    return String(input);
  }

  const sanitized = sanitize(value);

  try {
    const serialized = JSON.stringify(sanitized);
    if (Buffer.byteLength(serialized, "utf8") <= maxBytes) return sanitized;
    return {
      truncated: true,
      preview: redactSecrets(serialized.slice(0, Math.max(0, maxBytes - 80))),
    };
  } catch {
    return { sanitized: true };
  }
}
