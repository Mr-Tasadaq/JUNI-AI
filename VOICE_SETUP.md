# JUNI AI Voice Setup — JUNI (Male) + SONA (Female)

This guide explains the complete voice configuration for the JUNI AI application. The app uses **Gemini Live API native audio** for the real conversation. `voice.zip` is retained as an optional local preview archive; it is not used as the production conversation engine.

## 1. What the voice system contains

| Layer                    | File                        | Responsibility                                                                                                                  |
| ------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Model and personalities  | `shared/juni.ts`            | Gemini model, JUNI/SONA names, system instructions, voice names, and allowlisted tools                                          |
| Secure token broker      | `server/routers.ts`         | Authenticated server procedure that creates a short-lived, single-use Gemini Live token                                         |
| Gemini key configuration | `server/_core/env.ts`       | Reads `GEMINI_API_KEY` only on the server                                                                                       |
| Voice UI and streaming   | `client/src/pages/Home.tsx` | Microphone capture, PCM conversion, Gemini Live connection, native audio playback, interruption, switching, and confirmation UI |
| Route shell              | `client/src/App.tsx`        | Makes `/` the voice app and preserves `/audit` for the repository audit                                                         |
| Browser metadata         | `client/index.html`         | App title and secure theme metadata                                                                                             |
| Audio archive            | `voice.zip`                 | Optional `Juni Ai.mp3` and `SONA AI.mp3` preview files                                                                          |
| Safety tests             | `server/juni.tools.test.ts` | Tests persona separation, tool allowlisting, and recharge validation                                                            |

## 2. Prerequisites

Install:

- Node.js 20 or newer
- pnpm 10 or newer
- A Google AI Studio or Google Cloud Gemini API key with Gemini Live API access
- A configured Manus OAuth application for private user sessions
- HTTPS in production; microphone access is blocked by browsers on insecure origins except localhost

## 3. Install dependencies

From the repository root:

```bash
pnpm install
```

The project uses the official SDK:

```bash
pnpm add @google/genai
```

The relevant runtime dependency is already recorded in `package.json` and `pnpm-lock.yaml`.

## 4. Configure environment variables

Create a local `.env` file from `.env.example`:

```bash
cp .env.example .env
```

Set these values on the **server only**:

```dotenv
GEMINI_API_KEY=replace_with_a_server_only_key
DATABASE_URL=replace_with_mysql_or_tidb_url
JWT_SECRET=replace_with_a_long_random_secret
VITE_APP_ID=replace_with_manus_oauth_app_id
OAUTH_SERVER_URL=https://api.manus.im
VITE_OAUTH_PORTAL_URL=https://auth.manus.im
OWNER_OPEN_ID=replace_with_owner_open_id
OWNER_NAME=Project Owner
```

Never use `VITE_GEMINI_API_KEY`. Any variable beginning with `VITE_` may be bundled into browser JavaScript. `GEMINI_API_KEY` is intentionally server-only and is read by `server/_core/env.ts`.

In WebDev production, add `GEMINI_API_KEY` through the project’s secure environment-variable/secrets settings. Do not commit `.env` or paste the key into chat, issues, screenshots, or source files.

## 5. Configure the two personalities

Edit `shared/juni.ts`.

### JUNI AI — male

```ts
juni: {
  name: "JUNI AI",
  gender: "Male",
  voiceName: "Puck",
  systemInstruction: "...calm, clever, supportive, lightly teasing...",
}
```

### SONA AI — female

```ts
sona: {
  name: "SONA AI",
  gender: "Female",
  voiceName: "Kore",
  systemInstruction: "...warm, witty, playful, expressive...",
}
```

`voiceName` is passed into Gemini’s native `speechConfig.voiceConfig.prebuiltVoiceConfig`. If Google changes the available prebuilt voice catalog, replace `Puck` or `Kore` with a currently supported voice name. The UI labels and system instructions are independent from the provider voice name.

The selected personality controls:

- display name
- gender label
- greeting
- system instruction
- voice name
- accent description
- orb color
- conversation style

Changing personalities closes the current Live session before changing configuration. This is required because Live session configuration cannot be changed after the connection is open.

## 6. Configure the Gemini Live model

`shared/juni.ts` contains:

```ts
export const LIVE_MODEL = "gemini-3.1-flash-live-preview";
```

The session is audio-only:

```ts
responseModalities: [Modality.AUDIO];
```

The app deliberately does not use a normal `generateContent` text-chat fallback for the main conversation.

## 7. Understand the secure token flow

The browser never receives the long-lived Gemini API key.

1. The user authenticates through Manus OAuth.
2. The browser calls the protected tRPC procedure `live.createEphemeralToken`.
3. `server/routers.ts` creates a Gemini ephemeral token with `@google/genai`.
4. The token is constrained to `gemini-3.1-flash-live-preview`, audio output, session resumption, and the allowlisted safe tools.
5. The server returns only the short-lived token to the authenticated browser.
6. The browser constructs `new GoogleGenAI({ apiKey: token })` and opens one Live session.
7. The token expires after 30 minutes and can start one session within the one-minute start window.

The server-side procedure is protected with `protectedProcedure`. An unauthenticated user is redirected to sign in instead of receiving a token.

## 8. Microphone input settings

`client/src/pages/Home.tsx` requests:

```ts
navigator.mediaDevices.getUserMedia({
  audio: {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
  },
});
```

The Web Audio API captures microphone frames and converts them to:

- signed PCM16
- little-endian
- mono
- 16 kHz
- base64 encoded chunks
- MIME type `audio/pcm;rate=16000`

Each chunk is sent with:

```ts
session.sendRealtimeInput({
  audio: { data: base64Chunk, mimeType: "audio/pcm;rate=16000" },
});
```

## 9. Native audio output settings

Gemini native audio is returned as base64 PCM16 chunks at 24 kHz. The client:

1. decodes base64 into PCM16 samples;
2. creates a 24 kHz `AudioBuffer`;
3. schedules chunks on a low-latency playback queue;
4. stops and clears every queued source when Gemini reports an interruption.

The UI status moves through:

```text
Ready → Connecting → Listening → Speaking → Listening
```

Microphone tracks, processors, audio contexts, and queued output sources are all closed when the session ends.

## 10. Safe voice tools

The allowlist in `shared/juni.ts` contains exactly three tools:

### `open_website`

- accepts only an `https://` URL;
- displays a confirmation card;
- opens a new tab only after explicit approval;
- returns cancellation or success to Gemini.

### `get_recharge_info`

- read-only;
- requires authentication;
- never charges the user;
- currently returns an explicit “provider not connected” state rather than inventing balance data.

### `start_recharge`

- validates amounts from PKR 100 to PKR 100,000;
- displays a confirmation card;
- records only a guarded preview intent;
- returns `checkoutUrl: null` until a verified payment provider is connected;
- never claims payment success from a prepared intent.

Before connecting a real payment provider, add provider webhooks, idempotency keys, server-side status verification, audit logging, and an additional confirmation step at checkout.

## 11. Run locally

```bash
pnpm dev
```

Open the local HTTPS/preview URL or `http://localhost:3000`.

Then:

1. Sign in.
2. Select **JUNI AI · Male** or **SONA AI · Female**.
3. Tap the orb.
4. Approve microphone permission.
5. Speak naturally.
6. Interrupt while the assistant speaks by tapping the orb or using the interruption control.
7. Ask for a website or recharge information to test the safe-tool confirmation flow.

## 12. Validate the project

```bash
pnpm check
pnpm test
pnpm build
```

The included tests cover:

- the distinct JUNI and SONA configurations;
- the exact safe-tool allowlist;
- recharge intent behavior;
- invalid recharge amount rejection;
- existing authentication logout behavior.

## 13. Common errors

### `Gemini Live is not configured`

`GEMINI_API_KEY` is missing from the server environment. Add it to the secure project secrets and restart the server.

### Microphone permission is denied

Use HTTPS or localhost, allow microphone access in the browser, and confirm no other application has exclusive access to the microphone.

### No audio is heard

Check that the browser tab is not muted, user interaction has occurred before playback, the output device is connected, and the session is using the 24 kHz output queue.

### `1008` or connection close errors

Check the model name, token expiry, browser network, and Live API quota. Reconnect to obtain a fresh ephemeral token. Do not reuse a token after its one-session limit has been consumed.

### A tool opens or charges without confirmation

Treat this as a release-blocking security defect. The current implementation requires a visible user approval for opening websites and recharge intents. Do not bypass that confirmation in the client or system instruction.

## 14. Production checklist

- [ ] `GEMINI_API_KEY` is stored in server secrets only.
- [ ] OAuth callback and production origin are configured.
- [ ] Production origin uses HTTPS.
- [ ] Microphone permission copy is clear and localized.
- [ ] Session resumption/reconnect handling is monitored.
- [ ] Gemini Live usage, quotas, and cost limits are monitored.
- [ ] Tool calls are audit logged without recording secrets or raw audio unnecessarily.
- [ ] Payment provider is connected and verified before enabling real checkout.
- [ ] User data retention, deletion, export, and privacy notices are implemented.
- [ ] `pnpm check`, `pnpm test`, and `pnpm build` pass in CI.

## 15. Audio archive notes

`voice.zip` contains:

```text
voice/Juni Ai.mp3
voice/SONA AI.mp3
```

These files are useful as local identity/reference previews. Gemini Live production output is generated natively by the selected `voiceName` and is not loaded from these MP3 files. Keep the archive out of frontend bundles unless you intentionally add an explicit preview player.
