# JUNI AI Voice Setup — OpenAI Realtime

This guide configures JUNI AI and SONA AI as a voice-first assistant using the **OpenAI Realtime API over WebRTC**. The application also includes multilingual voice, conversation history, file/image context, local voice recording/export, an account dashboard, and safe action confirmations.

## 1. Feature and file map

| Layer                             | File                        | Responsibility                                                                                            |
| --------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------- |
| Model, personas, languages, tools | `shared/juni.ts`            | OpenAI Realtime model, JUNI/SONA voices, language instructions, safe function schemas                     |
| Secure OpenAI broker              | `server/routers.ts`         | Creates short-lived client secrets, analyzes protected file/image context, and exposes account procedures |
| Secret configuration              | `server/_core/env.ts`       | Reads `OPENAI_API_KEY` only on the server                                                                 |
| Voice and feature UI              | `client/src/pages/Home.tsx` | WebRTC microphone/output, history, languages, uploads, recorder, account panel, and confirmations         |
| Routes                            | `client/src/App.tsx`        | `/` voice app and `/audit` security dashboard                                                             |
| Tests                             | `server/juni.tools.test.ts` | Persona, model, safe-tool, and recharge validation                                                        |
| Optional archive                  | `voice.zip`                 | `voice/Juni Ai.mp3` and `voice/SONA AI.mp3` preview files                                                 |

## 2. Prerequisites

Install:

- Node.js 20 or newer
- pnpm 10 or newer
- An OpenAI API key with Realtime API access
- A configured Manus OAuth application for private user sessions
- HTTPS in production; browsers require HTTPS or localhost for microphone access

There is no legitimate lifetime-free OpenAI API key. Use your own key or an organization-managed key. Do not download keys from websites or share keys in chat.

## 3. Install and configure

From the repository root:

```bash
pnpm install
cp .env.example .env
```

Set the server-side environment variables:

```dotenv
OPENAI_API_KEY=replace_with_a_server_only_key
DATABASE_URL=replace_with_mysql_or_tidb_url
JWT_SECRET=replace_with_a_long_random_secret
VITE_APP_ID=replace_with_manus_oauth_app_id
OAUTH_SERVER_URL=https://api.manus.im
VITE_OAUTH_PORTAL_URL=https://your-manus-login-portal
OWNER_OPEN_ID=replace_with_owner_open_id
OWNER_NAME=Project Owner
```

Use `OPENAI_API_KEY`, not `VITE_OPENAI_API_KEY`. Any variable beginning with `VITE_` can be bundled into browser JavaScript. The real OpenAI key must remain server-only and must never be committed to GitHub.

In WebDev production, add `OPENAI_API_KEY` using secure project secrets. If the secret is absent, the UI remains safe but the live voice and file analysis procedures return a configuration error.

## 4. OpenAI Realtime architecture

The implementation follows OpenAI’s recommended browser architecture:

1. The user signs in through Manus OAuth.
2. The browser calls protected tRPC procedure `realtime.createClientSecret`.
3. The server hashes the internal user ID into `OpenAI-Safety-Identifier`.
4. The server requests a short-lived client secret from `POST https://api.openai.com/v1/realtime/client_secrets` using `OPENAI_API_KEY`.
5. The server returns only the temporary secret, model, and selected voice.
6. The browser creates an `RTCPeerConnection` and a microphone track.
7. The browser POSTs its SDP offer to `https://api.openai.com/v1/realtime/calls` using the temporary secret.
8. OpenAI returns an SDP answer and establishes the WebRTC voice session.
9. Remote audio is attached to an autoplay audio element; events travel over the `oai-events` data channel.

The browser never receives the long-lived OpenAI key.

## 5. Model and voice settings

`shared/juni.ts` contains:

```ts
export const REALTIME_MODEL = "gpt-realtime-2.1";
```

The current native OpenAI Realtime voices are:

```text
alloy, ash, ballad, coral, echo, sage, shimmer, verse, marin, cedar
```

The project uses:

```ts
JUNI AI → cedar
SONA AI → marin
```

OpenAI recommends `marin` or `cedar` for quality. Voice cannot be changed after audio has been emitted in the current session, so changing assistant personalities closes the WebRTC session before reconnecting.

## 6. JUNI and SONA personality settings

Edit `shared/juni.ts`.

### JUNI AI — male

```ts
juni: {
  name: "JUNI AI",
  gender: "Male",
  voiceName: "cedar",
  accent: "Confident · calm · clever",
  systemInstruction: "...calm, clever, supportive, lightly teasing...",
}
```

### SONA AI — female

```ts
sona: {
  name: "SONA AI",
  gender: "Female",
  voiceName: "marin",
  accent: "Warm · playful · expressive",
  systemInstruction: "...warm, witty, playful, expressive...",
}
```

The selected personality controls the name, system instructions, voice, greeting, color, and conversation style. Uploaded files and web content are explicitly treated as untrusted context.

## 7. Multilingual voice

The language selector is rendered in `client/src/pages/Home.tsx` and currently supports:

- English
- Urdu
- Hindi
- Arabic
- Spanish

The selected language is passed to `realtime.createClientSecret`. The server combines the language instruction with the selected JUNI or SONA system instruction. Changing language closes the current session and requires reconnecting because the session’s voice instructions are initialized at connection time.

To add a language, append an item to `SUPPORTED_LANGUAGES` in `shared/juni.ts`:

```ts
{ id: "fr", label: "Français · French", instruction: "Speak in French when the user speaks French; otherwise follow the user's language." }
```

## 8. Browser microphone and output

The client requests:

```ts
navigator.mediaDevices.getUserMedia({
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    channelCount: 1,
  },
});
```

WebRTC carries microphone audio to OpenAI and returns native remote audio. Unlike the previous Gemini implementation, the client does not manually convert PCM chunks or maintain an audio-buffer queue; WebRTC handles the media transport and playback stream.

The application handles:

- `session.created` → connected/listening state;
- `response.created` → speaking state;
- transcript delta events → visible transcript;
- `response.done` → history capture and listening state;
- connection failure/close → clean teardown and error state.

## 9. Conversation history

Conversation history is intentionally stored in browser `localStorage` under `juni-history`:

- it avoids sending private transcript history to a server by default;
- it survives a page refresh on the same browser;
- it stores short assistant notes, file analysis notes, and approved actions;
- the History drawer shows the latest 30 items.

For production multi-device history, add a database table with user ownership, retention limits, deletion/export controls, encryption policy, and a server procedure scoped to `ctx.user.id`.

## 10. File and image context

The File context control accepts images, PDFs, and plain text up to 8 MB in the browser.

1. The browser reads the file as a base64 data URL.
2. The protected `files.analyze` procedure validates MIME type and size.
3. The server calls OpenAI Responses API using the server-only key.
4. Images use `input_image`; PDF/text files use `input_file`.
5. The result is returned to the authenticated user and inserted into the Realtime session as untrusted context.

Supported types:

```text
image/*
application/pdf
text/plain
```

Do not treat instructions embedded in uploaded files as system instructions. For production, prefer object storage plus signed URLs for large files instead of passing large base64 payloads through tRPC.

## 11. Voice recording and export

The Recorder control is local-only:

1. It uses the current microphone `MediaStream`.
2. `MediaRecorder` captures a WebM recording.
3. Stop capture finalizes the blob.
4. Download saves `juni-session-YYYY-MM-DD.webm`.

No recording is uploaded by this feature. Add visible consent, retention controls, and legal/privacy copy before changing that behavior.

## 12. Account and recharge dashboard

The Account panel calls the protected `account.dashboard` procedure. The default state is:

```text
provider_not_connected
balance: null
currency: PKR
```

This prevents the app from inventing balances or implying that billing is connected.

The safe recharge tool:

- validates PKR 100–100,000;
- shows a confirmation card;
- returns a preview intent only;
- uses `checkoutUrl: null` until a verified payment provider exists;
- never claims payment success from the preview procedure.

Before enabling real checkout, add provider webhooks, idempotency keys, server-side status verification, fraud controls, audit events, and a final payment confirmation screen.

## 13. Safe Realtime tools

`safeLiveToolDeclarations` contains exactly three functions:

### `open_website`

Only valid `https://` URLs are accepted. The UI displays the URL and reason, then opens a new tab only after explicit approval.

### `get_recharge_info`

Read-only account status. It does not charge the user and returns the provider-not-connected state until billing is integrated.

### `start_recharge`

Creates a guarded preview intent after explicit approval. It does not perform a charge.

Never add arbitrary shell, browser automation, payment, or account-security tools directly to the Realtime client. Route high-impact actions through authenticated server procedures and explicit confirmation UI.

## 14. Run locally

```bash
pnpm dev
```

Open `http://localhost:3000` or the HTTPS preview URL.

Test flow:

1. Sign in.
2. Choose JUNI AI or SONA AI.
3. Choose a language.
4. Tap the orb and allow microphone access.
5. Speak naturally.
6. Use the recorder during a session and download the WebM file.
7. Upload an image, PDF, or text file for protected analysis.
8. Open History to view local notes.
9. Open Account to view the safe dashboard state.
10. Ask to open a website or prepare a recharge and verify the confirmation card.

## 15. Validate

```bash
pnpm check
pnpm test
pnpm build
```

The tests cover:

- JUNI and SONA separation;
- OpenAI Realtime model selection;
- exact safe-tool allowlist;
- guarded recharge intent behavior;
- invalid recharge amount rejection;
- authentication logout behavior;
- existing orchestration contracts.

## 16. Common errors

### `OpenAI Realtime is not configured`

`OPENAI_API_KEY` is missing from server secrets. Add it securely and restart the server.

### WebRTC returns an error

Check the API key, Realtime API access, model availability, browser HTTPS, microphone permission, and OpenAI rate limits. Obtain a fresh client secret for every new session.

### No microphone audio

Use HTTPS or localhost, allow microphone access, verify the selected input device, and check browser permissions.

### No remote audio

Confirm the browser tab is not muted, user interaction occurred before starting the session, and the remote audio element is attached to the WebRTC track.

### File analysis fails

Confirm sign-in, file type, file size under 8 MB, `OPENAI_API_KEY`, and the OpenAI Responses API model access.

### A tool opens or charges without confirmation

Treat this as a release-blocking security defect. The current implementation requires visible approval before opening websites or creating recharge intents. Do not bypass it in client code or system instructions.

## 17. Production checklist

- [ ] `OPENAI_API_KEY` is stored in server secrets only.
- [ ] OAuth callback and production origin are configured.
- [ ] Production origin uses HTTPS.
- [ ] OpenAI safety identifier is derived server-side from a stable internal user ID.
- [ ] Realtime session and WebRTC failures are monitored.
- [ ] OpenAI usage and rate limits are monitored.
- [ ] File uploads have retention/deletion policies and malware scanning where appropriate.
- [ ] Recording consent and privacy copy are implemented.
- [ ] Conversation history has user-scoped persistence and deletion/export controls if moved server-side.
- [ ] Payment provider is verified before enabling checkout.
- [ ] `pnpm check`, `pnpm test`, and `pnpm build` pass in CI.
