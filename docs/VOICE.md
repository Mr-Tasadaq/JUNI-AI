# JUNI Real-Time Voice Intelligence

Step 4 adds a real-time Gemini Live voice interface while preserving the provider-neutral Juni core.

The production voice path is:

MICROPHONE → PCM16 16 kHz → GEMINI LIVE → PCM16 24 kHz → WEB AUDIO PLAYBACK

Voice is an audio-to-audio interaction mode. It does not use speech-to-text followed by a normal text response as its primary architecture, and it does not use browser speech synthesis or prerecorded audio.

## Authentication and trust boundary

The browser never receives `GEMINI_API_KEY`.

The browser first uses the existing JUNI bearer access gate at `POST /api/voice-token`. The server verifies the feature flag, origin, bearer credential, trusted tenant/user identity, Gemini configuration, and configured Live model.

The server creates a Gemini ephemeral auth token with:

- `uses: 1`
- short-lived `expireTime`
- `newSessionExpireTime`
- `liveConnectConstraints`
- locked model
- locked `responseModalities: ["AUDIO"]`
- locked Juni system identity
- locked session resumption configuration
- locked context-window compression
- locked approved Live tools

The browser keeps the ephemeral token only in a private runtime field. It is not written to localStorage, sessionStorage, IndexedDB, cookies, URLs, or the provenance ledger.

The direct browser WebSocket uses the constrained Gemini endpoint with the ephemeral token as `access_token`.

Current Google documentation specifies the constrained `v1beta` WebSocket form for ephemeral-token connections. The current JS SDK documents `authTokens.create` / `CreateAuthTokenConfig`, including `expireTime`, `newSessionExpireTime`, `uses`, `liveConnectConstraints`, and `lockAdditionalFields`.

## Model configuration

`GEMINI_LIVE_MODEL` remains configurable.

Juni validates the configured model through the Gemini Models API before issuing a token. A model is accepted only when its metadata provides a Live-capability signal through its name or supported action/generation metadata.

The default repository value remains `gemini-3.8-live`, but deployments should verify the selected model is supported for the account/API configuration in use.

## Audio input

`voice/audio-input.js` requests microphone access only after the user presses Start Voice.

It requests microphone only:

- one audio channel
- browser echo cancellation
- noise suppression
- auto gain control
- `video: false`

The primary path is AudioWorklet.

`voice/audio-worklet.js` receives Float32 microphone frames, resamples from the browser's actual sample rate to 16 kHz, converts samples to signed little-endian PCM16, and emits transferable chunk buffers.

Chunk size is configured between 20 ms and 100 ms; the default is 60 ms.

A ScriptProcessorNode fallback is isolated behind the same `VoiceAudioInput` interface for browsers that do not provide AudioWorklet.

## Audio output

`voice/audio-output.js` keeps one AudioContext alive for the active voice session.

Gemini audio payloads are base64-encoded raw PCM16. The client decodes them into little-endian signed 16-bit samples, uses the supplied audio rate when present, and schedules AudioBufferSourceNode playback on a bounded queue.

The queue tracks the next playback time and has a maximum buffered-audio limit.

`clear()` stops and disconnects queued sources and increments a generation marker so stale async playback cannot be scheduled after interruption.

The AudioContext is closed when voice mode is stopped.

## Voice state machine

The provider-neutral state machine in `core/voice.js` exposes:

`idle`, `requesting_permission`, `connecting`, `listening`, `speaking`, `interrupted`, `reconnecting`, `error`, `closing`, `closed`

State transitions are validated rather than assigned arbitrarily.

The browser voice client maps Live protocol events into these normalized states.

## Interruption / barge-in

Gemini Live automatic voice activity detection is the turn detector.

When Gemini reports `serverContent.interrupted`, the client immediately clears current output playback and queued stale audio. The conversation session remains active and returns to `listening`.

The client does not use a second competing amplitude-based VAD. Input/output analyser levels are used only for visualization.

## Session resumption and reconnect

The client retains the latest `sessionResumptionUpdate.newHandle` in memory only.

On `goAway`, the client starts bounded reconnect with exponential backoff and jitter.

Reconnect is limited by `JUNI_VOICE_MAX_RECONNECT_ATTEMPTS`.

Before reuse, the client refreshes an expired or near-expired ephemeral token. The current resumption handle is carried into the next constrained token request and Live setup when available.

If reconnect attempts are exhausted, the voice state becomes `error` and the user can explicitly retry.

## Context window compression

The Live setup enables `contextWindowCompression` using the documented sliding-window form.

This works with session resumption to keep long-running audio sessions manageable.

## Realtime function calling

Only two Live tools are exposed:

### openWebsite

Accepts one URL. The URL must use HTTP or HTTPS, contain no credentials, use only standard ports, and not target localhost or literal private/local addresses.

The tool does not execute page code, inspect arbitrary DOM, or perform browser automation.

A successful tool call produces a user-visible Open button. The page is opened only after an explicit user click.

### getCurrentTime

Returns a current UTC ISO timestamp and accepts no arguments.

Unknown function names and malformed calls are rejected.

Tool responses are sanitized and never include credentials, environment variables, filesystem content, hidden prompts, database credentials, or Gemini tokens.

## Captions

Captions are optional and disabled by default unless configured.

When enabled, Gemini input and output transcription events are displayed as temporary UX captions.

Captions are not used as replacement transport for the audio session and are not automatically inserted into the normal text-chat history or Step 2 permanent memory.

## Memory integration

Step 4 exposes bounded provider-neutral hooks over Step 2 retrieval:

- recent context
- preferences
- approved semantic memory
- approved knowledge

These hooks are intentionally small and scoped to the current tenant/user. The voice client does not load the 10 GiB storage corpus into model context.

Voice exchanges are not automatically written into permanent memory.

## Session metadata and provenance

The Step 2 database gains `voice_sessions`.

Persisted metadata includes:

- session ID
- tenant/user scope
- provider/model
- start/connect/end timestamps
- reconnect count
- interruption count
- tool-call count
- audio bytes sent/received
- duration
- close reason
- resumption update count
- retention timestamp

Raw continuous microphone audio and raw model audio are not persisted by default.

Voice lifecycle/tool metadata is recorded through existing audit/provenance mechanisms with the existing tamper-evident hash chain.

The ephemeral token is never recorded.

## Storage and the 10 GiB budget

Voice session metadata counts toward the existing 10 GiB logical storage budget through the Step 2 quota service.

Raw continuous recordings are deliberately not stored in Step 4.

Any future recording feature must use explicit consent plus the existing quota, retention, deletion, and provenance controls.

## Browser lifecycle

Voice mode handles microphone track ending, AudioContext suspension/resume, pagehide, explicit Stop, WebSocket closure, bounded reconnect, GoAway, token expiry, and malformed provider messages.

Stopping voice releases microphone tracks, closes audio resources, clears playback, closes the Live socket, and clears the in-memory token/resumption state.

## Security headers

The Vercel configuration permits microphone only for the application origin, denies camera access, permits WebSocket connections only to `wss://generativelanguage.googleapis.com` in addition to same-origin connections, and keeps `unsafe-inline` and `unsafe-eval` disabled.

## API

`POST /api/voice-token` returns only the short-lived client token and minimal runtime metadata.

`POST /api/voice-events` accepts only a small allowlist of sanitized voice lifecycle metrics for session auditing.

Both endpoints use the existing bearer/origin/rate-limit/security boundary.

## Current limitations

The repository does not claim successful real Gemini Live network connectivity without configured Gemini credentials.

The repository's test suite uses injected provider/audio/WebSocket boundaries for deterministic testing.

The current end-user identity model uses the repository's existing trusted authenticated request context or server-side fixed tenant/user fallback; arbitrary browser tenant/user headers are not accepted.

The Gemini JS SDK currently documents ephemeral-token token creation as experimental and notes version-specific token support details. Step 4 follows Google's documented constrained-WebSocket shape for ephemeral-token browser sessions and keeps that provider-specific implementation isolated in `providers/gemini-live.js`.

Step 4 does not implement unrestricted browser automation, computer control, video intelligence, autonomous actions, autonomous learning, full document intelligence, or a distributed blockchain network.