# JUNI AI API Boundary Audit

**Scope:** Read-only API boundary audit for Step 8. Every discovered externally reachable route, tRPC procedure, client transport, and server provider boundary was inspected. No architecture redesign or application behavior change was made.

**Boundary target:**

```text
Client
  ↓
Server API
  ↓
Validation
  ↓
Authentication
  ↓
Authorization / ownership
  ↓
Business logic
  ↓
Database or provider
  ↓
Response / client-safe error
```

## 1. Discovered API Surfaces

### Externally reachable server routes

| Method | Path | Registration | Classification |
|---|---|---|---|
| GET | `/api/oauth/callback` | `server/_core/oauth.ts`, registered by `server/_core/index.ts` | Canonical authentication callback |
| GET | `/manus-storage/*` | `server/_core/storageProxy.ts`, registered by `server/_core/index.ts` | Required special storage channel; owner authorization is not explicit |
| POST | `/api/trpc` with procedure path | `server/_core/index.ts` and `createExpressMiddleware` | Canonical application API boundary |
| GET | Static/Vite routes | `server/_core/vite.ts` / static serving | Application delivery, not a domain API |

`server/index.ts` contains a second legacy static Express entrypoint but is not referenced by current `package.json` scripts. It is not treated as an active API boundary.

### Client API transports

- `client/src/main.tsx` uses the canonical tRPC `httpBatchLink` to `/api/trpc` with `credentials: "include"`.
- The same tRPC link may add a preview `Authorization: Bearer ...` header from `sessionStorage` when cookie transport is unavailable.
- `client/src/pages/Home.tsx` directly posts SDP to OpenAI Realtime `/v1/realtime/calls` using a temporary client secret. This is a required-special-channel/provider-boundary finding, not a permanent-key exposure.
- No client database import or direct database connection was found.

## 2. API Contract Table

Unknown behavior is explicitly marked `UNKNOWN — MUST VERIFY`; blank cells are not used.

| Procedure/route | Type | Input | Validation | Auth | Owner check | Business logic | DB | Provider | Output | Error |
|---|---|---|---|---|---|---|---|---|---|---|
| `system.health` | query | `timestamp: number` | Zod number, minimum `0`; unknown object fields are stripped by default Zod object behavior | PUBLIC | Not applicable | Returns `{ ok: true }` | None | None | `{ ok: true }` | Validation error for invalid timestamp; tRPC error serialization |
| `system.notifyOwner` | mutation | `title`, `content` strings | Zod strings minimum length 1; no maximum length; unknown fields stripped | ADMIN via `adminProcedure` | Not resource-owner based; role check only | Calls owner notification helper | None | Forge notification endpoint through server helper | `{ success: boolean }` | `FORBIDDEN` for non-admin; provider/helper errors may surface as tRPC errors |
| `auth.me` | query | None | No input | PUBLIC | Current context only; no arbitrary user ID | Returns `ctx.user` | Context authentication reads/updates user via `server/db.ts` | Manus SDK may authenticate/sync | `User | null` | Unauthenticated returns `null`; auth/database sync errors are converted to null context by `createContext` |
| `auth.logout` | mutation | None | No input | PUBLIC | Not applicable | Clears session cookie | None | None | `{ success: true }` | Cookie clearing errors are tRPC/server errors; client handles already-unauthorized state |
| `realtime.createClientSecret` | mutation | `{ persona, language }` | Zod enum derived from `JUNI_PERSONAS` and `SUPPORTED_LANGUAGES`; unknown fields stripped | PROTECTED | Uses `ctx.user.openId` for safety identifier; no resource lookup | Builds persona/language Realtime session configuration | None | OpenAI `/v1/realtime/client_secrets` with server API key | `{ value, model, voice }` | Missing key, provider status/error, or malformed response may surface through thrown Error/tRPC serialization; key not returned |
| `files.analyze` | mutation | `{ name, mimeType, dataUrl }` | Zod name 1–180, MIME 1–120, data URL max 12,000,000 and base64 regex; server permits image, PDF, text/plain; file content treated as untrusted in prompt | PROTECTED | Auth user only; no persisted file owner/resource lookup | Builds image/file analysis input | None in active procedure | OpenAI `/v1/responses` with server API key | `{ name, mimeType, text }` | Validation, unsupported MIME, provider status, provider error message; no permanent key/header returned |
| `account.dashboard` | query | None | No input | PROTECTED | Current `ctx.user` only; no account table | Returns safe preview account state | None | None; provider not connected | User projection, `currency: "PKR"`, `balance: null`, provider-not-connected status/message | Protected auth failure; no provider/database call in procedure |
| `account.getRechargeInfo` | query | None | No input | PROTECTED | `userId` derived from `ctx.user.id`; no account query | Returns safe read-only recharge preview | None | None; provider not connected | `userId`, `currency`, `status`, `balance: null`, `message` | Protected auth failure |
| `account.startRecharge` | mutation | `{ amount }` | Zod finite number, minimum 100, maximum 100,000; unknown fields stripped | PROTECTED | `userId` derived from `ctx.user.id`; no account query | Returns non-billing preview intent | None | None; no checkout provider | `status: "awaiting_provider"`, amount, PKR, userId, `checkoutUrl: null`, message | Validation or protected auth failure |
| `GET /api/oauth/callback` | OAuth callback | Query `code`, `state`; cookie nonce | Manual string checks, OAuth state decode, nonce equality; downstream SDK/provider validation | OAuth flow, no existing app session required | OAuth nonce binds browser; user identity comes from provider `openId` | Exchange code, fetch user info, upsert user, create session | `upsertUser` | Manus OAuth exchange and user-info endpoints | HTTP 302 to `/` on success; JSON error on failure | 400 missing params/identity, 403 invalid state, 500 generic callback failure |
| `GET /manus-storage/*` | storage redirect | Wildcard storage key | Requires non-empty key; no schema/owner validation | PUBLIC route; no explicit auth | NONE in route; Forge-side path policy UNKNOWN | Requests signed GET URL and redirects | None | Forge storage presign endpoint | 307 redirect to signed URL | 400 missing key, 500 unconfigured, 502 Forge/proxy failure |

## 3. Procedure Inventory

### Application router

`server/routers.ts` exports `appRouter` with:

- `system` — imported `systemRouter`.
- `auth.me` — public query.
- `auth.logout` — public mutation.
- `realtime.createClientSecret` — protected mutation.
- `files.analyze` — protected mutation.
- `account.dashboard` — protected query.
- `account.getRechargeInfo` — protected query.
- `account.startRecharge` — protected mutation.

### System router

`server/_core/systemRouter.ts` exports:

- `system.health` — public query.
- `system.notifyOwner` — admin mutation.

### Middleware boundary

`server/_core/trpc.ts` defines:

- `publicProcedure = t.procedure`.
- `protectedProcedure = t.procedure.use(requireUser)`.
- `adminProcedure` — requires a non-null user with role `admin`.

`server/_core/context.ts` creates `ctx.user` using `sdk.authenticateRequest`; authentication failure becomes `user: null` so public procedures can continue.

## 4. Request Validation Audit

### `system.health`

- Input explicitly defined: Yes.
- Schema validation: Yes, Zod object and non-negative timestamp.
- String limits: Not applicable.
- Number limits: Minimum 0; no upper bound.
- Enum restrictions: Not applicable.
- URL validation: Not applicable.
- Uploaded payload limits: Not applicable.
- Unknown fields: Zod object defaults to stripping unknown fields rather than rejecting them.
- Malformed input reaching logic: Zod blocks invalid timestamp before resolver.

### `system.notifyOwner`

- Input explicitly defined: Yes.
- Schema validation: Yes, Zod strings.
- String limits: Minimum one character; no maximum length.
- Number limits/enums/URLs/uploads: Not applicable.
- Unknown fields: Stripped by default.
- Malformed input reaching logic: Invalid empty strings are blocked; excessively large strings are not explicitly bounded.

### `auth.me` and `auth.logout`

- Input explicitly defined: No input.
- Schema validation: No input schema required.
- Malformed input reaching logic: No client payload is consumed.

### `realtime.createClientSecret`

- Input explicitly defined: Yes.
- Schema validation: Yes.
- `persona`: restricted to `juni` or `sona` from shared identity contract.
- `language`: restricted to `en`, `ur`, `hi`, `ar`, or `es` derived from shared language contract.
- Unknown fields: Stripped by default.
- URLs/IDs/pagination/search: Not accepted.
- Malformed input reaching logic: Zod blocks invalid persona/language values.

### `files.analyze`

- Input explicitly defined: Yes.
- `name`: length 1–180.
- `mimeType`: length 1–120.
- `dataUrl`: base64 data URL regex and 12,000,000-character maximum.
- Supported content: images, `application/pdf`, and `text/plain` only.
- Content prompt: explicitly says file instructions are untrusted content.
- Unknown fields: Stripped by default.
- URL validation: Only the data URL regex is applied; no remote URL is accepted by this procedure.
- Malformed input reaching logic: Schema and MIME checks block malformed/unsupported input before the provider call.
- Gap: No explicit byte-size calculation, decompression-bomb defense, malware scanning, or persistent file ownership state.

### Account procedures

- `account.dashboard`: no input.
- `account.getRechargeInfo`: no input.
- `account.startRecharge`: finite amount with inclusive range 100–100,000; unknown fields stripped.
- No IDs, pagination, search, filters, owner IDs, account IDs, or URLs are accepted.

### OAuth and storage routes

- OAuth `code` and `state` are manually checked as strings; nonce equality is required.
- The OAuth state payload is base64 JSON and contains redirect URI plus nonce; callback relies on SDK token exchange validation for code validity.
- Storage wildcard key has only a non-empty check; no explicit path normalization, ownership lookup, or user authentication is performed by the route.

## 5. Authentication Boundary

Protected procedures obtain identity only through `ctx.user` populated by `createContext()` and `sdk.authenticateRequest()`.

No active feature procedure trusts a client-supplied `userId`, `ownerId`, `email`, `role`, or `accountId` for authorization. Account response `userId` values are derived from `ctx.user.id`.

Public procedures are intentionally public, but `auth.me` can return the current authenticated user when a valid session is present. It does not accept an arbitrary identity selector.

## 6. Authorization and Ownership Audit

### Current user-owned operation chain

```text
Authenticated request
  ↓
server resolves ctx.user
  ↓
protectedProcedure checks non-null user
  ↓
procedure uses ctx.user identity or returns preview
  ↓
provider/API operation or response
```

This chain is present for current realtime, file-analysis, and account procedures. There are no active database resource lookups for conversations, messages, stored files, memory, tasks, or research.

### User A / User B conceptual tests

| Scenario | Current route | Expected/observed status |
|---|---|---|
| User A → User A account preview | Account protected procedures | ALLOW; identity derived from A context |
| User A → User B account data | No client owner selector and no account resource query | No current cross-user route; NOT IMPLEMENTED |
| User A → User B conversation | No active conversation procedure | NOT IMPLEMENTED; future route must deny |
| User A → User B file | Analysis is transient; storage proxy has no explicit app owner check | STORAGE OWNER CHECK UNKNOWN; risk remains |
| User A → User B memory/task/research | No active procedures | NOT IMPLEMENTED |
| Unauthenticated → protected resource | `protectedProcedure` | DENY as tRPC `UNAUTHORIZED` |
| Non-admin → `system.notifyOwner` | `adminProcedure` | DENY as tRPC `FORBIDDEN` |

No IDOR-shaped route such as `/resource/:id` or a tRPC input accepting an arbitrary resource ID was found in current app routers.

## 7. Provider Boundary Audit

### Server provider credentials

| Credential | Location | Used by | Browser exposure |
|---|---|---|---|
| `OPENAI_API_KEY` | `server/_core/env.ts` as `ENV.openAiApiKey` | `server/routers.ts` Realtime and Responses calls | Not returned; not found in client source |
| `BUILT_IN_FORGE_API_KEY` | `server/_core/env.ts` as `ENV.forgeApiKey` | LLM, image generation, data API, map, storage, notification, heartbeat, transcription helpers | Not returned by inspected server helpers |
| `DATABASE_URL` | Server/tooling environment | Drizzle config and `server/db.ts` | Not found in client source |
| `JWT_SECRET` | `server/_core/env.ts` as cookie secret | JWT signing/verification | Not returned |
| OAuth server credentials/config | `OAUTH_SERVER_URL`, app ID, server SDK | OAuth exchange/user info | OAuth access token stays server-side during callback |

### Provider paths

- Client → tRPC → `server/routers.ts` → OpenAI Realtime client-secret endpoint.
- Client → tRPC → `server/routers.ts` → OpenAI Responses API for file analysis.
- `server/orchestration.ts` → `server/_core/llm.ts` → Forge chat completions.
- `server/_core/imageGeneration.ts` → Forge ImageService → storage helper.
- `server/_core/dataApi.ts` → Forge WebDevService `CallApi`.
- `server/_core/map.ts` → Forge maps proxy helper path.
- `server/_core/storageProxy.ts` → Forge storage presign endpoint.
- `server/_core/notification.ts` → Forge notification endpoint.
- `server/_core/heartbeat.ts` → Forge scheduled callback mechanism.
- `server/_core/voiceTranscription.ts` → Forge transcription endpoint.
- `server/_core/sdk.ts` → Manus OAuth server through Axios.

Some provider helpers are not reachable through the current `appRouter`; they are framework capabilities or unused helper boundaries, not active domain APIs.

## 8. OpenAI Realtime Boundary

The intended chain is implemented as follows:

```text
Client
  ↓ protected tRPC request
Server `realtime.createClientSecret`
  ↓ server-only OPENAI_API_KEY
OpenAI `/v1/realtime/client_secrets`
  ↓ temporary `value`
Client WebRTC negotiation
```

Verified:

- Authentication is required.
- Persona and language are schema-restricted.
- User identity is taken from `ctx.user.openId`; it cannot be substituted through input.
- The permanent key is only used in server code.
- The browser receives the temporary secret, model, and voice only.
- The generated session includes constrained model, audio, instructions, and `safeLiveToolDeclarations`.

Unknown/partial:

- The exact lifetime and provider-side scope of the returned client secret are not proven by repository code; **UNKNOWN — MUST VERIFY** against provider configuration/API behavior.
- Browser provider-specific WebRTC request/event shapes remain in `Home.tsx`, so the provider contract is not fully isolated behind the server boundary.

## 9. File-Analysis Boundary

```text
Authenticated tRPC request
  ↓
Zod input validation
  ↓
Base64 data URL and MIME validation
  ↓
Prompt states file content is untrusted
  ↓
Server OpenAI Responses request
  ↓
Return name, MIME type, and text only
```

Positive findings:

- Protected procedure.
- Size/shape and MIME allowlist checks.
- Prompt-injection boundary text is included for image and file content.
- Server-only provider key.
- Response is reduced to a small object rather than returning raw provider response.

Gaps:

- No malware scanning, content decompression guard, persistent owner record, retention policy, or delete path.
- Provider error message may be propagated through a thrown `Error`; provider-specific error text may reach the client.
- The procedure does not use `server/storage.ts` or migration-declared `storedFiles`.

## 10. Orchestration Boundary

`server/orchestration.ts` is server-side and calls `invokeLLM` through `server/_core/llm.ts`.

It constructs messages with:

```text
system instructions
  + security boundary statement
history
user request
[UNTRUSTED_CONTEXT_1]
...
[/UNTRUSTED_CONTEXT_1]
```

The `UNTRUSTED_CONTEXT_n` wrapper explicitly states that retrieved content is data only and cannot override system instructions, permissions, or authority. Existing tests verify this envelope and reject empty provider responses.

No current tRPC procedure directly exposes `orchestrateConversation`; therefore no active API route was found that bypasses this envelope by calling this orchestrator with an untrusted context. The active OpenAI Realtime Home path is separate and uses persona instructions plus file prompt warnings rather than this exact orchestration wrapper.

## 11. Database Boundary

### Current persistent API path

The OAuth/authentication path is:

```text
OAuth callback or authenticated request
  ↓
server/_core/sdk.ts / oauth.ts
  ↓
server/db.ts repository helpers
  ↓
Drizzle mysql2 client
  ↓
users table
```

`auth.me` can trigger `authenticateRequest`, which may load/synchronize a user and update `lastSignedIn`. The active feature procedures do not query the database for accounts, conversations, files, memory, tasks, or research.

### Ownership filtering

- `getUserByOpenId` filters by the verified session-derived open ID.
- No active feature query accepts a resource ID or owner ID.
- Migration-declared user-owned tables have no active repository/query path, so ownership filtering is **UNKNOWN — MUST VERIFY** if those tables are used in deployment.

## 12. Response Contracts and Error Safety

### Successful responses

- Public health: `{ ok: true }`.
- Auth current user: `User | null`.
- Logout: `{ success: true }`.
- Realtime: temporary secret value, model, voice.
- Files: name, MIME type, analysis text.
- Account: safe preview objects with nullable `balance`/`checkoutUrl`.
- Owner notification: `{ success: boolean }`.

### Nullable/optional fields

- `auth.me` may return `null`.
- User `name`, `email`, and `loginMethod` are nullable.
- Account `balance` and `checkoutUrl` are always `null` in current preview implementation.
- `files.analyze` always returns `text`, using a fallback string if provider output text is absent.
- Realtime output fields are expected from provider body; missing `value` causes an error rather than a fabricated secret.

### Failure paths

- Authentication failure: context user becomes null; protected route returns `UNAUTHORIZED`.
- Authorization failure: admin route returns `FORBIDDEN`.
- Validation failure: tRPC/Zod error before resolver logic.
- Provider failure: direct thrown `Error` or helper error; exact client-safe serialization depends on tRPC adapter behavior and is **PARTIAL**.
- Database failure: SDK catches/surfaces auth sync failure as generic `ForbiddenError`; lower-level DB helper logs details and throws. No SQL credentials are returned by the inspected paths.
- OAuth callback failure: generic 500 body; detailed error is server-logged.
- Storage provider failure: generic 502 body; Forge response body is server-logged.

Potential leakage risks:

- `files.analyze` and direct OpenAI router calls derive error messages from provider response bodies.
- `server/_core/llm.ts` includes provider HTTP status/status text and response text in thrown errors, though no active appRouter route was found that exposes this helper directly.
- No inspected error path returns provider authorization headers, API keys, database URLs, SQL statements, or stack traces intentionally.

## 13. Error Handling Audit

| Error contract | Location/usage | API behavior |
|---|---|---|
| `BadRequestError` | Shared factory; no current direct use found | No active route mapping proven |
| `UnauthorizedError` | Shared factory; no current direct use found | No active route mapping proven |
| `ForbiddenError` | SDK invalid session/sync/cron/user failures | Authentication context becomes null or OAuth callback returns generic failure |
| `NotFoundError` | Shared factory; no current direct use found | No active route mapping proven |
| `HttpError` | Shared base class | Not the primary tRPC procedure error contract |
| `TRPCError(UNAUTHORIZED)` | `protectedProcedure` | Client-safe auth failure message |
| `TRPCError(FORBIDDEN)` | `adminProcedure` | Client-safe permission failure message |
| Zod validation errors | Router `.input(...)` schemas | tRPC validation response |
| Direct `Error` | Realtime/files/provider calls | May expose provider-derived message through tRPC serialization; requires normalization later |
| Express JSON errors | OAuth/storage routes | Explicit generic/status-specific JSON/text responses |

Current error handling is functional but not normalized into one API error envelope.

## 14. Bypass Paths

| Location/path | Classification | Reason |
|---|---|---|
| `client/src/main.tsx` → `/api/trpc` | CANONICAL | Typed tRPC transport for application procedures |
| `client/src/main.tsx` → `Authorization` fallback | REQUIRED SPECIAL CHANNEL | Preview/WebView cookie fallback; bearer token comes from sessionStorage |
| `client/src/pages/Home.tsx` → OpenAI `/v1/realtime/calls` | REQUIRED SPECIAL CHANNEL / ARCHITECTURE RISK | Browser WebRTC negotiation with temporary secret; permanent key not present |
| `server/_core/oauth.ts` → Manus OAuth | REQUIRED SPECIAL CHANNEL | OAuth callback must exchange authorization code with identity provider |
| `server/_core/storageProxy.ts` → Forge storage presign | REQUIRED SPECIAL CHANNEL | Server storage download redirect |
| `server/_core/sdk.ts` Axios → Manus OAuth | CANONICAL SERVER PROVIDER BOUNDARY | Server-only identity-provider client |
| `server/_core/llm.ts` fetch → Forge LLM | CANONICAL SERVER PROVIDER BOUNDARY | Server-only LLM helper |
| `server/_core/imageGeneration.ts` fetch → Forge ImageService | CANONICAL SERVER PROVIDER BOUNDARY | Server-only image helper |
| `server/_core/dataApi.ts` fetch → Forge WebDevService | CANONICAL SERVER PROVIDER BOUNDARY | Server-only data helper |
| `server/_core/map.ts` fetch → Forge maps proxy | CANONICAL SERVER PROVIDER BOUNDARY | Server helper; client Map also loads public proxy script |
| `server/_core/notification.ts` fetch → Forge notification | CANONICAL SERVER PROVIDER BOUNDARY | Admin/system helper |
| `server/_core/heartbeat.ts` fetch → Forge callback | REQUIRED SPECIAL CHANNEL | Scheduled callback infrastructure; route registration/use must be verified |
| `server/_core/voiceTranscription.ts` fetch → Forge transcription | CANONICAL SERVER PROVIDER BOUNDARY | Helper/example; not exposed by current app router |
| `client/public/__manus__/debug-collector.js` XMLHttpRequest hooks | REQUIRED RUNTIME INSTRUMENTATION | Development/runtime diagnostics; not a domain API |
| `server` imports Drizzle | CANONICAL DATABASE BOUNDARY | Database access is server-side; active queries use `server/db.ts` |
| Client imports `server/routers` as a TypeScript `AppRouter` type | POTENTIAL BOUNDARY LEAK | Type-only import gives client server module path dependency; no runtime server import is intended |

No WebSocket or EventSource application channel was found in the inspected source.

## 15. Client/Server Separation

Expected separation:

```text
client/
  ↓ shared types/contracts
server API
  ↓
server-only secrets/providers/database
```

Findings:

- No `OPENAI_API_KEY`, `DATABASE_URL`, or `JWT_SECRET` reference was found in client source.
- Client uses shared JUNI contracts and typed `AppRouter` binding.
- Client exposes `VITE_FRONTEND_FORGE_API_KEY` to the map proxy; this must be intentionally public/restricted and must not be a privileged Forge secret.
- Client receives a temporary OpenAI Realtime secret by design.
- Client directly contains OpenAI Realtime request/event shapes, which is provider contract leakage but not permanent credential exposure.
- Client type import from `../../../server/routers` couples the browser TypeScript graph to a server module path; it is type-only at runtime but weakens structural package separation.

## 16. API Risk Register

### API-001

- **Severity:** HIGH
- **Location:** `server/_core/storageProxy.ts:5-47`
- **Procedure:** `GET /manus-storage/*`
- **Finding:** Storage redirect route has no explicit authentication or application-level resource-owner check.
- **Security Impact:** A leaked or guessable storage key may permit access to another user’s stored object unless Forge independently enforces authorization.
- **Evidence:** Route validates only non-empty key and Forge configuration before requesting a signed URL.
- **Required Fix:** Verify Forge path authorization and add authenticated owner/resource lookup before issuing signed URLs.
- **V1 Blocker:** YES for persistent user-owned files; NO for current transient file analysis only.

### API-002

- **Severity:** HIGH
- **Location:** `client/src/pages/Home.tsx` and `server/routers.ts`
- **Procedure:** `realtime.createClientSecret` / browser WebRTC negotiation
- **Finding:** Provider-specific OpenAI session negotiation and event handling are split between server and client.
- **Security Impact:** Central provider policy, rate limiting, capability enforcement, and provider replacement are harder to guarantee.
- **Evidence:** Home directly posts to OpenAI `/v1/realtime/calls` after receiving a temporary secret.
- **Required Fix:** Decide and document an accepted WebRTC special-channel boundary or introduce a provider-core/session relay abstraction.
- **V1 Blocker:** NO if explicitly accepted and scoped; YES if strict provider-isolation rule is mandatory.

### API-003

- **Severity:** MEDIUM
- **Location:** `server/routers.ts:146-159`
- **Procedure:** `files.analyze`
- **Finding:** Provider error messages are derived from OpenAI response bodies and may be surfaced through thrown errors.
- **Security Impact:** Provider internals or unexpected upstream details may reach clients; large/untrusted inputs also have resource-pressure risk.
- **Evidence:** `getOpenAiError(body)` returns provider error message; procedure sends client-provided base64 data to provider.
- **Required Fix:** Normalize provider errors to client-safe codes/messages and add byte/resource/malware/retention controls.
- **V1 Blocker:** NO for current preview; YES before production persistent file processing.

### API-004

- **Severity:** MEDIUM
- **Location:** `server/_core/trpc.ts`, `server/routers.ts`
- **Procedure:** All protected user-owned procedures
- **Finding:** Authentication is enforced, but no active resource-level ownership lookup exists for future/migration-declared conversations, messages, or stored files.
- **Security Impact:** Authentication alone would not prevent IDOR when resource endpoints are added.
- **Evidence:** Migration tables contain `userId`, but active schema/repositories/procedures do not expose owner-filtered queries.
- **Required Fix:** Require server-derived owner predicates and cross-user denial tests before adding resource endpoints.
- **V1 Blocker:** YES for user-owned persistence; NO for current preview-only procedures.

### API-005

- **Severity:** MEDIUM
- **Location:** `server/_core/llm.ts`
- **Procedure:** Future/indirect LLM callers of `invokeLLM` and `listLLMModels`
- **Finding:** Helper errors include provider status, status text, and response body text.
- **Security Impact:** Internal provider details may leak if a future route exposes these errors directly.
- **Evidence:** Errors are constructed with `${status} ${statusText} – ${errorText}`.
- **Required Fix:** Normalize errors at the API boundary and keep detailed upstream diagnostics server-side.
- **V1 Blocker:** NO while helper is not exposed; YES before exposing it through public API.

### API-006

- **Severity:** MEDIUM
- **Location:** `client/src/main.tsx`, `server/_core/sdk.ts`
- **Procedure:** All tRPC requests using preview authentication fallback
- **Finding:** Session token may be mirrored into `sessionStorage` and forwarded as a Bearer token.
- **Security Impact:** Same-origin JavaScript/XSS can access the bearer token; logout cannot revoke a copied stateless JWT before expiration.
- **Evidence:** Client reads `manus-cookie` from `sessionStorage`; server accepts `Authorization: Bearer` fallback; JWT lifetime is one year.
- **Required Fix:** Confirm preview threat model; prefer short-lived/revocable fallback tokens or cookie-only production path where feasible.
- **V1 Blocker:** NO for current preview; production risk requires explicit acceptance.

### API-007

- **Severity:** LOW
- **Location:** `server/routers.ts`, shared error module, Express routes
- **Procedure:** All API procedures/routes
- **Finding:** Error contracts are split across Zod, TRPCError, HttpError, direct Error, and Express responses.
- **Security Impact:** Inconsistent client behavior and inconsistent redaction/audit semantics.
- **Evidence:** Multiple error mechanisms are active in inspected source.
- **Required Fix:** Define a shared client-safe error envelope and preserve detailed logs server-side.
- **V1 Blocker:** NO.

### API-008

- **Severity:** LOW
- **Location:** `client/src/lib/trpc.ts`
- **Procedure:** Typed API client
- **Finding:** Client imports `AppRouter` from a server module path.
- **Security Impact:** No direct runtime secret exposure, but it weakens intended package boundaries and can make server implementation accidentally enter the client dependency graph.
- **Evidence:** `import type { AppRouter } from "../../../server/routers"`.
- **Required Fix:** Move the type boundary into a shared/API contract package during controlled architecture work.
- **V1 Blocker:** NO.

### API-009

- **Severity:** INFORMATIONAL
- **Location:** `server/orchestration.ts`
- **Procedure:** `orchestrateConversation`
- **Finding:** Untrusted context is explicitly wrapped in `[UNTRUSTED_CONTEXT_n]` blocks and treated as data.
- **Security Impact:** Positive control; no current route bypass was found.
- **Evidence:** Existing orchestration test verifies the envelope and non-fabrication behavior.
- **Required Fix:** Preserve this contract and add route-level tests if exposed later.
- **V1 Blocker:** NO.

## 17. API Coverage Matrix

| API Area | Discovered | Validated | Auth | Authorization | Input Validation | Error Safety | Provider Boundary | Status |
|---|---:|---:|---|---|---|---|---|---|
| Auth | Yes | Partial | OAuth callback plus public auth procedures | OAuth nonce; user identity derived server-side | Manual query/state checks plus SDK validation | Generic OAuth failure; mixed internal errors | Manus server-side OAuth | PARTIAL — needs session/revocation hardening |
| Account | Yes | Partial | Protected | Current context user only; no account DB owner model | Amount range; no-input queries | Safe preview values; no provider secrets | No billing provider connected | PARTIAL / SAFE PREVIEW |
| Chat | No live procedure | No | N/A | N/A | N/A | N/A | Orchestration helper exists but no route | NOT IMPLEMENTED |
| Voice | Yes | Partial | Protected client-secret issuance | Persona/language and `ctx.user` safety identifier | Zod enum inputs | Permanent key stays server-side; provider errors mixed | Server secret broker plus browser WebRTC special channel | PARTIAL |
| Files | Yes | Partial | Protected analysis | Auth only; no persistent owner lookup | MIME/data URL/name limits | Prompt untrusted boundary; provider errors may leak details | Server OpenAI Responses call | PARTIAL; storage authorization UNKNOWN |
| Research | No | No | N/A | N/A | N/A | N/A | No API found | NOT IMPLEMENTED |
| Memory | No | No | N/A | N/A | N/A | N/A | No API found | NOT IMPLEMENTED |
| System | Yes | Partial | Health public; notification admin | Admin role for notification | Zod timestamp/title/content | Health safe; notification/provider errors mixed | Forge notification for admin helper | PARTIAL |

## 18. Validation Record

Required repository checks were run without changing application behavior:

| Command | Result |
|---|---|
| `pnpm test` | PASS — 3 test files, 8 tests |
| `pnpm check` | PASS — TypeScript completed successfully |
| `pnpm build` | PASS — frontend and server bundles completed; existing chunk-size warning emitted |

The following commands were intentionally not substituted because they are not defined in the current repository: `npm run lint`, `npm run typecheck`, `npm run db:sanity`, `npm run db:validate`, and `npm run security:scan`.

## Boundary Conclusion

The current safe core is the typed tRPC boundary with server-side session authentication, protected procedures, server-held permanent provider credentials, and explicit file-content untrusted prompts. The boundary is **PARTIAL**, not complete: storage retrieval lacks an explicit application owner check, migration-declared resources lack active owner-filtered APIs, provider logic leaks into the browser Realtime flow, and error contracts are not normalized.

No API or application behavior was changed during this audit.
