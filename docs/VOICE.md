# JUNI Real-Time Voice

Step 4 adds a real-time browser voice interface using Gemini Live. The primary path is audio-to-audio:

Microphone → mono PCM16 16kHz → Gemini Live WebSocket → PCM16 24kHz → Web Audio playback

It is not a speech-to-text → text generation → text-to-speech pipeline, and it does not use browser speech synthesis as the assistant response path.

## Authentication

The browser calls POST /api/voice-token after the existing JUNI bearer authentication/origin/rate-limit checks. The server validates the voice feature flag, Gemini configuration, trusted identity scope, and configured Live model, then calls authTokens.create on the official Google Gen AI SDK.

The browser receives only the short-lived ephemeral token plus safe session metadata. The long-lived GEMINI_API_KEY never reaches browser code and is never placed in persistent browser storage, the database, or the provenance ledger.

Google documents ephemeral tokens specifically for direct client-to-Live connections, including the constrained v1beta WebSocket endpoint. citeturn128412search1turn128412search10

## Token constraints

The token is issued with uses=1, bounded expireTime and newSessionExpireTime, the configured Live model, AUDIO response modality, server-side Juni identity, the fixed safe voice tools, session resumption, and context window compression.

The current @google/genai SDK exposes these auth-token fields, and the current Gemini documentation shows constrained tokens with AUDIO-only response configuration. citeturn128412search3turn128412search1

liveConnectConstraints is used to carry the server-selected Live configuration, which keeps the important voice configuration constrained on the server. The browser does not provide its own Juni system identity.

## Browser WebSocket

The browser connects to the Gemini constrained endpoint with the ephemeral token in the required access_token query parameter. The first WebSocket message is the Live setup message.

The setup uses:

- models/ + configured Live model
- generationConfig.responseModalities = ["AUDIO"]
- the fixed safe function declarations
- session resumption
- context window compression
- optional input/output audio transcription when captions are enabled

Google's WebSocket documentation specifies the constrained endpoint for ephemeral tokens and the setup message as the first client message. citeturn128412search10

## Audio input

voice/audio-input.js prefers AudioWorklet. voice/audio-input-worklet.js receives Float32 microphone frames, resamples the browser's actual input sample rate to 16kHz, clamps samples, converts to signed little-endian PCM16, and emits transferable chunks.

Normal chunks are approximately 40ms and remain configurable within a 20–100ms safe range.

A ScriptProcessorNode implementation exists only as a compatibility fallback when AudioWorklet is unavailable. It is not the primary path.

The microphone request is audio-only and explicitly sets video=false.

## Audio output

voice/audio-output.js keeps one AudioContext for the active session. Gemini output is decoded as little-endian PCM16 and played at the expected 24kHz rate. Google documents 24kHz output for Live audio examples. citeturn128412search11

Each chunk is scheduled after the previous one using nextPlaybackTime and a small safety margin. The queue is bounded by a configurable maximum buffer duration and can be cleared atomically.

## Barge-in and interruption

Gemini Live automatic voice activity detection remains authoritative for conversation turns. The browser analyser is used for visualization and a small barge-in assist.

When the user begins speaking while Juni is speaking, the client immediately clears scheduled audio and returns to listening while keeping the Live context.

When Gemini sends serverContent.interrupted=true, that server signal is treated as authoritative and current playback is cleared immediately.

## Session state

The provider-neutral state machine in core/voice.js uses:

idle, requesting_permission, connecting, listening, speaking, interrupted, reconnecting, error, closing, closed

Illegal transitions are rejected. Browser protocol details stay outside core/voice.js.

## Session resumption and GoAway

The Live session enables session resumption with transparent updates. The latest valid resumption handle stays only in browser runtime memory.

On GoAway or an unexpected close, the client stops accepting stale audio and uses bounded exponential backoff. Before the token expires it can reuse the current ephemeral token; otherwise it requests a fresh token bound to the latest resume handle.

The latest Live SDK documentation defines session-resumption handles, transparent reconnect metadata, and the resumable flag. citeturn847394search0turn847394search2

If context cannot be resumed, the application exposes a recovery/error state rather than silently claiming continuity.

## Context-window compression

The Live setup enables contextWindowCompression with the sliding-window configuration and keeps it paired with session resumption for long-running sessions. citeturn847394search1

## Safe realtime tools

Only two tools are available to the Live session:

openWebsite

Accepts one credential-free HTTP(S) URL. It rejects unsupported schemes, credentials, non-standard ports, localhost/local/internal hosts, and literal private IP targets.

It never executes arbitrary JavaScript, DOM operations, browser automation, or model-provided code. It returns a safe ready result and the UI shows a user-controlled Open action.

getCurrentTime

Returns a sanitized browser-local timestamp and timezone.

Unknown tool names and invalid argument schemas are rejected.

Google's current Live API documentation supports client-side function calling and tool responses. citeturn128412search11

## Captions

Captions are optional and disabled by default. When enabled, input and output transcription are displayed temporarily as YOU/JUNI captions.

Captions are not the voice transport and are not automatically persisted as permanent memory.

## Observability and provenance

Voice session metadata is persisted through Step 2 in a tenant/user-scoped voice_sessions table and counted against the existing logical storage quota.

Tracked metadata can include session timestamps, reconnect/interruption/tool counters, audio byte counts, approximate duration, close reason, and safe error codes.

Raw microphone audio, model audio, ephemeral tokens, API keys, hidden prompts, and credentials are not written to the ledger.

Voice lifecycle records use the existing tamper-evident audit_event ledger event type. The provenance layer remains tamper-evident only; it is not a distributed blockchain network.

## Browser lifecycle

Voice cleanup stops microphone tracks, closes the WebSocket, clears scheduled output, releases audio resources, removes the in-memory ephemeral token, and records completion metadata when the API remains reachable.

Page visibility and pagehide/beforeunload lifecycle events are handled so microphone capture does not continue after the user leaves voice mode.

## UI

The existing static HTML/CSS/JavaScript application is preserved. Voice is a separate interaction mode and does not inject every spoken turn into the text-chat DOM.

The voice panel provides:

- Start voice
- Mute / Unmute
- Stop
- Retry
- captions toggle
- output volume
- connection/speaking/listening state
- live input/output amplitude visualization
- session clear
- safe tool Open action

The visualization is driven by actual microphone/output analyser levels; it does not run as an unconditional fake animation.

## Security headers

Vercel security headers now allow microphone for the application origin and allow only the required Gemini Live WebSocket destination in connect-src.

Camera and geolocation remain disabled. No unsafe-eval or wildcard connect-src was added.

## Feature flag

JUNI_FEATURE_VOICE=false keeps realtime voice disabled by default. The token endpoint returns VOICE_FEATURE_DISABLED while text chat and research remain available.

## Storage

Continuous voice recording is not implemented. Only bounded session metadata is persisted, so voice does not silently consume the 10 GiB logical persistent-storage budget with microphone recordings.

## Testing boundary

Voice unit/integration tests use dependency-injected Gemini SDK, WebSocket, audio-input, and audio-output boundaries. These prove protocol and security behavior without requiring external credentials.

A passing test suite does not claim a real Gemini Live network session unless credentials, a supported Live model, browser microphone permission, and external network access were actually available and exercised.

## Step 4 boundary

Step 4 does not implement full video intelligence, YouTube intelligence, unrestricted browser/computer control, autonomous external actions, unrestricted crawling, autonomous publishing, autonomous learning, continuous audio recording, distributed blockchain infrastructure, or external immutable ledger anchoring.