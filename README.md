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

## Step 2 prerequisites

Step 2 should connect a durable memory layer to the existing events/provenance contracts.

That step should define persistence, retention, user consent/approval policy, deletion/correction semantics, embeddings/vector storage, and storage-budget accounting before building the full memory engine.

Step 3 can connect research/web tools.

Step 4 can add the durable tamper-evident audit/provenance implementation.

Step 5 can expand the Gemini Live browser experience using secure session credentials.

Step 1 deliberately stops before implementing those systems.
