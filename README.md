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

Or use any static server:

```bash
python -m http.server 8000
```

Run tests:

```bash
npm test
```

## Environment

Copy `.env.example` to your local environment and configure:

- `OPENAI_API_KEY` — server-only OpenAI API key
- `OPENAI_MODEL` — model name; defaults to `gpt-5.5`
- `JUNI_API_TOKEN` — bearer access code required by `/api/chat`
- `JUNI_RATE_LIMIT` — requests per rate-limit window; defaults to 20
- `JUNI_RATE_WINDOW_SECONDS` — window size; defaults to 60 seconds
- `JUNI_ALLOWED_ORIGIN` — optional exact origin check for browser requests

The web app stores the bearer access code locally on the user's device and sends it as:

```
Authorization: Bearer <access-code>
```

This is an access gate, not a substitute for per-user identity. For a public multi-user product, replace the shared bearer token with a real identity/session system.

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

The server limits messages to 4,000 characters and replays at most 20 recent messages to the model.

OpenAI's official Node SDK currently recommends the Responses API for model generation. citeturn538958search0turn538958search2

## Rate limiting

The included limiter is intentionally dependency-free and works in a single serverless/runtime instance. Serverless platforms can run multiple instances, so this should be upgraded to a shared store such as Redis/Upstash before operating at significant traffic.

## Deploy to Vercel

1. Import the GitHub repository into Vercel.
2. Keep the project root unchanged.
3. Add the environment variables in the Vercel project settings:
   - `OPENAI_API_KEY`
   - `JUNI_API_TOKEN`
   - optionally `OPENAI_MODEL`, `JUNI_RATE_LIMIT`, `JUNI_RATE_WINDOW_SECONDS`, and `JUNI_ALLOWED_ORIGIN`
4. Deploy.

Vercel will serve the static files and the `api/chat.js` serverless function from the same project.

## Security notes

Never commit `.env` files or API keys.

The repository includes browser security headers through `vercel.json`, including a restrictive Content Security Policy, clickjacking protection, and MIME-sniffing protection.

The shared bearer token should be treated as a credential. Do not put the OpenAI key into the browser or share it with users.

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
