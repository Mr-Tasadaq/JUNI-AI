# JUNI AI Constitution

## 1. Project Identity

- **Name:** JUNI AI
- **Purpose:** Personal AI assistant
- **V1 target:** Section 30

## 2. Core Principles

JUNI AI is governed by the following principles:

1. **User-first:** The product should serve the user’s goals, control, safety, and understanding.
2. **Privacy-first:** Collect, retain, process, and expose only what is necessary and authorized.
3. **Secure by default:** The default behavior must minimize attack surface, privilege, and accidental disclosure.
4. **Explicit consent:** High-impact actions, sensitive processing, and personalized memory require clear user consent.
5. **No silent memory:** The system must not create or retain personalized memories without making that behavior visible and authorized.
6. **No fabricated capabilities:** JUNI AI must not claim to have completed work, accessed data, used a provider, or performed an action that it did not actually complete.
7. **Graceful degradation:** Optional capabilities may be unavailable, but the system must communicate limitations truthfully and preserve the secure core experience.
8. **Modular architecture:** Features and integrations must remain replaceable, testable, and isolated behind stable boundaries.

## 3. Architecture Rule

The repository architecture is organized around these top-level boundaries:

```text
apps/web
apps/api
packages/shared
packages/provider-core
packages/storage-core
packages/provenance-core
```

Each boundary must have a clear responsibility. Cross-boundary dependencies must be intentional, documented, and kept as narrow as practical.

## 4. AI Boundary Rule

The UI must not directly control AI providers.

All AI requests must pass through the orchestrator boundary. Provider-specific logic, authentication, request shaping, response normalization, streaming behavior, and provider failure handling must stay inside provider adapters.

The UI may express user intent and render normalized results, but it must not contain provider-specific business logic or provider credentials.

## 5. Memory Rule

- Messages are not automatically memories.
- Inferred memories require approval.
- Files do not automatically become memories.
- Voice does not automatically save memories.
- Users can disable personalized memory.

Memory creation, modification, retrieval, retention, export, and deletion must be explicit, user-scoped, auditable, and subject to the appropriate authorization checks.

## 6. Security Rule

- Every user-owned resource requires authorization.
- Never trust client-supplied ownership IDs.
- Validate inputs at API boundaries.
- Do not expose internal/system memory to normal users.
- Sensitive memory requires the appropriate permission.

Authorization must be enforced server-side. Identity and ownership must be derived from trusted authenticated context rather than accepted from the client as authority.

## 7. Failure Rule

- Optional AI capabilities may degrade gracefully.
- Never pretend an unavailable provider succeeded.
- Never silently lose user data.

Failures must be observable to the user and useful to operators without exposing secrets or internal details. When an operation cannot be completed, the system must preserve user data where possible and state what did and did not happen.

## 8. V1 Rule

V1 is organized into the following sections:

- **Section 21 → Authentication**
- **Section 22 → Home**
- **Section 23 → Chat**
- **Section 24 → Voice**
- **Section 25 → Files**
- **Section 26 → Memory**
- **Section 27 → Research**
- **Section 28 → Media / Multimodal**
- **Section 29 → Tasks / Activity / Settings**
- **Section 30 → V1 Hardening / Release**

The V1 target is Section 30. Work must proceed incrementally, with each section validated before it is treated as complete.

## 9. Validation Gate

Every completed section must eventually pass:

```text
npm test
npm run lint
npm run typecheck
npm run build
npm run db:sanity
npm run db:validate
npm run security:scan
```

A section may not be considered fully complete until its applicable validation checks pass or an explicit, documented exception identifies why a check is not applicable.

## 10. Completion Policy

**COMPLETE** means there is no unresolved V1 blocker.

**PARTIAL** means secure core functionality works, but optional functionality is truthfully unavailable.

Never mark a blocked feature as complete.
