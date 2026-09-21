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

Gemini Live is server-side by design in this foundation. The Live API uses stateful WebSocket sessions and supports realtime audio/video input and native audio output. Client microphone access should be introduced later with a secure session/ephemeral-token design rather than shipping a persistent Gemini API key to the browser.


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


## Step 4 realtime voice security

Voice token issuance uses the existing bearer authorization, exact-origin check when configured, and rate limiting. Identity is resolved with the same trusted request context/fixed server-side identity approach used by Step 3; browser-supplied tenant/user headers are not trusted by default.

\`providers/gemini-live.js\` validates the configured \`GEMINI_LIVE_MODEL\` against the voice allowlist and a Live-capability check before creating an ephemeral token. The token uses \`uses: 1\`, bounded expiry, a server-side Juni system identity, AUDIO-only response modality, constrained tools, session resumption, and context compression.

The ephemeral token exists only in browser memory. It is not persisted in localStorage, sessionStorage, IndexedDB, cookies, application chat history, the Step 2 database, or the provenance ledger. The long-lived Gemini API key is never sent to the browser or logged.

Microphone access is requested only from the explicit Start Voice action, with audio-only \`getUserMedia\` constraints and \`video: false\`. No raw microphone/model audio is persisted by default.

Live tool calls are allowlisted and schema-validated. \`openWebsite\` accepts only credential-free HTTP(S) URLs and returns a user-visible Open action instead of silently executing browser behavior. Unknown tools and unsafe URLs are rejected.

Vercel CSP is restricted to the required Gemini Live WebSocket host plus same-origin connections. Permissions-Policy allows microphone for the application origin while camera and geolocation remain disabled.
