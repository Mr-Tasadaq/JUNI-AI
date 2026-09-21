import { randomUUID } from "node:crypto";

export const RESEARCH_MODES = Object.freeze([
  "QUICK_LOOKUP",
  "RESEARCH",
  "DEEP_RESEARCH",
  "URL_ANALYSIS",
  "SOURCE_COMPARISON",
  "KNOWLEDGE_ACQUISITION",
]);

export const SOURCE_STATUSES = Object.freeze([
  "retrieved",
  "partial",
  "failed",
  "duplicate",
  "blocked",
  "unsupported",
]);

export const CLAIM_RELATIONS = Object.freeze([
  "supports",
  "contradicts",
  "qualifies",
]);

export const CANDIDATE_STATUSES = Object.freeze([
  "candidate",
  "approved",
  "rejected",
  "superseded",
  "archived",
]);

export function normalizeResearchRequest(input = {}) {
  const query = String(input.query ?? input.question ?? "").trim();
  if (!query && !(Array.isArray(input.urls) && input.urls.length)) {
    throw new TypeError("Research query or URL is required.");
  }

  const urls = [...new Set((Array.isArray(input.urls) ? input.urls : [])
    .map((url) => String(url).trim())
    .filter(Boolean))].slice(0, 20);

  let mode = String(input.mode ?? "RESEARCH").toUpperCase();
  if (!RESEARCH_MODES.includes(mode)) mode = inferResearchMode(query, urls);

  const maxSourcesDefault = mode === "QUICK_LOOKUP" ? 4
    : mode === "DEEP_RESEARCH" ? 12
      : mode === "URL_ANALYSIS" ? Math.max(4, urls.length)
        : 8;

  return Object.freeze({
    requestId: input.requestId ?? randomUUID(),
    query,
    mode,
    requestedFreshness: input.requestedFreshness ?? "balanced",
    domains: normalizeDomains(input.domains),
    excludedDomains: normalizeDomains(input.excludedDomains),
    language: input.language ? String(input.language) : null,
    maxSources: clampInteger(input.maxSources, maxSourcesDefault, 1, 20),
    maxSearchQueries: clampInteger(input.maxSearchQueries, mode === "DEEP_RESEARCH" ? 3 : mode === "RESEARCH" ? 2 : 1, 1, 5),
    maxRetrievedBytes: clampInteger(input.maxRetrievedBytes, 5 * 1024 * 1024, 32 * 1024, 20 * 1024 * 1024),
    maxSourceBytes: clampInteger(input.maxSourceBytes, 512 * 1024, 16 * 1024, 2 * 1024 * 1024),
    maxRedirects: clampInteger(input.maxRedirects, 3, 0, 5),
    languageHints: input.languageHints ?? null,
    dateFrom: normalizeDate(input.dateFrom),
    dateTo: normalizeDate(input.dateTo),
    urls,
    outputFormat: input.outputFormat ?? "markdown",
    citationRequired: input.citationRequired !== false,
    allowKnowledgeCandidate: input.allowKnowledgeCandidate === true,
    provider: input.provider ? String(input.provider) : null,
    model: input.model ? String(input.model) : null,
    metadata: safeObject(input.metadata),
    startedAt: null,
    userScope: input.userScope ?? null,
  });
}

export function inferResearchMode(query = "", urls = []) {
  if (urls.length) return "URL_ANALYSIS";
  const normalized = query.toLowerCase();
  if (/\b(compare|versus|vs\.?|difference between)\b/.test(normalized)) return "SOURCE_COMPARISON";
  if (/\b(latest|current|today|this week|recent|now)\b/.test(normalized)) return "RESEARCH";
  if (normalized.length > 220 || /\b(comprehensive|deep dive|in[- ]depth|systematic|multiple sources)\b/.test(normalized)) {
    return "DEEP_RESEARCH";
  }
  return "QUICK_LOOKUP";
}

export function searchQueriesForRequest(request) {
  const base = request.query;
  const queries = [];
  if (base) queries.push(base);
  if (request.mode === "DEEP_RESEARCH") {
    queries.push("primary sources " + base);
    if (request.requestedFreshness === "current" || request.requestedFreshness === "latest") {
      queries.push("latest " + base);
    } else {
      queries.push("independent sources " + base);
    }
  } else if (request.mode === "RESEARCH" || request.mode === "SOURCE_COMPARISON") {
    queries.push(request.mode === "SOURCE_COMPARISON" ? "independent sources " + base : "primary sources " + base);
  }
  return [...new Set(queries.filter(Boolean))].slice(0, request.maxSearchQueries);
}

export function normalizeDomains(value) {
  return [...new Set((Array.isArray(value) ? value : value ? [value] : [])
    .map((domain) => String(domain).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    .filter(Boolean))]
    .slice(0, 100);
}

export function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? structuredClone(value) : {};
}

export function assertResearchMode(mode) {
  if (!RESEARCH_MODES.includes(mode)) throw new TypeError("Invalid research mode.");
}

export function assertCandidateStatus(status) {
  if (!CANDIDATE_STATUSES.includes(status)) throw new TypeError("Invalid knowledge candidate status.");
}
