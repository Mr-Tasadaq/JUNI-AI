import { timingSafeEqual } from "node:crypto";

export function safeTokenEquals(supplied, expected) {
  if (!supplied || !expected) return false;
  const a = Buffer.from(String(supplied));
  const b = Buffer.from(String(expected));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function authorizeRequest(req, expectedToken) {
  if (!expectedToken) return { allowed: false, reason: "server_not_configured" };
  const header = req?.headers?.authorization ?? "";
  if (!header.startsWith("Bearer ")) return { allowed: false, reason: "missing_bearer" };
  return safeTokenEquals(header.slice(7).trim(), expectedToken)
    ? { allowed: true, reason: "authorized" }
    : { allowed: false, reason: "invalid_token" };
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
