# JUNI AI Core Domain Model

**Scope:** Step 10 conceptual domain-model audit. This document defines and audits domain concepts without creating database tables or Drizzle relations.

> **No schema expansion was performed.** No migration, table, relation, data migration, or database write was created in Step 10.

## CURRENT IMPLEMENTATION

### Current database reality

The canonical active Drizzle schema is `drizzle/schema.ts`. It defines exactly one database table:

```text
users
```

Known identity fields, and only those fields, are:

| Field | Current meaning |
|---|---|
| `id` | Auto-increment integer internal user identifier |
| `openId` | Unique Manus OAuth identity identifier |
| `name` | Nullable user display name |
| `email` | Nullable user email |
| `loginMethod` | Nullable authentication method metadata |
| `role` | Required enum: `user` or `admin`; default `user` |
| `createdAt` | User creation timestamp |
| `updatedAt` | User update timestamp |
| `lastSignedIn` | Last sign-in timestamp |

No additional user columns are inferred by this document.

### Current relationship reality

```text
users
  ↓
NO declared Drizzle relations
```

`drizzle/relations.ts` status: **CURRENT STATUS: EMPTY**.

There are no active Drizzle relations or foreign keys in the current canonical schema. Migration-history files mention `conversations`, `messages`, and `storedFiles`, but those entities are not represented in the current `drizzle/schema.ts`; they are therefore treated as migration-history artifacts or unresolved future/storage contracts, not current active domain tables.

### Current runtime concepts

- **User:** Implemented as the authenticated identity root and database table.
- **Authentication session:** Implemented at runtime as a signed JWT in the `app_session_id` cookie, with a preview bearer fallback; not a database table.
- **AI conversation session:** Runtime-only Realtime/WebRTC interaction state in the browser/provider; not the same as the authentication session and not persisted as a current table.
- **Account:** Preview-only router responses; no account, balance, ledger, pricing, or payment tables.
- **File analysis:** Transient protected API call; no current file table is represented in the active schema.
- **Personas/languages:** Shared TypeScript contracts, not database entities.
- **Memory, research, task, activity, provenance:** Not implemented as active tables or domain services.

## TARGET JUNI AI MODEL

The target model is conceptual only. It is not a claim that these entities currently exist in the database.

```text
JUNI AI
                       │
              ┌────────┴────────┐
              │                 │
            USER             SESSION
              │
      ┌───────┼────────┬──────────┐
      │       │        │          │
   CHAT     FILES    MEMORY    TASKS
    │         │        │
 MESSAGE    ANALYSIS  CANDIDATE
                       │
                    APPROVAL
                       │
                    MEMORY
                       │
                  PROVENANCE
                       │
                    SOURCE
                       │
                  RESEARCH
                       │
                    ACTIVITY
```

The target model separates identity, interaction, durable personalization, evidence, work execution, user-visible activity, and security/audit records.

## Current Implemented Domains

### User

**Status:** Implemented as the only active database entity.

**Purpose:** Authenticated owner of JUNI AI resources.

- **Identity:** Internal `id` plus unique external `openId`.
- **Authentication:** Manus OAuth establishes identity; server-signed JWT session is verified on requests.
- **Role:** Current enum is `user` or `admin`.
- **Ownership:** Future user-owned resources should point to this identity root; no current child resource relation is declared.
- **Account lifecycle:** Created/upserted during OAuth synchronization; `lastSignedIn` is updated during authenticated request handling.
- **Deletion:** No current user deletion procedure or deletion semantics.
- **Provenance:** No current user audit/provenance record.

### Authentication Session

**Status:** Implemented at runtime, not as a database table.

**Purpose:** Prove that a browser/request is authenticated.

The authentication session is distinct from an AI conversation session. It contains signed session claims such as `openId`, `appId`, and `name`, has JWT expiration, and is transported primarily through `app_session_id`.

It must not automatically be treated as:

- A conversation.
- A conversation participant record.
- A memory approval.
- A provider Realtime session.
- A user-owned activity record.

### AI Conversation Session

**Status:** Runtime-only concept; not persisted in the active schema.

**Purpose:** Represent an active voice/WebRTC or future chat interaction with provider session state.

A conversation session may have provider session IDs, audio state, interruption state, and temporary context. Those values are not authentication credentials and should not become the sole ownership boundary.

## Planned V1 Domains

| Domain | Current DB | Planned V1 role | Owner | Persistent target | User visible |
|---|---:|---|---|---:|---:|
| User | YES | Identity root | Self/system identity | Yes | Yes |
| Session | UNKNOWN / runtime only | Authentication/session tracking | User | TBD | No |
| Conversation | NO | Logical interaction container | User | Yes | Yes |
| Message | NO | Individual conversational event | Conversation/user | Yes | Yes |
| File | NO | User file metadata and lifecycle | User | Yes | Yes |
| Memory | NO | Approved personalization information | User | Yes | Yes, policy-scoped |
| MemoryCandidate | NO | Potential memory awaiting review | User | Yes | Review-only until approved |
| Research | NO | Query, sources, evidence, synthesis | User | Yes or temporary | Yes |
| Source | NO | Origin of evidence/content | Owning resource | Yes or temporary | Yes, as permitted |
| Observation | NO | Pre-trust observed information | Owning workflow/resource | Often temporary | Limited |
| Provenance | NO | Origin/transformation/provider trace | Resource | Yes | Limited |
| Task | NO | Actionable user-owned work | User | Yes | Yes |
| Activity | NO | User-visible important operation/event | User | Yes | Yes |
| AuditEvent | NO | Security/operational trace | System/resource | Yes, append-only | Limited |
| Permission | NO | Resource-level access policy | User/resource | TBD | Limited |

`UNKNOWN` means the deployed database/runtime state must be verified before implementation. It does not mean the entity currently exists.

## Entity Definitions

### User

The authenticated owner identity. User identity is established by the authentication provider and mapped to the internal user record. A User may own conversations, files, memory candidates, memories, research, tasks, and activities in the target model.

### Session

A session is a time-bounded authentication or runtime interaction context. Authentication Session and AI Conversation Session are separate concepts:

| Session type | Purpose | Credential-bearing? | Persistent target |
|---|---|---:|---:|
| Authentication session | Prove request identity | Yes | Optional metadata; current JWT is stateless |
| AI conversation session | Coordinate active chat/voice interaction | Temporary provider/session identifiers | Optional interaction metadata |

Neither session type should be used as a substitute for User ownership.

### Conversation

A logical container for a user’s AI interaction history. Target relationship:

```text
User
  ↓ owns
Conversation
```

A conversation may contain messages, metadata, timestamps, selected assistant/persona, and provider/session references. A provider session ID is not its internal identity.

### Message

A single conversational event associated with a Conversation. Target relationship:

```text
Conversation
  ↓ contains
Message
```

Messages may inherit ownership through their Conversation rather than duplicating an owner field, depending on the eventual schema design.

#### Message roles

| Role | Conceptual purpose | Permission caution |
|---|---|---|
| `user` | User-authored request or input | User-visible and user-owned within conversation |
| `assistant` | Model/provider response | User-visible output, but not automatically trusted fact or memory |
| `system` | Internal instruction/configuration | Not automatically user-visible; system-only by default |
| `tool` | External action/result or tool exchange | Visibility and execution authority require explicit policy |

Roles must not automatically share the same permission category.

### File

A user-associated file concept that must separate:

1. **File metadata:** name, MIME type, size, hash, ownership, lifecycle state.
2. **File content:** bytes or content payload.
3. **AI analysis:** derived model output about the content.
4. **Storage object:** external storage key/provider location.

A File is not automatically a Memory, and a file’s analysis is not automatically trusted knowledge.

#### File lifecycle

```text
uploaded
   ↓
validated
   ↓
stored
   ↓
processing
   ↓
processed
   ↓
available
   ↓
archived / deleted
```

These are target conceptual states only. They are not implemented in the current active schema. The current `files.analyze` path is transient analysis and does not establish this lifecycle.

### Memory

Persistent information JUNI is allowed to retain for future personalization.

Core rule:

> **Message ≠ Memory.**

A conversation message must not automatically become persistent Memory. A model inference, file observation, or research result requires an explicit policy and, where required, user approval before becoming durable personalization.

### MemoryCandidate

A potential memory awaiting policy, review, and approval handling.

```text
Observation
   ↓
MemoryCandidate
   ↓
Review
   ↓
Approval
   ↓
Memory
```

A candidate is not active memory and must not be used as if it were approved merely because it was generated by a model.

### Memory categories

| Category | User-visible | Persistent | Intended meaning |
|---|---:|---:|---|
| `SESSION` | Usually yes | No/temporary | Context for one authentication or interaction session |
| `WORKING` | Limited | Temporary | Short-lived reasoning/workspace context |
| `USER` | Yes, permission-scoped | Yes | Approved personal preference/fact |
| `KNOWLEDGE` | Yes, permission-scoped | Yes | Approved reusable knowledge associated with the user/workspace |
| `SYSTEM` | No for normal users | Yes, system-controlled | Internal policy/system configuration; never exposed merely by authentication |

### Memory lifecycle

```text
candidate
   ↓
pending review
   ↓
approved
   ↓
active
   ↓
edited / versioned
   ↓
revoked
   ↓
deleted / expired
```

Not every memory must support every state. For example, temporary working context may expire without becoming approved memory. Revocation and deletion must remain distinct where auditability requires retaining a non-content event.

### Research

Research is a structured investigation that keeps evidence separate from personal memory.

```text
Research
  ↓
Query
  ↓
Sources
  ↓
Evidence
  ↓
Synthesis
```

Research results may be user-visible and may inform a response, but they do not automatically become Memory.

### Source

A Source represents where evidence or content originated. Possible source types include:

- Web page.
- Document.
- User file.
- Tool output.
- External dataset.

A Source is not automatically a Memory. A source may be temporary, retained for provenance, or deleted according to retention policy.

### Observation

An Observation is an observed piece of information before it becomes trusted or persistent knowledge. It is especially useful for voice input, files, research, chat, and multimodal input.

An Observation should carry enough context to distinguish raw observation from approved interpretation. It should not automatically receive the permission level of a Memory.

### Provenance

Provenance answers:

- Where did this information originate?
- How was it transformed?
- Which operation/provider produced it?
- Which source, model, tool, or user action contributed to it?

Conceptual chain:

```text
Source
   ↓
Observation
   ↓
Transformation
   ↓
Output
```

A future Memory may therefore have:

```text
Memory
  ↓
Provenance
  ↓
Source
```

### Task

A Task is an actionable unit of work owned by a User.

Target lifecycle:

```text
pending
   ↓
running
   ↓
completed
```

Possible terminal/alternate states include `failed` and `cancelled`. Task execution requires ownership, authorization, idempotency, retry, and audit semantics.

### Activity

Activity is a user-visible record of an important JUNI operation or event, such as a file analysis completed, task status changed, or memory approval requested.

Activity is not:

- An AuditEvent.
- A Conversation Message.
- A complete provenance record.

### AuditEvent

An AuditEvent is a security and operational trace, such as:

- Memory approved.
- Memory revoked.
- File deleted.
- Permission changed.
- Task executed.
- Provider credential issued.

AuditEvents should generally be append-only and access-controlled. They are not ordinary user-visible activity by default.

### Permission

Permissions are resource-level access rules and must not rely solely on roles.

Two levels must remain separate:

```text
ROLE
  +
RESOURCE PERMISSION
```

For example, a user role does not automatically grant access to sensitive memory, system memory, another user’s file, or all provenance records. Resource permission should be evaluated after identity and ownership resolution.

## Relationships

### Current relationships

```text
users
  ↓
NO DECLARED DRIZZLE RELATIONS
```

No current relationship is implemented in `drizzle/relations.ts`.

### Target relationship graph

```text
User
 │
 ├── Conversation
 │      └── Message
 │
 ├── File
 │
 ├── Memory
 │      └── MemoryCandidate
 │
 ├── Research
 │      └── Source
 │
 ├── Task
 │
 └── Activity
```

Provenance graph:

```text
Source
   ↓
Observation
   ↓
Provenance
   ↓
Memory / Research / Output
```

### Ownership inheritance

```text
Message
  ↓ belongs to
Conversation
  ↓ owned by
User
```

A Message may inherit ownership through Conversation rather than duplicating `ownerId`, depending on later schema review. If direct message ownership is retained for query performance or defense in depth, the relationship must be kept consistent and verified against the parent Conversation.

No entity should own itself, and no circular ownership is intended.

## Ownership

Every user-owned domain must resolve to an owner:

```text
User
  ↓
owned resource
```

Potentially owned domains:

- Conversation.
- File.
- Memory.
- MemoryCandidate.
- Research.
- Task.
- Activity.

Ownership rules:

1. The server derives the authenticated User from the authentication context.
2. The server resolves the resource owner from the resource relationship.
3. The server checks ownership or explicit resource permission.
4. Only then may the operation read, mutate, revoke, delete, or expose the resource.
5. Client-supplied `userId` or `ownerId` must not be treated as authoritative.

## Lifecycle

### User lifecycle

Current runtime lifecycle:

```text
OAuth identity observed
   ↓
users upserted
   ↓
authenticated session created
   ↓
lastSignedIn updated on authenticated requests
   ↓
logout clears browser credential
```

No current hard-delete, soft-delete, archive, revoke, or expiry policy exists for User.

### Conversation lifecycle

Target only:

```text
created
   ↓
active
   ↓
archived or deleted
```

### Message lifecycle

Target only:

```text
received
   ↓
processing
   ↓
complete or error
```

System/tool messages may have separate visibility and retention policies.

### File lifecycle

Target only:

```text
uploaded → validated → stored → processing → processed → available → archived/deleted
```

### Memory lifecycle

Target only:

```text
candidate → pending review → approved → active → edited/versioned → revoked → deleted/expired
```

### Research lifecycle

Target only:

```text
requested → querying → sources collected → evidence evaluated → synthesized → delivered/retained/expired
```

### Task lifecycle

Target only:

```text
pending → running → completed
                ├→ failed
                └→ cancelled
```

### Activity/AuditEvent lifecycle

Activity may be retained or hidden according to user-facing policy. AuditEvent and provenance events should generally be append-only, with access controlled independently from mutable user-facing activity.

## Security Boundaries

### Identity and ownership

User identity is separate from resource identity. Internal entity IDs, provider IDs, session IDs, request IDs, storage keys, and external source IDs must not be interchangeable.

### Memory consent

The following are separate concepts:

1. Memory existence.
2. Permission to create memory.
3. Permission to use memory.
4. Permission to view memory.
5. Permission to edit memory.
6. Permission to revoke memory.

A user may disable personalized memory without deleting all conversation history. A model must not silently convert messages, files, voice input, or research into memory.

### Sensitive memory

| Classification | Who can create | Who can view | Who can edit | Who can revoke |
|---|---|---|---|---|
| `NORMAL` | User-approved workflow; eligible system workflow | Owning user and explicitly authorized principals | Owner/authorized workflow | Owner/authorized workflow |
| `SENSITIVE` | Explicit user action or stronger approved workflow | Owner with additional permission; never broad authenticated access | Owner with additional permission | Owner, authorized policy, or required administrator workflow |
| `SYSTEM` | System/authorized administrators only | System/authorized administrators; not normal users | System/authorized administrators | System policy/authorized administrators |

These are target policies, not active implementation.

### Role versus resource permission

Role is a coarse identity attribute. Resource permission is evaluated for a specific resource. An ordinary `user` must not receive system memory, another user’s provenance, or all audit events merely because authentication succeeded. An `admin` role must not automatically bypass resource-specific privacy policy without an explicit policy decision.

## Provenance

Future provenance relationships:

```text
Source
   ↓
Observation
   ↓
Transformation
   ↓
Output
```

Possible provenance attributes, to be considered later rather than assumed now:

- Creator/actor.
- Source type and source ID.
- Provider and model.
- Operation/request/trace ID.
- Observed/transformed/created timestamps.
- Version.
- Confidence or trust state.
- Approval/revocation relationship.

Provenance access must follow the owning resource:

```text
resource owner
  ↓
authorized provenance
```

It must not follow this unsafe pattern:

```text
authenticated user
  ↓
all provenance
```

## Missing Domains

The following are not current database entities or active domain services:

- Session persistence/metadata.
- Conversation.
- Message.
- File metadata/content lifecycle.
- Memory.
- MemoryCandidate.
- Research.
- Source.
- Observation.
- Provenance.
- Task.
- Activity.
- AuditEvent.
- Resource Permission.
- Account/ledger/payment state.

Their absence is intentional for this step. No table or schema is created here.

## Domain Boundaries

Future conceptual domains and required boundaries:

| Domain | Owner | Service boundary | Storage boundary | API boundary | Permission boundary |
|---|---|---|---|---|---|
| IDENTITY | User/system | Auth/User Service | User repository | OAuth/auth procedures | Session and role policy |
| CONVERSATION | User | Conversation Service | Conversation/Message repository | Conversation/message API | Owner/participant policy |
| FILES | User | File Service | Metadata repository + storage adapter | Upload/analyze/retrieve/delete API | Owner/resource permission |
| MEMORY | User | Memory Service | Memory/Candidate repository | Candidate/review/memory API | Consent, visibility, sensitive policy |
| RESEARCH | User | Research Service | Research/source/evidence repository | Research API | Owner and source policy |
| TASKS | User | Task Service | Task repository/scheduler | Task API | Owner/execution permission |
| ACTIVITY | User/resource | Activity Service | Activity repository | Activity feed API | User visibility policy |
| PROVENANCE | Resource | Provenance Service | Append-only provenance repository | Limited provenance API | Resource-scoped access |
| SETTINGS | User/system | Settings Service | Settings repository | Settings API | User/admin policy |

## Entity Identity

Every future persistent entity requires a deliberate stable identity strategy. Candidates include:

- Numeric internal ID.
- UUID.
- External provider ID as a secondary attribute.
- Composite identity where domain semantics require it.

The current `users.id` is a numeric internal ID and `users.openId` is an external identity identifier. These must remain distinct.

Future records must separately model, where applicable:

- Internal entity ID.
- Provider ID.
- Authentication session ID.
- AI provider conversation/session ID.
- Request/correlation ID.
- Storage key.
- External source ID.

An external provider ID must never be the sole internal ownership boundary without deliberate review.

## Lifecycle Ownership

For each future domain, applicability of these actors must be decided:

| Actor | Meaning |
|---|---|
| Creator | Actor that first creates the record |
| Owner | User or system principal entitled to access/use it |
| Modifier | Actor that changes mutable state |
| Revoker | Actor that invalidates permission or trust |
| Deleter | Actor that removes content or schedules deletion |

Not every entity needs every actor. Immutable events may have creator/actor but no modifier.

## Deletion Semantics

Each future domain must explicitly choose among:

- Hard delete.
- Soft delete.
- Archive.
- Revoke.
- Expire.

These are not interchangeable:

- **Delete** removes or makes content unavailable.
- **Archive** preserves but removes from active views.
- **Revoke** invalidates permission, trust, or approval.
- **Expire** removes validity based on time or retention policy.
- **Soft delete** preserves a record marker for controlled recovery/audit.

No deletion semantics are implemented for the planned domains in Step 10.

## Versioning Requirements

Versioning should be evaluated especially for:

- Memory.
- Provenance.
- Research synthesis.
- User settings.
- Conversation metadata where edits matter.

A future design must decide whether changes overwrite the current record or create a new immutable version. Memory approval, edits, and revocations should preserve enough history to explain what the system knew and when.

## Immutable Events

The following records may need append-only semantics:

- AuditEvent.
- Provenance event.
- Activity event where historical accuracy matters.
- Approval/revocation event.

Immutable events are separate from mutable entities such as User profile, Conversation metadata, Memory state, Task state, and File metadata.

## Mutable Entities

Potentially mutable target entities include:

- User profile.
- Conversation metadata.
- Memory.
- Task.
- File metadata.
- Settings.

Mutation authorization, versioning, and audit behavior must be defined before schema implementation.

## Migration Strategy

No migration is created in Step 10. Future schema work should proceed in controlled increments:

1. Reconcile the active `users` schema with migration history before adding new entities.
2. Define one domain contract at a time, beginning with ownership and authorization.
3. Define repository and service responsibilities before table creation.
4. Add explicit foreign-key/relation decisions only after ownership inheritance is reviewed.
5. Add lifecycle, deletion, retention, and versioning fields only where the domain requires them.
6. Add provenance and immutable event strategy before persisting model-derived or retrieved content.
7. Generate one migration per controlled domain change.
8. Validate forward migration, rollback/compensation plan, data-loss risk, and deployed-state compatibility.
9. Add repository, authorization, lifecycle, concurrency, and provenance tests before exposing an API.
10. Do not treat migration-history tables as active entities until they are represented in the canonical schema and verified against deployment state.

## Domain Risk Register

### DOMAIN-001

- **Domain:** Core schema authority
- **Finding:** Active `drizzle/schema.ts` contains only `users`; migration history mentions additional tables, while `drizzle/relations.ts` is empty.
- **Current State:** One active table and no declared relations.
- **Target State:** Canonical schema and migration history agree before domain expansion.
- **Risk:** New domain work may build against stale or ambiguous persistence assumptions.
- **Required Decision:** Reconcile schema/migration authority in a dedicated database step.
- **V1 Blocker:** YES for persistent domain implementation; NO for this conceptual audit.

### DOMAIN-002

- **Domain:** Authentication Session vs AI Conversation Session
- **Finding:** Runtime authentication and AI provider sessions exist conceptually but are not separate persistent domain contracts.
- **Current State:** Stateless JWT auth session; transient Realtime/browser session.
- **Target State:** Explicitly separate identity proof, interaction session, and provider-session IDs.
- **Risk:** Session IDs or provider credentials could be misused as ownership or conversation identity.
- **Required Decision:** Define session ownership, retention, expiration, and provider-ID mapping.
- **V1 Blocker:** YES before persistent conversation/voice history.

### DOMAIN-003

- **Domain:** Memory consent and approval
- **Finding:** No Memory or MemoryCandidate exists; messages/files/research must not become memories silently.
- **Current State:** No memory persistence or approval flow.
- **Target State:** Observation → Candidate → Review → Approval → Memory with consent and revocation.
- **Risk:** Privacy violation, fabricated personalization, or unapproved retention.
- **Required Decision:** Define creation/use/view/edit/revoke permissions and user controls.
- **V1 Blocker:** YES before Memory implementation.

### DOMAIN-004

- **Domain:** Source and provenance
- **Finding:** Research evidence, file observations, model output, and personal memory have no persistent provenance model.
- **Current State:** No provenance tables or service.
- **Target State:** Source → Observation → Transformation → Output with resource-scoped access.
- **Risk:** Untraceable or over-trusted AI output and cross-user provenance leakage.
- **Required Decision:** Define source types, provider/model/request IDs, versioning, and access rules.
- **V1 Blocker:** YES before research/memory claims of traceability.

### DOMAIN-005

- **Domain:** Ownership graph
- **Finding:** Only User is active; all planned owned domains lack relations and owner enforcement.
- **Current State:** No declared Drizzle relations or foreign keys.
- **Target State:** Every owned entity resolves to an authenticated User through explicit ownership/inheritance.
- **Risk:** IDOR and orphaned resources.
- **Required Decision:** Decide direct versus inherited ownership for Message and other child entities.
- **V1 Blocker:** YES before user-owned persistence.

### DOMAIN-006

- **Domain:** Event versus mutable record separation
- **Finding:** Activity, AuditEvent, Provenance, Message, and mutable domain state are not yet distinct in storage.
- **Current State:** No active tables.
- **Target State:** Append-only security/provenance events are separate from mutable user-facing entities.
- **Risk:** Loss of historical traceability or accidental exposure of internal audit data.
- **Required Decision:** Define event retention, visibility, immutability, and access policy.
- **V1 Blocker:** NO for current preview; YES before production audit/provenance claims.

## Conceptual Consistency Checklist

- [x] No entity is designed to own itself.
- [x] No circular ownership is intended.
- [x] User is the identity root.
- [x] Memory is separated from messages.
- [x] Source is separated from memory.
- [x] AuditEvent is separated from Activity.
- [x] Authentication Session is separated from AI Conversation Session.
- [x] Provider IDs are separated from internal IDs.
- [x] Current implementation is separated from target model.
- [x] No database tables, migrations, relations, or data were created or modified.

## Validation Record

The repository was validated without changing the database structure:

| Command | Result |
|---|---|
| `pnpm test` | PASS — 3 test files, 8 tests |
| `pnpm check` | PASS — TypeScript completed successfully |
| `pnpm build` | PASS — frontend and server bundles completed; existing chunk-size warning emitted |

## Step 10 Status

**COMPLETE as a conceptual audit.** The current database reality is explicitly documented, the canonical User entity is defined without invented columns, planned domains and relationships are separated from implementation, and no schema work was performed.
