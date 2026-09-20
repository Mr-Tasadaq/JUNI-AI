# JUNI-AI

JUNI-AI is a lightweight, responsive AI assistant interface that can run as a static site and connect to a backend later.

## What is included

- Responsive chat interface for desktop and mobile
- Recent conversation history stored in the browser
- New chat and clear-history actions
- Light/dark theme toggle with preference persistence
- Starter prompts for common tasks
- Markdown export of the active conversation
- Character counter and keyboard-friendly composer
- Reduced-motion support
- Safe client/server boundary: no model API key is required in the browser
- Demo-mode responses when no `/api/chat` endpoint is available

## Run locally

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Connect a real AI backend

The browser sends:

```
POST /api/chat
Content-Type: application/json

{
  "message": "Hello",
  "messages": [
    { "role": "user", "content": "Hello" }
  ]
}
```

Return JSON:

```json
{ "reply": "Hello from your model." }
```

Keep provider API keys and privileged credentials on the server. Do not put secrets into frontend code.

## Current project status

The original repository contained only a heading in `README.md`. This starter establishes a usable product surface without assuming a specific AI provider or exposing credentials.

## Recommended next layer

1. Add a small server route at `/api/chat`.
2. Add authentication and rate limiting.
3. Add server-side model selection and configuration.
4. Add automated tests for the API contract and chat state.
5. Add deployment configuration after the backend choice is known.
