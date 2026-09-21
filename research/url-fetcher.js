import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { hashObject, hashString } from "../storage/serialization.js";
import { validateExternalUrl, promptInjectionIndicators } from "./security.js";
import { canonicalizeUrl, extractHtmlMetadata, normalizeContent, normalizeHtmlText } from "./normalizer.js";

export class SafeWebRetriever {
  #config;
  #fetch;
  #lookup;
  #request;

  constructor({ config, fetchImpl, lookup, requestImpl } = {}) {
    this.#config = config?.research ? config : { research: config ?? {} };
    this.#fetch = fetchImpl ?? null;
    this.#lookup = lookup ?? dns.lookup;
    this.#request = requestImpl ?? pinnedHttpRequest;
  }

  async retrieve(rawUrl, {
    allowedDomains = this.#config.research.allowedDomains,
    blockedDomains = this.#config.research.blockedDomains,
    maxBytes = this.#config.research.maxSourceBytes,
    maxRedirects = this.#config.research.maxRedirects,
    signal,
  } = {}) {
    if (typeof this.#fetch !== "function" && typeof this.#request !== "function") {
      throw new TypeError("A fetch implementation is required.");
    }
    let target = await validateExternalUrl(rawUrl, { allowedDomains, blockedDomains, lookup: this.#lookup });
    const redirectChain = [];
    let redirects = 0;

    while (true) {
      await validateExternalUrl(target.toString(), { allowedDomains, blockedDomains, lookup: this.#lookup });

      const controller = new AbortController();
      const timeoutMs = this.#config.research.retrievalTimeoutMs;
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener("abort", () => controller.abort(), { once: true });
      }

      let response;
      try {
        const requestOptions = {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "accept": "text/html, text/plain, application/json, text/markdown, application/xml;q=0.9, */*;q=0.1",
            "user-agent": this.#config.research.userAgent,
          },
          timeoutMs,
          maxBytes,
          pinnedAddress: await resolvePublicAddress(target.hostname, this.#lookup),
        };
        response = this.#fetch
          ? await this.#fetch(target, requestOptions)
          : await this.#request(target, requestOptions);
      } catch (error) {
        const wrapped = new Error(error?.name === "AbortError" ? "Web retrieval timed out." : "Web retrieval failed.");
        wrapped.code = error?.name === "AbortError" ? "RETRIEVAL_TIMEOUT" : "RETRIEVAL_FAILED";
        wrapped.cause = error;
        throw wrapped;
      } finally {
        clearTimeout(timer);
      }

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw retrievalError("REDIRECT_WITHOUT_LOCATION", "Redirect response did not include a Location.");
        if (redirects >= maxRedirects) throw retrievalError("TOO_MANY_REDIRECTS", "Maximum redirect limit reached.");
        const next = new URL(location, target);
        await validateExternalUrl(next.toString(), { allowedDomains, blockedDomains, lookup: this.#lookup });
        redirectChain.push({ from: target.toString(), to: next.toString(), status: response.status });
        target = next;
        redirects += 1;
        continue;
      }

      const contentType = (response.headers.get("content-type") || "application/octet-stream").split(";")[0].trim().toLowerCase();
      const declaredLength = Number.parseInt(response.headers.get("content-length") || "", 10);
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        throw retrievalError("SOURCE_TOO_LARGE", "Retrieved source exceeds the configured byte limit.");
      }

      const bytes = await readLimited(response, maxBytes);
      const contentHash = hashString(Buffer.from(bytes));
      let content = "";
      let metadata = {};
      let extractionStatus = "unsupported";

      if (contentType.startsWith("text/html")) {
        const html = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        metadata = extractHtmlMetadata(html);
        content = normalizeHtmlText(html);
        extractionStatus = "extracted";
      } else if (contentType.startsWith("text/") || contentType.includes("json") || contentType.includes("xml")) {
        content = normalizeContent(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
        extractionStatus = "extracted";
      }

      const canonicalCandidate = metadata.canonicalUrl
        ? safeCanonical(metadata.canonicalUrl, target.toString())
        : canonicalizeUrl(target.toString());

      const result = {
        url: target.toString(),
        canonicalUrl: canonicalCandidate,
        finalUrl: target.toString(),
        redirectChain,
        status: response.ok ? "retrieved" : "partial",
        httpStatus: response.status,
        contentType,
        content,
        rawBytes: bytes.byteLength,
        contentHash,
        metadataHash: hashObject({
          canonicalUrl: canonicalCandidate,
          title: metadata.title ?? null,
          author: metadata.author ?? null,
          publisher: metadata.publisher ?? null,
          publicationDate: metadata.publicationDate ?? null,
          language: metadata.language ?? null,
          contentType,
        }),
        metadata: {
          ...metadata,
          promptInjectionIndicators: promptInjectionIndicators(content),
          extractionStatus,
        },
        retrievedAt: new Date().toISOString(),
      };

      return result;
    }
  }
}

export async function resolvePublicAddress(hostname, lookup = dns.lookup) {
  const normalized = String(hostname ?? "").toLowerCase().replace(/\.$/, "");
  if (net.isIP(normalized)) {
    if (isPrivateIp(normalized)) {
      const error = new Error("Private or non-public IP targets are not permitted.");
      error.code = "SSRF_BLOCKED";
      throw error;
    }
    return normalized;
  }

  let addresses;
  try {
    addresses = await lookup(normalized, { all: true, verbatim: true });
  } catch (error) {
    const wrapped = new Error("The requested host could not be resolved.");
    wrapped.code = "DNS_FAILURE";
    wrapped.cause = error;
    throw wrapped;
  }

  const safeAddresses = addresses.filter((entry) => entry && !isPrivateIp(entry.address));
  if (!safeAddresses.length) {
    const error = new Error("The requested host resolves to a private or non-public network.");
    error.code = "SSRF_BLOCKED";
    throw error;
  }
  return safeAddresses[0].address;
}

async function pinnedHttpRequest(target, {
  method = "GET",
  headers = {},
  signal,
  timeoutMs = 12_000,
  maxBytes = 512 * 1024,
  pinnedAddress,
} = {}) {
  const url = new URL(target);
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const address = pinnedAddress ?? await resolvePublicAddress(hostname);
  if (isPrivateIp(address)) {
    const error = new Error("Private or non-public IP targets are not permitted.");
    error.code = "SSRF_BLOCKED";
    throw error;
  }

  const transport = url.protocol === "https:" ? https : http;
  const requestHeaders = { ...headers, host: url.host, connection: "close" };
  const options = {
    protocol: url.protocol,
    hostname: address,
    port: url.port || (url.protocol === "https:" ? 443 : 80),
    path: (url.pathname || "/") + url.search,
    method,
    headers: requestHeaders,
    timeout: timeoutMs,
  };
  if (url.protocol === "https:") options.servername = hostname;

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    const request = transport.request(options, (response) => {
      const chunks = [];
      let total = 0;
      response.on("data", (chunk) => {
        total += chunk.byteLength;
        if (total > maxBytes) {
          const error = new Error("Retrieved source exceeds the configured byte limit.");
          error.code = "SOURCE_TOO_LARGE";
          request.destroy(error);
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        const body = Buffer.concat(chunks);
        const headerMap = new Map();
        for (const [key, value] of Object.entries(response.headers)) {
          headerMap.set(key.toLowerCase(), Array.isArray(value) ? value.join(", ") : String(value ?? ""));
        }
        finish(resolve, {
          status: response.statusCode ?? 0,
          ok: (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300,
          headers: { get(name) { return headerMap.get(String(name).toLowerCase()) ?? null; } },
          async arrayBuffer() { return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength); },
        });
      });
      response.on("error", (error) => {
        const wrapped = new Error("Web retrieval failed.");
        wrapped.code = "RETRIEVAL_FAILED";
        wrapped.cause = error;
        finish(reject, wrapped);
      });
    });

    timer = setTimeout(() => {
      const error = new Error("Web retrieval timed out.");
      error.code = "RETRIEVAL_TIMEOUT";
      request.destroy(error);
      finish(reject, error);
    }, Math.max(1_000, Number(timeoutMs) || 12_000));

    request.on("timeout", () => {
      const error = new Error("Web retrieval timed out.");
      error.code = "RETRIEVAL_TIMEOUT";
      request.destroy(error);
      finish(reject, error);
    });
    request.on("error", (error) => {
      if (settled) return;
      const wrapped = new Error(error?.code === "SOURCE_TOO_LARGE" ? error.message : "Web retrieval failed.");
      wrapped.code = error?.code === "SOURCE_TOO_LARGE" ? "SOURCE_TOO_LARGE" : "RETRIEVAL_FAILED";
      wrapped.cause = error;
      finish(reject, wrapped);
    });

    if (signal) {
      const onAbort = () => {
        const error = new Error("Web retrieval aborted.");
        error.code = "RETRIEVAL_ABORTED";
        request.destroy(error);
        finish(reject, error);
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    request.end();
  });
}

const PRIVATE_IPV4_RANGES = Object.freeze([
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
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
  return (ipv4ToNumber(ip) & maskFor(bits)) === (ipv4ToNumber(network) & maskFor(bits));
}

function isPrivateIp(address) {
  if (net.isIPv4(address)) return PRIVATE_IPV4_RANGES.some(([network, bits]) => ipv4InRange(address, network, bits));
  if (!net.isIPv6(address)) return true;
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  if (/^fe[89ab]/i.test(normalized)) return true;
  if (/^f[cd]/i.test(normalized)) return true;
  if (normalized.startsWith("::ffff:") && net.isIPv4(normalized.slice(7))) return isPrivateIp(normalized.slice(7));
  return false;
}

async function readLimited(response, maxBytes) {
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw retrievalError("SOURCE_TOO_LARGE", "Retrieved source exceeds the configured byte limit.");
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch {}
      throw retrievalError("SOURCE_TOO_LARGE", "Retrieved source exceeds the configured byte limit.");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function safeCanonical(raw, fallback) {
  try {
    const url = new URL(raw, fallback);
    return canonicalizeUrl(url.toString());
  } catch {
    return fallback;
  }
}

function retrievalError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
