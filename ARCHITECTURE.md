# JUNI AI Architecture Record

## Current status

**Status: PARTIAL.** JUNI AI now has two separated application experiences inside one shared platform: an authenticated user panel at `/` and a server-authorized admin control center at `/admin`. The existing Manus OAuth/session foundation, OpenAI Realtime WebRTC flow, server-side provider boundary, and canonical JUNI/SONA persona contract remain intact. The first safe administration layer is **COMPLETE**: server-authorized user listing, safe user detail display, and confirmed role changes are implemented.

The admin slice provides operational health, provider/model status, voice/persona inventory, truthful capability limits, a user-management section, and a durable audit-event foundation for role changes. Destructive user deletion, account enable/disable, billing mutations, memory administration, storage quota controls, feature flags, and maintenance mutations remain deferred.

## Shared platform boundaries

Authentication, authorization, persona configuration, realtime orchestration, safe tools, file analysis, provider credentials, and security policy are shared platform concerns. SONA AI and JUNI AI are not separate products; they are two controlled assistant identities selected within the same authenticated JUNI platform.

The canonical persona definitions remain in `shared/juni.ts`. They define exactly two primary user-facing personas:

| Persona     | Gender | Voice   | Product behavior                                                           |
| ----------- | ------ | ------- | -------------------------------------------------------------------------- |
| **JUNI AI** | Male   | `cedar` | Confident, calm, clever, supportive, witty, and emotionally responsive.    |
| **SONA AI** | Female | `marin` | Warm, playful, expressive, witty, intelligent, and emotionally responsive. |

No provider credential or duplicated system prompt is introduced in the browser. The server receives a validated persona ID and language ID, loads the canonical configuration, and creates the short-lived OpenAI Realtime client secret with the matching voice and instructions.

## Provider and capability architecture

The normal text orchestration path is provider-neutral at the JUNI boundary:

```text
Application / orchestrator → JUNI capability contract → provider adapter → external provider
```

`server/capabilities.ts` owns the capability vocabulary, adapter contract, deterministic resolution, safe provider-health metadata, and normalized provider errors. `server/orchestration.ts` requests a capability and uses the selected adapter; it does not call a vendor transport directly. The current adapter wraps the existing server-only `invokeLLM` implementation rather than duplicating its request normalization, retries, tools, structured output, or model behavior.

The capability registry is intentionally truthful:

| Capability       | Status                                                      | Current boundary                                  |
| ---------------- | ----------------------------------------------------------- | ------------------------------------------------- |
| `SMART_GENERAL`  | **COMPLETE** when the server Forge configuration is present | Existing server-side LLM adapter                  |
| `FAST_GENERAL`   | **NOT IMPLEMENTED**                                         | No adapter                                        |
| `VISION`         | **NOT IMPLEMENTED**                                         | No dedicated capability adapter                   |
| `VIDEO`          | **NOT IMPLEMENTED**                                         | No video provider pipeline                        |
| `EMBEDDING`      | **NOT IMPLEMENTED**                                         | No embedding provider                             |
| `RESEARCH`       | **NOT IMPLEMENTED**                                         | No research tool layer                            |
| `CODE`           | **NOT IMPLEMENTED**                                         | No code capability adapter                        |
| `VOICE_REALTIME` | **PARTIAL / SEPARATE PATH**                                 | OpenAI Realtime WebRTC flow, not the text adapter |

An unconfigured adapter is reported as unavailable and cannot be selected. Unsupported capabilities fail with a JUNI-owned `unsupported_capability` error; provider failures are normalized into safe categories such as configuration, timeout, rate limiting, or provider error. Health metadata contains only provider ID, enabled state, supported capabilities, health state, and an optional error category. It never contains keys, authorization headers, secret URLs, or raw provider bodies.

The existing untrusted-context envelope remains part of orchestration. Retrieved or uploaded content is passed as data inside `UNTRUSTED_CONTEXT` blocks and cannot become system authority. Realtime voice remains a distinct architecture with canonical JUNI/SONA personas, short-lived credentials, and WebRTC transport; it is not routed through normal text orchestration.

## Authentication flow

The browser starts Manus OAuth through `client/src/const.ts`. It creates a one-time nonce and writes the `__Host-oauth_state` cookie before redirecting to the Manus OAuth portal. `server/_core/oauth.ts` verifies the nonce, exchanges the authorization code, retrieves provider user information server-side, upserts the local `users` record by provider `openId`, signs a local session JWT, and sets an HttpOnly session cookie.

`server/_core/context.ts` calls `sdk.authenticateRequest` for every request. `server/_core/sdk.ts` verifies the JWT and resolves the provider identity to the local database user. The authenticated application user is therefore established from the server-side session and database record, not from browser state. The authenticated user ID is `ctx.user.id`.

The browser authentication path is strictly `Manus OAuth → server callback → HttpOnly session cookie → server verification → ctx.user`. HTTPS uses `Secure` and `SameSite=None` for the existing OAuth deployment model, while local HTTP uses `SameSite=Lax`. Browser requests use `credentials: include`; the application session JWT is not accepted from an `Authorization` header and is not mirrored into `localStorage` or `sessionStorage`. Long-lived provider credentials remain server environment values.

Scheduled-task callbacks are a separate non-browser exception. They use the existing `cron_` session identity and task-bound provider verification path, with the task token arriving in the callback cookie. This flow is isolated from ordinary browser authentication; no general browser bearer-token fallback exists.

## User Panel architecture

The user experience is the authenticated `/` route implemented by `client/src/pages/Home.tsx`. It is mobile-first and voice-first rather than a conventional text-chat product. It provides:

- Explicit SONA AI / JUNI AI persona switching.
- Current persona name, gender, role, accent, and voice identity.
- WebRTC connection, microphone, listening, speaking, and error indicators.
- Short-lived server-brokered OpenAI Realtime credentials.
- Language selection using the shared supported-language contract.
- Local browser session notes, recording export, protected file analysis, and confirmation-gated tools.
- Account and safe-preview billing information through protected server procedures.

An unauthenticated request receives an authentication gate instead of the private voice panel. The UI may show a sign-in control, but server procedures remain the actual security boundary. Authenticated voice turns with available textual transcripts are persisted to the owner-scoped server conversation; raw audio remains ephemeral. Account-namespaced local notes remain a temporary compatibility layer and are never auto-uploaded.

Persona switching is deterministic: selecting a persona closes any active session, updates the shared persona ID, updates the UI identity/greeting, and causes the next protected `realtime.createClientSecret` request to load that persona’s server-side system instructions and configured voice. The browser receives only the temporary client secret and selected voice needed for WebRTC negotiation.

## Admin Panel architecture

The administrative experience is `/admin`, implemented by `client/src/pages/AdminPanel.tsx`. It uses the same visual language as the user panel but with denser operational information. It currently displays:

- System health and authentication mode.
- Database configuration status without returning database credentials.
- OpenAI Realtime model, transport, and provider-configured status.
- SONA AI and JUNI AI voice/persona inventory.
- Voice, protected file analysis, billing-preview, memory, and audit capability states.
- Explicit safe-boundary messaging for deferred administrative features.
- User ID, name, email, role, created date, and last activity from the existing `users` model.
- Searchable user list with role badges and a confirmation dialog for role changes.

The route is not secured by hiding a link. The `admin.dashboard` tRPC procedure uses `adminProcedure`, which requires an authenticated `ctx.user` and the server-derived `role === "admin"`. A normal user receives `FORBIDDEN` even if they navigate directly to `/admin`, change URL state, or forge client input. The frontend role check only controls presentation and query enablement; it is not the authorization boundary.

The existing database role values are lowercase `user` and `admin`; these are the repository’s persisted equivalents of the product-level **USER** and **ADMIN** roles. No competing role system or schema migration was introduced. The existing owner-openId bootstrap behavior remains the source of the initial administrator assignment. The schema has no account-status field, so enable/disable controls are **NOT IMPLEMENTED** rather than simulated in the UI.

## Authorization model

`protectedProcedure` rejects unauthenticated requests. `adminProcedure` rejects unauthenticated requests and authenticated users whose server-derived role is not `admin`. Current protected procedures are:

| Procedure or route            | Authorization and ownership                                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `realtime.createClientSecret` | Authenticated user only; safety identifier is derived from `ctx.user.openId`; persona and language are allowlisted.                                                                   |
| `files.analyze`               | Authenticated user only; analysis is ephemeral and provider credentials remain server-side.                                                                                           |
| `account.dashboard`           | Authenticated user only; response identity is derived from `ctx.user.id`.                                                                                                             |
| `account.getRechargeInfo`     | Authenticated user only; owner ID is server-derived.                                                                                                                                  |
| `account.startRecharge`       | Authenticated user only; amount is validated and owner ID is server-derived. It remains preview-only.                                                                                 |
| `admin.dashboard`             | Admin only; returns operational data only after server role verification.                                                                                                             |
| `admin.users`                 | Admin only; returns a deliberately reduced user summary without `openId`, login method, credentials, or provider secrets.                                                             |
| `admin.changeUserRole`        | Admin only; validates target ID and role, prevents self-demotion, and atomically updates `users.role` with an append-only `user.role_changed` audit event derived from `ctx.user.id`. |
| `admin.auditEvents`           | Admin only; returns a newest-first reduced DTO with event ID, actor, action, target, timestamp, and allowlisted role metadata.                                                        |
| `conversations.list`          | Authenticated owner only; returns reduced conversation summaries ordered by newest activity.                                                                                          |
| `conversations.get`           | Authenticated owner only; returns one owned conversation and its messages; cross-user IDs return `NOT_FOUND`.                                                                         |
| `conversations.create`        | Authenticated owner only; creates a server-owned conversation and ignores any client owner field.                                                                                     |
| `conversations.addMessage`    | Authenticated owner only; validates UUID, role, and 20,000-character maximum content, then atomically appends and updates activity.                                                   |
| `conversations.rename`        | Authenticated owner only; accepts only a validated conversation ID and title.                                                                                                         |
| `system.notifyOwner`          | Existing admin-only procedure.                                                                                                                                                        |
| `GET /manus-storage/*`        | Authenticated and restricted to `users/{ctx.user.id}/` storage keys.                                                                                                                  |

A client-supplied owner ID cannot override `ctx.user.id`. Cross-user storage paths and conversation IDs return generic not-found results. Conversation and message rows carry server-derived ownership, and all reads/writes query both the resource ID and `ctx.user.id`. Memory, projects, tasks, file metadata, and administrative mutations remain separate future slices.

## Durable conversation architecture

The active schema now contains two owner-scoped tables in addition to `users` and `auditEvents`:

| Table           | Purpose                                                                                                                          | Ownership and indexing                                                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conversations` | Stable UUID, owner, title, creation time, and last activity time.                                                                | `ownerId`; `(ownerId, updatedAt)` supports the authenticated history list.                                                                                      |
| `messages`      | Stable UUID, conversation ID, owner, `user`/`assistant` role, textual content, optional allowlisted metadata, and creation time. | `ownerId` plus conversation ID; `(conversationId, createdAt)` supports ordered reads and `(ownerId, conversationId, createdAt)` reinforces owner-scoped access. |

The server is authoritative. `conversations.create` derives ownership from `ctx.user.id`; `get`, `addMessage`, and `rename` require both the requested resource ID and that same server-derived owner. Message content is bounded to 20,000 characters. The public procedure does not accept owner IDs, timestamps, provider IDs, capability values, or arbitrary metadata. The database service accepts metadata only from trusted server code and reduces returned metadata to persona, capability, and provider allowlists.

For the current voice-first path, the transition is: authenticated user starts a Realtime session; available input transcript and assistant transcript are collected; the server-backed conversation is created lazily; the user message is written before the assistant message; and the UI refreshes the owner-scoped conversation list after successful writes. If persistence is unavailable, the turn remains a local compatibility note and the UI reports that durable history is unavailable. This does not claim full memory, learning, or provider-response archival.

Raw WebRTC audio, recordings, client secrets, hidden system prompts, raw provider responses, authorization headers, and API credentials are not stored in the conversation tables. Persona identity remains part of the authenticated UI/session contract; message metadata is currently null for Realtime turns because the browser is not trusted to manufacture provider or capability provenance.

## Security decisions and findings

The authentication hardening work addressed the following findings:

| Finding                                                                             | Change                                                                                               |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Browser session token was mirrored into `sessionStorage` and sent as a Bearer token | Removed the browser fallback; the browser uses the HttpOnly cookie transport only.                   |
| Runtime identity was written to `localStorage`                                      | Removed the identity persistence write.                                                              |
| Storage proxy had no explicit application authorization                             | Added authentication and user-key ownership enforcement.                                             |
| Local HTTP used an insecure `SameSite=None` combination                             | Local HTTP now uses `SameSite=Lax`; secure deployment keeps the required secure cross-site behavior. |
| OAuth state-cookie cleanup used hard-coded options                                  | Reused request-aware cookie options.                                                                 |
| Provider errors could expose provider details                                       | Provider failures return a generic error and log only operation/status metadata.                     |
| Admin access could have been treated as frontend state                              | Added `adminProcedure`-protected `admin.dashboard` and normal-user denial tests.                     |

The short-lived Realtime client secret is intentionally delivered to an authenticated browser because WebRTC requires it. The long-lived `OPENAI_API_KEY`, Forge credentials, database credentials, and admin secrets remain server-only. No credentials are placed in URLs, query parameters, client storage, source code, screenshots, or rendered provider errors.

Administrative mutations are intentionally limited in this slice. `auditEvents` is a durable append-only application table. Role changes and their audit records are written inside one Drizzle transaction when the database supports the configured MySQL connection, so a successful role change is not reported if its audit write fails. Audit metadata is allowlisted to previous/new role values and excludes passwords, tokens, authorization headers, raw request bodies, and provider credentials. Audit reads are admin-only; no general audit update/delete procedures exist. Account deletion, account status, billing, memory, quota, feature-flag, and maintenance mutations remain **NOT IMPLEMENTED**.

## Tests added and maintained

The test suite covers:

- Unauthenticated rejection of current protected procedures.
- Valid HttpOnly cookie authentication and missing-cookie rejection.
- Expired/malformed cookie rejection and rejection of arbitrary browser bearer tokens.
- Continued scheduled-task authentication through the isolated cron session flow.
- Normal-user denial of `admin.dashboard`.
- Admin access to `admin.dashboard`.
- Unauthenticated denial of `admin.users` and `admin.changeUserRole`.
- Normal-user denial of user listing and role changes even when the frontend requests them.
- Admin access to reduced user details without provider credentials.
- Admin role change for another user.
- Durable `user.role_changed` audit creation with server-derived actor identity.
- Admin-only newest-first audit reading with reduced metadata.
- Self-role-change prevention for administrators.
- Authenticated conversation creation and owner-derived list access.
- Unauthenticated conversation creation rejection.
- Cross-user conversation read and message-write rejection.
- Owner-derived rename and message-write binding.
- Invalid conversation IDs and excessive message content rejection.
- Rejection of browser-supplied owner identity and client metadata.
- Deterministic conversation ordering through server query ordering.
- Client identity cannot override server identity.
- Cross-user and unauthenticated storage-key denial.
- Generic provider errors without configuration leakage.
- Provider credentials and browser session forwarding absent from client code.
- Canonical SONA and JUNI genders, voices, IDs, languages, and safe tools.
- `SMART_GENERAL` resolution through the real server-side provider adapter.
- Unsupported, unconfigured, and separate realtime capabilities are rejected or reported truthfully.
- Provider failures are normalized without leaking credentials or raw provider responses.
- Orchestration preserves the untrusted-context data-only envelope and returns selected capability/provider metadata.

## Validation evidence

Validation is run from the real repository using the package scripts:

| Check              | Result                                                              |
| ------------------ | ------------------------------------------------------------------- |
| `pnpm format`      | Passed; unrelated formatter churn was reverted after inspection.    |
| `pnpm check`       | Passed.                                                             |
| `pnpm test`        | Passed: 10 test files, 40 tests.                                    |
| `pnpm build`       | Passed; Vite emitted the existing non-blocking large-chunk warning. |
| `git diff --check` | Passed.                                                             |

The durable audit schema is defined in `drizzle/schema.ts` and migration `drizzle/0002_durable_audit_events.sql`. Durable conversations and messages are defined in the same schema and migration `drizzle/0003_durable_conversations.sql`. Historical `conversations`, `messages`, and `storedFiles` SQL artifacts were inspected as remnants of an earlier schema; the committed conversation migration creates only the intended new tables and indexes, with no drops or resets. Migrations must be applied through the normal database workflow in an environment with the real `DATABASE_URL`; no live database migration was run in this validation environment.

## Known limitations and next slices

The current JWT remains stateless with the existing one-year lifetime; logout cannot revoke a copied token before expiration. A future production hardening slice should add token rotation and revocation or shorten the lifetime after the deployment threat model is confirmed.

The admin panel is intentionally an operational foundation rather than a claim of full administrative CRUD. Account status controls, provider configuration mutations, model availability controls, voice configuration persistence, memory/knowledge management, storage quotas, research/tool policies, feature flags, maintenance actions, diagnostics, and administrative access to private conversations remain unavailable.

The file-analysis path remains ephemeral. Durable conversation continuity is the first persistence slice, not a complete memory or learning system. Existing pre-migration global `juni-history` data is intentionally not auto-imported; new temporary notes are namespaced by authenticated user ID to prevent cross-account leakage. A future explicit user-consented import can be designed separately.
