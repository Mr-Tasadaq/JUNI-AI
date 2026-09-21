const FUNCTION_SCHEMAS = Object.freeze({
  openWebsite: Object.freeze({
    name: "openWebsite",
    description: "Prepare a user-visible safe website link. Never execute page code or browser automation.",
    behavior: "BLOCKING",
    parameters: {
      type: "OBJECT",
      properties: {
        url: {
          type: "STRING",
          description: "An HTTP or HTTPS public website URL.",
        },
      },
      required: ["url"],
    },
  }),
  getCurrentTime: Object.freeze({
    name: "getCurrentTime",
    description: "Return the current UTC time as an ISO timestamp.",
    behavior: "BLOCKING",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  }),
});

export const VOICE_TOOL_DECLARATIONS = Object.freeze(Object.values(FUNCTION_SCHEMAS));

export async function executeVoiceTool(name, args = {}) {
  if (!FUNCTION_SCHEMAS[name]) {
    throw toolError("VOICE_TOOL_REJECTED", "Unknown voice tool.");
  }

  if (name === "getCurrentTime") {
    if (args && Object.keys(args).length) {
      throw toolError("VOICE_TOOL_REJECTED", "getCurrentTime accepts no arguments.");
    }
    return {
      status: "ok",
      utc: new Date().toISOString(),
    };
  }

  if (name === "openWebsite") {
    const allowedKeys = new Set(["url"]);
    if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some((key) => !allowedKeys.has(key))) {
      throw toolError("VOICE_TOOL_REJECTED", "Invalid openWebsite arguments.");
    }
    const url = validateWebsiteUrl(args.url);
    return {
      status: "ready",
      url,
      label: new URL(url).hostname,
    };
  }

  throw toolError("VOICE_TOOL_REJECTED", "Unknown voice tool.");
}

export function validateWebsiteUrl(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.length === 0 || rawUrl.length > 2048) {
    throw toolError("VOICE_TOOL_REJECTED", "Invalid website URL.");
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw toolError("VOICE_TOOL_REJECTED", "Invalid website URL.");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw toolError("VOICE_TOOL_REJECTED", "Only HTTP(S) websites are allowed.");
  }

  if (url.username || url.password) {
    throw toolError("VOICE_TOOL_REJECTED", "Website URLs may not contain credentials.");
  }

  if (url.port && !["80", "443"].includes(url.port)) {
    throw toolError("VOICE_TOOL_REJECTED", "Only standard HTTP(S) ports are allowed.");
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (isPrivateHost(host)) {
    throw toolError("VOICE_TOOL_REJECTED", "Private or local targets are not allowed.");
  }

  url.hash = "";
  return url.toString();
}

function isPrivateHost(host) {
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;
  if (/^(127\.|0\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|192\.0\.0\.|198\.(18|19)\.|224\.|23[0-9]\.)/.test(host)) return true;
  if (/^(fc|fd)[0-9a-f]{2}:/i.test(host) || /^fe[89ab][0-9a-f]:/i.test(host)) return true;
  return false;
}

function toolError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
