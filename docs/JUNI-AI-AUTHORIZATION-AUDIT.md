# JUNI AI Authentication & Authorization Audit

**Scope:** Read-only authentication and authorization audit for Step 7. No auth provider, session format, login flow, permission, cookie behavior, or application source was changed.

**Important:** This document records repository behavior as inspected. It does not claim that a production deployment has identical runtime configuration unless the repository proves it.

## 1. Authentication Flow

The actual identity chain is:

```text
User
  ↓
client/src/const.ts:startLogin()
  ↓
Manus OAuth portal (/app-auth)
  ↓
GET /api/oauth/callback?code=...&state=...
  ↓
OAuth state nonce cookie validation
  ↓
Manus authorization-code exchange via server/_core/sdk.ts
  ↓
Manus user-info lookup
  ↓
users upsert via server/db.ts
  ↓
Signed HS256 JWT session token
  ↓
app_session_id cookie
  ↓
/api/trpc request
  ↓
server/_core/context.ts:createContext()
  ↓
sdk.authenticateRequest()
  ↓
ctx.user: User | null
  ↓
protectedProcedure/adminProcedure authorization
```

The OAuth callback also supports a preview/WebView fallback path: the browser may send the session token as `Authorization: Bearer ...` when the session cookie is unavailable. The server checks the cookie first and the bearer header second.

## 2. Session Model

### Primary session source

| Item | Actual implementation |
|---|---|
| Source | Server-signed JWT stored in the `app_session_id` cookie |
| Location | `server/_core/sdk.ts` (`createSessionToken`, `signSession`, `verifySession`, `authenticateRequest`) |
| Signing algorithm | HS256 via `jose` |
| Signing secret | Server-side `JWT_SECRET`, exposed in code only through `ENV.cookieSecret` |
| Payload | `openId`, `appId`, `name` |
| Validation | `jwtVerify` with the server secret and allowed algorithm `HS256`; required non-empty payload fields are checked |
| Expiration | One year by default (`ONE_YEAR_MS`); OAuth callback explicitly creates a one-year session |
| Session database | None; the JWT is stateless, while user profile lookup/upsert uses the `users` table |
| OAuth provider token | Used server-side during callback/user sync; not used as the browser session token |
| Preview fallback | Same signed session token may be mirrored in browser `sessionStorage` as `manus-cookie` and sent as a Bearer token |

### Session validation behavior

`authenticateRequest()` reads `app_session_id` from the request cookie. If absent, it accepts an `Authorization` header beginning with `Bearer `. It verifies the JWT, handles cron-prefixed sessions through a separate Manus JWT/user-info path, loads or synchronizes the user through `server/db.ts`, updates `lastSignedIn`, and returns the database-derived `User`.

An invalid/missing session causes the SDK to throw `ForbiddenError("Invalid session cookie")`; `createContext()` catches authentication errors and returns `user: null`. Protected middleware then converts the missing context user into a tRPC `UNAUTHORIZED` error.

## 3. User Context

`TrpcContext` is defined in `server/_core/context.ts`:

```ts
{
  req: Request;
  res: Response;
  user: User | null;
}
```

After successful normal authentication, `ctx.user` is the database-derived `User` shape:

| Field | Availability | Classification |
|---|---:|---|
| `id` | Yes | Private internal identifier |
| `openId` | Yes | Sensitive external identity identifier |
| `name` | Yes, nullable | User data |
| `email` | Yes, nullable | User data / potentially sensitive |
| `loginMethod` | Yes, nullable | Authentication metadata |
| `role` | Yes | Sensitive authorization data |
| `createdAt` | Yes | Private metadata |
| `updatedAt` | Yes | Private metadata |
| `lastSignedIn` | Yes | Private metadata |

Cron sessions can return an extended `AuthenticatedUser` with `taskUid?: string` and `isCron?: boolean`, but the current application router does not expose a user-owned feature procedure specifically for cron sessions.

## 4. Protected Procedures

`protectedProcedure` in `server/_core/trpc.ts` requires `ctx.user` to be truthy. It does not accept a client-supplied owner ID and does not itself perform resource-level ownership checks.

| Router | Procedure | Resource/provider accessed | Authorization check | Side effects |
|---|---|---|---|---|
| `realtime` | `createClientSecret` | OpenAI Realtime client-secret endpoint | Authenticated user required; `ctx.user.openId` used to derive an OpenAI safety identifier | Creates a temporary provider credential; no application database write |
| `files` | `analyze` | OpenAI Responses API | Authenticated user required; input MIME/data URL validated; no persisted file owner record | Sends user-supplied content to OpenAI for analysis; no application database write |
| `account` | `dashboard` | Current account preview | Authenticated user required; response is derived from `ctx.user` | Read-only response |
| `account` | `getRechargeInfo` | Current recharge preview | Authenticated user required; returned `userId` is derived from `ctx.user.id` | Read-only response |
| `account` | `startRecharge` | Recharge intent preview | Authenticated user required; amount validated; returned `userId` is derived from `ctx.user.id` | Returns preview intent only; no payment provider or database write |

No active conversation, message, memory, task, research, or stored-file CRUD procedure was found.

## 5. Public Procedures

| Procedure | Purpose | Why public | User-data access | Side effects |
|---|---|---|---|---|
| `system.health` | Validates a non-negative timestamp and returns `{ ok: true }` | Health checks must work without login | No | No |
| `auth.me` | Returns `ctx.user` or `null` | The client needs to discover current auth state before choosing UI/login behavior | Yes, but only the current authenticated context user; unauthenticated callers receive `null` | No |
| `auth.logout` | Clears the session cookie | Logout must be callable from the current browser auth state and is intentionally idempotent/public | No database/user lookup | Yes: clears `app_session_id` cookie |

`system.notifyOwner` is not public; it uses `adminProcedure` and is documented under admin boundaries.

## 6. Ownership Checks

### Current identity table

The `users` table is the identity root. The OAuth callback and SDK derive the user from the verified session `openId`; the client does not choose the authenticated user for these operations.

### Migration-declared resources

Migration history contains `conversations`, `messages`, and `storedFiles`, but they are absent from the active Drizzle schema, have no active repository queries, and have no current feature procedures. Their ownership checks therefore cannot be verified as implemented.

| Resource | Current owner representation | Server determines owner? | Database restricted to owner? | Status |
|---|---|---:|---:|---|
| User | Verified session `openId` → `users` row | Yes | `getUserByOpenId` uses verified session identity | VERIFY — active identity path exists |
| Conversation | Migration-only `userId` | No active API | No active query | VERIFY / NOT IMPLEMENTED |
| Message | Migration-only `userId` and `conversationId` | No active API | No active query | VERIFY / NOT IMPLEMENTED |
| File | Migration-only `storedFiles.userId`; active analysis is transient | No persisted file owner lookup | No active query | VERIFY / PARTIAL |
| Memory | No table or API | No | No | MISSING |
| Task | No table or API | No | No | MISSING |
| Research | No table or API | No | No | MISSING |

For current account procedures, the server uses `ctx.user.id`; no `request.userId → database query` pattern was found in `server/routers.ts`.

## 7. IDOR Analysis

### User A → User B conversation

- **Current endpoint:** None found.
- **Result:** NOT APPLICABLE to a live procedure; migration-declared table lacks active owner query and FK protection.
- **Required future result:** `FORBIDDEN` or `NOT FOUND`, with a server-side owner predicate.

### User A → User B file

- **Current endpoint:** `files.analyze` is transient and accepts content directly; it does not retrieve a stored file by ID.
- **Storage proxy:** `GET /manus-storage/*` does not perform an application-level authenticated owner check in `server/_core/storageProxy.ts`.
- **Result:** HIGH verification risk for stored-object access; actual Forge path authorization is unknown.

### User A → User B memory/task/research

- **Current endpoint:** None found.
- **Result:** MISSING rather than exploitable through a current route.

No endpoint was found that accepts an arbitrary `userId` and blindly queries user-owned resources. This is a positive finding for current routers, not proof that future resource authorization is designed.

## 8. Admin / Role Boundaries

Administrative functionality exists in a narrow form:

- `users.role` is a MySQL enum with `user` and `admin`.
- `adminProcedure` requires `ctx.user.role === "admin"`.
- `system.notifyOwner` is the only current admin procedure found.
- `upsertUser` promotes the configured `OWNER_OPEN_ID` to `admin` when an explicit role is not supplied.
- No `isAdmin` field or separate permissions table was found.
- No admin UI route was found.

`system.notifyOwner` accepts `title` and `content`, requires admin authorization, and triggers the owner notification integration. Ordinary authenticated users receive `FORBIDDEN` through `adminProcedure`.

## 9. Account Authorization

| Procedure | Authentication | Authorization/ownership | Side effect | External provider |
|---|---|---|---|---|
| `account.dashboard` | `protectedProcedure` | Uses current `ctx.user`; no client owner ID | None; returns safe preview | None; provider not connected |
| `account.getRechargeInfo` | `protectedProcedure` | Returned `userId` is `ctx.user.id`; no account table/query | None; read-only preview | None; provider not connected |
| `account.startRecharge` | `protectedProcedure` plus amount schema | Returned `userId` is `ctx.user.id`; no client owner ID | No charge, checkout, or database write | None; returns `awaiting_provider` preview |

The account surface does not expose a real balance or claim a successful payment. `balance` and `checkoutUrl` are `null`, and messages state that a verified billing provider is not connected.

## 10. Voice Authorization

The current voice credential chain is:

```text
Authenticated user
        ↓
protectedProcedure: realtime.createClientSecret
        ↓
server checks OPENAI_API_KEY
        ↓
server constructs persona/language session configuration
        ↓
server calls OpenAI client_secrets endpoint with permanent key
        ↓
server returns temporary client secret value
        ↓
browser uses temporary value for WebRTC negotiation
```

Positive findings:

- `realtime.createClientSecret` is protected.
- `OPENAI_API_KEY` is read from server `ENV` and is not returned.
- The response exposes only a temporary client secret, model, and voice.
- The OpenAI safety identifier is derived from a SHA-256 hash of `ctx.user.openId` rather than exposing the raw open ID in that header.

Boundary finding:

- `Home.tsx` directly negotiates with OpenAI using the temporary secret and contains provider-specific session/event shapes. This is a provider-boundary architecture concern, but the permanent API key remains server-side.

## 11. File Authorization

### Upload/input

`files.analyze` is protected and validates `name`, `mimeType`, and base64 `dataUrl` shape/length. Supported content is limited to images, PDF, and plain text.

### Analysis

Analysis is performed server-side through OpenAI Responses API using the server-only `OPENAI_API_KEY`. The input prompt tells the model to treat file instructions as untrusted content. The user’s `openId` is represented in an OpenAI safety identifier hash.

### Storage

The active analysis procedure does not persist a file record. Migration history contains a `storedFiles` table, but it is absent from the active schema and application queries.

### Retrieval

`GET /manus-storage/*` redirects to a Forge-signed URL without an explicit application-level authenticated owner check. Forge storage authorization/path secrecy is unknown.

### Deletion

No file deletion procedure, retention policy, archive state, or delete coordination was found.

**Status:** Analysis input is protected; durable upload/storage/retrieval/deletion authorization is partial or unknown.

## 12. Secret Exposure

Searches found no `OPENAI_API_KEY` or `DATABASE_URL` in browser source. The permanent provider credentials are accessed in server code through `ENV`.

| Secret/token surface | Location | Finding |
|---|---|---|
| `OPENAI_API_KEY` | `server/_core/env.ts`, server router/provider calls | Server-only in inspected source |
| `DATABASE_URL` | `server/_core/env.ts`, `drizzle.config.ts`, `server/db.ts` | Server/tooling only in inspected source |
| `JWT_SECRET` | Server environment → `ENV.cookieSecret` | Server-only in inspected source |
| Forge API key | Server `ENV.forgeApiKey` for server helpers/proxy | Server-only in server code |
| `VITE_FRONTEND_FORGE_API_KEY` | `client/src/components/Map.tsx` | Intentionally browser-exposed frontend configuration; must be a restricted public/proxy credential, not a privileged secret |
| Temporary OpenAI client secret | Returned by protected procedure to browser | Expected short-lived browser credential; not the permanent API key |
| Session token | Cookie and preview fallback `sessionStorage`/Bearer header | Sensitive credential; fallback increases exposure to browser JavaScript/XSS compared with HttpOnly cookie-only flow |

No actual secret values are copied into this audit.

## 13. Cookie Security

### Session cookie: `app_session_id`

Configured by `getSessionCookieOptions(req)` and set by the OAuth callback.

| Attribute | Actual value/status | Classification |
|---|---|---|
| HttpOnly | `true` | SECURE |
| Secure | True when request protocol or trusted forwarded protocol is HTTPS; false for local HTTP | SECURE in HTTPS deployment; expected local-development exception |
| SameSite | `none` | WEAK / deployment-dependent: requires Secure in modern browsers and permits cross-site sending; likely required by the preview/iframe environment |
| Path | `/` | SECURE / broad by application design |
| Domain | Undefined; host-only cookie | SECURE |
| Expiration | `maxAge: ONE_YEAR_MS`; JWT also expires after one year | WEAK from a least-lifetime perspective; long-lived session |

### OAuth state cookie: `__Host-oauth_state`

Written by `client/src/const.ts` with `Path=/; Max-Age=600; SameSite=None; Secure`.

| Attribute | Actual value/status | Classification |
|---|---|---|
| HttpOnly | Not set because browser JavaScript writes it | EXPECTED for current client-generated nonce, but exposed to same-origin script |
| Secure | Explicitly set | SECURE |
| SameSite | `none` | WEAK / deployment-dependent; permits cross-site sending but supports OAuth portal flow |
| Path | `/` | SECURE |
| Domain | No Domain attribute; `__Host-` prefix requires host-only semantics | SECURE |
| Expiration | 600 seconds | SECURE for a short-lived OAuth state nonce |

The OAuth state cookie is cleared after nonce validation. The session cookie is cleared by `auth.logout`.

## 14. Session Expiration

- **Lifetime:** One year for the normal session JWT and cookie.
- **Refresh mechanism:** No refresh-token mechanism was found. The SDK may synchronize user profile data when a valid session identifies a user, but it does not extend the JWT expiration.
- **Logout behavior:** Clears the browser session cookie and client-side auth cache; it does not revoke a stateless JWT server-side.
- **Expired-session behavior:** `jwtVerify` rejects the token; SDK returns no authenticated user; `createContext` sets `user: null`; protected procedure returns `UNAUTHORIZED`.
- **Preview fallback:** A session token in `sessionStorage` may remain usable until JWT expiration unless logout clears it or the token expires.

## 15. Logout

The actual logout chain is:

```text
User clicks logout
  ↓
useAuth.logout()
  ↓
trpc.auth.logout.mutateAsync()
  ↓
server clears app_session_id with matching cookie options and maxAge -1
  ↓
client removes manus-cookie from sessionStorage
  ↓
client sets auth.me cache to null
  ↓
client invalidates auth.me query
```

`auth.logout` is intentionally public and returns `{ success: true }`. If the client receives an `UNAUTHORIZED` logout error, `useAuth` treats it as already logged out and still clears local state in `finally`.

There is no server-side JWT revocation list or database session record. Logout therefore removes the browser’s normal credential but does not invalidate an already copied stateless token before its expiration.

## 16. Error Handling

| Condition | Current error/status | Classification |
|---|---|---|
| Missing/invalid protected auth | tRPC `UNAUTHORIZED`, message `Please login (10001)` | Appropriate authentication distinction |
| Non-admin calling admin procedure | tRPC `FORBIDDEN`, message `You do not have required permission (10002)` | Appropriate authorization distinction |
| OAuth missing code/state | HTTP 400 with generic error | Appropriate bad request |
| OAuth invalid state | HTTP 403 with `invalid oauth state` | Appropriate CSRF rejection |
| Missing user from OAuth info | HTTP 400 | Appropriate malformed identity response |
| OAuth callback internal failure | HTTP 500 generic message; server logs details | Does not expose internal error to caller |
| File invalid MIME/data shape | tRPC validation/error response | Input rejection |
| Provider unavailable | Direct `Error` with configuration/provider message | Functional, but error style is not normalized |
| Missing resource | No current feature resource route | NOT APPLICABLE |

The repository also defines `HttpError` and convenience factories, while tRPC uses `TRPCError` and routers use direct `Error`. Error taxonomy is therefore mixed and should be consolidated later.

## 17. User Enumeration

Findings:

- `auth.me` returns `null` to unauthenticated callers and the current authenticated user to that user; it does not accept an arbitrary user ID.
- No public user search, email lookup, or user-by-ID route was found.
- Account routes are protected and derive identity from `ctx.user`.
- OAuth callback error messages reveal validation state (`code and state required`, `invalid oauth state`, `openId missing`) but do not expose an arbitrary user directory.
- `auth.me` returns the authenticated user object, including internal `id`, `openId`, `role`, and timestamps, to that same authenticated browser. This is self-disclosure, not cross-user enumeration, but it is broader than the minimum UI profile shape.

**Status:** No cross-user enumeration route found; self-profile output is broader than strictly necessary.

## 18. Client vs Server Authorization

The UI uses auth state to decide whether to show login/account controls, but server middleware remains the real authorization boundary:

- `useAuth` is a client convenience and does not grant access.
- `protectedProcedure` checks `ctx.user` server-side.
- `adminProcedure` checks the server-side role.
- Account/realtime/file procedures derive identity server-side.
- Home confirmation cards are UX consent controls, not substitutes for server authorization.

Boundary concern:

- The client directly performs OpenAI WebRTC negotiation after receiving a temporary secret. The permanent credential is not exposed, but provider-specific session logic is still in browser code.

## 19. Memory Authorization Readiness

Memory is not currently implemented. Before Section 26, the required authorization chain should be designed as:

```text
Memory record
  ↓
ownerId / owner relation
  ↓
authenticated ctx.user
  ↓
explicit permission and visibility policy
  ↓
owner-restricted memory access
```

Model-inferred memory must not bypass user approval. No current table, procedure, or client behavior creates or returns memory records.

## 20. Sensitive Data Boundaries

Future memory must distinguish:

1. Normal user-accessible memory.
2. Sensitive memory requiring additional permission or visibility controls.
3. System memory that ordinary users must never receive merely because they are authenticated.

The current repository has no database or API contract for these classes. The existing `role` boundary is an admin role, not a sensitive-memory visibility policy.

## 21. Provenance Authorization

Future provenance records must be scoped through the owning resource:

```text
resource owner
  ↓
authorized provenance for that resource
```

The current repository has no persisted provenance records. Authentication alone must not become permission to read all provenance across users, providers, or system operations.

## 22. Security Findings

### HIGH

**AUTH-H-01 — Stateless one-year bearer sessions have no server-side revocation.** The session JWT is valid until expiration if copied, even after logout. The preview fallback intentionally places the bearer token in `sessionStorage`, increasing exposure to same-origin JavaScript compromise compared with the HttpOnly cookie path.

**AUTH-H-02 — Storage proxy has no explicit application-level owner authorization.** `GET /manus-storage/*` checks a path and Forge configuration but does not authenticate the caller or look up the owner of the requested object. Forge-side path authorization is unknown.

**AUTH-H-03 — Migration-declared user-owned resources have no active authorization path.** Conversations, messages, and stored files appear in migration history but not active schema/query/router code; ownership enforcement cannot be demonstrated.

### MEDIUM

**AUTH-M-01 — Session lifetime is one year.** This is long for a browser bearer credential and is not paired with refresh/revocation infrastructure.

**AUTH-M-02 — Browser provider boundary is not fully isolated.** Home contains OpenAI Realtime WebRTC negotiation and provider event shapes. The permanent key remains server-only, but the provider contract leaks into the client.

**AUTH-M-03 — `auth.me` returns a broad `User` object.** The public procedure is safe for current-user discovery but exposes internal ID, open ID, role, and timestamps to the authenticated client without a minimal profile projection.

**AUTH-M-04 — Cookie SameSite/secure behavior is deployment-sensitive.** `SameSite=None` is used for both OAuth/session compatibility and requires Secure in modern browsers; local HTTP mode sets the session cookie `secure: false`, which may behave differently across browsers.

**AUTH-M-05 — Error taxonomy is mixed.** `TRPCError`, `HttpError`, direct `Error`, and Express JSON errors coexist, complicating consistent client handling and audit logging.

### LOW

**AUTH-L-01 — No dedicated authorization tests for protected/admin rejection.** Existing tests cover logout, recharge amount validation, persona/tool contracts, and orchestration, but not unauthenticated protected calls, non-admin calls, or cross-owner resource queries.

**AUTH-L-02 — No route-level browser security tests.** OAuth state-cookie behavior, logout in a browser, and token fallback are not covered by an E2E suite.

### INFO

**AUTH-I-01 — No permanent provider credential was found in client code.** This is a positive result from static search.

**AUTH-I-02 — No active user-owned memory/task/research APIs exist.** Current IDOR risk for those domains is missing functionality rather than a demonstrated exploitable route.

## 23. Required Fixes

No fixes are implemented in Step 7. Required follow-up before expanding user-owned features:

1. Verify and protect the storage download path with authenticated owner/resource checks or prove equivalent Forge authorization.
2. Decide whether the one-year stateless session and `sessionStorage` bearer fallback meet the production threat model; document revocation and token-rotation requirements.
3. Reconcile migration-declared resource tables with the active schema before exposing conversations, messages, or stored files through APIs.
4. Add owner predicates and authorization tests for every user-owned resource before implementing Memory, Tasks, Research, or persistent Files.
5. Define minimal auth/profile response projections instead of returning the full `User` object from `auth.me` where possible.
6. Normalize authentication/provider/resource errors into a documented error contract.
7. Add tests for unauthenticated protected calls, non-admin admin calls, invalid OAuth state, expired session behavior, and resource-owner isolation.
8. Keep the permanent OpenAI key server-only and decide whether WebRTC provider negotiation is an accepted explicit architecture exception.
9. Define sensitive-memory, system-memory, approval, consent, and provenance authorization before Memory implementation.

## Validation Record

Required checks were run without changing authentication behavior:

| Command | Result |
|---|---|
| `pnpm test` | PASS — 3 test files, 8 tests |
| `pnpm check` | PASS — TypeScript completed successfully |
| `pnpm build` | PASS — frontend and server bundles completed; existing chunk-size warning emitted |

No login flow, session format, permission, cookie configuration, or source behavior was changed.
