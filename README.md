# JUNI-AI

JUNI-AI is a lightweight, responsive AI assistant interface with a server-side OpenAI integration.

## Included

- Responsive desktop/mobile chat UI
- Local conversation history
- New chat and clear-history actions
- Light/dark theme persistence
- Starter prompts
- Markdown export
- Keyboard-friendly composer
- Server-side OpenAI Responses API integration
- Bearer access-code authentication
- Per-client request rate limiting
- Request size/history limits
- Security headers and strict same-origin browser policy
- Automated Node.js tests
- GitHub Actions CI
- Vercel deployment configuration
- Demo responses only when the API cannot be reached at all

The frontend never contains the OpenAI API key.

## Local setup

Install dependencies:

```bash
npm install
```

Run the static UI:

```bash
npm run dev
```

Run tests:

```bash
npm test
```

## Environment

Configure:

- `OPENAI_API_KEY` — server-only OpenAI API key
- `OPENAI_MODEL` — model name; defaults to `gpt-5.5`
- `JUNI_API_TOKEN` — bearer access code required by `/api/chat`
- `JUNI_RATE_LIMIT` — requests per rate-limit window; defaults to 20
- `JUNI_RATE_WINDOW_SECONDS` — window size; defaults to 60 seconds
- `JUNI_ALLOWED_ORIGIN` — optional exact browser origin check

The browser stores the bearer access code locally and sends it as:

```
Authorization: Bearer <access-code>
```

This is an access gate, not a per-user identity system. For a public multi-user product, replace the shared bearer token with real identity/session authentication.

## API contract

Request:

```
POST /api/chat
Content-Type: application/json
Authorization: Bearer <access-code>

{
  "message": "Hello",
  "messages": [
    { "role": "user", "content": "Hello" }
  ]
}
```

Response:

```json
{
  "reply": "Hello from JUNI-AI.",
  "requestId": "req_..."
}
```

Messages are capped at 4,000 characters and at most 20 recent conversation turns are sent to the model.

OpenAI's official Node SDK currently recommends the Responses API for model generation. See the official SDK documentation for the current interface and examples.

## Rate limiting

The included limiter is dependency-free and works per running server instance. Serverless platforms can run multiple instances, so use a shared store such as Redis/Upstash before operating at significant traffic.

## Deploy to Vercel

1. Import the repository into Vercel.
2. Keep the project root unchanged.
3. Add `OPENAI_API_KEY` and `JUNI_API_TOKEN` to the project's environment variables.
4. Optionally add the model, rate-limit, and allowed-origin variables.
5. Deploy.

Vercel will serve the static frontend and `api/chat.js` as a serverless function.

## Security

Never commit `.env` files or API keys.

The deployment config adds a restrictive Content Security Policy, clickjacking protection, MIME-sniffing protection, referrer controls, and a permissions policy.

The shared bearer token is a credential. Treat it as sensitive and rotate it when necessary.

## Project structure

```
.
├── api/
│   └── chat.js
├── lib/
│   └── rate-limit.js
├── test/
│   ├── chat.test.js
│   └── rate-limit.test.js
├── app.js
├── index.html
├── styles.css
├── package.json
└── vercel.json
```
