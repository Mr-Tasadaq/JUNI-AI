const OPEN_WEBSITE_SCHEMA = Object.freeze({
  name: "openWebsite",
  description: "Prepare a public website URL for the user to open. This never executes arbitrary browser code.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "An absolute public HTTP or HTTPS URL." },
    },
    required: ["url"],
    additionalProperties: false,
  },
});

const CURRENT_TIME_SCHEMA = Object.freeze({
  name: "getCurrentTime",
  description: "Return the current local browser time as an ISO timestamp and timezone name.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
});

export const VOICE_TOOL_DECLARATIONS = Object.freeze([
  OPEN_WEBSITE_SCHEMA,
  CURRENT_TIME_SCHEMA,
]);

export function listVoiceTools() {
  return VOICE_TOOL_DECLARATIONS.map((tool) => structuredClone(tool));
}

export async function executeVoiceTool(name, args = {}) {
  if (name === "openWebsite") return openWebsite(args);
  if (name === "getCurrentTime") return getCurrentTime(args);
  throw toolError("VOICE_TOOL_REJECTED", "Unknown voice tool.");
}

function openWebsite(args) {
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).length !== 1 || typeof args.url !== "string") {
    throw toolError("VOICE_TOOL_REJECTED", "Invalid openWebsite arguments.");
  }
  let url;
  try { url = new URL(args.url); } catch { throw toolError("VOICE_TOOL_REJECTED", "Invalid website URL."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw toolError("VOICE_TOOL_REJECTED", "Only credential-free HTTP(S) URLs are permitted.");
  }
  if (url.port && !["80", "443"].includes(url.port)) {
    throw toolError("VOICE_TOOL_REJECTED", "Only standard HTTP(S) ports are permitted.");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw toolError("VOICE_TOOL_REJECTED", "Private or local targets are not permitted.");
  }
  if (isLiteralPrivateIp(hostname)) throw toolError("VOICE_TOOL_REJECTED", "Private or non-public IP targets are not permitted.");
  return { status: "ready", url: url.toString(), requiresUserClick: true };
}

function getCurrentTime(args) {
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).length) {
    throw toolError("VOICE_TOOL_REJECTED", "getCurrentTime takes no arguments.");
  }
  const now = new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return {
    status: "ok",
    iso: now.toISOString(),
    timeZone,
    local: now.toLocaleString(),
  };
}

function isLiteralPrivateIp(hostname) {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) {
    const parts = hostname.split(".").map(Number);
    if (parts.some((part) => part < 0 || part > 255)) return true;
    const [a,b] = parts;
    return a === 10 || a === 127 || a === 0 || a === 169 && b === 254
      || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31;
  }
  const normalized = hostname.toLowerCase();
  return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd");
}

function toolError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
