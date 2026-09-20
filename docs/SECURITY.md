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
