# JUNI-AI Security Boundaries

## Secrets

Provider API keys are server-only environment variables:

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`

Never place these values in frontend JavaScript, browser storage, HTML, public configuration, or committed files.

## API authentication

Step 1 uses `JUNI_API_TOKEN` as a server-side bearer access gate.

This is intentionally simple and is not a substitute for per-user identity, sessions, or authorization roles.

## Request boundaries

The API applies:

- HTTP method checks
- exact optional origin checks
- bearer authentication
- rate limiting
- message-length limits
- bounded conversation history
- capability-aware provider selection
- normalized provider errors

## Event logging

The event model records operational metadata, but it sanitizes keys, secrets, bearer credentials, passwords, and similar fields.

Raw model prompts and full provider responses should not be treated as safe telemetry by default.

## Generated vs. sourced knowledge

Model output is generated output. A generated response should not be persisted as verified knowledge merely because a model produced it.

Later knowledge/memory modules should attach provenance records that identify:

- origin
- source URI when available
- source hash/fingerprint when available
- parent relationships
- correction/supersession events

## Deletion and correction

The Step 1 event vocabulary already includes memory creation/update/deletion and learning events so future durable stores can make changes auditable.

No durable memory or ledger is implemented yet.

## Provider isolation

A provider timeout, rate limit, overload, or upstream failure should become a normalized `ProviderError`.

The router can retry and/or fall back without exposing vendor-specific error payloads to the frontend.

## Realtime voice

Step 4 uses a secure ephemeral-token boundary for Gemini Live.

The browser calls `POST /api/voice-token` through the existing bearer/origin/rate-limit controls. The server keeps `GEMINI_API_KEY` private, validates the configured Live model, and creates a short-lived single-use token with constrained Live settings.

The browser stores the ephemeral token only in an in-memory private client field. It is never written to localStorage, sessionStorage, IndexedDB, cookies, URL query strings, or provenance/audit records.

The token constrains the Live model, AUDIO-only response modality, Juni identity, session-resumption configuration, context-window compression, and allowlisted realtime function declarations.

The direct browser WebSocket connects only to the required Gemini constrained endpoint. The CSP permits that Gemini WebSocket host in addition to same-origin connections. Permissions-Policy permits microphone for the application origin and denies camera access.

The microphone pipeline requests audio only after explicit user action, resamples to 16 kHz PCM16, and sends bounded realtime chunks. Raw microphone/model audio is not persisted by default.

Retrieved/model-supplied tool calls are not arbitrary browser automation. Only `openWebsite` and `getCurrentTime` are accepted, arguments are schema-validated, and a website open requires an explicit user click.

Voice lifecycle metrics are persisted through the existing tenant/user-scoped Step 2 storage/quota layer and recorded as safe tamper-evident audit metadata. Raw audio and ephemeral credentials never enter the ledger.


## Step 2 persistent-data boundaries

All memory, knowledge, document, vector, provenance, and audit service operations require an explicit tenantId + userId scope.

The storage layer applies both predicates to reads and writes. There is no service method that accepts an object ID alone for cross-scope lookup.

Important and permanent memory or knowledge promotion requires explicit approval metadata. Model-generated output is not trusted as permanent knowledge merely because a model produced it.

Deletion of memory is represented by a tombstone rather than a destructive SQL delete. Historical versions remain available to authorized inspection.

The provenance ledger is append-oriented and cryptographically chained. It is tamper-evident, not distributed consensus and not mathematically immutable.

The HTTP API does not expose raw memory by arbitrary tenant/user headers because Step 1 does not yet provide a real user identity/session authority. The programmatic inspection service is the current boundary until authenticated identity is added.


## Step 3 web-research security

Retrieved pages are UNTRUSTED DATA. The research layer explicitly instructs synthesis models not to follow instructions embedded in web content. It blocks URL credentials, non-HTTP schemes, localhost, private/non-public IP targets, unsafe DNS resolutions, non-standard ports, and redirects to blocked/private destinations. Response sizes and redirect counts are bounded, and downloaded HTML scripts/styles are never executed.

The research HTTP endpoint does not trust arbitrary tenant/user headers by default. It uses authenticated request identity when available or a server-configured fixed scope. Provider API keys remain server-side.

Provider-native citations are preserved only when they can be mapped to a retrieved source. Application citations are accepted only when the cited source and evidence IDs exist. Conflicting evidence is retained as supports/contradicts/qualifies relationships rather than silently merged.
