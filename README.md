# JUNI-AI

JUNI-AI is a multi-provider AI agent foundation. Its intelligence layer is provider-based and replaceable: Anthropic Claude, OpenAI, and Google Gemini are adapters behind a stable Juni Core contract.

## Step 1 status

Implemented:

- central Juni Core application/service layer
- provider-neutral request/response/stream contracts
- Anthropic, OpenAI, and Gemini adapters
- capability-aware model/provider router
- provider health/status
- retry + fallback handling
- timeout/error normalization
- multimodal content block normalization
- streaming event normalization
- provider-neutral tool registry
- structured observability events with secret redaction
- centralized Juni identity and trust rules
- provenance contract and explicit AI Blockchain boundary
- configurable Gemini Live voice session architecture
- environment-driven provider/model/feature configuration
- automated architecture/security/backwards-compatibility tests
- GitHub Actions CI
- existing responsive chat UI preserved

## Intelligence vs. storage

“10GB AI” is a storage/memory budget, not 10GB of intelligence.

The planned budget is approximately 10 GiB for:

- long-term memories
- preferences
- conversations
- documents
- extracted knowledge
- embeddings/vector records
- learned facts
- cached knowledge
- research artifacts
- media metadata
- audit logs
- provenance records
- model/provider metadata
- learning events

The model APIs provide the actual model intelligence.

Step 1 defines the storage/provenance boundaries but does not implement the durable memory engine.

## AI Blockchain boundary

The AI Blockchain concept is not a second AI engine.

In this architecture it is only a future tamper-evident provenance/audit layer for:

- important memories
- knowledge versions
- source hashes
- document fingerprints
- learning events
- research events
- model/version metadata
- memory history
- audit history
- provenance relationships

The Step 1 repository contains only the provenance contract. No blockchain ledger has been implemented.

## Architecture

### Flow

Browser -> `POST /api/chat` -> authentication/rate limiting -> Juni Core -> Model Router -> provider adapter -> provider API.

Tool calls follow:

Provider -> normalized tool call -> Tool Registry -> tool executor -> normalized tool result -> provider continuation.

Observability runs across this path through structured events.

### Provider layer

Each primary provider implements:

- `generate(request, options)`
- `stream(request, options)`
- `capabilities(model)`
- `health()`

The core does not call vendor SDK methods directly.

Adapters currently use the official vendor SDKs:

- OpenAI TypeScript/JavaScript SDK
- Anthropic TypeScript SDK
- Google GenAI SDK

The SDKs are lazy-loaded by adapters so architecture tests can run without live credentials.

### Router

Routing considers:

- requested task
- modality
- requested provider/model
- required capabilities
- latency preference
- configured provider order
- provider availability
- provider capability metadata

Retryable failures can be retried on the same provider, then the router can fall back to another eligible provider.

### Model capability detection

The current Step 1 capability method is an adapter-level model capability contract with optional environment overrides through `JUNI_MODEL_CAPABILITIES_JSON`.

Later provider/model catalog modules can replace static declarations with live model metadata without changing the core/router interface.

### Tools

`core/tools.js` provides the internal tool registry.

A tool has:

- stable name
- description
- input schema
- executor
- metadata

The following future tools are intentionally not implemented in Step 1:

web search, open website, document fetch, file search, memory lookup/write, knowledge lookup, research, browser actions, media analysis, calendar, and arbitrary external APIs.

### Gemini Live voice

The realtime boundary is in `providers/gemini-live.js` and `core/voice.js`.

The contract covers:

- microphone/audio input
- text input
- video frames
- response audio callbacks
- interruption/barge-in hooks
- tool responses
- session lifecycle
- reconnect
- error/close handling

The Live model is configurable through `GEMINI_LIVE_MODEL`.

Google's current documentation lists `gemini-3.8-live` as the default option for most low-latency voice agents and `gemini-3.1-flash-live-preview` as a legacy preview model. The project therefore does not hard-code the legacy identifier.

### Identity

Juni's identity is centralized in `core/identity.js`.

It describes Juni as intelligent, curious, adaptive, conversational, helpful, context-aware, tool-capable, uncertainty-aware, source-aware, and provenance-aware.

Learning-from-interaction is treated as a software design metaphor, not a claim that Juni has a human brain.

### Safety

The foundation enforces:

- provider secrets stay server-side
- bearer authentication stays outside model prompts/events
- event payloads redact secrets
- model output is not automatically verified knowledge
- user-provided information can remain distinct from externally sourced information
- provenance can track source and correction history
- provider failures are isolated
- tool execution happens through an explicit registry

## Configuration

Copy `.env.example` to your deployment environment.

Main variables:

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `ANTHROPIC_MODEL`
- `OPENAI_MODEL`
- `GEMINI_MODEL`
- `GEMINI_LIVE_MODEL`
- `JUNI_DEFAULT_PROVIDER`
- `JUNI_DEFAULT_MODEL`
- `JUNI_PROVIDER_PRIORITY`
- `JUNI_FALLBACK_PROVIDERS`
- `JUNI_MAX_PROVIDER_RETRIES`
- `JUNI_PROVIDER_RETRY_DELAY_MS`
- `JUNI_FEATURE_MULTIMODAL`
- `JUNI_FEATURE_STREAMING`
- `JUNI_FEATURE_TOOLS`
- `JUNI_FEATURE_WEB_RESEARCH`
- `JUNI_FEATURE_VOICE`
- `JUNI_MODEL_CAPABILITIES_JSON`

Security variables:

- `JUNI_API_TOKEN`
- `JUNI_ALLOWED_ORIGIN`
- `JUNI_MAX_MESSAGE_LENGTH`
- `JUNI_MAX_HISTORY`

Operational variables:

- `JUNI_RATE_LIMIT`
- `JUNI_RATE_WINDOW_SECONDS`
- `JUNI_MAX_EVENT_PAYLOAD_BYTES`
- `JUNI_STORAGE_BUDGET_BYTES`
- `JUNI_RESEARCH_MAX_SOURCES`
- `JUNI_RESEARCH_MAX_SEARCH_QUERIES`
- `JUNI_RESEARCH_MAX_RETRIEVED_BYTES`
- `JUNI_RESEARCH_MAX_SOURCE_BYTES`
- `JUNI_RESEARCH_RETRIEVAL_TIMEOUT_MS`
- `JUNI_RESEARCH_ALLOWED_DOMAINS`
- `JUNI_RESEARCH_BLOCKED_DOMAINS`
- `JUNI_RESEARCH_DEFAULT_TENANT_ID`
- `JUNI_RESEARCH_DEFAULT_USER_ID`

Never commit real credential values.

## Existing functionality

The original responsive chat UI remains in:

- `index.html`
- `styles.css`
- `app.js`

Its existing message payload shape is preserved:

```
{
  "message": "Hello",
  "messages": [
    { "role": "user", "content": "Hello" }
  ]
}
```

The API now translates that request into a provider-neutral Juni request.

## Local commands

Install:

```
npm install
```

Test:

```
npm test
```

Static checks:

```
npm run check
```

Serve the existing UI:

```
npm run dev
```

## Deployment

The repository remains compatible with Vercel.

Set provider keys and the server access token in the deployment environment. Do not put any provider key into browser code.

## Structure

```
.
├── api/
│   └── chat.js
├── core/
│   ├── app.js
│   ├── config.js
│   ├── errors.js
│   ├── events.js
│   ├── identity.js
│   ├── index.js
│   ├── juni.js
│   ├── provenance.js
│   ├── provider.js
│   ├── router.js
│   ├── security.js
│   ├── tools.js
│   └── voice.js
├── docs/
│   ├── ARCHITECTURE.md
│   └── SECURITY.md
├── lib/
│   └── rate-limit.js
├── providers/
│   ├── anthropic.js
│   ├── base.js
│   ├── gemini-live.js
│   ├── gemini.js
│   ├── index.js
│   └── openai.js
├── test/
│   ├── backwards-compat.test.js
│   ├── chat.test.js
│   ├── config.test.js
│   ├── events.test.js
│   ├── juni.test.js
│   ├── provider-adapters.test.js
│   ├── provider.test.js
│   ├── rate-limit.test.js
│   ├── router.test.js
│   ├── security.test.js
│   └── tools.test.js
├── app.js
├── index.html
├── package.json
├── styles.css
└── vercel.json
```


## Step 2 — persistent memory, knowledge storage & provenance

Implemented in the repository:

- 10 GiB configurable logical persistent-memory/storage quota
- short-term conversation context separated from long-term memory
- long-term memory with transient/candidate/important/permanent/archived/deleted states
- explicit approval requirement for important/permanent model-assisted knowledge
- historical versions for important memory and knowledge changes
- document metadata plus versioned extracted text storage
- provider-neutral embedding/vector interface with a LibSQL implementation
- source registration and provenance metadata
- research result, cache, media metadata, learning event, audit, and model/provider metadata stores
- configurable retention policies with explicit purge confirmation
- tamper-evident cryptographic hash-chain audit ledger
- scoped inspection services for memory, versions, provenance, storage usage, learning events, audit records, and ledger verification
- controlled learning pipeline from normalization through optional embedding
- tenant/user isolation in all persistent reads and writes

The 10 GiB value is a logical budget: 10 × 1024³ = 10,737,418,240 bytes. It is not a model size or intelligence measurement.

The AI Blockchain concept is implemented only as an append-oriented provenance/audit chain. It does not provide a second intelligence engine, distributed consensus, or an unconditional immutability guarantee.

### Step 2 storage configuration

Set JUNI_DATABASE_URL for the backing LibSQL-compatible database.

Local development example:

JUNI_DATABASE_URL=file:juni.db

For durable serverless deployments, use a hosted LibSQL/Turso-compatible URL plus JUNI_DATABASE_AUTH_TOKEN. The local/Vercel fallback file path is not a substitute for durable multi-instance persistence.

Quota and retention settings are configured through the Step 2 variables in .env.example.

See docs/MEMORY.md, docs/ARCHITECTURE.md, and docs/SECURITY.md.

Step 3 can add authenticated end-user memory HTTP APIs, live research ingestion, and other tools on top of these scoped services without coupling them to a model provider.

## Step 3 prerequisites

Step 3 — controlled web research & knowledge acquisition

Implemented in the repository:

- explicit QUICK_LOOKUP, RESEARCH, DEEP_RESEARCH, URL_ANALYSIS, SOURCE_COMPARISON, and KNOWLEDGE_ACQUISITION modes
- provider-neutral web-search capability discovery and retry/fallback in the Model Router
- OpenAI web search, Gemini Google Search grounding, Gemini URL Context, and Anthropic web search adapters
- controlled HTTP(S) retrieval with URL canonicalization, response limits, redirect validation, DNS/private-network checks, and prompt-injection isolation
- persistent research sessions, operations, sources, evidence, claims, citations, and knowledge candidates
- provider-native citation preservation plus application citation validation against actual evidence
- source hashing and metadata hashing connected to the Step 2 provenance ledger
- descriptive source-quality metadata rather than a universal truth/trust score
- research cache using the Step 2 cache/quota layer
- explicit candidate approval/rejection before persistent knowledge creation
- optional embedding creation through the existing provider-neutral vector store
- server-side POST /api/research APIs and minimal UI research state/source links

See docs/RESEARCH.md for the full pipeline, security boundary, configuration, API actions, and limitations.

Research is disabled by default through JUNI_FEATURE_WEB_RESEARCH=false. Enable it only after configuring at least one supported provider and a secure research identity scope for the HTTP endpoint.

Step 4 can add a durable external audit checkpoint or other independent anchoring for the tamper-evident provenance chain.

Step 5 can expand the Gemini Live browser experience using secure session credentials.

Step 2 intentionally stops before unrestricted autonomous learning, Internet access, browser automation, full voice/video UX, and a distributed blockchain network.


## Step 4 — realtime voice

Step 4 is implemented as a real-time Gemini Live browser voice interface, not as speech-to-text plus normal chat generation.

Production audio path:

\`Microphone → PCM16 16kHz → Gemini Live WebSocket → PCM16 24kHz → Web Audio\`

The browser obtains a short-lived Gemini ephemeral token from \`POST /api/voice-token\` after the existing JUNI bearer authentication/origin/rate-limit checks. The long-lived \`GEMINI_API_KEY\` remains server-side.

Voice mode enforces AUDIO-only model responses. Optional input/output transcription is captions metadata only.

The implementation includes AudioWorklet resampling/chunking, scheduled PCM output, barge-in interruption, session resumption, context-window compression, bounded reconnect, safe realtime tool calling, voice lifecycle observability, tenant/user-scoped voice session metadata, and minimal mobile-first UI controls.

Additional configuration is documented in \`.env.example\`. See \`docs/VOICE.md\`.
