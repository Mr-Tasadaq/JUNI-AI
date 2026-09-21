import { hashObject, hashString } from "../storage/serialization.js";
import { validateExternalUrl, promptInjectionIndicators } from "./security.js";
import { canonicalizeUrl, extractHtmlMetadata, normalizeContent, normalizeHtmlText } from "./normalizer.js";

export class SafeWebRetriever {
  #config;
  #fetch;
  #lookup;
  constructor({ config, fetchImpl = globalThis.fetch, lookup } = {}) {
    this.#config = config;
    this.#fetch = fetchImpl;
    this.#lookup = lookup;
  }

  async retrieve(rawUrl, {
    allowedDomains = this.#config.research.allowedDomains,
    blockedDomains = this.#config.research.blockedDomains,
    maxBytes = this.#config.research.maxSourceBytes,
    maxRedirects = this.#config.research.maxRedirects,
    signal,
  } = {}) {
    if (typeof this.#fetch !== "function") throw new TypeError("A fetch implementation is required.");
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
        response = await this.#fetch(target, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "accept": "text/html, text/plain, application/json, text/markdown, application/xml;q=0.9, */*;q=0.1",
            "user-agent": this.#config.research.userAgent,
          },
        });
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
