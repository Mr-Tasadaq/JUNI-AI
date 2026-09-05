# JUNI AI Architecture Record

## Current status

**Status: PARTIAL.** JUNI AI now has two separated application experiences inside one shared platform: an authenticated user panel at `/` and a server-authorized admin control center at `/admin`. The existing Manus OAuth/session foundation, OpenAI Realtime WebRTC flow, server-side provider boundary, and canonical JUNI/SONA persona contract remain intact. The first safe administration layer is **COMPLETE**: server-authorized user listing, safe user detail display, and confirmed role changes are implemented.

The admin slice provides operational health, provider/model status, voice/persona inventory, truthful capability limits, and a user-management section. Destructive user deletion, account enable/disable, billing mutations, memory administration, durable audit events, storage quota controls, feature flags, and maintenance mutations remain deferred because the active repository does not yet have safe status/audit contracts for them.

## Shared platform boundaries

Authentication, authorization, persona configuration, realtime orchestration, safe tools, file analysis, provider credentials, and security policy are shared platform concerns. SONA AI and JUNI AI are not separate products; they are two controlled assistant identities selected within the same authenticated JUNI platform.

The canonical persona definitions remain in `shared/juni.ts`. They define exactly two primary user-facing personas:

| Persona     | Gender | Voice   | Product behavior                                                           |
| ----------- | ------ | ------- | -------------------------------------------------------------------------- |
| **JUNI AI** | Male   | `cedar` | Confident, calm, clever, supportive, witty, and emotionally responsive.    |
| **SONA AI** | Female | `marin` | Warm, playful, expressive, witty, intelligent, and emotionally responsive. |

No provider credential or duplicated system prompt is introduced in the browser. The server receives a validated persona ID and language ID, loads the canonical configuration, and creates the short-lived OpenAI Realtime client secret with the matching voice and instructions.

## Authentication flow

The browser starts Manus OAuth through `client/src/const.ts`. It creates a one-time nonce and writes the `__Host-oauth_state` cookie before redirecting to the Manus OAuth portal. `server/_core/oauth.ts` verifies the nonce, exchanges the authorization code, retrieves provider user information server-side, upserts the local `users` record by provider `openId`, signs a local session JWT, and sets an HttpOnly session cookie.

`server/_core/context.ts` calls `sdk.authenticateRequest` for every request. `server/_core/sdk.ts` verifies the JWT and resolves the provider identity to the local database user. The authenticated application user is therefore established from the server-side session and database record, not from browser state. The authenticated user ID is `ctx.user.id`.

The session cookie is request-aware: HTTPS uses `Secure` and `SameSite=None` for the existing OAuth deployment model, while local HTTP uses `SameSite=Lax`. The browser uses `credentials: include` and does not mirror session credentials into `localStorage` or `sessionStorage`. Long-lived provider credentials remain server environment values.

## User Panel architecture

The user experience is the authenticated `/` route implemented by `client/src/pages/Home.tsx`. It is mobile-first and voice-first rather than a conventional text-chat product. It provides:

- Explicit SONA AI / JUNI AI persona switching.
- Current persona name, gender, role, accent, and voice identity.
- WebRTC connection, microphone, listening, speaking, and error indicators.
- Short-lived server-brokered OpenAI Realtime credentials.
- Language selection using the shared supported-language contract.
- Local browser session notes, recording export, protected file analysis, and confirmation-gated tools.
- Account and safe-preview billing information through protected server procedures.

An unauthenticated request receives an authentication gate instead of the private voice panel. The UI may show a sign-in control, but server procedures remain the actual security boundary. The local conversation history is explicitly browser-local and is not represented as durable private server data.

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

| Procedure or route            | Authorization and ownership                                                                                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `realtime.createClientSecret` | Authenticated user only; safety identifier is derived from `ctx.user.openId`; persona and language are allowlisted.                                                               |
| `files.analyze`               | Authenticated user only; analysis is ephemeral and provider credentials remain server-side.                                                                                       |
| `account.dashboard`           | Authenticated user only; response identity is derived from `ctx.user.id`.                                                                                                         |
| `account.getRechargeInfo`     | Authenticated user only; owner ID is server-derived.                                                                                                                              |
| `account.startRecharge`       | Authenticated user only; amount is validated and owner ID is server-derived. It remains preview-only.                                                                             |
| `admin.dashboard`             | Admin only; returns operational data only after server role verification.                                                                                                         |
| `admin.users`                 | Admin only; returns a deliberately reduced user summary without `openId`, login method, credentials, or provider secrets.                                                         |
| `admin.changeUserRole`        | Admin only; validates target ID and role, prevents self-demotion, updates the existing `users.role` column, and logs actor/target/role metadata to the server operational stream. |
| `system.notifyOwner`          | Existing admin-only procedure.                                                                                                                                                    |
| `GET /manus-storage/*`        | Authenticated and restricted to `users/{ctx.user.id}/` storage keys.                                                                                                              |

A client-supplied owner ID cannot override `ctx.user.id`. Cross-user storage paths return a generic 404. Future conversations, messages, memory, projects, tasks, file metadata, and administrative mutations must add owner-scoped queries, input schemas, authorization checks, and cross-user tests before being exposed.

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

Administrative mutations are intentionally limited in this slice. Since no durable audit-event table exists, role changes currently emit structured server operational logging but do not claim to provide a persistent audit log. Persistent administrative audit storage is the next security milestone. Consequential mutations beyond role changes must not be added without an auditable server-side operation contract.

## Tests added and maintained

The test suite covers:

- Unauthenticated rejection of current protected procedures.
- Normal-user denial of `admin.dashboard`.
- Admin access to `admin.dashboard`.
- Unauthenticated denial of `admin.users` and `admin.changeUserRole`.
- Normal-user denial of user listing and role changes even when the frontend requests them.
- Admin access to reduced user details without provider credentials.
- Admin role change for another user.
- Self-role-change prevention for administrators.
- Client identity cannot override server identity.
- Cross-user and unauthenticated storage-key denial.
- Generic provider errors without configuration leakage.
- Provider credentials and browser session forwarding absent from client code.
- Canonical SONA and JUNI genders, voices, IDs, languages, and safe tools.

## Validation evidence

Validation is run from the real repository using the package scripts:

| Check                 | Result                                                              |
| --------------------- | ------------------------------------------------------------------- |
| Scoped Prettier check | Passed for changed source, tests, and documentation.                |
| `pnpm check`          | TypeScript validation passed.                                       |
| `pnpm test`           | Passed: 6 test files, 22 tests.                                     |
| `pnpm build`          | Passed; Vite emitted the existing non-blocking large-chunk warning. |
| `git diff --check`    | Passed.                                                             |

No database migration was created. The existing `users.role` column already supports the required USER/ADMIN model, and the new user-management procedures reuse it. No account-status field or audit-event table exists in the active schema.

## Known limitations and next slices

The current JWT remains stateless with the existing one-year lifetime; logout cannot revoke a copied token before expiration. A future production hardening slice should add token rotation and revocation or shorten the lifetime after the deployment threat model is confirmed.

The admin panel is intentionally an operational foundation rather than a claim of full administrative CRUD. Account status controls, provider configuration mutations, model availability controls, voice configuration persistence, memory/knowledge management, storage quotas, research/tool policies, feature flags, maintenance actions, diagnostics, and persistent audit events require real domain contracts and should be implemented one auditable server procedure at a time.

The user panel still uses local browser history and the file-analysis path remains ephemeral. Durable conversation, message, memory, project, task, and file metadata ownership will require controlled schema migrations and owner-scoped service methods before those features are enabled.
