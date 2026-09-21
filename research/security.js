import dns from "node:dns/promises";
import net from "node:net";

const PRIVATE_IPV4_RANGES = Object.freeze([
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
]);

function ipv4ToNumber(ip) {
  return ip.split(".").reduce((value, part) => (value * 256) + Number(part), 0) >>> 0;
}

function maskFor(bits) {
  return bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
}

function ipv4InRange(ip, network, bits) {
  const address = ipv4ToNumber(ip);
  return (address & maskFor(bits)) === (ipv4ToNumber(network) & maskFor(bits));
}

function isPrivateIp(address) {
  if (net.isIPv4(address)) return PRIVATE_IPV4_RANGES.some(([network, bits]) => ipv4InRange(address, network, bits));
  if (!net.isIPv6(address)) return true;
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("::ffff:") && net.isIPv4(normalized.slice(7))) {
    return isPrivateIp(normalized.slice(7));
  }
  return false;
}

function domainMatches(hostname, domain) {
  return hostname === domain || hostname.endsWith("." + domain);
}

export async function validateExternalUrl(rawUrl, {
  allowedDomains = [],
  blockedDomains = [],
  lookup = dns.lookup,
} = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw securityError("UNSAFE_URL", "Invalid URL.");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw securityError("UNSAFE_URL_PROTOCOL", "Only HTTP(S) URLs are permitted.");
  }
  if (url.username || url.password) throw securityError("UNSAFE_URL_CREDENTIALS", "URLs containing credentials are not permitted.");
  if (url.port && !["80", "443"].includes(url.port)) throw securityError("UNSAFE_URL_PORT", "Only standard HTTP(S) ports are permitted.");

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw securityError("SSRF_BLOCKED", "Local host targets are not permitted.");
  }

  if (blockedDomains.some((domain) => domainMatches(hostname, domain))) {
    throw securityError("DOMAIN_BLOCKED", "The requested domain is blocked.");
  }
  if (allowedDomains.length && !allowedDomains.some((domain) => domainMatches(hostname, domain))) {
    throw securityError("DOMAIN_NOT_ALLOWED", "The requested domain is not on the allowlist.");
  }

  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw securityError("SSRF_BLOCKED", "Private or non-public IP targets are not permitted.");
  } else {
    let addresses;
    try {
      addresses = await lookup(hostname, { all: true, verbatim: true });
    } catch {
      throw securityError("DNS_FAILURE", "The requested host could not be resolved.");
    }
    if (!addresses.length || addresses.some((entry) => isPrivateIp(entry.address))) {
      throw securityError("SSRF_BLOCKED", "The requested host resolves to a private or non-public network.");
    }
  }

  return url;
}

function securityError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function promptInjectionIndicators(text) {
  const normalized = String(text ?? "").toLowerCase();
  const indicators = [
    /ignore\s+(all\s+)?previous\s+instructions/,
    /system\s+message/,
    /developer\s+message/,
    /reveal\s+(the\s+)?(secret|password|api key|credentials)/,
    /follow\s+these\s+instructions/,
    /you\s+are\s+now\s+/,
    /disregard\s+(the\s+)?rules/,
  ];
  return indicators.filter((pattern) => pattern.test(normalized)).length;
}
