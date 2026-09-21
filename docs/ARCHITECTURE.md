# JUNI-AI Step 1 Architecture

## Goal

JUNI-AI is a provider-based AI agent system. The core application depends on a stable provider contract, not on a single model vendor.

The current Step 1 foundation contains:

- a central Juni Core orchestration layer
- a capability-aware provider router
- Anthropic, OpenAI, and Gemini adapters
- configurable model/provider selection and fallback
- a provider-neutral tool registry
- a structured event model
- explicit security and provenance boundaries
- a Gemini Live session architecture for future realtime voice
- automated tests

## Data flow

1. The frontend sends the existing chat request contract to `POST /api/chat`.
2. The API authenticates the request and applies rate limits.
3. The API creates a normalized Juni request.
4. Juni Core emits request events and asks the Model Router for a suitable provider/model.
5. The router filters candidates by capability, health, task, modality, latency preference, and configured priority.
6. The selected provider adapter translates the provider-neutral request into its native API format.
7. The adapter returns a normalized result or a normalized streaming event.
8. Tool calls, when introduced by a model, pass through the internal Tool Registry rather than vendor-specific executors.
9. Events capture routing, provider execution, tool execution, failures, retries, and latency metadata.
10. The API returns the normalized response to the existing frontend.

## Provider contract

Each provider adapter exposes the Step 1 contract plus optional research methods:

- `name`
- `defaultModel`
- `capabilities(model)`
- `health()`
- `generate(request, options)`
- `stream(request, options)`
- `researchCapabilities(model)` when web research is supported
- `research(request)` for provider-native search or URL context

The core does not call vendor SDK methods directly.

### Current adapters

| Provider | Adapter | Current default model | Step 1 support |
| --- | --- | --- | --- |
| Anthropic | `providers/anthropic.js` | `claude-opus-5` | text, vision, streaming, tool calling |
| OpenAI | `providers/openai.js` | `gpt-5.5` | text, vision, streaming, tool calling, research capability flag |
| Gemini | `providers/gemini.js` | `gemini-3.8-flash` | text, vision, audio input/output capability flag, streaming, tool calling, research capability flag, live voice flag |

These are configuration defaults, not a permanent "brain". Model identifiers can be replaced through environment configuration.

## Router

The Model Router scores only candidates that satisfy required capabilities.

Inputs include:

- task type
- modality
- latency preference
- requested provider/model
- required web/research capability
- tool requirements
- provider health
- configured fallback order
- provider priority/weights

On retryable failures the router retries the provider according to configuration and can continue to the next eligible provider.

## Tools

Tools use a neutral internal definition:

- name
- description
- JSON-schema-like input schema
- executor
- metadata

Provider adapters translate those definitions into vendor-specific function/tool declarations.

Step 3 adds controlled web research outside the generic Tool Registry because provider-native search tools have different execution contracts. The research layer still records a neutral tool identity (for example web.search and web.retrieve), preserves provider metadata, and keeps provider SDK calls inside adapters.

## Multimodal

The provider-neutral message format can carry content blocks such as:

- text
- image
- image URL
- file
- input audio

Each adapter maps supported blocks to its provider API. Unsupported blocks should be rejected or handled by a later capability-aware router policy rather than silently treated as equivalent.

## Streaming

The normalized stream contract yields events such as:

- `text_delta`
- `tool_call`
- `completed`

Provider SDK event formats stay inside the adapters.

Tool orchestration for streaming is intentionally not hidden behind a partial protocol in Step 1. The non-streaming core already has the complete provider-neutral tool loop.

## Gemini Live voice

`providers/gemini-live.js` defines the future realtime boundary around Gemini Live.

It supports the architecture for:

- configurable Live model
- microphone/audio chunks
- video chunks
- realtime text
- audio output callbacks
- interruption/barge-in hooks
- tool responses
- session lifecycle
- reconnect by session recreation
- errors and close callbacks

No fake voice pipeline is used.

Google currently documents `gemini-3.8-live` as the default option for most low-latency voice agent experiences, while `gemini-3.1-flash-live-preview` is a legacy preview model. The application therefore keeps `GEMINI_LIVE_MODEL` configurable instead of hard-coding the legacy model.

## Juni identity

The identity layer defines Juni as:

- intelligent
- curious
- adaptive
- conversational
- helpful
- context-aware
- tool-capable
- transparent about uncertainty
- source-aware
- provenance-aware

The human-child-learning concept is only a software design metaphor. The code makes no claim that Juni has a human brain.

## Trust and safety

Step 1 and Step 2 enforce these boundaries:

- provider keys remain server-side
- authorization tokens are not returned in event payloads
- event data is sanitized for secrets
- model output is not automatically treated as verified fact
- user-provided and external information can remain distinguishable
- provenance is represented as a future persistence contract
- provider failures are isolated by normalized errors
- tool execution is explicit through the registry

## 10GB AI storage budget

The 10GB concept belongs to storage/memory budgeting, not model intelligence.

The configuration reserves a default budget of 10 GiB (10,737,418,240 bytes) for future data such as:

- memories
- preferences
- conversations
- documents
- extracted knowledge
- embeddings/vector records
- learned facts
- cached knowledge
- research artifacts
- media metadata
- audit/provenance records

Step 1 does not create the memory store or enforce the full storage budget yet.

## AI Blockchain boundary

The AI Blockchain concept is represented only by a provenance contract in Step 1.

Its purpose is tamper-evident provenance/audit for:

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

It is explicitly **not** an intelligence engine and does not make Juni smarter.

## Future steps

Step 2 can add the durable memory engine against the provenance/event contracts.

Step 3 now provides controlled web research and knowledge acquisition. Step 4 can add authenticated memory/research HTTP identity hardening and/or an independent durable audit checkpoint; those future changes must preserve the existing provenance boundary.

Step 5 can expand the Gemini Live voice UX and realtime tool orchestration.

Step 6+ can add documents, embeddings, media intelligence, and additional external tools.

The Step 1 boundary is deliberate: later modules should attach to the core contracts rather than bypass them.


## Step 3 research flow

1. `POST /api/research` authenticates with the existing bearer gate and resolves a secure tenant/user scope.
2. The request model infers/validates research mode and freshness constraints.
3. The research-aware router selects a configured provider/model that advertises the requested web capability and is currently healthy.
4. Provider-native search runs server-side; direct URLs use SafeWebRetriever, with Gemini URL Context used when available for URL analysis.
5. Sources are normalized, canonicalized, deduplicated, hashed, and persisted with provenance metadata.
6. Evidence is extracted as bounded excerpts. Web text is explicitly marked untrusted and is never interpreted as instructions.
7. Synthesis receives only bounded evidence and a list of source identities. Claims are linked to evidence and validated before citations are persisted.
8. Knowledge Acquisition creates a candidate only when explicitly requested. Approval creates a versioned Step 2 knowledge record; unapproved research does not become permanent memory.

## Step 3 storage

Research sessions, operations, source content, evidence, claims, citations, candidates, provenance, and research caches count toward the existing 10 GiB logical budget. Retrieval and synthesis are bounded; the complete research store is never loaded into model context.
