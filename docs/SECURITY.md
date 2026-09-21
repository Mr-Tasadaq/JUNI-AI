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

## Canonical request identity

Persistent user-scoped operations use the canonical request identity resolver in `core/identity.js`.

Identity precedence is:

1. An authenticated identity supplied by a trusted authentication/session layer.
2. An explicitly enabled internal identity-header mode.
3. An explicitly configured server-fixed tenant/user scope.

When an authenticated identity is present, `x-tenant-id` and `x-user-id` headers are not authoritative and cannot override it.

The current access-code flow authenticates the application credential but does not itself create per-user accounts. For durable user-scoped features in this mode, configure:

- `JUNI_IDENTITY_DEFAULT_TENANT_ID`
- `JUNI_IDENTITY_DEFAULT_USER_ID`

If no trusted identity source exists, the canonical resolver fails closed with `REQUEST_IDENTITY_NOT_CONFIGURED`.

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
- an exact allowlist for client-selectable provider and model identifiers

Client-supplied `provider` and `model` values in `/api/chat` are validated against `config.security.requestAllowlist`.

By default, all existing providers are selectable but only each provider's configured default model is selectable. Additional exact model IDs can be added through `JUNI_REQUEST_ALLOWED_MODELS_JSON`, and the selectable provider set can be restricted through `JUNI_REQUEST_ALLOWED_PROVIDERS`.

A model cannot be selected without also selecting its provider. The allowlist is only for client-controlled provider/model selection; normal router defaults and fallback policy remain server-controlled.

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

Durable memory, research, and provenance services are implemented in later steps with tenant + user scoping.

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
