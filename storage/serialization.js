import { createHash } from "node:crypto";

function normalize(value) {
  if (value === null || typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = normalize(value[key]);
      return out;
    }, {});
  }
  return String(value);
}

export function canonicalJson(value) {
  return JSON.stringify(normalize(value));
}

export function hashString(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

export function hashObject(value) {
  return hashString(canonicalJson(value));
}

export function byteSize(value) {
  if (Buffer.isBuffer(value)) return value.byteLength;
  if (value instanceof Uint8Array) return value.byteLength;
  if (typeof value === "string") return Buffer.byteLength(value, "utf8");
  return Buffer.byteLength(canonicalJson(value), "utf8");
}

export function toJson(value) {
  return canonicalJson(value ?? {});
}

export function fromJson(value, fallback = {}) {
  if (value == null || value === "") return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}
