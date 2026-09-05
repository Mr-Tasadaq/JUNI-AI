# JUNI AI Architecture and Authentication Record

## Current status

**Status: PARTIAL, AUTHENTICATION HARDENED.** JUNI AI uses the existing Manus OAuth/session foundation. The current repository has protected tRPC procedures for realtime client-secret creation, file analysis, and account preview operations, plus an admin-only owner notification procedure. Durable conversation, message, memory, project, task, and file-metadata resources are not currently implemented in the active schema or router. Their future implementations must use the same server-derived ownership model before they are exposed.

## Authentication flow

The browser starts Manus OAuth through `client/src/const.ts`. The client creates a one-time nonce and writes the `__Host-oauth_state` cookie, then redirects to the Manus OAuth portal with an encoded state containing the callback URI and nonce. `server/_core/oauth.ts` receives the callback, verifies that the state nonce matches the cookie, exchanges the authorization code with the Manus OAuth service, retrieves user information server-side, upserts the user by the provider `openId`, signs a local HS256 session JWT, and sets the session cookie.

The session cookie is `httpOnly`, path-scoped to `/`, and transport-aware: production HTTPS uses `secure: true` and `SameSite=None` for the existing cross-site OAuth deployment model; local HTTP uses `secure: false` and `SameSite=Lax` so development does not require an insecure `SameSite=None` cookie. The JWT contains only the provider `openId`, application ID, and display name. `server/_core/sdk.ts` verifies the JWT signature and algorithm, rejects missing or malformed claims, resolves the provider identity to the local `users` row, and returns that database-derived user to the request context.

`server/_core/context.ts` calls `sdk.authenticateRequest` for every tRPC request. Authentication failures are intentionally converted to `user: null` so public procedures remain available. `protectedProcedure` then rejects a missing user with the standard `UNAUTHORIZED` tRPC error; `adminProcedure` additionally requires the database-derived `role` to be `admin`. The browser uses `credentials: include` for tRPC requests and no longer mirrors the session token into `sessionStorage` or forwards a browser-held Bearer token.

The only remaining non-cookie session path is server-side compatibility for scheduled-task sessions and explicitly supplied server/runtime Authorization headers handled by `sdk.authenticateRequest`; the browser client does not create, store, or forward those headers.

## Authorization model

The server is the identity authority. Protected procedures never accept a client-supplied owner ID. The account dashboard, recharge information, and recharge intent derive `userId` directly from `ctx.user.id`. Supplying an extra `userId` field to the recharge input cannot override the authenticated identity; the server response continues to use the context user.

The active protected procedures are:

| Procedure or route            | Boundary             | Ownership behavior                                                                                                               |
| ----------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `realtime.createClientSecret` | `protectedProcedure` | Uses the authenticated user’s `openId` for the server-side OpenAI safety identifier; the provider API key remains server-only.   |
| `files.analyze`               | `protectedProcedure` | Requires authentication; accepts ephemeral client file content for analysis and does not persist metadata in the current schema. |
| `account.dashboard`           | `protectedProcedure` | Derives the returned account identity from `ctx.user.id`.                                                                        |
| `account.getRechargeInfo`     | `protectedProcedure` | Returns the authenticated `ctx.user.id`, never a client-supplied owner.                                                          |
| `account.startRecharge`       | `protectedProcedure` | Validates the amount and derives the returned owner from `ctx.user.id`; it does not initiate payment.                            |
| `system.notifyOwner`          | `adminProcedure`     | Requires a database-derived admin role.                                                                                          |
| `GET /manus-storage/*`        | Authenticated route  | Requires a valid session and accepts only keys under `users/{ctx.user.id}/`; other users’ keys return a generic 404.             |

Future private conversation, message, file metadata, memory, project, and task tables must include an owner column and indexed owner-scoped queries. Every read, update, delete, and provider-backed action must constrain the resource lookup by both resource identifier and `ctx.user.id`. No current table exists for those domains, so no unrelated schema migration was introduced in this hardening step.

## Security findings and changes

The audit found that the Manus OAuth/session foundation was functional and retained. The following risks were addressed:

| Finding                                                                                  | Severity | Change                                                                                                                                                             |
| ---------------------------------------------------------------------------------------- | -------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Browser session token was mirrored into `sessionStorage` and forwarded as a Bearer token |     High | Removed the browser fallback from `client/src/main.tsx`; the browser now uses the HttpOnly cookie transport only. Logout no longer manages a browser token mirror. |
| Runtime user identity was written to `localStorage` by the auth hook                     |   Medium | Removed the write; current user state remains in the tRPC query cache.                                                                                             |
| Storage proxy had no explicit application authentication or owner boundary               |     High | Added server authentication and enforced the `users/{numericUserId}/` key prefix. Unauthenticated requests receive 401; non-owner paths receive generic 404.       |
| Local HTTP used `SameSite=None` with `secure: false`                                     |   Medium | Cookie options now use `SameSite=None` only for secure requests and `SameSite=Lax` for local HTTP.                                                                 |
| OAuth state-cookie cleanup used hard-coded cookie options                                |   Medium | Cleanup now reuses the request-aware cookie option helper.                                                                                                         |
| Provider error details could be returned through thrown errors                           |   Medium | Provider failures now log only an operation and status and return a generic tRPC service-unavailable message.                                                      |
| Client-supplied identity override was not explicitly regression-tested                   |   Medium | Added a test proving account output uses the server context ID even when an extra `userId` field is supplied.                                                      |

The audit found no long-lived OpenAI or Forge API key in client code. The short-lived realtime client secret is intentionally returned by the protected server procedure because WebRTC requires it in the browser; the long-lived `OPENAI_API_KEY` and `BUILT_IN_FORGE_API_KEY` remain server environment values. The client-side map configuration is a separate configured frontend credential path and was not expanded by this change.

## Tests added

`server/security.authorization.test.ts` adds regression coverage for unauthenticated rejection of every current protected procedure, server-context ownership overriding an extra client `userId`, cross-user storage-key denial, and a recursive client-source scan that rejects privileged provider credentials and browser session-token forwarding. Existing logout, identity-contract, safe-tool, and orchestration tests remain in place.

## Validation evidence

The following commands were run after the hardening changes:

| Check                 | Result                                                             |
| --------------------- | ------------------------------------------------------------------ |
| Scoped Prettier check | Passed for changed source, tests, and documentation                |
| `pnpm check`          | Passed with no TypeScript errors                                   |
| `pnpm test`           | Passed: 5 test files, 15 tests                                     |
| `pnpm build`          | Passed; Vite emitted the existing non-blocking large-chunk warning |
| `git diff --check`    | Passed                                                             |

No database migration was generated or applied. The current schema contains only the users table in the active TypeScript source, so there is no existing durable private-resource model to migrate during this step.

## Remaining limitations

The local JWT is stateless and has the existing one-year lifetime; logout clears the cookie but cannot revoke a copied token before expiration. A future production hardening milestone should add rotation and server-side revocation or shorten the session lifetime after the deployment threat model is confirmed.

The storage key prefix is now an enforced boundary for the existing proxy, but the repository does not yet contain a stored-file metadata table or an upload procedure that constructs `users/{userId}/...` keys. A future upload feature must create the owner-scoped key server-side and persist metadata only after a successful storage write.

Conversations, messages, memories, projects, and tasks are not currently implemented in the active server router or schema. They must not be treated as private-resource features until their tables, owner indexes, server-side authorization checks, deletion semantics, and cross-user tests exist. The current file-analysis procedure is ephemeral and protected but does not persist file metadata.

The existing Manus OAuth callback depends on the configured OAuth service and database environment. Local development can run without those services, but authenticated integration tests require the real environment or a dedicated test double. Provider availability, database connectivity, and scheduled-task behavior remain deployment concerns outside this unit-level hardening step.
