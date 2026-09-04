# JUNI AI Contract Registry

This registry records the contracts that exist in the current repository snapshot. It is an inspection and classification document; it does not change application behavior or create new domain systems.

> **Contract distinction:** A product contract is not the same thing as a model prompt, database schema, provider request, or UI state. A single domain may intentionally have several related contracts, but each contract must have one identifiable canonical definition.

## 1. Shared Contracts

The target `packages/shared` directory does not exist. Current shared contracts live under `shared/`.

| Contract | Defined in | Export | Purpose | Consumers |
|---|---|---|---|---|
| `HttpError` | `shared/_core/errors.ts` | Class | Error with numeric `statusCode` and message | Server SDK/error paths |
| `BadRequestError` | `shared/_core/errors.ts` | Function | Creates `HttpError(400, msg)` | Available; no current direct route usage found |
| `UnauthorizedError` | `shared/_core/errors.ts` | Function | Creates `HttpError(401, msg)` | Available; no current direct route usage found |
| `ForbiddenError` | `shared/_core/errors.ts` | Function | Creates `HttpError(403, msg)` | `server/_core/sdk.ts` |
| `NotFoundError` | `shared/_core/errors.ts` | Function | Creates `HttpError(404, msg)` | Available; no current direct route usage found |
| Database type exports | `shared/types.ts` | `export type *` | Re-exports Drizzle-derived database types | Server/shared imports |
| Shared errors | `shared/types.ts` | `export *` | Re-exports shared error module | Server/shared imports |
| `UserId` | `shared/contracts/identity.ts` | Type alias | Canonical name for the Drizzle-derived `users.id` primary key | Account API output in `server/routers.ts` |
| Auth/OAuth constants | `shared/const.ts` | Named constants/types | Cookie names, OAuth state, shared error messages, timeout values, OAuth state type | Client OAuth and server auth |

The current shared directory also contains `shared/juni.ts`, which is the canonical AI identity/tool contract file for the current implementation.

`UserId` is intentionally a type alias for `User["id"]`, where `User` is inferred from `drizzle/schema.ts`. The current database primary key is an auto-incremented MySQL integer. This preserves the schema as the concrete identifier authority while giving consuming domain code one canonical identity name.

## 2. AI Identity Contracts

### `REALTIME_MODEL`

- **Defined in:** `shared/juni.ts`
- **Value:** `"gpt-realtime-2.1" as const`
- **Type:** Literal constant
- **Owner:** Shared AI identity contract
- **Used by:** `Home.tsx`, `server/routers.ts`, JUNI contract tests
- **Sensitive:** No; it identifies a provider model but is not a credential.

### `JUNI_PERSONAS`

- **Defined in:** `shared/juni.ts`
- **Type:** `as const` object with `juni` and `sona` entries.
- **Owner:** Shared AI identity contract
- **Used by:** Home UI, OpenAI client-secret broker, tests
- **Sensitive:** No, although system instructions should be treated as controlled application policy.

### `PersonaId`

- **Defined in:** `shared/juni.ts`
- **Definition:** `keyof typeof JUNI_PERSONAS`
- **Current values:** `"juni" | "sona"`
- **Used by:** Home state and server input schema.

### `SUPPORTED_LANGUAGES`

- **Defined in:** `shared/juni.ts`
- **Type:** Readonly tuple of language objects.
- **Used by:** Home language selector and server client-secret validation/configuration.

### `LanguageId`

- **Defined in:** `shared/juni.ts`
- **Definition:** `(typeof SUPPORTED_LANGUAGES)[number]["id"]`
- **Current values:** `"en" | "ur" | "hi" | "ar" | "es"`
- **Used by:** Home state and server input schema.

### `safeLiveToolDeclarations`

- **Defined in:** `shared/juni.ts`
- **Type:** Readonly tuple of OpenAI Realtime function declarations.
- **Current tool names:** `open_website`, `get_recharge_info`, `start_recharge`
- **Used by:** `server/routers.ts` when creating Realtime client-secret session configuration and by contract tests.
- **Sensitive:** The declarations themselves are not secrets, but they define high-impact capability boundaries.

## 3. Language Contracts

| ID | Label | Instruction |
|---|---|---|
| `en` | `English` | `Speak in English.` |
| `ur` | `اردو · Urdu` | `Speak in Urdu when the user speaks Urdu; otherwise follow the user's language.` |
| `hi` | `हिन्दी · Hindi` | `Speak in Hindi when the user speaks Hindi; otherwise follow the user's language.` |
| `ar` | `العربية · Arabic` | `Speak in Arabic when the user speaks Arabic; otherwise follow the user's language.` |
| `es` | `Español · Spanish` | `Speak in Spanish when the user speaks Spanish; otherwise follow the user's language.` |

Language IDs and instructions are canonical in `SUPPORTED_LANGUAGES`. They are not duplicated in the server router; the router derives its Zod enum from this shared constant.

## 4. Tool Contracts

### `open_website`

- **Name:** `open_website`
- **Description:** Requests opening an HTTPS website in a new browser tab; the user must explicitly approve the URL.
- **Parameters:** `url: string`, `reason: string`.
- **Required fields:** `url`, `reason`.
- **Confirmation requirement:** Explicit user approval in the Home confirmation card before `window.open`.
- **Side-effect level:** High relative to the other tools; it causes an external navigation but does not submit data by itself.
- **Runtime validation:** Home parses the URL and requires `https:`; invalid URLs receive a failed tool response.

### `get_recharge_info`

- **Name:** `get_recharge_info`
- **Description:** Reads current account recharge status; read-only and never charges the user.
- **Parameters:** Empty object.
- **Required fields:** None.
- **Confirmation requirement:** No confirmation for the read-only query.
- **Side-effect level:** Read-only.
- **Runtime behavior:** Calls protected `account.getRechargeInfo`; current result is provider-not-connected preview data.

### `start_recharge`

- **Name:** `start_recharge`
- **Description:** Prepares a recharge/payment flow; explicit confirmation is always required and the tool cannot claim payment success.
- **Parameters:** `amount: number` in PKR.
- **Required fields:** `amount`.
- **Confirmation requirement:** Explicit approval in the Home confirmation card before the protected mutation is called.
- **Side-effect level:** Potentially high; current implementation is a non-billing preview only.
- **Runtime validation:** Amount must be finite and between PKR 100 and PKR 100,000.

## 5. API Input Contracts

Server validation schemas in `server/routers.ts` are the current API input authorities.

### `amountSchema`

```ts
z.number().finite().min(100).max(100_000)
```

Used by `account.startRecharge`.

### `personaSchema`

```ts
z.enum(["juni", "sona"])
```

The implementation derives the TypeScript tuple from `PersonaId`.

Used by `realtime.createClientSecret`.

### `languageSchema`

The implementation derives a Zod enum from `SUPPORTED_LANGUAGES.map(language => language.id)`.

Current values: `en`, `ur`, `hi`, `ar`, `es`.

Used by `realtime.createClientSecret`.

### `dataUrlSchema`

```ts
z.string()
  .max(12_000_000)
  .regex(/^data:[^;]+;base64,[A-Za-z0-9+/=]+$/, "File must be a base64 data URL")
```

Used by `files.analyze` together with:

```ts
{
  name: z.string().min(1).max(180),
  mimeType: z.string().min(1).max(120),
  dataUrl: dataUrlSchema,
}
```

The procedure additionally permits only image MIME types, `application/pdf`, or `text/plain`.

## 6. API Output Contracts

The tRPC router in `server/routers.ts` is the canonical API procedure contract. Inferred TypeScript output types come from `AppRouter`; no manually duplicated response interfaces were found for these procedures.

| Router | Procedure | Type | Auth | Input |
|---|---|---|---|---|
| `system` | `health` | query | public | `timestamp: number`, minimum 0 |
| `system` | `notifyOwner` | mutation | admin | `title: string`, `content: string` |
| `auth` | `me` | query | public | none |
| `auth` | `logout` | mutation | public | none |
| `realtime` | `createClientSecret` | mutation | protected | `persona` + `language` |
| `files` | `analyze` | mutation | protected | `name` + `mimeType` + `dataUrl` |
| `account` | `dashboard` | query | protected | none |
| `account` | `getRechargeInfo` | query | protected | none |
| `account` | `startRecharge` | mutation | protected | `amount` |

### Protected procedure outputs

#### `realtime.createClientSecret`

Returns:

```ts
{
  value: string;       // short-lived OpenAI Realtime client secret
  model: "gpt-realtime-2.1";
  voice: string;       // selected persona voice, currently cedar or marin
}
```

The long-lived `OPENAI_API_KEY` is never returned.

#### `files.analyze`

Returns:

```ts
{
  name: string;
  mimeType: string;
  text: string;
}
```

`text` is the OpenAI Responses output or the fallback string `"No analysis was returned."`.

#### `account.dashboard`

Returns:

```ts
{
  user: { id: number; name: string | null; email: string | null };
  currency: "PKR";
  balance: null;
  status: "provider_not_connected";
  message: string;
}
```

#### `account.getRechargeInfo`

Returns:

```ts
{
  userId: number;
  currency: "PKR";
  status: "not_connected";
  balance: null;
  message: string;
}
```

#### `account.startRecharge`

Returns:

```ts
{
  status: "awaiting_provider";
  amount: number;
  currency: "PKR";
  userId: number;
  checkoutUrl: null;
  message: string;
}
```

The account outputs are safe-preview contracts. `balance` and `checkoutUrl` are not provider-backed values in the current implementation.

## 7. Authentication Contracts

The current authentication path is:

```text
useAuth
    ↓
 tRPC client
    ↓
 auth.me / auth.logout
    ↓
 createContext()
    ↓
 protectedProcedure
    ↓
 ctx.user
```

`useAuth` is defined in `client/src/_core/hooks/useAuth.ts`. It uses `trpc.auth.me.useQuery()` and `trpc.auth.logout.useMutation()`. Login navigation is initiated through `startLogin()` and the OAuth callback is handled by `server/_core/oauth.ts`.

`TrpcContext` is defined in `server/_core/context.ts`:

```ts
{
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
}
```

Protected procedures receive a non-null `ctx.user` after `protectedProcedure` middleware succeeds. The user shape is database-derived from `User` in `drizzle/schema.ts`:

```ts
{
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  loginMethod: string | null;
  role: "user" | "admin";
  createdAt: Date;
  updatedAt: Date;
  lastSignedIn: Date;
}
```

`adminProcedure` additionally requires `ctx.user.role === "admin"`.

## 8. Database Contracts

The authoritative database contract is `drizzle/schema.ts`, not a manually maintained interface.

### `users` table

| Field | Type | Nullability | Default | Unique | Primary key | Index | Enum |
|---|---|---|---|---|---|---|---|
| `id` | `int` | not null | auto-increment | no | yes | implicit PK | no |
| `openId` | `varchar(64)` | not null | none | yes | no | unique constraint | no |
| `name` | `text` | nullable | none | no | no | none declared | no |
| `email` | `varchar(320)` | nullable | none | no | no | none declared | no |
| `loginMethod` | `varchar(64)` | nullable | none | no | no | none declared | no |
| `role` | MySQL enum | not null | `"user"` | no | no | none declared | `"user" | "admin"` |
| `createdAt` | timestamp | not null | `defaultNow()` | no | no | none declared | no |
| `updatedAt` | timestamp | not null | `defaultNow().onUpdateNow()` | no | no | none declared | no |
| `lastSignedIn` | timestamp | not null | `defaultNow()` | no | no | none declared | no |

No Conversation, Message, File, Memory, MemoryCandidate, Task, Activity, or Audit/Provenance tables currently exist.

## 9. Error Contracts

### `HttpError`

- **Defined in:** `shared/_core/errors.ts`
- **Shape:** `Error` subclass with public `statusCode: number` and message.
- **Actual usage:** `server/_core/sdk.ts` throws `ForbiddenError(...)` for invalid session cookies, missing cron session task IDs, failed user sync, and missing users.

### Convenience constructors

| Export | Status | Actual usage |
|---|---:|---|
| `BadRequestError` | 400 | No current usage found |
| `UnauthorizedError` | 401 | No current usage found |
| `ForbiddenError` | 403 | Used by `server/_core/sdk.ts` |
| `NotFoundError` | 404 | No current usage found |

The tRPC layer independently uses `TRPCError` for `UNAUTHORIZED` and `FORBIDDEN` middleware failures. Router feature errors also use direct `Error` instances. These are related but not one normalized error contract.

## 10. Voice Contracts

| Contract | Current definition |
|---|---|
| Persona | `PersonaId` selects `JUNI_PERSONAS.juni` or `.sona`. |
| Language | `LanguageId` selects one entry from `SUPPORTED_LANGUAGES`. |
| Model | `REALTIME_MODEL = "gpt-realtime-2.1"`. |
| Voice | Persona `voiceName`: JUNI uses `cedar`; SONA uses `marin`. |
| Session | Browser `RTCPeerConnection` plus `RTCDataChannel("oai-events")`; server creates the session configuration and OpenAI handles WebRTC media. |
| Client secret | `realtime.createClientSecret` returns a short-lived `value`; long-lived `OPENAI_API_KEY` remains server-only. |
| Connection states | Home local `SessionStatus`: `idle`, `connecting`, `listening`, `speaking`, `error`. Legacy `VoiceSystem` uses `VoiceState`: `DISCONNECTED`, `CONNECTING`, `CONNECTED`, `LISTENING`, `PROCESSING`, `SPEAKING`, `INTERRUPTED`, `RECONNECTING`, `ERROR`. |
| Tool declarations | `safeLiveToolDeclarations` is the canonical three-tool allowlist. |

The active Home voice flow also has provider event handling for session creation, speech start, response creation/done, transcript deltas, function-call arguments, and errors.

## 11. File Contracts

The current file contract intentionally separates file metadata, content, analysis, and persistent storage.

| Contract | Current status |
|---|---|
| File name | `files.analyze` input `name: string`, 1–180 characters; Home obtains it from `File.name`. |
| MIME type | `files.analyze` input `mimeType: string`, 1–120 characters; only image MIME types, PDF, and plain text are accepted. |
| File content | Browser converts content to `dataUrl`; `dataUrlSchema` requires a base64 data URL and max length 12,000,000. |
| Analysis request | Server sends image content as `input_image`, PDF/text as `input_file` to OpenAI Responses API. |
| Analysis response | `{ name, mimeType, text }`. |
| Storage metadata | `server/storage.ts` exposes `{ key, url }` for Forge storage, but `files.analyze` does not persist uploaded file metadata or ownership. |
| Persistent file record | MISSING. No `files` database table or file repository exists. |

## 12. Account Contracts

| Field | Current contract | Provider-backed? |
|---|---|---:|
| `currency` | Literal `"PKR"` | No; application preview constant |
| `balance` | `null` | No; provider is not connected |
| `status` | `"provider_not_connected"` for dashboard, `"not_connected"` for recharge info, `"awaiting_provider"` for preview intent | No |
| `message` | Explicit safe-preview explanatory string | No; application-generated |
| `amount` | Finite number from 100 to 100,000 | No; validated input |
| `checkoutUrl` | `null` | No checkout provider connected |
| `userId` | Derived from `ctx.user.id` in protected procedures | Identity-backed, but no account table exists |

These are safe-preview contracts. They must not be presented as real account balances, completed payments, or active checkout sessions.

## 13. Frontend Component Contracts

### `AIChatBox`

Defined in `client/src/components/AIChatBox.tsx`.

```ts
type Message = {
  role: "system" | "user" | "assistant";
  content: string;
};

type AIChatBoxProps = {
  messages: Message[];
  onSendMessage: (content: string) => void;
  isLoading?: boolean;
  placeholder?: string;
  className?: string;
  height?: string | number;
  emptyStateMessage?: string;
  suggestedPrompts?: string[];
};
```

This is a reusable UI contract, but its comments reference a hypothetical `trpc.ai.chat` mutation that is not present in the current router.

### `VoiceSystem`

Defined in `client/src/components/VoiceSystem.tsx`.

- No public props; component is self-contained.
- Uses `VoiceState` from `client/src/lib/voiceState.ts`.
- Owns local microphone stream, timers, state transitions, and preview controls.
- It is a legacy/parallel voice contract relative to the active Home OpenAI flow.

### `CapabilityBoard`

Defined in `client/src/components/CapabilityBoard.tsx`.

- No public props.
- Uses an internal readonly `columns` constant containing examples, capabilities, and limitations.
- It describes “user-scoped conversation memory” as a capability, but no durable memory contract exists in the database/API inventory.

### `DashboardLayout`

Defined in `client/src/components/DashboardLayout.tsx`.

```ts
{
  children: React.ReactNode;
}
```

Internal contracts include menu items `{ icon, label, path }`, sidebar width numeric bounds, and authenticated user data from `useAuth`.

### `Home`

Defined in `client/src/pages/Home.tsx` with no public props. Important local contracts are:

```ts
type SessionStatus = "idle" | "connecting" | "listening" | "speaking" | "error";

type PendingAction =
  | { kind: "website"; callId: string; url: string; reason: string }
  | { kind: "recharge"; callId: string; amount: number }
  | null;

type ActivityItem = {
  id: number;
  label: string;
  detail: string;
  tone: "mint" | "violet" | "amber" | "slate";
};

type HistoryItem = {
  id: string;
  type: "voice" | "file" | "action";
  text: string;
  createdAt: number;
};
```

Home also consumes `PersonaId`, `LanguageId`, the tRPC router type, and the account/file/realtime procedure outputs.

### `Audit`

Defined in `client/src/pages/Audit.tsx` with no public props.

```ts
type Severity = "Critical" | "High" | "Medium" | "Low";
type Filter = "All" | Severity;
type Finding = {
  id: string;
  severity: Severity;
  status: string;
  title: string;
  summary: string;
  evidence: string;
  recommendation: string;
};
```

The page owns static audit finding data and filter state; it is not a server-backed audit contract.

## 14. Duplicate Contracts

| Contract concern | Classification | Finding |
|---|---|---|
| `PersonaId` | CANONICAL | Defined once in `shared/juni.ts`; server and client import it. |
| `LanguageId` | CANONICAL | Derived once from `SUPPORTED_LANGUAGES`; server and client import it. |
| `User` / `UserId` | CANONICAL | `User` is derived from `drizzle/schema.ts`; `UserId` in `shared/contracts/identity.ts` aliases `User["id"]` without duplicating the numeric key strategy. Shared types re-export both. Test fixtures manually construct compatible users but do not redefine a named user type except `AuthenticatedUser = NonNullable<TrpcContext["user"]>`. |
| Tool declarations | CANONICAL + provider-shape coupling | `safeLiveToolDeclarations` is defined once, but it is already shaped as OpenAI Realtime declarations in shared code. |
| File metadata | POTENTIAL DUPLICATE | `name`, `mimeType`, and `dataUrl` exist as a tRPC input shape, while Forge storage returns `{ key, url }`; no unified file domain contract exists. |
| Account status | POTENTIAL DUPLICATE | Dashboard uses `provider_not_connected`, recharge info uses `not_connected`, and recharge intent uses `awaiting_provider`. These are separate safe-preview outputs without a shared status union. |
| Error shapes | DUPLICATE | `HttpError`, tRPC `TRPCError`, direct `Error`, and Express `{ error: string }` responses coexist. |
| API response objects | POTENTIAL DUPLICATE | Router inference is canonical, but Home uses local `PendingAction`, `ActivityItem`, and `HistoryItem` contracts around those responses. |
| Voice state | DUPLICATE | Active Home `SessionStatus` and legacy `VoiceSystem` `VoiceState` represent overlapping lifecycle concepts. |
| Chat `Message` | POTENTIAL DUPLICATE | `AIChatBox.Message` is UI-local while `server/orchestration.ts` defines its own history item shape. |

## 15. Unsafe / Weak Contracts

### Unsafe `any` findings

| Location | Finding | Classification |
|---|---|---|
| `client/src/pages/Home.tsx` | Realtime event callback and nested response items use `any`. | REPLACEABLE / RISK: provider event parsing is untyped at the UI boundary. |
| `server/storage.ts` | `data as any` is passed into `Blob`. | SAFE / NECESSARY only if SDK input type cannot express the union; should be narrowed later. |
| `server/_core/sdk.ts` | OAuth response platform fields use `as any`. | REPLACEABLE: external SDK response should receive a typed adapter. |
| `client/src/hooks/usePersistFn.ts` | Generic noop uses `any`. | LOW RISK / REPLACEABLE with generic unknown tuple/function typing. |
| UI primitives `textarea.tsx`, `input.tsx`, `dialog.tsx` | Browser event values use `as any`. | REPLACEABLE / LOW RISK; common event typing shortcuts. |

No `Record<string, any>` occurrence was found in the inspected application source. `unknown` appears in typed error/response boundaries, which is generally safer than `any` but should be narrowed before domain use.

### Weak or incomplete domain contracts

- File analysis has input and output contracts but no durable owner, retention, or storage record.
- Account status values are not unified under a shared status union.
- Realtime provider event payloads are untyped in the browser.
- The `AIChatBox` message contract refers to an unimplemented `trpc.ai.chat` procedure.
- No contracts exist for Conversation, Message persistence, Memory, MemoryCandidate, Research, Observation, Experience, RetrievalTrace, Task, Activity, Provenance, or Evaluation domains.

## 16. Canonical Contracts

The current canonical definitions are:

| Contract | Canonical definition |
|---|---|
| Persona identity and language values | `shared/juni.ts` |
| Safe Realtime tools | `shared/juni.ts` |
| API procedure inputs and outputs | `server/routers.ts` via inferred `AppRouter` |
| Authenticated user/database type | `drizzle/schema.ts` via inferred `User`; `shared/contracts/identity.ts` exposes the derived `UserId` name |
| Auth context | `server/_core/context.ts` via `TrpcContext` |
| Protected/admin authorization middleware | `server/_core/trpc.ts` |
| Error base/convenience contracts | `shared/_core/errors.ts` |
| UI chat props/message contract | `client/src/components/AIChatBox.tsx` |
| Legacy voice state machine | `client/src/lib/voiceState.ts` |

Canonical-contract rule:

> Every domain contract must have one identifiable canonical definition. Consumers should import the canonical contract instead of redefining it. Database-derived types should remain derived from the database schema. Shared contracts must not contain provider secrets. Client contracts must not expose server-only implementation details.

## 17. Missing Contracts

### Future JUNI domain gap table

| Domain | Status | Evidence |
|---|---|---|
| Conversation | MISSING | No table, router, or durable contract found |
| Message | PARTIAL | UI `Message` type exists; no durable database/API message domain |
| File | PARTIAL | Analysis input/output exists; no durable file ownership/storage record |
| Memory | MISSING | No table, router, UI, or memory candidate flow |
| MemoryCandidate | MISSING | No contract found |
| Research | DOCUMENTED ONLY | Research files/roadmap references exist; no live domain contract |
| Observation | MISSING | No contract found |
| Experience | MISSING | No contract found |
| RetrievalTrace | MISSING | No contract found |
| Task | MISSING | No task table/router/UI contract found |
| Activity | PARTIAL | Home-local `ActivityItem` exists; no durable activity domain |
| Provenance | DOCUMENTED ONLY | Architecture docs name the boundary; no package/table/runtime contract |
| Evaluation | MISSING | No contract found |

### Additional missing cross-cutting contracts

- Provider-neutral AI request/response interface.
- Provider capability and error normalization interface.
- User-owned resource authorization contract.
- File storage metadata and retention contract.
- Unified account status union.
- Typed OpenAI Realtime event adapter contract.
- Shared error envelope for tRPC, Express, and provider failures.
- Contract for explicit memory approval and disablement.

## Contract Dependency Matrix

| Contract | Defined in | Used by | Sensitive? |
|---|---|---|---:|
| `PersonaId` | `shared/juni.ts` | client Home, server router, tests | No |
| `LanguageId` | `shared/juni.ts` | client Home, server router | No |
| `JUNI_PERSONAS` | `shared/juni.ts` | client Home, server router | No; system policy should be controlled |
| `safeLiveToolDeclarations` | `shared/juni.ts` | server router, tests | Capability-sensitive |
| `AppRouter` | `server/routers.ts` | tRPC client/server type boundary | No; response data may be sensitive |
| `TrpcContext` | `server/_core/context.ts` | protected/admin procedures, tests | Contains user/session request context |
| `User` | `drizzle/schema.ts` | server context, DB helpers, shared type exports | Yes; user identity data |
| `UserId` | `shared/contracts/identity.ts` | account API output, shared type consumers | No; identifier type only |
| `HttpError` | `shared/_core/errors.ts` | SDK/server error paths | May carry sensitive messages if misused |
| `AIChatBox.Message` | `client/src/components/AIChatBox.tsx` | AIChatBox consumers | User content; privacy-sensitive |
| `SessionStatus` | `client/src/pages/Home.tsx` | Home UI state | No |
| `HistoryItem` | `client/src/pages/Home.tsx` | local history UI/storage | User content; privacy-sensitive |
| `File analyze input` | `server/routers.ts` | Home file UI and server procedure | File content; sensitive |
| `OPENAI_API_KEY` | server environment | server provider calls only | Yes; server-only |

## Existing Contract Test Coverage

| Contract area | Existing coverage |
|---|---|
| Persona values | `server/juni.tools.test.ts` checks distinct genders and voice names. Full field equality is not tested. |
| Language values | `server/juni.tools.test.ts` checks canonical language IDs and Zod acceptance/rejection. |
| Tool definitions | `server/juni.tools.test.ts` checks exact three-tool name allowlist and required parameter structure. Confirmation semantics remain a UI/runtime behavior. |
| `UserId` | `server/identity.contract.test.ts` proves type equality with `User["id"]` and verifies account output derives the authenticated context identifier. |
| Authorization | `server/auth.logout.test.ts` checks logout cookie clearing; protected/admin rejection paths do not have dedicated tests. |
| API input validation | `server/juni.tools.test.ts` checks recharge amount boundaries plus persona and language acceptance/rejection. File schema tests were not found. |
| Error behavior | `server/orchestration.test.ts` checks empty provider response rejection; shared `HttpError` factories have no direct tests. |
| Voice states | `client/src/lib/voiceState.test.ts` checks valid/invalid state transitions and labels. |
| Workspace status | `client/src/lib/workspaceStatus.test.ts` checks retryable creation error and neutral state. |
| Database contracts | No database integration/schema test found. |

## Versioning Rules

- **Breaking contract change:** Removes or renames a field/value, changes requiredness or meaning, changes authorization semantics, changes provider behavior incompatibly, or invalidates existing consumers. Requires migration plan, compatibility review, and updated tests.
- **Non-breaking contract change:** Adds an optional field/value, adds a new isolated capability, or broadens a response without invalidating existing consumers. Still requires consumer and provider compatibility review.
- **Deprecated contract:** Remains available temporarily but is marked for removal, documented with replacement and timeline, and covered by migration tests where applicable.
- **Migration-required contract:** A change that requires database migration, persisted-data transformation, provider configuration change, or coordinated frontend/backend rollout before it can be safely deployed.

## Compatibility Rules

Every future contract change must verify:

1. Frontend compatibility.
2. Backend compatibility.
3. Database compatibility.
4. Provider compatibility.
5. Test compatibility.

A contract change must identify its canonical definition, consumers, sensitive fields, migration requirements, and rollback behavior before implementation.

## Product, Prompt, Database, Provider, and UI Separation

The following must remain separate and traceable:

```text
PRODUCT CONTRACT
      ≠
MODEL PROMPT
      ≠
DATABASE SCHEMA
      ≠
PROVIDER REQUEST
      ≠
UI STATE
```

The current repository has examples of this separation, but also has leakage to address later: OpenAI Realtime request/event details appear in both `server/routers.ts` and `client/src/pages/Home.tsx`, and the active UI owns provider event parsing.

## Validation Record

The latest Section 14 validation commands passed after the `UserId` contract implementation:

```text
Prettier scoped source/new-document check → PASS
git diff --check → PASS
pnpm check  → PASS
pnpm test   → PASS (4 files, 11 tests)
pnpm build  → PASS
```

The production build completed successfully. The contract change did not add a database migration, a database table, or a new provider integration.
