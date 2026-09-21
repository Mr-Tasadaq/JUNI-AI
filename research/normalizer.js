import { hashObject, hashString } from "../storage/serialization.js";
import { normalizeDomains, safeObject, SOURCE_STATUSES } from "./model.js";

export function canonicalizeUrl(rawUrl) {
  const url = new URL(rawUrl);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
  const removable = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"]);
  [...url.searchParams.keys()].forEach((key) => { if (removable.has(key.toLowerCase())) url.searchParams.delete(key); });
  url.search = sortSearchParams(url.searchParams);
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, -1);
  return url.toString();
}

function sortSearchParams(params) {
  const pairs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  return pairs.length ? "?" + new URLSearchParams(pairs).toString() : "";
}

export function normalizeSearchSource(raw, context = {}) {
  if (!raw?.url) return null;
  let canonicalUrl;
  try { canonicalUrl = canonicalizeUrl(raw.url); } catch { return null; }
  const url = new URL(canonicalUrl);
  const metadata = safeObject(raw.metadata);

  return {
    id: raw.id ?? null,
    url: raw.url,
    canonicalUrl,
    title: nullableString(raw.title),
    domain: url.hostname,
    publisher: nullableString(raw.publisher),
    author: nullableString(raw.author),
    publicationDate: raw.publicationDate ?? raw.publishedAt ?? null,
    retrievedAt: raw.retrievedAt ?? new Date().toISOString(),
    contentType: raw.contentType ?? null,
    language: raw.language ?? null,
    status: SOURCE_STATUSES.includes(raw.status) ? raw.status : "retrieved",
    sourceType: "external",
    primarySource: raw.primarySource === true,
    contentHash: raw.contentHash ?? null,
    metadataHash: raw.metadataHash ?? hashObject({
      canonicalUrl, title: raw.title ?? null, publisher: raw.publisher ?? null,
      author: raw.author ?? null, publicationDate: raw.publicationDate ?? null,
      contentType: raw.contentType ?? null, language: raw.language ?? null,
    }),
    provider: context.provider ?? raw.provider ?? null,
    tool: context.tool ?? raw.tool ?? null,
    researchSessionId: context.sessionId ?? null,
    metadata,
  };
}

export function normalizeHtmlText(html) {
  return String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractHtmlMetadata(html) {
  const content = String(html ?? "");
  const meta = (name, attribute = "name") => {
    const pattern = new RegExp("<meta[^>]+[" + attribute + "\\s*=" + "\"']([^\"']+)['\"][^>]*>", "i");
    const match = content.match(pattern);
    return match?.[1] ?? null;
  };
  const title = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ?? null;
  const canonical = content.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i)?.[1] ?? null;
  const author = meta("author") ?? meta("article:author", "property");
  const publisher = meta("og:site_name", "property");
  const published = meta("article:published_time", "property") ?? meta("date");
  const language = content.match(/<html[^>]+lang=["']([^"']+)["']/i)?.[1] ?? null;
  return {
    title,
    canonicalUrl: canonical,
    author,
    publisher,
    publicationDate: published,
    language,
  };
}

export function normalizeContent(rawText) {
  return String(rawText ?? "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
}

export function contentFingerprint(text) {
  return hashString(normalizeContent(text).slice(0, 200_000));
}

export function nearDuplicateSimilarity(a, b) {
  const left = shingleSet(a);
  const right = shingleSet(b);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function shingleSet(text) {
  const normalized = normalizeContent(text).toLowerCase();
  const words = normalized.split(/\s+/).filter(Boolean);
  const set = new Set();
  for (let i = 0; i < words.length - 2; i += 3) set.add(words.slice(i, i + 3).join(" "));
  return set;
}

export { hashString, hashObject, normalizeDomains };
