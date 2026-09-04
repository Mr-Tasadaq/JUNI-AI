# JUNI AI Database Audit

**Scope:** Read-only database contract audit for Step 6. No schema redesign, table deletion, migration, data migration, database write, or migration application was performed.

> **Current database ≠ target JUNI AI database.** This document distinguishes the active TypeScript schema, migration-declared tables, and the unknown state of any deployed database.

## 1. Database Engine

The repository is configured for **MySQL**:

- `drizzle.config.ts` sets `dialect: "mysql"`.
- `drizzle/schema.ts` imports MySQL column/table helpers from `drizzle-orm/mysql-core`.
- `server/db.ts` creates the client with `drizzle-orm/mysql2`.
- `DATABASE_URL` is the connection configuration input.

The **live database engine and deployed schema are UNKNOWN** because no database connection or migration command was executed during this audit. The repository configuration identifies the intended engine as MySQL; it does not prove the currently deployed database state.

## 2. ORM

The ORM is **Drizzle** with `drizzle-kit` for schema/migration tooling and `mysql2` for runtime connectivity.

Relevant files:

- `drizzle/schema.ts` — active TypeScript schema authority.
- `drizzle.config.ts` — Drizzle configuration.
- `drizzle/relations.ts` — currently empty relation declaration file.
- `server/db.ts` — runtime Drizzle client and user repository helpers.
- `drizzle/*.sql` — committed migration SQL.
- `drizzle/meta/*.json` — committed migration snapshots.

No Prisma schema, TypeORM model, raw SQL repository, or second ORM was found.

## 3. Tables

### Active TypeScript schema

The current `drizzle/schema.ts` defines exactly one table:

| Table | Purpose | Primary key | Foreign keys | Ownership relation | Timestamps | Indexes | Unique constraints |
|---|---|---|---|---|---|---|---|
| `users` | Manus OAuth users, profile data, role, and sign-in timestamps | `id` auto-increment integer | None | Not user-owned; it is the identity root | `createdAt`, `updatedAt`, `lastSignedIn` | Primary-key index; no additional declared index | `openId` unique |

### Tables declared by migration history

`drizzle/0001_motionless_whistler.sql` and `drizzle/meta/0001_snapshot.json` additionally declare the following tables, but they are **not present in the current `drizzle/schema.ts`**:

| Table | Intended purpose | Primary key | Foreign keys | Ownership relation | Timestamps | Indexes | Unique constraints | Active schema status |
|---|---|---|---|---|---|---|---|---|
| `conversations` | User conversation containers | `id` auto-increment integer | None declared | `userId` column suggests user ownership | `createdAt`, `updatedAt`, `lastMessageAt` | `conversations_user_id_idx(userId)` | None | DRIFT / not represented in current TS schema |
| `messages` | Conversation messages | `id` auto-increment integer | None declared | `userId` column suggests user ownership; `conversationId` suggests parent conversation | `createdAt` only | `messages_conversation_idx(conversationId, createdAt)`, `messages_user_idx(userId, createdAt)` | None | DRIFT / not represented in current TS schema |
| `storedFiles` | Stored file metadata and storage references | `id` auto-increment integer | None declared | `userId` column suggests user ownership | `createdAt` only | `stored_files_user_idx(userId, createdAt)` | `storageKey` unique | DRIFT / not represented in current TS schema |

Because the live database was not queried, these migration-declared tables are **not asserted to exist in the deployed database**. They are recorded as migration-history contracts only.

## 4. Columns

### 4.1 `users` — active TypeScript schema and migration 0000

| Column | Database type | Nullable | Default | Unique | Indexed | Required | Sensitivity |
|---|---|---:|---|---:|---:|---:|---|
| `id` | `int` | No | Auto-increment | No | Yes, primary key | Yes | PRIVATE identifier |
| `openId` | `varchar(64)` | No | None | Yes | Yes, unique | Yes | SENSITIVE external identity identifier |
| `name` | `text` | Yes | None | No | No | No | USER DATA |
| `email` | `varchar(320)` | Yes | None | No | No | No | USER DATA / potentially sensitive |
| `loginMethod` | `varchar(64)` | Yes | None | No | No | No | USER DATA / authentication metadata |
| `role` | `enum('user','admin')` | No | `'user'` | No | No additional index | Yes | SENSITIVE authorization data |
| `createdAt` | `timestamp` | No | `now()` | No | No additional index | Yes | PRIVATE metadata |
| `updatedAt` | `timestamp` | No | `now()` with update trigger behavior | No | No additional index | Yes | PRIVATE metadata |
| `lastSignedIn` | `timestamp` | No | `now()` | No | No additional index | Yes | PRIVATE metadata |

### 4.2 `conversations` — migration history only

| Column | Database type | Nullable | Default | Unique | Indexed | Required | Sensitivity |
|---|---|---:|---|---:|---:|---:|---|
| `id` | `int` | No | Auto-increment | No | Yes, primary key | Yes | PRIVATE identifier |
| `userId` | `int` | No | None | No | Yes, `conversations_user_id_idx` | Yes | SENSITIVE ownership link |
| `title` | `varchar(160)` | No | `'New conversation'` | No | No | Yes | USER DATA |
| `createdAt` | `timestamp` | No | `now()` | No | No additional index | Yes | PRIVATE metadata |
| `updatedAt` | `timestamp` | No | `now()` with update trigger behavior | No | No additional index | Yes | PRIVATE metadata |
| `lastMessageAt` | `timestamp` | Yes | None | No | No | No | PRIVATE metadata |

### 4.3 `messages` — migration history only

| Column | Database type | Nullable | Default | Unique | Indexed | Required | Sensitivity |
|---|---|---:|---|---:|---:|---:|---|
| `id` | `int` | No | Auto-increment | No | Yes, primary key | Yes | PRIVATE identifier |
| `conversationId` | `int` | No | None | No | Yes, composite conversation/time index | Yes | SENSITIVE ownership path |
| `userId` | `int` | No | None | No | Yes, composite user/time index | Yes | SENSITIVE ownership link |
| `role` | `enum('system','user','assistant','tool')` | No | None | No | No additional index | Yes | PRIVATE control metadata |
| `content` | `text` | No | None | No | No | Yes | USER DATA / potentially SENSITIVE content |
| `status` | `enum('complete','error')` | No | `'complete'` | No | No additional index | Yes | PRIVATE processing metadata |
| `createdAt` | `timestamp` | No | `now()` | No | No additional index | Yes | PRIVATE metadata |

### 4.4 `storedFiles` — migration history only

| Column | Database type | Nullable | Default | Unique | Indexed | Required | Sensitivity |
|---|---|---:|---|---:|---:|---:|---|
| `id` | `int` | No | Auto-increment | No | Yes, primary key | Yes | PRIVATE identifier |
| `userId` | `int` | No | None | No | Yes, composite user/time index | Yes | SENSITIVE ownership link |
| `storageKey` | `varchar(512)` | No | None | Yes | Yes, unique | Yes | SENSITIVE storage locator; not a raw secret but should be protected |
| `storageUrl` | `varchar(1024)` | No | None | No | No | Yes | PRIVATE; may reveal storage location |
| `originalName` | `varchar(255)` | No | None | No | No | Yes | USER DATA |
| `mimeType` | `varchar(255)` | No | None | No | No | Yes | USER DATA / processing metadata |
| `sizeBytes` | `bigint` | No | None | No | No | Yes | PRIVATE metadata |
| `sha256` | `varchar(64)` | Yes | None | No | No | No | PRIVATE content fingerprint |
| `createdAt` | `timestamp` | No | `now()` | No | No additional index | Yes | PRIVATE metadata |

No JSON database columns were found. Text columns such as `messages.content`, `users.name`, and `storedFiles.originalName` are unstructured text, not validated structured blobs.

## 5. Primary Keys

| Entity/table | Stable primary key | Status |
|---|---|---|
| User / `users` | `id` auto-increment integer | EXISTS in active schema |
| Conversation / `conversations` | `id` auto-increment integer | EXISTS in migration history only; absent from active schema |
| Message / `messages` | `id` auto-increment integer | EXISTS in migration history only; absent from active schema |
| File / `storedFiles` | `id` auto-increment integer | EXISTS in migration history only; absent from active schema |
| Memory | None | MISSING |
| Task | None | MISSING |
| Activity | None | MISSING |
| Research | None | MISSING |

No UUID, external provider ID, session ID, or domain-specific stable identifier exists for future domains.

## 6. Foreign Keys

### Declared foreign keys

**None found.** Neither the active schema nor the committed migration SQL defines a `FOREIGN KEY` constraint.

### Relationship evidence without constraints

| Intended relationship | Evidence | Status |
|---|---|---|
| `conversations.userId → users.id` | `conversations.userId` is a required integer | FK MISSING |
| `messages.conversationId → conversations.id` | `messages.conversationId` is a required integer | FK MISSING |
| `messages.userId → users.id` | `messages.userId` is a required integer | FK MISSING |
| `storedFiles.userId → users.id` | `storedFiles.userId` is a required integer | FK MISSING |
| `memory → users` | No memory table | NOT APPLICABLE / MISSING |
| `task → users` | No task table | NOT APPLICABLE / MISSING |
| `activity → users` | No activity table | NOT APPLICABLE / MISSING |

`drizzle/relations.ts` is effectively empty and does not provide ORM relation definitions.

## 7. Ownership

### `users`

The `users` table is the identity root, not a user-owned child resource. The OAuth `openId` identifies the external account, while `id` is the internal stable identity key.

### Migration-declared user-owned tables

- `conversations.userId` represents intended ownership.
- `messages.userId` represents intended user association, and `conversationId` represents intended conversation membership.
- `storedFiles.userId` represents intended ownership.

Ownership is not enforced by foreign keys, schema relations, repository queries, or current feature procedures because no active feature queries for these tables were found. Ownership cannot be changed through a current API path because no current CRUD API exists for them.

### Ownership summary

| Table | Owner representation | Can ownership be changed? | Where ownership is checked? |
|---|---|---:|---|
| `users` | Identity itself (`id`, `openId`) | Not through a feature API | OAuth/session identity flow |
| `conversations` | Required `userId` column in migration | Unknown; no active API | NOWHERE in active application code |
| `messages` | Required `userId` and `conversationId` columns in migration | Unknown; no active API | NOWHERE in active application code |
| `storedFiles` | Required `userId` column in migration | Unknown; no active API | NOWHERE in active application code |

## 8. Authorization Alignment

The desired flow is:

```text
Authenticated User
        ↓
API Authorization
        ↓
Owner check
        ↓
Database query
```

The current application satisfies the identity/procedure portion for user authentication:

- `createContext()` resolves `ctx.user`.
- `protectedProcedure` requires a non-null user.
- Current account/realtime/file procedures derive user identity from `ctx.user`, not a client-supplied `userId`.
- `server/db.ts` uses `getUserByOpenId` and `upsertUser` for the active users table.

The current application does **not** provide an active repository/query layer for migration-declared conversations, messages, or stored files. Therefore owner checks for those tables are **UNKNOWN / NOT IMPLEMENTED**. No evidence was found of a current client-supplied `userId` query in the active router.

## 9. Delete Behavior

No foreign keys are declared, so database-level `CASCADE`, `RESTRICT`, or `SET NULL` behavior is not configured for the migration-declared relationships.

| Relationship | Database action | Application action | Status |
|---|---|---|---|
| Conversation → User | No FK action | No delete procedure found | MANUAL CLEANUP / UNKNOWN |
| Message → Conversation | No FK action | No delete procedure found | MANUAL CLEANUP / UNKNOWN |
| Message → User | No FK action | No delete procedure found | MANUAL CLEANUP / UNKNOWN |
| Stored file → User | No FK action | No delete procedure found | MANUAL CLEANUP / UNKNOWN |

Without foreign keys, parent deletion cannot be assumed to protect against child orphans.

## 10. Timestamps

| Table | `createdAt` | `updatedAt` | `deletedAt` | `archivedAt` | `revokedAt` |
|---|---:|---:|---:|---:|---:|
| `users` | Yes | Yes | No | No | No |
| `conversations` | Yes | Yes | No | No | No |
| `messages` | Yes | No | No | No | No |
| `storedFiles` | Yes | No | No | No | No |
| Memory | Missing | Missing | Missing | Missing | Missing |
| Task | Missing | Missing | Missing | Missing | Missing |
| Activity | Missing | Missing | Missing | Missing | Missing |
| Research | Missing | Missing | Missing | Missing | Missing |

`lastMessageAt` exists on migration-declared conversations as a domain-specific activity timestamp, but it is not a deletion or archival marker.

## 11. Soft Delete / Archive

No `deletedAt`, `archivedAt`, or `revokedAt` columns were found. Current schema/migration behavior supports neither soft deletion nor archive/revoke state.

| Domain | Hard delete | Soft delete | Archive | Revoke |
|---|---|---|---|---|
| User | No current delete procedure | None | None | None |
| Conversation | No current delete procedure | None | None | None |
| Message | No current delete procedure | None | None | None |
| Stored file | No current delete procedure | None | None | None |
| Memory | Missing | Missing | Missing | Missing |

Memory must not be added until approval, consent, provenance, and revocation semantics are designed explicitly.

## 12. Memory Readiness

| Requirement | Status | Evidence |
|---|---|---|
| Memory record | MISSING | No memory table or repository |
| Memory candidate | MISSING | No candidate table or workflow |
| Approval | MISSING | No approval field/procedure |
| Consent | MISSING | No database consent contract |
| Ownership | MISSING | No memory owner field |
| Trust state | MISSING | No trust-state field |
| Provenance | MISSING | No source/provider/trace fields |
| Version | MISSING | No version field or revision model |
| Revocation | MISSING | No revoked/deleted state |

The database is **not memory-ready** beyond having an identity table that could eventually own memory records. No memory schema should be inferred from current tables.

## 13. File Readiness

| Requirement | Status | Evidence |
|---|---|---|
| File metadata | PARTIAL | Migration `storedFiles` includes name, MIME type, size, hash, and timestamps; absent from active TypeScript schema |
| Storage key | PARTIAL | `storedFiles.storageKey` exists in migration history; no active model/query |
| MIME type | PARTIAL | `storedFiles.mimeType` exists in migration history |
| Size | PARTIAL | `storedFiles.sizeBytes` exists in migration history |
| Owner | PARTIAL | `storedFiles.userId` exists, but no FK or active ownership query |
| Processing state | MISSING | No processing-state column |
| Analysis state | MISSING | No analysis-state column |
| Deleted/archive state | MISSING | No lifecycle columns |
| Storage deletion coordination | MISSING | No delete service/procedure found |

The active `files.analyze` API accepts base64 input and returns analysis text, but it does not persist a file record through the database contract audited here.

## 14. Conversation Readiness

| Requirement | Status | Evidence |
|---|---|---|
| Conversation record | PARTIAL | Migration history defines `conversations`; absent from active schema and application queries |
| Messages | PARTIAL | Migration history defines `messages`; absent from active schema and application queries |
| Roles | PARTIAL | Message role enum includes `system`, `user`, `assistant`, `tool` |
| Timestamps | PARTIAL | Conversation/message timestamps exist in migration history |
| Provider/model metadata | MISSING | No provider/model columns |
| Session relationship | MISSING | No session ID or Realtime session relationship |
| Ownership FK | MISSING | `userId` columns exist but no FK |

`server/orchestration.ts` has an in-memory request history type, but this is not a persisted conversation/message database contract.

## 15. Task Readiness

Task infrastructure is **MISSING**:

- Task table — MISSING
- Status — MISSING
- Priority — MISSING
- Schedule — MISSING
- Owner — MISSING
- `createdAt` — MISSING
- `completedAt` — MISSING

The heartbeat helper contains infrastructure-level scheduled callback concepts, but no user-owned task database model was found.

## 16. Provenance Readiness

Provenance is **MISSING** from the database:

- Source — MISSING
- Source type — MISSING
- Source ID — MISSING
- Created by — MISSING
- Model/provider — MISSING
- Timestamp — only generic timestamps exist on current/migration tables
- Version — MISSING
- Trace/audit ID — MISSING

The current code logs some provider events and uses an `OpenAI-Safety-Identifier` derived from the user identity, but neither is a persisted provenance contract.

## 17. Indexes

### Existing indexes

| Table | Index | Columns | Unique |
|---|---|---|---:|
| `users` | Primary key | `id` | Yes, primary-key semantics |
| `users` | `users_openId_unique` | `openId` | Yes |
| `conversations` | `conversations_user_id_idx` | `userId` | No |
| `messages` | `messages_conversation_idx` | `conversationId`, `createdAt` | No |
| `messages` | `messages_user_idx` | `userId`, `createdAt` | No |
| `storedFiles` | `stored_files_user_idx` | `userId`, `createdAt` | No |
| `storedFiles` | `storedFiles_storageKey_unique` | `storageKey` | Yes |

### Frequently queried fields

- `userId`: indexed in migration-declared child tables.
- `conversationId`: indexed with `createdAt` in migration-declared messages.
- `createdAt`: included in child-table composite indexes; no standalone timestamp indexes.
- `status`: no index; message status is not currently queried by active code.
- `type`: no database field/index found.

No indexes were added or changed during this audit.

## 18. Unique Constraints

| Identifier | Current constraint | Assessment |
|---|---|---|
| `users.id` | Primary key | Correct stable internal identifier |
| `users.openId` | Unique | Correct for external Manus identity mapping |
| `users.email` | No unique constraint | Appropriate only if email is not the identity key; policy is undocumented |
| `storedFiles.storageKey` | Unique in migration history | Appropriate for storage object key; absent from active schema |
| Provider IDs | No fields/constraints | MISSING |
| Session IDs | No fields/constraints | MISSING |
| Conversation/message IDs | Primary keys in migration history | Stable per-row IDs; not active TypeScript contracts |

No duplicate external ID or provider ID contract exists because those fields do not exist.

## 19. Sensitive Data

| Classification | Current fields |
|---|---|
| PUBLIC | No database column is explicitly classified public. |
| USER DATA | `users.name`, `users.email`, conversation titles, message content, stored file name/MIME/size. |
| PRIVATE | Internal IDs, timestamps, login method, storage URL, content hashes, message status. |
| SENSITIVE | `users.openId`, role, user ownership IDs, conversation/message relationships, storage keys. |
| SECRET | No raw API key or session secret is stored in the database schema. |

No raw `OPENAI_API_KEY`, JWT secret, OAuth token, or other provider credential is represented in the database schema inspected.

## 20. JSON / Structured Data

No JSON-typed database columns were found.

Text fields are not automatically structured JSON fields:

- `messages.content` is unstructured message content.
- `users.name` and `storedFiles.originalName` are unstructured strings.

No schema validation is applied to future structured content because no such field exists. If structured provider metadata, tool arguments, provenance, or memory payloads are added later, the contract must define whether to normalize them into columns or validate a versioned JSON document before persistence.

## 21. Migration Status

| Item | Finding |
|---|---|
| Migration count | 2 committed SQL files: `0000_early_onslaught.sql` and `0001_motionless_whistler.sql` |
| Latest migration | `0001_motionless_whistler.sql` |
| Snapshot count | 2 snapshots: `0000_snapshot.json` and `0001_snapshot.json` |
| Journal entries | `drizzle/meta/_journal.json` contains `
 entries: []` despite the presence of two SQL files and two snapshots |
| Schema/migration consistency | DRIFT: active `drizzle/schema.ts` defines only `users`, while migration 0001 and snapshot 0001 define `conversations`, `messages`, and `storedFiles` |
| Pending migration | UNKNOWN without connecting to the database; the journal metadata itself does not list migration entries |
| Manual SQL | The committed migration SQL is generated-style SQL; no separate manual SQL script was found |

The empty journal is significant: it does not establish that either migration has been applied. It also conflicts with the presence of migration SQL/snapshots and requires deployment-state verification.

## 22. Schema Drift

| Comparison | Status | Evidence |
|---|---|---|
| `drizzle/schema.ts` vs migration 0000 | MATCH | Both describe `users` with the same fields and constraints. |
| `drizzle/schema.ts` vs migration 0001 | DRIFT | Migration 0001 adds three tables not represented in the active schema. |
| `drizzle/schema.ts` vs snapshot 0001 | DRIFT | Snapshot 0001 contains `conversations`, `messages`, and `storedFiles`; active schema does not. |
| Migrations vs application queries | UNKNOWN / PARTIAL | Application runtime queries only users; no active queries use the migration-declared feature tables. |
| Repository vs deployed database | UNKNOWN | No database connection or introspection was performed. |

The most important current database risk is schema authority ambiguity: a future `drizzle-kit generate` from the active schema could treat migration-declared tables as removed or otherwise produce unsafe drift unless the schema/migration history is reconciled in a dedicated migration review.

## 23. Database Access Boundary

Desired pattern:

```text
Feature
  ↓
Database service/repository
  ↓
Drizzle
  ↓
Database
```

### Actual access points

| Location | Access | Boundary status |
|---|---|---|
| `server/db.ts` | Creates Drizzle MySQL client; implements `upsertUser` and `getUserByOpenId` | CANONICAL repository boundary for the active users table |
| `server/_core/oauth.ts` | Calls `db.upsertUser` | Correctly uses the database helper |
| `server/_core/sdk.ts` | Calls `db.getUserByOpenId` and `db.upsertUser` | Correctly uses the database helper |
| `server/_core/context.ts` | Imports `User` type only | Type-level dependency, not a database query |
| `shared/types.ts` | Re-exports schema-derived types | Type-level dependency, not a database query |
| Client source | No Drizzle/database runtime import found | No direct browser database access found |
| Feature routers | No direct Drizzle queries found | Feature persistence is absent rather than bypassing the repository |

No direct database access bypassing `server/db.ts` was found in active server feature code. There is no repository/service layer for migration-declared conversations, messages, or stored files because those tables are not represented in active application code.

## 24. Transactions

No `.transaction(...)` usage was found.

| Operation | Current status | Assessment |
|---|---|---|
| Upsert user during OAuth | Single SQL `INSERT ... ON DUPLICATE KEY UPDATE` statement | NON-TRANSACTIONAL at application level; atomic as one database statement subject to MySQL semantics |
| Create account/user plus session | User upsert and session token creation occur in separate application operations | NON-TRANSACTIONAL / UNKNOWN cross-system atomicity |
| Create conversation + first message | No active operation | UNKNOWN / MISSING |
| Approve memory | No operation | MISSING |
| Delete/revoke memory | No operation | MISSING |
| Start task | No operation | MISSING |
| Recharge/account balance | No database operation; provider is not connected | NOT APPLICABLE in current preview |

No schema or transaction behavior was changed.

## 25. Race Conditions

### Current user upsert

`upsertUser` uses a single insert/upsert statement keyed by the unique `openId`. This avoids a separate read-then-insert race for user creation. Concurrent profile updates can still have last-write-wins semantics for nullable profile fields and `lastSignedIn`; no explicit version or optimistic-lock field exists.

### Migration-declared tables

No active application queries or read-modify-write operations were found for `conversations`, `messages`, or `storedFiles`, so runtime race behavior for those tables is UNKNOWN. Their schema lacks version counters or explicit optimistic-lock columns.

### Future/high-risk state

| State | Current status |
|---|---|
| Balance | No persisted balance; current account response is `null` preview data |
| Memory status | No memory table/state |
| Approval state | No approval table/state |
| Task state | No task table/state |
| File processing state | No processing-state column |

## 26. Missing Contracts

The database contract is missing or incomplete for:

- Active Drizzle definitions for migration-declared `conversations`, `messages`, and `storedFiles`.
- Explicit foreign keys and relation declarations.
- User-owned resource repository/query contracts.
- Conversation/message provider and session metadata.
- File processing, analysis, retention, deletion, and archive state.
- Memory and memory-candidate records.
- Consent, approval, trust state, provenance, versioning, and revocation.
- Research, observation, experience, and retrieval-trace records.
- Task status, priority, schedule, owner, and completion timestamps.
- Activity and audit/provenance records.
- Provider/session/external IDs and uniqueness policies.
- Migration journal consistency and deployed migration-state verification.

## 27. Risks

### HIGH

**DB-H-01 — Active schema and migration history drift.** `drizzle/schema.ts` contains only `users`, while migration 0001/snapshot 0001 contain `conversations`, `messages`, and `storedFiles`. Future schema generation or migration work could accidentally remove, ignore, or recreate tables depending on the actual database state.

**DB-H-02 — Migration journal/deployed state is unknown.** `_journal.json` contains no entries even though two migrations and snapshots are committed. The live database was not inspected, so applied/pending state cannot be asserted.

**DB-H-03 — Migration-declared ownership relationships have no foreign keys.** Required `userId` and relationship IDs are not backed by FK constraints, allowing orphan rows unless application code consistently protects them. No active feature repository currently performs those checks.

### MEDIUM

**DB-M-01 — No active repository contract for feature tables.** Migration-declared tables have no matching TypeScript schema or query helpers, making them effectively unavailable to the current application while possibly existing in some deployment.

**DB-M-02 — No lifecycle fields.** Current and migration-declared records have no deletion, archival, revocation, or file processing state. This is especially unsafe for future Memory and File systems.

**DB-M-03 — No provenance or provider metadata.** Conversation/message/file migrations do not record provider/model/session/source/version information.

**DB-M-04 — No transaction or concurrency contract for future domain writes.** There is no transaction helper or optimistic-lock pattern for operations that will eventually require atomicity.

**DB-M-05 — Email is not unique.** This may be intentional because `openId` is the identity key, but the policy is undocumented and duplicate email behavior is not defined.

### LOW

**DB-L-01 — Timestamp coverage is uneven.** Messages and stored files have `createdAt` but no `updatedAt`; users and conversations have update timestamps.

**DB-L-02 — No standalone indexes for status/type.** Migration tables index owner/time and conversation/time, but not status or type. This is not currently a performance defect because active queries are absent.

### INFO

**DB-I-01 — No raw secrets are modeled.** The schema contains no provider API keys, OAuth tokens, JWT secrets, or other raw credentials.

**DB-I-02 — Current deployed database is not known.** This audit is repository-based and did not connect to or modify a database.

## 28. Recommended Changes

Recommendations are intentionally not implemented in this audit step:

1. Reconcile `drizzle/schema.ts`, migration 0001, snapshots, and the migration journal in a dedicated schema-drift change. Do not run `db:push` until the intended authority is confirmed.
2. Verify the deployed database with a read-only schema/migration-status inspection before any migration generation or application.
3. Decide whether `conversations`, `messages`, and `storedFiles` are active product tables or stale migration artifacts; do not describe them as current runtime tables until that decision is documented.
4. If retained, add active Drizzle definitions, repository helpers, ownership predicates, and explicit foreign-key/relation policy through a separate migration-reviewed change.
5. Define deletion, archive, retention, and revocation semantics before Memory or persistent File features are introduced.
6. Define provenance and provider/session metadata before persisting model-generated or retrieved content.
7. Add database sanity and validation scripts that can distinguish schema files, migration history, and deployed schema state.
8. Add transaction and concurrency tests for any future multi-row operation, especially memory approval/revocation, conversation/message creation, task state transitions, and account balance changes.
9. Document whether email is an identity attribute or merely profile data before adding uniqueness.
10. Keep database-derived types sourced from the canonical Drizzle schema; do not hand-maintain duplicate entity interfaces.

## Entity Matrix

| Entity | Exists in active schema | Exists in migration history | Owner | FK | Soft delete | Provenance |
|---|---:|---:|---|---|---|---|
| User | YES | YES | Identity root | Not applicable | None | None |
| Conversation | NO | YES | `userId` intended | MISSING | None | MISSING |
| Message | NO | YES | `userId`/conversation intended | MISSING | None | MISSING |
| File | NO | YES as `storedFiles` | `userId` intended | MISSING | None | MISSING |
| Memory | NO | NO | Missing | Missing | Missing | Missing |
| MemoryCandidate | NO | NO | Missing | Missing | Missing | Missing |
| Research | NO | NO | Missing | Missing | Missing | Missing |
| Task | NO | NO | Missing | Missing | Missing | Missing |
| Activity | NO | NO | Missing | Missing | Missing | Missing |

## Future Migration Rule

Every future schema change requires:

1. An explicit migration.
2. Backward-compatibility review.
3. Ownership review.
4. Authorization review.
5. Data-loss review.
6. Migration validation against the intended deployed state.
7. Rollback consideration.
8. Updated schema/migration consistency checks.
9. Updated repository and API contract tests.

No schema change is authorized by this audit document.

## Validation Record

Database checks that actually exist in the repository were evaluated without applying migrations:

| Check | Result | Reason |
|---|---|---|
| `pnpm check` | PASS | TypeScript completed successfully |
| `pnpm test` | PASS | 3 test files, 8 tests passed |
| `pnpm build` | PASS | Frontend and server bundles completed; existing chunk-size warning emitted |
| `pnpm db:push` | NOT RUN | Exists, but it generates/applies migrations and would change database state; prohibited in this audit |
| Database introspection | BLOCKED / UNKNOWN | No read-only database connection/introspection was performed |
| Dedicated `db:sanity` script | NOT AVAILABLE | No such script exists |
| Dedicated `db:validate` script | NOT AVAILABLE | No such script exists |

No database behavior was changed.
