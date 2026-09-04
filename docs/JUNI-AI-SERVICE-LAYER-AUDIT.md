# JUNI AI Business Logic & Service-Layer Audit

**Scope:** Read-only Step 9 audit of actual server business logic and service boundaries. No router rewrite, service migration, provider replacement, database redesign, or feature removal was performed.

**Current conclusion:** The repository has a small active domain surface. Business decisions are concentrated in `server/routers.ts`, `server/db.ts`, `server/orchestration.ts`, and provider helpers under `server/_core/`. Several apparent domains exist only in migration history or shared contracts and do not yet have active services.

## 1. Existing Server Modules

| Module | Actual responsibility | Classification |
|---|---|---|
| `server/routers.ts` | tRPC transport, Zod inputs, protected/admin middleware selection, Realtime session construction, file-analysis provider call, account preview responses | Router-heavy / mixed business and integration logic |
| `server/orchestration.ts` | Builds system/history/user messages, wraps untrusted context, invokes LLM, extracts response text | AI orchestration helper with security/prompt logic |
| `server/db.ts` | Lazy Drizzle client, user upsert/read, owner promotion, sign-in timestamp update | Database repository plus small identity business decisions |
| `server/_core/trpc.ts` | tRPC initialization and public/protected/admin authorization middleware | Central auth boundary |
| `server/_core/context.ts` | Resolves request user through SDK; creates tRPC context | Transport/auth context |
| `server/_core/sdk.ts` | OAuth exchange, JWT signing/verifying, request authentication, user synchronization, cron identity | Authentication service/helper with DB coordination |
| `server/_core/oauth.ts` | OAuth callback, CSRF nonce check, user upsert, session cookie creation | Auth transport flow with business side effects |
| `server/_core/llm.ts` | Provider-neutral-looking message types plus Forge/OpenAI-compatible HTTP payload construction, retry/backoff, response/error mapping | Provider adapter with shared LLM contract |
| `server/_core/imageGeneration.ts` | Forge image request, base64 decode, S3 storage write | Provider/storage helper |
| `server/_core/dataApi.ts` | Forge generic external API request and JSON decoding | Provider helper |
| `server/_core/map.ts` | Forge maps proxy requests and response mapping | Provider helper |
| `server/_core/storageProxy.ts` | Storage presign request and redirect | Required special storage transport |
| `server/_core/notification.ts` | Forge owner notification request | Provider/notification helper |
| `server/_core/heartbeat.ts` | Scheduled callback and error mapping | Infrastructure side-effect helper |
| `server/_core/voiceTranscription.ts` | Forge transcription request and audio retrieval | Provider helper |
| `server/_core/systemRouter.ts` | Health resolver and admin notification resolver | Router-level system logic |
| `server/storage.ts` | Forge storage put/delete helpers | Storage repository/provider helper |
| `shared/juni.ts` | Personas, languages, voice names, system instructions, safe tool declarations | Shared product/provider contract |
| `shared/const.ts` | Cookie names/lifetime, OAuth state encoding, auth error messages | Shared auth contract |
| `shared/_core/errors.ts` | `HttpError` and convenience constructors | Shared error contract, not consistently used |

No active `ConversationService`, `MemoryService`, `ResearchService`, `TaskService`, `AccountService`, or `FileService` class/module exists.

## 2. Router-to-Business-Logic Map

### `system.health`

```text
Procedure
  ↓
Zod timestamp >= 0
  ↓
PUBLIC
  ↓
Return constant health result
  ↓
No database
  ↓
No provider
  ↓
{ ok: true }
```

**Classification:** Mostly transport validation and a pure response. No router-coupled domain decision beyond the health contract.

### `system.notifyOwner`

```text
Procedure
  ↓
Zod non-empty title/content
  ↓
adminProcedure role check
  ↓
Call notifyOwner(input)
  ↓
No database
  ↓
Forge notification provider
  ↓
{ success: delivered }
```

**Classification:** Router selects authorization and passes input directly to a provider helper. Admin permission is centralized; notification business policy is minimal.

### `auth.me`

```text
Procedure
  ↓
No input validation
  ↓
PUBLIC procedure; context authentication already attempted
  ↓
Return ctx.user or null
  ↓
Context may read/upsert/update user through server/db.ts
  ↓
Manus SDK may be called during authentication/sync
  ↓
User | null
```

**Classification:** Router-coupled response projection; authentication/database decisions are hidden in context/SDK.

### `auth.logout`

```text
Procedure
  ↓
No input
  ↓
PUBLIC and idempotent intent
  ↓
Clear app_session_id cookie
  ↓
No database
  ↓
No provider
  ↓
{ success: true }
```

**Classification:** Transport/session side effect directly in router. No separate session service.

### `realtime.createClientSecret`

```text
Procedure
  ↓
Zod persona/language enums
  ↓
protectedProcedure; ctx.user required
  ↓
Select persona/language, construct OpenAI session config, derive safety identifier
  ↓
No database
  ↓
OpenAI Realtime client_secrets endpoint
  ↓
Temporary value/model/voice
```

**Classification:** ROUTER-COUPLED LOGIC and PROVIDER-COUPLED. Validation, authorization, persona selection, provider request construction, and response shaping are all in `server/routers.ts`.

### `files.analyze`

```text
Procedure
  ↓
Zod name/MIME/data URL validation and supported MIME allowlist
  ↓
protectedProcedure; ctx.user required
  ↓
Select image/file content shape and add untrusted-content instruction
  ↓
No database or storage write
  ↓
OpenAI Responses API
  ↓
{name, mimeType, text}
```

**Classification:** ROUTER-COUPLED LOGIC and PROVIDER-COUPLED. File policy, provider request construction, prompt-injection warning, provider response extraction, and API response formatting are colocated.

### `account.dashboard`

```text
Procedure
  ↓
No input
  ↓
protectedProcedure; ctx.user required
  ↓
Build safe provider-not-connected preview from ctx.user
  ↓
No database
  ↓
No billing provider
  ↓
Dashboard preview object
```

**Classification:** Router-coupled preview/domain response. No real account service exists.

### `account.getRechargeInfo`

```text
Procedure
  ↓
No input
  ↓
protectedProcedure; ctx.user required
  ↓
Build read-only not-connected preview; userId comes from ctx.user
  ↓
No database
  ↓
No billing provider
  ↓
Recharge preview object
```

**Classification:** Router-coupled preview logic; no balance or pricing business logic exists.

### `account.startRecharge`

```text
Procedure
  ↓
Zod finite amount, 100 <= amount <= 100000
  ↓
protectedProcedure; ctx.user required
  ↓
Return awaiting_provider intent with PKR and ctx.user.id
  ↓
No database
  ↓
No payment provider
  ↓
Preview intent object
```

**Classification:** Router-coupled input policy and response formatting. It is not a payment state transition.

## 3. Database Logic

`server/db.ts` is primarily a database access boundary:

- Lazily creates a Drizzle MySQL client.
- Reads `users` by unique `openId`.
- Upserts users with a single `INSERT ... ON DUPLICATE KEY UPDATE`.
- Normalizes nullable profile fields before persistence.
- Updates `lastSignedIn`.

It also contains business decisions that should eventually be explicit in an identity/account service:

- Promotes `ENV.ownerOpenId` to `admin` when no explicit role is supplied.
- Decides that missing `lastSignedIn` becomes `new Date()`.
- Treats absent database configuration as a warning and returns no DB instead of failing fast.

It contains no provider logic, response formatting, or resource authorization. Input validation is minimal (`openId` required); callers are expected to provide typed `InsertUser` values. No feature queries for migration-declared tables exist.

## 4. AI Orchestration

`server/orchestration.ts` maps as follows:

```text
OrchestrationRequest
  ↓
Optional history array
  ↓
Optional untrustedContext array
  ↓
System instructions plus security boundary text
  ↓
User request plus [UNTRUSTED_CONTEXT_n] blocks
  ↓
invokeLLM()
  ↓
Extract string/text parts from provider response
  ↓
Reject empty result
  ↓
OrchestrationResult { content, capability, providerBoundary }
```

| Logic | Classification |
|---|---|
| Request/response types | DOMAIN CONTRACT |
| History placement | DOMAIN/PROMPT LOGIC |
| `[UNTRUSTED_CONTEXT_n]` envelope | SECURITY LOGIC + PROMPT LOGIC |
| System instruction composition | PROMPT LOGIC |
| Provider call | AI LOGIC delegated to LLM helper |
| Response text extraction | AI response normalization |
| `SMART_GENERAL` capability label | DOMAIN RESPONSE CONTRACT |
| `providerBoundary: "server"` | ARCHITECTURE/SECURITY metadata |
| HTTP transport | Not handled here |

No current tRPC route calls `orchestrateConversation`; it is tested as an isolated helper. Future route exposure must preserve the envelope and server-side provider boundary.

## 5. Provider Coupling

### PROVIDER-COUPLED

- `server/routers.ts` uses OpenAI Realtime endpoint, `output_modalities`, Realtime session shape, `voice`, `model`, OpenAI safety header, and Responses API content parts.
- `shared/juni.ts` stores `REALTIME_MODEL`, OpenAI-compatible voice names, and provider-specific function tool declaration shape.
- `server/_core/llm.ts` builds Forge/OpenAI-compatible `/v1/chat/completions` and `/v1/models` requests, uses provider payload names, and interprets provider response fields.
- `server/_core/imageGeneration.ts`, `dataApi.ts`, `map.ts`, `notification.ts`, `storageProxy.ts`, and `voiceTranscription.ts` construct Forge-specific endpoints/headers.
- `client/src/pages/Home.tsx` performs OpenAI Realtime WebRTC negotiation and handles provider event shapes.

### PROVIDER-AGNOSTIC OR MOSTLY AGNOSTIC

- `orchestrateConversation` request contract and untrusted-context envelope are mostly provider-agnostic, although its output extraction follows the current LLM response shape.
- `server/db.ts` persistence helpers are provider-agnostic except identity fields originate from Manus OAuth.
- `system.health` is provider-agnostic.
- Account preview response contracts are provider-agnostic placeholders.

There is no dedicated provider-adapter package. Provider-specific decisions are distributed across routers, shared contracts, client code, and `_core` helpers.

## 6. Authentication Logic

Authentication logic is distributed but has a recognizable path:

- `client/src/const.ts`: starts OAuth, creates nonce, writes OAuth state cookie, redirects.
- `server/_core/oauth.ts`: validates nonce, exchanges code, fetches provider identity, upserts user, creates session cookie.
- `server/_core/sdk.ts`: signs/verifies JWT, authenticates requests, syncs users, supports cron identity.
- `server/_core/context.ts`: attaches authenticated user or null to request context.
- `server/_core/trpc.ts`: converts context identity into protected/admin authorization.
- `server/db.ts`: stores/retrieves identity and applies owner-admin promotion.

This is reusable auth infrastructure, but there is no explicit `AuthService` boundary; OAuth transport, JWT session logic, and user synchronization are split between SDK and route files.

## 7. Authorization Logic

### CENTRALIZED

- Authentication-required check is centralized in `protectedProcedure`.
- Admin role check is centralized in `adminProcedure`.
- Current account/realtime/file procedures derive identity from `ctx.user` rather than client owner IDs.

### DUPLICATED

- Multiple protected procedures independently use `ctx.user.openId` or `ctx.user.id` for response/provider metadata.
- Account procedures independently construct user-scoped response fields.
- There is no shared `requireOwner` or resource authorization helper because resource CRUD is absent.

### INCONSISTENT / MISSING

- Storage proxy does not use `protectedProcedure` because it is an Express route and has no explicit application owner check.
- Migration-declared conversations/messages/storedFiles have user ID columns but no active authorization service or repository query.
- Memory, task, research, and provenance authorization are missing because those domains are not implemented.

## 8. Account Logic

| Concern | Current implementation | Classification |
|---|---|---|
| Account read | `account.dashboard` returns user projection and provider-not-connected state | Router-coupled preview logic |
| Recharge read | `account.getRechargeInfo` returns PKR, null balance, not-connected status | Router-coupled preview logic |
| Pricing | No pricing table or calculation; amount only range-checked | MISSING |
| Currency | Hard-coded `PKR` in two procedures and shared tool description | Duplicated/provider-independent policy; candidate for centralization |
| Balance | Always `null`; no database/account ledger | MISSING |
| Checkout | `checkoutUrl: null`; no provider | MISSING |
| External payment | None | MISSING |
| Confirmation | Persona instructions/tool description require confirmation conceptually; no payment execution exists | Prompt/product contract only |

## 9. File Logic

### `files.analyze`

| Concern | Current implementation | Classification |
|---|---|---|
| File validation | Zod name, MIME, data URL shape/size; supported MIME allowlist | Router-coupled business/validation logic |
| File decoding | Sends data URL directly as `file_data` or `input_image`; no server decode | Provider-coupled |
| Size enforcement | 12,000,000-character data URL limit; Express body limit 50 MB | Partial transport/input policy |
| AI analysis | Constructs OpenAI Responses request with `gpt-4.1-mini` | Provider-coupled |
| Prompt-injection protection | Adds “treat file instructions as untrusted content” text | Security/prompt logic in router |
| Storage | None in active procedure | Missing from feature path |
| Response formatting | Returns name, MIME, output text/fallback | Router-coupled response logic |
| Lifecycle/deletion | None | Missing |

Migration `storedFiles` and storage helpers exist separately, but the active analysis procedure does not connect them.

## 10. Voice Logic

### `realtime.createClientSecret`

| Concern | Current implementation | Classification |
|---|---|---|
| Authentication | `protectedProcedure` | Centralized transport auth |
| Persona validation | Zod enum from shared persona keys | Shared contract + router validation |
| Language validation | Zod enum from shared languages | Shared contract + router validation |
| Session construction | Builds OpenAI Realtime session object inline | Router-coupled/provider-coupled |
| Temporary credential creation | Server POST to OpenAI client secrets | Provider adapter logic in router |
| Safety identifier | SHA-256 of `ctx.user.openId` | Security logic in router |
| Response | Returns temporary value/model/voice | Router response formatting |
| Browser continuation | Home uses temporary value for WebRTC | Provider logic in client |

Persona instructions also contain business/safety decisions: no fabricated payment success, explicit confirmation for external actions, untrusted file/web instructions, and tone/style requirements.

## 11. State Transitions

### User authentication/session

```text
NO VALID SESSION
  ↓ OAuth callback + valid nonce/code
SIGNED JWT + session cookie
  ↓ request verification
AUTHENTICATED ctx.user
  ↓ logout
COOKIE CLEARED / CLIENT AUTH STATE NULL
```

Validation: OAuth code/state, nonce match, JWT signature/expiration, required session fields.

Safety: JWT is stateless; logout does not revoke copied tokens. One-year lifetime creates a long replay window.

### User role

```text
DEFAULT/UNSPECIFIED ROLE
  ↓ user upsert
'user' default, or 'admin' when openId === ENV.ownerOpenId
```

Validation: database enum plus owner-open-ID comparison. The `InsertUser.role` input can also carry an explicit role from callers, so role assignment is not fully isolated to one authorization service.

### Account recharge preview

```text
NO BILLING PROVIDER / NO BALANCE
  ↓ startRecharge(amount)
AWAITING_PROVIDER PREVIEW
```

Validation: finite amount in range 100–100,000. No payment, balance, or persistent status transition occurs.

### Realtime credential

```text
AUTHENTICATED USER
  ↓ valid persona/language
TEMPORARY CLIENT SECRET ISSUED
```

Validation: protected auth, enum inputs, configured server key, provider response must contain `value`. Repeating the call creates another temporary credential; no idempotency key exists.

### File analysis

```text
NO PERSISTED FILE STATE
  ↓ validated data URL + provider call
TRANSIENT ANALYSIS RESPONSE
```

Validation: input shape/MIME/size. No completed/revoked/archived state exists.

## 12. Side Effects

| Operation | Side effect | Idempotent? | Retry-safe? | Transactional? | Audited? |
|---|---|---:|---:|---:|---:|
| OAuth callback | User upsert, session creation, cookie set | Mostly; user upsert is conflict-safe, repeated callback/code behavior provider-dependent | UNKNOWN; authorization code usually single-use | No transaction across DB/provider/cookie | Server logs errors; no persistent audit event |
| Auth request sync | User upsert and `lastSignedIn` update | Single statement; repeated calls update timestamp | Generally retry-safe but last-write-wins | Single DB statement only | No persistent audit |
| `auth.logout` | Cookie clear | Yes/idempotent intent | Yes | Not applicable | No persistent audit |
| `system.notifyOwner` | External notification | UNKNOWN; no idempotency key | UNKNOWN; retry could duplicate notification | No transaction | Provider/helper logs failure only |
| `realtime.createClientSecret` | Temporary credential creation | No guarantee; repeated request may create multiple credentials | UNKNOWN; retry may create another credential | No transaction | Console log contains user ID/model, no durable audit |
| `files.analyze` | External AI analysis | No guarantee; repeated request can repeat cost/processing | UNKNOWN; no idempotency key | No transaction | No durable audit |
| `account.startRecharge` | Returns preview only | Yes for current implementation | Yes | No database/provider operation | No durable audit |
| `generateImage` helper | External image generation + storage write | No idempotency key; timestamp key can duplicate on same millisecond in theory | UNKNOWN; retry may generate/store twice | No transaction across provider/storage | No durable audit |
| `storagePut`/`storageDelete` | External storage write/delete | Depends on storage key/provider | UNKNOWN | No transaction | No durable audit |
| Heartbeat callback | External scheduled callback | UNKNOWN; retry/status logic exists but endpoint semantics vary | Partially guarded by retry/status mapping | No transaction | Logs only |

## 13. Transactions

No Drizzle `.transaction(...)` usage was found.

### Multi-step operations

**OAuth callback:**

```text
A. Exchange authorization code
B. Fetch provider user info
C. Upsert local user
D. Create signed session token
E. Set cookie
F. Redirect
```

There is no cross-step transaction. Failure after C can leave a local user row without a browser session; failure after D before E can leave an unused signed token in memory only.

**Image generation helper:**

```text
A. Generate provider image
B. Decode base64
C. Put object into storage
D. Return storage URL
```

No transaction or compensating delete exists if storage write/response handling fails.

**Future payment:**

No actual payment flow exists. `startRecharge` does not touch a database or provider, so there is no current balance transaction to audit.

## 14. Idempotency

- User upsert: relatively safe due to unique `openId` and single-statement duplicate-key update.
- Logout: idempotent intent.
- Health: pure/idempotent.
- Account previews: deterministic/read-only for current implementation.
- Notification: UNKNOWN; duplicate notifications possible on retry.
- Realtime credential creation: UNKNOWN/non-idempotent from application perspective.
- File analysis: repeated request can repeat provider cost and produce separate responses.
- Image generation/storage: no request idempotency key.
- Future memory approval/task execution: NOT IMPLEMENTED; must not assume idempotency.

## 15. Concurrency

| Operation | Assessment | Reason |
|---|---|---|
| User creation | NO OBVIOUS RACE RISK for duplicate creation | Unique openId + atomic upsert |
| Profile/last-sign-in updates | RACE RISK / last-write-wins | Concurrent upserts update shared fields without versioning |
| Account balance | NOT APPLICABLE | No balance exists |
| Recharge | UNKNOWN for future; current preview has no write | No payment/provider call |
| Conversation/message writes | UNKNOWN | No active repository/API; migrations lack version/transaction contract |
| File persistence | UNKNOWN | Active analysis is transient; storedFiles inactive |
| Memory approval | MISSING | No state/model |
| Task execution | MISSING | No state/model |
| Notification/realtime/file provider calls | UNKNOWN | No idempotency or distributed lock contract |

## 16. Error Translation

```text
Provider error
  ↓
Thrown Error or helper-specific error string
  ↓
tRPC/Express adapter serialization
  ↓
Client error object or generic route response
```

Current behavior:

- `server/routers.ts` extracts OpenAI error message and throws direct `Error`.
- `server/_core/llm.ts` includes provider status, status text, and response body in errors.
- `server/_core/imageGeneration.ts`, `dataApi.ts`, and related helpers include provider status/detail in thrown errors.
- OAuth and storage Express routes intentionally return generic client messages while logging details server-side.
- Shared `HttpError` factories are not the dominant error translation path.

**Classification:** PARTIAL. Detailed provider errors are useful for server diagnosis but should be normalized before crossing public API boundaries.

## 17. Duplicate Logic

| Concept | Implementations | Classification |
|---|---|---|
| User identity | `users` schema, `User` type, `ctx.user`, SDK `AuthenticatedUser`, cron user builder | Intentional layers, but identity shaping is distributed |
| Account | Three account procedures each construct preview fields; shared voice tool descriptions mention recharge | DUPLICATED / placeholder policy |
| Session | OAuth cookie, JWT payload, preview sessionStorage bearer fallback, cron session path | Intentional compatibility paths; security complexity |
| Persona | `shared/juni.ts`, router enum, Home UI state/rendering | Shared source plus client use; acceptable but provider voice names leak into shared contract |
| Language | `SUPPORTED_LANGUAGES`, router enum, Home state | Shared source; no duplication of validation found |
| File | `files.analyze` input logic, migration `storedFiles`, `storage.ts`, storage proxy | DUPLICATED/fragmented concepts; active persistence disconnected |
| AI response | `orchestration.extractText`, router `output_text`, LLM `InvokeResult`, Realtime browser events | DUPLICATED provider-specific response handling |
| Error | `HttpError`, `TRPCError`, direct `Error`, Express JSON/text | INCONSISTENT |
| Provider | OpenAI direct calls in routers/client, Forge helpers, LLM adapter | PROVIDER-COUPLED/DISTRIBUTED |
| Currency | `
`PKR` in account procedures and `shared/juni.ts` | DUPLICATED policy |
| Safety instructions | Persona system instructions and file-analysis prompt warnings | DUPLICATED/feature-specific security prompt logic |

## 18. Reusable Logic

| Logic | Classification | Current location | Reuse assessment |
|---|---|---|---|
| User lookup by verified OpenID | REUSABLE | `server/db.ts:getUserByOpenId` | Auth and future user-owned services can reuse through a repository boundary |
| User upsert/sign-in update | REUSABLE but identity-specific | `server/db.ts:upsertUser` | Reusable for auth synchronization; owner promotion should be separated later |
| Protected-user check | REUSABLE | `server/_core/trpc.ts:protectedProcedure` | Correct centralized middleware |
| Admin-role check | REUSABLE | `server/_core/trpc.ts:adminProcedure` | Correct centralized middleware |
| Data URL validation | FEATURE-SPECIFIC | `server/routers.ts:dataUrlSchema` | Candidate for File Service validation module if more file APIs appear |
| Amount range validation | FEATURE-SPECIFIC | `server/routers.ts:amountSchema` | Candidate for Account/Payment policy module; currently only preview |
| Persona/language enums | REUSABLE | `shared/juni.ts` and router schemas | Shared UI/API contract |
| Untrusted context envelope | REUSABLE | `server/orchestration.ts:contextEnvelope` | Candidate for orchestration/provenance boundary |
| LLM retry/backoff | REUSABLE | `server/_core/llm.ts` | Candidate provider-core utility; currently tied to Forge LLM helper |
| Safety identifier hashing | REUSABLE | `server/routers.ts:safetyIdentifier` | Candidate provider adapter/security utility |
| Provider error extraction | REUSABLE | `server/routers.ts:getOpenAiError` and helper-specific error code | Candidate common provider-error translator |
| Storage upload/delete | REUSABLE | `server/storage.ts` | Candidate Storage Core; currently provider-specific |

No exact function was found to be used by two active tRPC procedures for account/file/voice business logic. Reuse opportunities are mostly future boundaries, not current duplicated function bodies.

## 19. Current Boundaries

```text
Express route / tRPC router
  ├── input validation
  ├── procedure-level auth selection
  ├── some domain decisions
  ├── provider request construction
  └── response formatting

server/_core helpers
  ├── auth/session
  ├── provider calls
  ├── storage/notification
  └── infrastructure callbacks

server/db.ts
  └── users persistence plus owner-role decision

server/orchestration.ts
  └── prompt/security envelope plus LLM call
```

Current boundaries are functional but not one-responsibility-pure. The most router-heavy code is Realtime, file analysis, and account preview logic.

## 20. Proposed Future Boundaries

These are proposals only; none is implemented in Step 9.

| Future service | Why | Current location | Dependencies | Migration risk |
|---|---|---|---|---|
| Auth Service | Centralize OAuth callback, JWT/session lifecycle, user synchronization, logout, and cron identity | `server/_core/oauth.ts`, `sdk.ts`, `context.ts`, `db.ts`, client auth hook | OAuth provider, cookie policy, users repository | HIGH — session behavior and login compatibility |
| Conversation Service | Own conversation/message lifecycle, owner checks, persistence, and transactions | Migration SQL only; no active service | Drizzle schema/repository, auth, provenance | HIGH — schema drift and FK/ownership decisions |
| AI Orchestration Service | Separate request policy, history, untrusted context, capability routing, and provider-neutral result | `server/orchestration.ts`, parts of routers | Provider-core, provenance, conversation repository | MEDIUM/HIGH — prompt/security behavior |
| Voice Service | Own persona/language policy, realtime session configuration, credential issuance, rate limits | `server/routers.ts`, `shared/juni.ts`, `Home.tsx` | OpenAI adapter, auth, safety identifiers | HIGH — browser WebRTC compatibility |
| File Service | Own file validation, decoding, storage metadata, analysis lifecycle, deletion, and ownership | `server/routers.ts`, `storage.ts`, `storageProxy.ts`, migration-only `storedFiles` | Storage provider, file repository, AI provider | HIGH — persistent user data and access control |
| Memory Service | Own candidate/approval/trust/revocation/visibility semantics | Not implemented | User auth, provenance, repository, approval policy | HIGH — privacy and consent |
| Research Service | Own external retrieval, source records, citations, provenance, and untrusted context | `dataApi.ts` helper only | Data providers, provenance, orchestration | HIGH — source trust and SSRF/network controls |
| Task Service | Own task state, scheduling, retries, ownership, and execution | `heartbeat.ts` infrastructure only | Scheduler, auth, repository, audit | HIGH — concurrency and retries |
| Provenance Service | Own source/provider/model/trace/version/audit metadata | No active persistence; orchestration labels only | All domain services, repository | HIGH — cross-cutting schema and privacy |
| Account Service | Own balance, pricing, currency, recharge intent, payment confirmation, idempotency | Three preview procedures in `server/routers.ts` | Billing provider, ledger repository, auth | HIGH — financial correctness and external side effects |

## 21. Risks

### SERVICE-001 — Router-coupled provider/business logic

- **Location:** `server/routers.ts`
- **Finding:** Realtime, file-analysis, and account rules are implemented inline in route resolvers.
- **Impact:** Harder testing, provider replacement, rate limiting, reuse, and security review.
- **Evidence:** Router constructs provider request payloads, selects personas/languages, validates file policy, formats account state, and maps provider responses.
- **Recommended Future Fix:** Introduce domain services and provider adapters after contracts are frozen.
- **V1 Blocker:** NO for current preview; YES before broad feature expansion.

### SERVICE-002 — File concepts are fragmented

- **Location:** `server/routers.ts`, `server/storage.ts`, `server/_core/storageProxy.ts`, migration-only `storedFiles`
- **Finding:** Analysis, storage, metadata, retrieval, and deletion are not one service boundary.
- **Impact:** Ownership, lifecycle, retention, and deletion guarantees can diverge.
- **Evidence:** `files.analyze` is transient and does not persist to `storedFiles`; storage proxy has separate route behavior.
- **Recommended Future Fix:** Define File Service plus repository and storage adapter with owner checks.
- **V1 Blocker:** YES before persistent file feature.

### SERVICE-003 — Account is a placeholder, not a service

- **Location:** `server/routers.ts`, `shared/juni.ts`
- **Finding:** Currency, amount validation, and recharge response logic are inline previews; no balance/ledger/payment state exists.
- **Impact:** A future payment integration could accidentally treat preview intent as a completed business operation.
- **Evidence:** `balance: null`, `checkoutUrl: null`, `awaiting_provider`, and explicit not-connected messages.
- **Recommended Future Fix:** Create Account/Payment Service with ledger, idempotency, confirmation, and provider adapter.
- **V1 Blocker:** YES before real payments.

### SERVICE-004 — Provider-specific contracts span server and client

- **Location:** `server/routers.ts`, `shared/juni.ts`, `client/src/pages/Home.tsx`, `server/_core/llm.ts`
- **Finding:** OpenAI/Forge payload and response shapes are not isolated behind adapters.
- **Impact:** Provider changes require UI/router changes and can spread credential/capability assumptions.
- **Evidence:** Realtime WebRTC negotiation in Home; OpenAI response fields in router; Forge paths in LLM helper.
- **Recommended Future Fix:** Add provider-core interfaces and adapters while preserving a stable domain result contract.
- **V1 Blocker:** NO if explicitly accepted; YES for multi-provider strategy.

### SERVICE-005 — Authentication and user persistence decisions are split

- **Location:** `oauth.ts`, `sdk.ts`, `context.ts`, `db.ts`
- **Finding:** Auth flow crosses route, SDK, context, and DB helper, while owner admin promotion lives in persistence code.
- **Impact:** Session and role policy changes may be difficult to reason about and test atomically.
- **Evidence:** `db.upsertUser` both persists and promotes configured owner to admin.
- **Recommended Future Fix:** Define Auth Service with identity policy and User Repository separation.
- **V1 Blocker:** NO for current flow; MEDIUM risk.

### SERVICE-006 — No transaction boundary for multi-step side effects

- **Location:** OAuth callback and image-generation/storage helper
- **Finding:** External calls, persistence, credential/session creation, and cookie/storage writes are not coordinated by transactions or compensating actions.
- **Impact:** Partial failures can leave local rows or external objects without corresponding state.
- **Evidence:** Sequential operations in `oauth.ts` and `imageGeneration.ts`; no `.transaction` usage.
- **Recommended Future Fix:** Add explicit workflow/outbox/compensation design per side effect.
- **V1 Blocker:** YES for payments and durable user data; NO for current preview.

### SERVICE-007 — Retry behavior is provider-specific and not idempotency-aware

- **Location:** `server/_core/llm.ts`, heartbeat/provider helpers
- **Finding:** LLM helper retries non-2xx/network errors, but request idempotency is not established.
- **Impact:** Retried non-read operations could duplicate external effects or costs if reused for side-effecting tools.
- **Evidence:** `fetchWithBackoff` retries up to four times; `invokeLLM` has no idempotency key.
- **Recommended Future Fix:** Restrict retries to safe operations or add idempotency/correlation keys and operation classification.
- **V1 Blocker:** NO for current text generation; YES for side-effect tools.

### SERVICE-008 — Error translation is not centralized

- **Location:** Routers, `_core/llm.ts`, provider helpers, shared errors
- **Finding:** Direct provider details, `TRPCError`, `HttpError`, direct `Error`, and Express responses coexist.
- **Impact:** Inconsistent client behavior and possible upstream-detail leakage.
- **Evidence:** Multiple error construction paths in inspected code.
- **Recommended Future Fix:** Add provider-error translator and client-safe domain error envelope.
- **V1 Blocker:** NO for preview; YES before public production APIs.

### SERVICE-009 — Future domain services are absent

- **Location:** Repository-wide
- **Finding:** Memory, Research, Task, Activity, Provenance, and active Conversation services do not exist.
- **Impact:** Planned capabilities must not be treated as implemented or authorized.
- **Evidence:** No active feature modules or procedures found; only migration/shared/infrastructure artifacts.
- **Recommended Future Fix:** Implement each domain only after contract, ownership, provenance, and transaction design.
- **V1 Blocker:** YES for any claim that these capabilities are complete.

## 22. Migration Candidates

Prioritize future controlled refactoring in this order:

1. **Security-sensitive logic:** storage owner checks, provider secret boundary, account/payment authorization, memory approval.
2. **Duplicated or fragmented logic:** file lifecycle, account policy/currency, error translation, auth/user policy.
3. **Provider-coupled logic:** Realtime, file analysis, LLM/image/data adapters.
4. **High-change logic:** account/payment, voice configuration, research retrieval.
5. **Testing-unfriendly logic:** router-heavy provider calls and multi-step side effects.
6. **Cosmetic cleanup:** naming/formatting and low-impact module organization.

## Logic Classification Matrix

| Logic | Current Location | Domain | Pure? | DB? | Network? | Duplicated? | Risk |
|---|---|---|---:|---:|---:|---:|---|
| Authentication | `oauth.ts`, `sdk.ts`, `context.ts`, `db.ts` | Auth | No | Yes | Yes | Distributed | High session/role coupling |
| Authorization | `trpc.ts`, inline router identity use | Auth/security | Middleware mostly pure | No | No | Some repeated ctx usage | Missing resource owner layer |
| Chat orchestration | `orchestration.ts` | AI orchestration | No | No | Yes | Low | Untrusted-context bypass if future route bypasses helper |
| Voice | `routers.ts`, `shared/juni.ts`, Home | Voice | No | No | Yes | Persona/UI/provider split | Provider coupling |
| File analysis | `routers.ts` | Files/AI | No | No | Yes | Storage concepts fragmented | Input/resource/lifecycle gaps |
| Account | `routers.ts`, `shared/juni.ts` | Account | Preview mostly pure | No | No | Currency/response repeated | Not real billing; unsafe to extend inline |
| User persistence | `db.ts` | Identity | No | Yes | No | Low | Owner-role decision in repository |
| LLM provider adapter | `_core/llm.ts` | AI provider | No | No | Yes | Provider-specific | Error/retry/idempotency concerns |
| Storage | `storage.ts`, `storageProxy.ts` | Files | No | No | Yes | Split | Owner/lifecycle gap |
| Notification | `_core/notification.ts`, system router | System | No | No | Yes | Low | Duplicate notification risk |

## Future Golden Path

The target architecture, not a claim about current implementation, is:

```text
API ROUTE
   ↓
INPUT VALIDATION
   ↓
AUTHENTICATION
   ↓
AUTHORIZATION
   ↓
DOMAIN SERVICE
   ↓
REPOSITORY / PROVIDER BOUNDARY
   ↓
RESULT
   ↓
API RESPONSE
```

## One-Responsibility Rule

Future rule:

```text
Router
    = transport boundary

Service
    = business decision

Repository
    = persistence

Provider adapter
    = external AI/provider communication

Provenance
    = source/audit metadata
```

This rule is intentionally not applied as a refactor in Step 9.

## Validation Record

Required checks were run without changing runtime behavior:

| Command | Result |
|---|---|
| `pnpm test` | PASS — 3 test files, 8 tests |
| `pnpm check` | PASS — TypeScript completed successfully |
| `pnpm build` | PASS — frontend and server bundles completed; existing chunk-size warning emitted |

No router rewrite, service migration, provider replacement, database redesign, or feature removal was performed.
