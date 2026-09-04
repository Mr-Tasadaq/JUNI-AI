# JUNI AI Event & State Model

**Scope:** Step 11 conceptual event/state audit. No event engine, event bus, state-machine library, schema migration, router rewrite, or runtime state-machine implementation was added.

## 1. Current Implementation Boundary

The repository currently has three separate sources of truth that must not be silently merged:

| Source | Current observation | Authority status |
|---|---|---|
| `docs/JUNI-AI-ARCHITECTURE.md` | Describes conversations/messages, protected conversation procedures, and broader V1 feature ownership | Architecture intent/documentation |
| `drizzle/schema.ts` | Exports only `users` | Active TypeScript schema authority |
| `drizzle/0001_motionless_whistler.sql` and snapshot | Contains migration-era `conversations`, `messages`, and `storedFiles` structures | Migration history/state artifact requiring reconciliation |
| `server/routers.ts` | Does not currently expose conversation/message procedures; exposes auth, realtime, files, account, and system procedures | Active API implementation |

The event/state model therefore marks events as **IMPLEMENTED**, **PARTIAL**, **DOCUMENTED ONLY**, or **NOT IMPLEMENTED** based on active code, not architecture claims or migration-only artifacts.

## 2. Universal JUNI Pipeline

Target conceptual flow:

```text
INPUT
  ↓
OBSERVATION
  ↓
VALIDATION
  ↓
AUTHORIZATION
  ↓
CONTEXT SELECTION
  ↓
ORCHESTRATION
  ↓
DECISION
  ↓
ACTION / RESPONSE
  ↓
OUTCOME
  ↓
PROVENANCE
  ↓
OPTIONAL FUTURE MEMORY / EVALUATION
```

Current implementation covers portions of this pipeline for authentication, voice, file analysis, and orchestration. It does not provide a universal event engine or durable event history.

## 3. Event Versus State

> **EVENT = something that happened.**
>
> **STATE = the current condition after events.**

Example:

```text
file.uploaded
      ↓
File state = stored
```

An event should be append-oriented and attributable. State may be mutable, derived, or reconstructed from valid events. A UI label or local state variable is not automatically a durable domain event.

## 4. Event Status Vocabulary

- **IMPLEMENTED:** Active code emits or handles an equivalent event/state transition.
- **PARTIAL:** A runtime action or local state exists, but there is no durable event contract, complete lifecycle, or complete domain implementation.
- **DOCUMENTED ONLY:** Architecture/shared documentation describes the concept, but active event/state code was not found.
- **NOT IMPLEMENTED:** No active implementation or authoritative runtime contract exists.

## 5. Immutable Event Registry

| Event ID | Event name | Domain | Producer | Consumer | Payload concept | Security | Persistent? | Idempotent? | Status |
|---|---|---|---|---|---|---|---:|---:|---|
| JUNI.AUTH.AUTHENTICATED | `user.authenticated` | Auth | OAuth callback/SDK | Context/client | user identity, session metadata | Sensitive | No durable event | Mostly | PARTIAL |
| JUNI.AUTH.LOGGED_OUT | `user.logged_out` | Auth | Logout procedure/browser | Client cookie state | user/session reference | Sensitive | No | Yes | PARTIAL |
| JUNI.CONVERSATION.CREATED | `conversation.created` | Conversation | Future Conversation Service | Message/Activity | conversation ID, owner | User data | No active producer | TBD | NOT IMPLEMENTED |
| JUNI.MESSAGE.CREATED | `message.created` | Conversation | Future Message Service | Orchestrator | message ID, conversation ID, role, content ref | User data | No active producer | TBD | NOT IMPLEMENTED |
| JUNI.MESSAGE.COMPLETED | `message.completed` | Conversation | Future Message Service | UI/Activity | result reference | User data | No active producer | TBD | NOT IMPLEMENTED |
| JUNI.MESSAGE.FAILED | `message.failed` | Conversation | Future Message Service | UI/Activity | safe error class | User data | No active producer | TBD | NOT IMPLEMENTED |
| JUNI.FILE.UPLOADED | `file.uploaded` | Files | Future File Service | Validation/storage | file metadata/storage ref | Sensitive | No active producer | TBD | NOT IMPLEMENTED |
| JUNI.FILE.ANALYZED | `file.analyzed` | Files | Current `files.analyze` request | UI/voice context | analysis result | Sensitive | No durable event | Unknown | PARTIAL |
| JUNI.VOICE.SESSION_STARTED | `voice.session.started` | Voice | Home/OpenAI WebRTC flow | UI/activity | provider session/model/persona | Sensitive | No | No guarantee | PARTIAL |
| JUNI.VOICE.SESSION_ENDED | `voice.session.ended` | Voice | Home cleanup/connection close | UI/activity | reason, session reference | Sensitive | No | Yes intent | PARTIAL |
| JUNI.RESEARCH.STARTED | `research.started` | Research | Future Research Service | Retrieval | query ID, owner | User data | No active producer | TBD | NOT IMPLEMENTED |
| JUNI.MEMORY.CANDIDATE_CREATED | `memory.candidate.created` | Memory | Future Memory Service | Review | observation/candidate ref | Sensitive | No active producer | TBD | NOT IMPLEMENTED |
| JUNI.MEMORY.APPROVED | `memory.approved` | Memory | Future approval workflow | Memory retrieval | candidate/memory ID, approver | Sensitive | No active producer | TBD | NOT IMPLEMENTED |
| JUNI.MEMORY.REVOKED | `memory.revoked` | Memory | Future permission workflow | Retrieval | memory ID, revoker | Sensitive | No active producer | TBD | NOT IMPLEMENTED |
| JUNI.TASK.CREATED | `task.created` | Tasks | Future Task Service | Scheduler/activity | task ID, owner | User data | No active producer | TBD | NOT IMPLEMENTED |
| JUNI.TASK.COMPLETED | `task.completed` | Tasks | Future executor | Activity/provenance | task ID, result ref | User data | No active producer | TBD | NOT IMPLEMENTED |
| JUNI.AUDIT.RECORDED | audit event | Audit | Future append-only audit writer | Security operations | who/what/when/resource/result | Restricted | No active writer | Append-only | NOT IMPLEMENTED |

Only mark an event implemented after active code confirms it. Local state updates and browser activity labels are not equivalent to durable event persistence.

## 6. Authentication State Model

Target model:

```text
UNKNOWN
   ↓
AUTHENTICATING
   ↓
AUTHENTICATED
```

Failure path:

```text
AUTHENTICATING
   ↓
AUTHENTICATION_FAILED
```

Logout path:

```text
AUTHENTICATED
   ↓
LOGGING_OUT
   ↓
SIGNED_OUT
```

Current implementation is partial: OAuth callback, JWT verification, context user resolution, and cookie clearing exist, but these named states are not emitted as durable events. Authentication failure can occur during OAuth or request verification; logout directly clears the cookie rather than persisting a logout event.

## 7. Session State Model

Authentication session and AI interaction session must remain separate.

Target authentication-session model:

```text
CREATED
  ↓
ACTIVE
  ↓
EXPIRED
```

Optional:

```text
ACTIVE
  ↓
REVOKED
```

Target AI interaction session uses a separate provider/runtime lifecycle. A provider Realtime session ID must not become the authentication session ID or the sole ownership key.

Current status: runtime sessions exist, but no durable session-state entity or event registry is implemented.

## 8. Conversation State Model

Target conceptual model:

```text
NEW
  ↓
ACTIVE
  ↓
IDLE
  ↓
ARCHIVED
```

Creation flow:

```text
conversation.create.requested
        ↓
authorization
        ↓
conversation.created
```

Current status: **NOT IMPLEMENTED in active router/schema**. Architecture documentation and migration artifacts describe the concept, but current `server/routers.ts` has no conversation procedures and active `drizzle/schema.ts` exports no conversation table.

## 9. Message State Model

Target model:

```text
CREATED
  ↓
PROCESSING
  ↓
COMPLETED
```

Failure path:

```text
PROCESSING
  ↓
ERROR
```

Retry path:

```text
ERROR
  ↓
RETRY_REQUESTED
  ↓
PROCESSING
```

A retry must not automatically create a duplicate user message. One logical send requires one stable request identity and one logical message identity.

Current status: UI-local message/history concepts and migration artifacts exist, but no active durable Message API/service is present. The send flow is not wrapped in a durable idempotency design.

## 10. AI Generation State

Target model:

```text
REQUESTED
   ↓
VALIDATING
   ↓
CONTEXT_BUILDING
   ↓
MODEL_CALLING
   ↓
RESPONSE_RECEIVED
   ↓
PERSISTING
   ↓
COMPLETED
```

Failure:

```text
MODEL_CALLING
   ↓
PROVIDER_ERROR
   ↓
ERROR
```

Current `orchestrateConversation` partially implements `CONTEXT_BUILDING → MODEL_CALLING → RESPONSE_RECEIVED` and rejects an empty response. Current file/realtime routes perform separate provider workflows. There is no active persistence stage for conversation output.

Failure classes must remain distinct:

```text
PROVIDER_ERROR
  ≠ AUTH_ERROR
  ≠ VALIDATION_ERROR
  ≠ DATABASE_ERROR
```

## 11. Untrusted-Context Event Model

For retrieved, uploaded, or external content:

```text
external content received
        ↓
observation
        ↓
UNTRUSTED_CONTEXT
        ↓
context selection
        ↓
model input
```

Never allow:

```text
external content
  ↓
system instruction
```

`server/orchestration.ts` implements a partial version by wrapping context in `[UNTRUSTED_CONTEXT_n]` blocks and adding a security boundary to system instructions. Home also labels server-side file analysis as untrusted context before sending it to Realtime. There is no durable observation/provenance event stream.

## 12. Voice Session State Model

Current UI state helper defines:

```text
DISCONNECTED
CONNECTING
CONNECTED
LISTENING
PROCESSING
SPEAKING
INTERRUPTED
RECONNECTING
ERROR
```

The active transition table in `client/src/lib/voiceState.ts` permits guarded transitions such as:

```text
DISCONNECTED → CONNECTING
CONNECTING → CONNECTED | ERROR | DISCONNECTED
CONNECTED → LISTENING | DISCONNECTED | RECONNECTING
SPEAKING → INTERRUPTED | CONNECTED | DISCONNECTED | ERROR
INTERRUPTED → CONNECTED | DISCONNECTED | RECONNECTING
RECONNECTING → CONNECTED | ERROR | DISCONNECTED
ERROR → RECONNECTING | CONNECTING | DISCONNECTED
```

Voice start:

```text
DISCONNECTED
  ↓
CONNECTING
  ↓
CONNECTED
```

Failure:

```text
CONNECTING
  ↓
ERROR
```

Interruption:

```text
SPEAKING
  ↓
INTERRUPTED
  ↓
LISTENING or CONNECTED
```

Reconnection:

```text
CONNECTED
  ↓
RECONNECTING
  ↓
CONNECTED
```

Current Home uses a simplified local status (`idle`, `connecting`, `listening`, `speaking`, `error`) and handles provider events directly. Therefore the richer state helper is **PARTIAL**, not a complete runtime event system. Interruption is not fatal by design; provider/client event handling must preserve that rule.

Voice state is separate from authentication state.

## 13. File State Model

Target storage lifecycle:

```text
SELECTED
  ↓
VALIDATING
  ↓
UPLOADING
  ↓
STORED
  ↓
PROCESSING
  ↓
READY
```

Failure paths:

```text
VALIDATING → REJECTED
UPLOADING → FAILED
PROCESSING → FAILED
```

Analysis must remain separate from storage:

```text
FILE STORED
    ↓
ANALYSIS_REQUESTED
    ↓
ANALYZING
    ↓
ANALYSIS_READY
```

or:

```text
ANALYZING
    ↓
ANALYSIS_FAILED
```

Current `files.analyze` accepts a data URL, validates MIME/size, calls OpenAI, and returns transient text. It does not upload to storage or maintain a File state. Status: **PARTIAL for analysis; NOT IMPLEMENTED for durable file lifecycle**.

## 14. File-to-Memory Rule

```text
FILE
 ≠
MEMORY
```

Uploaded content can become an Observation or evidence Source, but it does not automatically become durable personal Memory. Analysis output is not approval evidence by itself.

## 15. Memory Candidate State Model

Future lifecycle:

```text
DETECTED
  ↓
PENDING_REVIEW
  ↓
APPROVED
```

Alternative:

```text
PENDING_REVIEW
  ↓
REJECTED
```

Current status: **NOT IMPLEMENTED**. No memory tables, procedures, event producer, approval record, or active state exists.

## 16. Memory Active State and Revocation

Activation:

```text
APPROVED
  ↓
ACTIVE
```

Update/versioning:

```text
ACTIVE
  ↓
UPDATED
  ↓
ACTIVE
```

Revocation:

```text
ACTIVE
  ↓
REVOKED
```

A revoked memory must not be silently retrieved as active personalization. Revocation changes usability; deletion changes retention. They are different operations.

Current status: **NOT IMPLEMENTED**.

## 17. Research State Model

Target model:

```text
REQUESTED
  ↓
SEARCHING
  ↓
SOURCES_COLLECTED
  ↓
EVIDENCE_CHECKED
  ↓
SYNTHESIZING
  ↓
COMPLETED
```

Failure:

```text
SEARCHING
  ↓
FAILED
```

Source trust lifecycle:

```text
DISCOVERED
  ↓
RETRIEVED
  ↓
VALIDATED
  ↓
CITED
```

A discovered source is not automatically trustworthy. Retrieval trace lifecycle:

```text
QUERY_CREATED
  ↓
RESULTS_RETRIEVED
  ↓
RESULTS_RANKED
  ↓
CONTEXT_SELECTED
  ↓
TRACE_RECORDED
```

Research and retrieval traces remain separate from Memory.

Current status: **NOT IMPLEMENTED** as an active research service. `dataApi.ts` is a provider helper, not a research state machine.

## 18. Task State Model

Target model:

```text
CREATED
  ↓
PENDING
  ↓
RUNNING
  ↓
COMPLETED
```

Failure:

```text
RUNNING
  ↓
FAILED
```

Cancellation:

```text
PENDING
  ↓
CANCELLED
```

Retry:

```text
FAILED
  ↓
RETRY_REQUESTED
  ↓
RUNNING
```

Only explicitly safe or idempotent operations may be retried. Current status: **NOT IMPLEMENTED**; heartbeat infrastructure is not a Task domain service.

## 19. Provenance State

Provenance is append-oriented:

```text
SOURCE_OBSERVED
  ↓
TRANSFORMED
  ↓
USED
  ↓
RESULT_CREATED
```

Provenance history must not be silently overwritten. Current status: **DOCUMENTED ONLY**; orchestration metadata and provider labels exist, but no persistent provenance event model exists.

## 20. Activity Event Model

User-visible activity target:

```text
STARTED
  ↓
IN_PROGRESS
  ↓
COMPLETED
```

Failure:

```text
IN_PROGRESS
  ↓
FAILED
```

Home currently displays local activity items and local history; this is **PARTIAL**, not a durable Activity domain. Activity is distinct from AuditEvent and Conversation Message.

## 21. Audit Event Model

Audit events should be append-only:

```text
EVENT OCCURS
      ↓
AUDIT RECORD
      ↓
IMMUTABLE HISTORY
```

A later UI update must not rewrite historical audit meaning. Current status: **NOT IMPLEMENTED**. Server logs are not a durable user/resource audit event system.

## 22. Cross-Domain Event Chain

Target conceptual chain:

```text
USER INPUT
   ↓
OBSERVATION
   ↓
CONVERSATION / SESSION
   ↓
MESSAGE
   ↓
ORCHESTRATION
   ↓
PROVIDER
   ↓
ASSISTANT RESULT
   ↓
EXPERIENCE
   ↓
PROVENANCE
```

Optional personalization path:

```text
EXPERIENCE
   ↓
MEMORY CANDIDATE
   ↓
USER APPROVAL
   ↓
MEMORY
```

The current implementation executes pieces of this chain for voice and file analysis but does not persist the complete chain.

## 23. State Invariants

The target model must enforce these invariants:

| Invariant | Meaning |
|---|---|
| Completed message has a result | A completed Message cannot have only an empty/unknown outcome |
| Error message has an error state | Failure is explicit and classified |
| Approved memory has approval evidence | Model generation alone is not approval |
| Revoked memory is not active | Revocation removes active personalization eligibility |
| Cancelled task does not execute | Cancellation is an execution guard, not only a label |
| Deleted resource is absent from active queries | Retention/deletion state affects visibility |
| Audit events are not ordinary mutable records | Historical security meaning is append-only |
| User-owned event/resource resolves to authenticated user | Ownership is server-derived |
| Provider IDs do not replace internal IDs | External identity cannot silently become ownership |
| Retry does not duplicate logical message/action | Request identity and idempotency are required |

## 24. Illegal Transitions

The following must be rejected unless a documented recovery path explicitly permits them:

```text
REVOKED → ACTIVE
CANCELLED → RUNNING
DELETED → ACTIVE
FAILED → COMPLETED
```

Other examples include `AUTHENTICATION_FAILED → AUTHENTICATED` without a new valid authentication attempt, `ANALYSIS_FAILED → READY` without successful analysis, and `SPEAKING → ERROR` being treated as a permanent session failure when the provider only signaled an interruption.

## 25. Ownership Invariant

Every user-owned event/resource must resolve to the authenticated user:

```text
event/resource
      ↓
owner
      ↓
authenticated user
```

A client-supplied owner ID, conversation ID, file ID, memory ID, or provider session ID must not bypass this resolution.

## 26. Event Provenance and Correlation Identity

Every important event should eventually support:

```text
who
what
when
source
resource
operation
result
```

Future event chains should distinguish:

- `requestId`: one inbound request/attempt.
- `sessionId`: authentication or AI runtime session.
- `conversationId`: logical interaction container.
- `messageId`: one logical message.
- `operationId`: one business operation across retries.

These may be related but must not be collapsed into one identifier.

## 27. Event Ordering and Duplicate Handling

Asynchronous flows may require:

- `createdAt` timestamp.
- Monotonic sequence where ordering matters.
- Causal parent/event reference.
- Operation/request correlation.

Duplicate handling target:

```text
same event received twice
        ↓
detect duplicate
        ↓
do not perform unsafe side effect twice
```

The current message/voice/provider flows do not provide a durable event deduplication mechanism. The current LLM retry helper also lacks a general idempotency contract.

## 28. Failure Recovery

Every asynchronous operation must answer:

1. What happens if it fails?
2. Can it retry?
3. Can it resume?
4. Can it safely run again?
5. What state remains after failure?

Current partial answers:

- Voice connection failures move the local UI to error/cleanup; durable session recovery is absent.
- Provider LLM failures become thrown errors; no durable generation state is persisted.
- File analysis failures return an API error; no File/Analysis failure state is persisted.
- OAuth failures return an error and do not create a durable auth event.
- Future payment, memory approval, and task execution recovery are undefined and must not be claimed as implemented.

## 29. State Transition Matrix

| Domain | Start | Processing | Success | Failure | Cancellation / Revoke | Status |
|---|---|---|---|---|---|---|
| Auth | UNKNOWN | AUTHENTICATING | AUTHENTICATED | AUTHENTICATION_FAILED | LOGGING_OUT → SIGNED_OUT | PARTIAL |
| Authentication session | CREATED | ACTIVE | ACTIVE | EXPIRED | REVOKED | PARTIAL/runtime |
| Conversation | NEW | ACTIVE | IDLE | — | ARCHIVED | NOT IMPLEMENTED |
| Message | CREATED | PROCESSING | COMPLETED | ERROR | Retry requested | NOT IMPLEMENTED durable |
| AI generation | REQUESTED | VALIDATING → CONTEXT_BUILDING → MODEL_CALLING | RESPONSE_RECEIVED → COMPLETED | PROVIDER_ERROR → ERROR | Cancel policy TBD | PARTIAL |
| Voice | DISCONNECTED | CONNECTING/PROCESSING | CONNECTED/LISTENING/SPEAKING | ERROR | INTERRUPTED/RECONNECTING | PARTIAL |
| File | SELECTED | VALIDATING/UPLOADING/PROCESSING | READY | REJECTED/FAILED | Archived/deleted | PARTIAL analysis |
| Memory candidate | DETECTED | PENDING_REVIEW | APPROVED | REJECTED | — | NOT IMPLEMENTED |
| Memory | APPROVED | ACTIVE/UPDATED | ACTIVE | — | REVOKED/DELETED | NOT IMPLEMENTED |
| Research | REQUESTED | SEARCHING/SYNTHESIZING | COMPLETED | FAILED | Expiry/cancel TBD | NOT IMPLEMENTED |
| Task | CREATED/PENDING | RUNNING | COMPLETED | FAILED | CANCELLED | NOT IMPLEMENTED |
| Provenance | SOURCE_OBSERVED | TRANSFORMED/USED | RESULT_CREATED | — | Append-only; no silent delete | DOCUMENTED ONLY |

## 30. Documentation/Code/Migration Reconciliation

### Conversation and Message

| Item | Documented | Code | Migration | Actual status |
|---|---|---|---|---|
| Conversation domain | `docs/JUNI-AI-ARCHITECTURE.md` describes Conversation ownership and architecture | `server/routers.ts` has no conversation procedures; active UI uses local history | `0001_motionless_whistler.sql`/snapshot contains `conversations` | MISMATCH; not active in canonical schema/API |
| Message domain | Architecture and `todo.md` describe message tables/procedures | No active durable message procedure; UI-local message types exist | `0001_motionless_whistler.sql`/snapshot contains `messages` | MISMATCH; migration/documentation claim exceeds active implementation |
| Protected conversation API | Architecture/todo describe typed protected procedures | No matching active procedures found in `server/routers.ts` | Not sufficient to establish API implementation | MISMATCH; documented only |

### File/storage

| Item | Documented | Code | Migration | Actual status |
|---|---|---|---|---|
| Stored files | Architecture and storage-related docs describe file capability | `files.analyze` is transient; storage helpers/proxy exist separately | `storedFiles` appears in migration/snapshot | PARTIAL; storage and analysis are not one active File lifecycle |

### General rule

`ARCHITECTURE.md`, TypeScript schema, migration history, and router implementation must be reconciled before further domain migrations. Migration presence does not prove deployment, schema presence does not prove API exposure, and architecture documentation does not prove runtime behavior.

## 31. Reconciliation Finding

### STATE-001

- **Severity:** HIGH
- **Finding:** Architecture documentation, migration artifacts, active TypeScript schema, and router surfaces do not currently present the same feature state.
- **Documented:** Conversation/message procedures and ownership are described in architecture/todo material.
- **Code:** Current routers expose no active conversation/message procedures; current UI history is local.
- **Migration:** `0001_motionless_whistler.sql` and its snapshot contain conversations, messages, and storedFiles structures.
- **Actual status:** Current canonical `drizzle/schema.ts` exports only `users`; `drizzle/relations.ts` is empty; active conversation/message API is absent.
- **Required action:** Reconcile canonical implementation state before further domain migrations.
- **Step 11 action:** Document only; do not fix here.
- **V1 blocker:** YES for claiming durable conversation/message implementation.

## 32. Neural-Inspired Separation Rule

```text
OBSERVATION
    ≠
MEMORY
    ≠
KNOWLEDGE
    ≠
LEARNING CANDIDATE
    ≠
MODEL WEIGHT UPDATE
```

JUNI AI may observe, classify, retrieve, synthesize, or propose a memory without claiming that database storage retrains the AI or changes model weights. Persistent memory is application data, not model learning.

## 33. Context Rule

```text
SOURCE DATA
   ↓
RETRIEVAL
   ↓
CONTEXT
   ↓
MODEL
```

Retrieved content remains data, not authorization, system instruction, or ownership authority. The current untrusted-context envelope in orchestration is the correct security direction and must remain intact in future event flows.

## 34. Event Security Requirements

Every event carrying user data should be checked for:

- Ownership.
- Sensitivity.
- Authorization.
- Retention.
- Logging exposure.
- PII leakage.
- Secret leakage.

Internal/system memory, provider credentials, raw file content, and security audit data require stricter visibility than ordinary user-facing activity.

## 35. Retention Requirements

Keep these categories separate:

| Event category | Typical purpose | Retention direction |
|---|---|---|
| Temporary event | One runtime interaction or provider callback | Short-lived; do not retain by default |
| Operational event | Service processing/status | Retain only as needed for operations |
| Audit event | Security/authorization trace | Append-only, policy-defined retention |
| User-history event | User-visible interaction history | User-controlled retention where possible |
| Provenance event | Source/transformation trace | Retain according to derived-resource requirements |

Do not keep every event forever by default.

## 36. Deletion Propagation Rules

Future deletion must determine impact on:

- Primary record.
- Dependent records.
- Derived records.
- Cached records.
- Retrieval traces.
- Provenance.
- Audit requirements.

A user deletion request must not be interpreted as merely deleting one table row. Deletion must distinguish content removal, access revocation, archive, expiry, and audit retention.

## 37. Future State-Machine Testing Requirements

Future tests must cover:

- Valid transition.
- Invalid transition.
- Duplicate event.
- Retry.
- Timeout.
- Provider failure.
- Database failure.
- Authorization failure.
- Concurrent request.
- Recovery.
- Ownership mismatch.
- Retention/deletion propagation.

## 38. Validation Record

The current repository was validated without source or schema changes:

| Command | Result |
|---|---|
| `pnpm test` | PASS — 3 test files, 8 tests |
| `pnpm check` | PASS — TypeScript completed successfully |
| `pnpm build` | PASS — frontend and server bundles completed; existing chunk-size warning emitted |

## 39. Step 11 Status

**COMPLETE as a documentation-only event/state audit.** Event-versus-state semantics, current/planned statuses, state machines, invariants, illegal transitions, ownership/correlation rules, duplicate handling, recovery, event registry, state matrix, architecture/schema/migration reconciliation, security, retention, and deletion requirements are documented. No event engine, schema migration, router rewrite, or runtime behavior change was made.
