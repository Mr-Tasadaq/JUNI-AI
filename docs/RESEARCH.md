# JUNI Web Research & Knowledge Acquisition

Step 3 gives Juni a controlled web-research capability. It does not give Juni unrestricted Internet access and it does not turn web pages into permanent memory automatically.

## Pipeline

USER QUESTION → intent → provider/tool selection → web search/URL retrieval → normalization → evidence → citation mapping → synthesis → provenance → optional knowledge candidate → optional approval → Step 2 knowledge

Web content is always treated as UNTRUSTED DATA. Text from a page can be quoted as evidence but cannot become a system instruction, developer instruction, privileged command, secret, permission grant, or tool authorization.

## Research modes

- QUICK_LOOKUP: one bounded search step for simple questions.
- RESEARCH: multiple search steps may be issued and results are compared.
- DEEP_RESEARCH: multiple independent/primary-source search queries are executed before synthesis. The application only uses this label when those multiple steps actually run.
- URL_ANALYSIS: analyzes explicit user URLs; Gemini URL Context is used when available, with controlled direct retrieval as the bounded fallback.
- SOURCE_COMPARISON: searches for independent/primary sources and preserves contradictory/qualifying evidence.
- KNOWLEDGE_ACQUISITION: normal research plus an optional candidate knowledge record.

## Provider-neutral selection

The Step 1 Model Router now exposes research capability discovery. A provider can advertise:

- webSearch
- urlContext
- nativeCitations

The router checks provider health, configured model, requested operation, capability support, priority, retry policy, and fallback options.

The built-in adapters use the provider SDK already installed by Step 1:

- OpenAI: Responses API web search (web_search) with source/citation extraction.
- Gemini: Interactions API with google_search and url_context.
- Anthropic: Messages API server-side web_search_20260318 with direct callers and citation extraction.
- Custom future providers can use createGenericResearchProvider() without changing the orchestrator.

The exact model IDs and research capability overrides remain configurable. The application does not assume that every provider/model supports every research capability.

## Source model

A normalized research source includes:

- source ID
- URL and canonical URL
- domain
- title, author, publisher, publication date when actually exposed
- retrieval timestamp
- content type/language when available
- retrieval status
- content hash and metadata hash
- provider/tool
- research session
- descriptive quality basis
- relevance and corroboration metadata

Unknown metadata is stored as null; it is never invented.

Canonicalization removes URL fragments, default ports, and common tracking parameters. URL duplicates are collapsed. Near-duplicate content is detected with bounded text shingles, while equivalent retrievals remain traceable.

Primary-source prioritization is a heuristic based on source signals such as government/first-party/documentation domains. It is not a universal truth score and does not automatically reject secondary sources.

## Retrieval and security

SafeWebRetriever:

- permits only HTTP(S)
- rejects URL credentials
- rejects non-standard ports
- blocks localhost and private/non-public IP targets
- checks DNS answers before retrieval
- manually validates every redirect
- applies a redirect limit
- applies response byte limits
- applies a retrieval timeout
- strips executable HTML/script/style content during normalization
- never executes downloaded page code

A page containing text such as “ignore previous instructions” is stored only as untrusted source content. The synthesis prompt explicitly tells the model that web text is evidence, not instructions.

Domain allowlists and blocklists are configurable.

The current DNS check is deliberately conservative: a hostname resolving to any private/non-public address is blocked.

## Evidence and citations

Evidence is extracted deterministically from retrieved text as bounded excerpts with offsets/locators and content hashes.

A canonical citation links:

claim → source → evidence

Relations are:

- supports
- contradicts
- qualifies

Provider-native citations are preserved when they can be mapped to a retrieved source. Application-generated citations are accepted only when the cited source and evidence IDs exist. Invalid or fabricated source/evidence references are rejected.

Research answers retain claims, evidence, citations, warnings, and verification metadata. Contradictory evidence is not silently merged away.

## Research sessions

Each session persists:

- request/query/mode
- freshness/date settings
- start/end/status
- selected provider/model
- search queries and retrieval operations
- source IDs
- tool/provider/model metadata
- usage metadata such as search count, retrieval count, cache hits, and tokens when the provider exposes token usage
- synthesis answer
- warnings/errors
- provenance events

This provides a future audit/UI path such as “show how Juni researched this answer.”

## Knowledge acquisition

The default boundary is:

WEB RESEARCH → SOURCE → EVIDENCE → SYNTHESIS → KNOWLEDGE CANDIDATE

not:

WEB RESEARCH → PERMANENT MEMORY

Candidates have:

- proposed knowledge
- source IDs
- evidence IDs
- confidence
- rationale
- provenance reference
- status
- candidate hash
- timestamps

Candidate status can be candidate, approved, rejected, superseded, or archived.

Approval creates a versioned Step 2 knowledge_records entry with explicit approval metadata, source/provenance references, and optional embedding creation through the existing provider-neutral vector store. Previous knowledge versions remain intact.

## Cache and 10 GiB budget

Research URL/search caches use the Step 2 cache service, so cache entries are already counted by the existing logical storage quota.

Research sessions, operations, sources, evidence, claims, citations, and knowledge candidates are included in the existing 10 GiB accounting. Retrieved content is stored only within configured per-source and per-session bounds; the orchestrator never loads the whole research store into a model prompt.

The 10 GiB value is a logical data budget, not model intelligence or model size.

## Server-side API

POST /api/research supports bounded actions for:

- research
- start
- retrieve
- session/source/evidence/claim/citation/operation inspection
- candidate create/approve/reject
- provenance verification
- research-event inspection

The endpoint requires the Step 1 bearer access gate and origin checks. It resolves identity from authenticated request context when available or from explicit server-side fixed tenant/user configuration. Arbitrary identity headers are disabled by default.

Provider credentials never enter the browser.

## Current boundary

Step 3 intentionally does not implement:

- unrestricted crawling
- autonomous learning
- browser/computer control
- autonomous external actions or publishing
- full video/media understanding
- full realtime voice UX
- a distributed blockchain network
- external immutable ledger anchoring

Step 3 is the controlled research and knowledge-acquisition foundation that attaches to Step 2 storage/provenance.
