# JUNI AI Repository Architecture Map

This document defines the repository-wide architecture boundaries for JUNI AI. It is a documentation-only architecture map for Step 2 and does not implement new application systems.

## 2.1 Repository Layers

```text
JUNI AI
│
├── apps/
│   ├── web/              # User interface
│   └── api/              # Backend/API
│
├── packages/
│   ├── shared/           # Shared contracts/types
│   ├── provider-core/    # AI provider boundary
│   ├── storage-core/     # Persistence/storage boundary
│   └── provenance-core/  # Provenance/audit boundary
│
└── docs/
    └── architecture/
```

The current repository may contain legacy or transitional paths while the target architecture is established incrementally. New sections should follow these ownership boundaries and must not introduce competing architectural conventions without documentation and review.

## 2.2 `apps/web`

The web application owns the user-facing experience:

- Pages
- Components
- Client state
- User interactions
- Authentication UI
- Chat UI
- Voice UI
- Files UI
- Memory UI
- Research UI
- Settings UI

Frontend code must not contain provider secrets. It may call authenticated API contracts and render normalized domain results, but it must not directly own provider credentials, provider authentication, or provider-specific security-sensitive behavior.

## 2.3 `apps/api`

The API owns the server-side application boundary:

- Authentication enforcement
- Authorization
- Request validation
- AI orchestration
- Memory operations
- File operations
- Research boundary
- Provider communication
- Security-sensitive operations

The API is the trusted application boundary between the browser and domain services. It must derive identity and ownership from authenticated server context rather than trusting client-supplied ownership identifiers.

## 2.4 `packages/shared`

This package owns contracts shared between frontend and backend.

Examples include:

- Types
- Schemas
- API contracts
- Domain enums
- Request/response contracts
- Error contracts

Shared contracts must remain provider-neutral where practical. They should describe application intent and normalized results rather than leaking provider SDK types into the web layer.

## 2.5 `packages/provider-core`

This package owns the AI provider boundary and is responsible for:

- Provider interface
- Provider adapters
- Model capabilities
- Provider errors
- Provider selection
- Provider configuration

The required call path is:

```text
Web → API → Orchestrator → Provider Core → Provider
```

The following direct paths are prohibited:

```text
Web → OpenAI
Web → Anthropic
Web → Gemini
```

Provider-specific request shaping, authentication, streaming semantics, model selection, error normalization, and capability detection must remain inside provider adapters or the provider-core boundary.

## 2.6 `packages/storage-core`

This package owns persistence and storage boundaries, including:

- Database access boundary
- Repositories
- Persistence operations
- Storage abstractions
- Transaction boundaries

Storage-core must enforce repository-level access patterns and must not be bypassed by UI code. User ownership and authorization remain API concerns, while storage-core provides the controlled persistence mechanisms used by authorized domain operations.

## 2.7 `packages/provenance-core`

This package owns trust and traceability metadata, including:

- Provenance
- Ownership
- Source tracking
- Audit information
- Version history
- Trust metadata

Provenance data should make it possible to understand where user-visible information came from, which user or system owns it, when it changed, and what trust or verification context applies.

## 2.8 Dependency Direction

The dependency direction is:

```text
apps/web
   ↓
apps/api
   ↓
packages/*
```

Avoid circular dependencies. Lower-level packages must not import application pages or UI state. The web application must depend on API contracts rather than reaching around the API boundary to call providers or storage directly.

When a shared contract is needed by both web and API, it belongs in `packages/shared` rather than in an application-specific module.

## 2.9 Security Boundary

The security boundary is:

```text
Browser
   ↓
Authenticated API
   ↓
Authorization
   ↓
Validated request
   ↓
Domain operation
   ↓
Storage / Provider
```

Every request must cross these checks in order:

1. The browser sends a request through the authenticated API boundary.
2. The API establishes the authenticated principal.
3. Authorization verifies the principal may perform the requested operation.
4. Request validation checks shape, size, type, and domain constraints.
5. The domain operation applies business rules.
6. Only then may the operation access storage or a provider.

Secrets, privileged provider credentials, internal memory, and security-sensitive operations must remain behind this boundary.

## 2.10 User-Data Ownership

Every user-owned resource must have an enforceable ownership boundary. Examples include:

- User
- Conversation
- Message
- File
- Memory
- Memory candidate
- Task
- Activity

Ownership must be derived from authenticated server context and enforced in API procedures and repository queries. A client-supplied user ID, owner ID, or resource owner field is not an authority signal.

Resources that are intentionally shared, system-owned, or internal must have an explicit classification and access policy rather than being treated as user-owned by default.

## 2.11 Feature Ownership

| Feature | Primary Layer |
|---|---|
| Authentication | API + Web |
| Chat | API + Web |
| Voice | API + Web |
| Files | API + Web + Storage |
| Memory | API + Web + Storage |
| Research | API + Web |
| Multimodal | API + Web + Provider |
| Tasks | API + Web + Storage |
| Provenance | Provenance Core |
| AI Providers | Provider Core |

Primary ownership identifies where the feature’s main contracts and controls live. Cross-layer features must still respect the API security boundary and the relevant shared, storage, provider, and provenance boundaries.

## 2.12 Reuse Rule

Before creating a new abstraction:

1. Search existing code.
2. Identify the existing contract.
3. Reuse the existing service.
4. Extend only when necessary.
5. Avoid duplicate implementations.

A new abstraction must have a clear ownership boundary and a documented reason that an existing service or contract cannot be reused safely.

## 2.13 Backward-Compatibility Rule

New sections must not silently break:

- Section 21
- Section 22
- Section 23
- Section 24
- Section 25

Changes that affect existing V1 behavior must preserve existing contracts where practical, provide an intentional migration path where necessary, and include regression validation before being marked complete.

## 2.14 Architecture Validation

Architecture validation must check that:

- Web does not contain provider secrets.
- API remains the security boundary.
- Provider logic remains isolated.
- Storage logic remains isolated.
- Shared contracts remain reusable.
- No circular dependency is introduced.

A review should also confirm that new code follows the dependency direction, derives ownership from trusted context, validates API inputs, and does not create an undocumented parallel implementation of an existing capability.

## Step 2 Completion Condition

Step 2 is complete when:

- [x] Architecture document is created.
- [x] Layer boundaries are defined.
- [x] Dependency direction is defined.
- [x] Security boundary is defined.
- [x] Ownership rules are defined.
- [x] Existing V1 features are mapped.
- [x] Architecture validation checks are documented.
- [x] The document is committed with the requested commit message.

The next step is **Step 3: Repository Inventory**. Do not begin Memory implementation as part of this architecture-map step.
