# JUNI AI Repository Inventory

**Inventory scope:** repository snapshot at the current local checkout before this inventory commit.

**Method:** file-tree inspection, source inspection, route and environment-name search, test inventory, and requested validation-command attempts. This document records actual findings only; missing target architecture directories and unimplemented features are marked explicitly.

## 1. Repository Root

The repository root is a React/Vite/Express/tRPC full-stack project. The requested target directories `apps/` and `packages/` do not currently exist.

```text
.
├── client/                 # Current frontend source and public assets
├── server/                 # Current Express/tRPC server and helpers
├── shared/                 # Current shared TypeScript modules
├── drizzle/                # Drizzle schema, migrations, and relations
├── docs/                   # Constitution and architecture documentation
├── research/               # Research notes and sources
├── patches/                # Package patches
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── vitest.config.ts
├── drizzle.config.ts
├── components.json
├── template.json
├── .prettierrc
├── .prettierignore
├── .gitignore
├── README.md
├── VOICE_SETUP.md
├── ARCHITECTURE.md
├── NEURAL_SCHEMA_PROPOSAL.md
├── todo.md
└── voice.zip
```

There is no Prisma directory or Prisma schema. The database layer uses Drizzle with MySQL/TiDB configuration.

### Current top-level configuration

- `package.json` — package metadata, scripts, dependencies, and package-manager configuration.
- `pnpm-lock.yaml` — locked dependency graph.
- `tsconfig.json`, `tsconfig.node.json` — TypeScript configuration.
- `vite.config.ts` — Vite configuration and development integration.
- `vitest.config.ts` — Vitest configuration.
- `drizzle.config.ts` — Drizzle configuration using `DATABASE_URL`.
- `components.json` — UI component configuration.
- `template.json` — template/runtime metadata.
- `.prettierrc`, `.prettierignore`, `.gitignore` — formatting and repository hygiene.

## 2. Frontend

The current frontend lives under `client/`, not `apps/web`.

### Routes and pages

- `client/src/pages/Home.tsx` — primary JUNI/SONA voice companion at `/`.
- `client/src/pages/Audit.tsx` — preserved security audit dashboard at `/audit`.
- `client/src/pages/NotFound.tsx` — `/404` and fallback page.
- `client/src/pages/ComponentShowcase.tsx` — component showcase page exists as a file but is not registered in the current route switch.

### Components

Reusable product/framework components include:

- `AIChatBox.tsx` — chat UI example/component; current Home page does not use it for the main experience.
- `VoiceSystem.tsx` — legacy voice-system component; current Home page contains its own OpenAI Realtime WebRTC flow.
- `CapabilityBoard.tsx` — capability UI component.
- `DashboardLayout.tsx` and `DashboardLayoutSkeleton.tsx` — dashboard shell components.
- `ErrorBoundary.tsx`, `ManusDialog.tsx`, `Map.tsx` — framework/application components.
- `components/ui/` — installed shadcn/Radix-style UI primitives.

### Hooks and client state

- `client/src/_core/hooks/useAuth.ts` — authentication query/logout hook.
- `client/src/hooks/useComposition.ts` — composition helper.
- `client/src/hooks/useMobile.tsx` — mobile breakpoint hook.
- `client/src/hooks/usePersistFn.ts` — stable callback helper.
- `client/src/contexts/ThemeContext.tsx` — theme state/provider.
- `client/src/lib/voiceState.ts` — voice state module with tests.
- `client/src/lib/workspaceStatus.ts` — workspace status module with tests.
- `Home.tsx` local React state — current session status, persona, language, transcript, local history, activity, pending actions, and recorder state.
- `localStorage` — current browser-local history under `juni-history`; authentication state is also mirrored by the existing auth hook/runtime integration.

There is no Redux, Zustand, or other centralized client state package found.

### Services and API clients

- `client/src/lib/trpc.ts` — typed tRPC client binding to `server/routers.ts`.
- `client/src/main.tsx` — React Query/tRPC HTTP batch client using `/api/trpc`.
- `client/src/const.ts` — OAuth login URL/state initiation.
- `Home.tsx` also directly calls `https://api.openai.com/v1/realtime/calls` with an ephemeral client secret. This is an architecture violation against the constitution/map’s strict provider boundary and is recorded in the risks document; it is not fixed in this inventory step.
- `Map.tsx` loads a maps proxy using frontend `VITE_FRONTEND_FORGE_API_URL` and `VITE_FRONTEND_FORGE_API_KEY` values.

### Current feature coverage

| Area | Actual status |
|---|---|
| Authentication | Manus OAuth UI and auth hook exist. |
| Chat | `AIChatBox.tsx` exists, but the main Home experience is voice-first; no registered chat route was found. |
| Voice | OpenAI Realtime WebRTC flow exists in `Home.tsx`; legacy `VoiceSystem.tsx` also exists. |
| Files | Home accepts image/PDF/text files and calls `files.analyze`; persistent file storage is not used for this flow. |
| Memory | NOT IMPLEMENTED as a domain subsystem. Local voice history is not a memory system. |
| Research | No registered research page or router procedure found; research notes exist in `research/`. |
| Settings | No registered settings route; controls are embedded in Home/menu UI. |
| Tests | Frontend unit tests exist for voice state and workspace status. No browser/E2E suite was found. |

## 3. Backend

The current backend lives under `server/`, not `apps/api`.

### Bootstrap and routes

- `server/_core/index.ts` is the active package entrypoint for `dev` and `build`.
- It registers the storage proxy, OAuth callback, and tRPC middleware.
- `server/index.ts` is a second legacy/static Express entrypoint that is not referenced by the current package scripts. This duplicate entrypoint requires later consolidation review.

### Controllers and services

- `server/routers.ts` — tRPC application router and current domain procedures.
- `server/_core/trpc.ts` — public, protected, and admin procedure middleware.
- `server/_core/context.ts` — request context and authenticated user.
- `server/_core/oauth.ts` — OAuth callback and session creation.
- `server/_core/sdk.ts` — Manus OAuth SDK/session helpers.
- `server/db.ts` — Drizzle user persistence helpers.
- `server/storage.ts` — Forge-backed storage helper functions.
- `server/_core/storageProxy.ts` — signed storage download redirect route.
- `server/orchestration.ts` — reusable server-side general LLM orchestration module.
- `server/_core/llm.ts` — built-in Forge LLM helper/client.
- `server/_core/voiceTranscription.ts` — documented/available transcription helper pattern, not exposed by the current app router.
- `server/_core/imageGeneration.ts`, `map.ts`, `dataApi.ts`, `notification.ts`, and `heartbeat.ts` — framework integration helpers; only some are reachable through current registered procedures/routes.

### Authentication and authorization

- Manus OAuth callback validates an OAuth nonce/state cookie, exchanges the code, upserts a user, and creates a session cookie.
- `protectedProcedure` requires an authenticated context user.
- `adminProcedure` requires `ctx.user.role === "admin"`.
- Current feature procedures derive returned user IDs from `ctx.user.id` rather than accepting owner IDs as inputs.
- Feature-resource ownership tables do not exist yet because feature tables do not exist.

### Current backend feature coverage

| Area | Actual status |
|---|---|
| Authentication | Implemented through Manus OAuth, session cookie, `auth.me`, and `auth.logout`. |
| Authorization | Public/protected/admin tRPC middleware exists; resource-level ownership enforcement is NOT IMPLEMENTED because resource tables are absent. |
| Orchestrator | `server/orchestration.ts` exists for server-side general LLM calls, but the main Realtime Home flow bypasses it. |
| Providers | OpenAI Realtime and Responses calls are directly implemented in `server/routers.ts`; built-in Forge LLM helper also exists. No `provider-core` adapter package exists. |
| Storage | Forge storage put/get helpers and download proxy exist. No user-owned file metadata table exists. |
| Memory | NOT IMPLEMENTED. |
| Files | Protected `files.analyze` calls OpenAI Responses API with base64 image/PDF/text input; durable file storage is not connected to this procedure. |
| Research | NOT IMPLEMENTED as a registered backend feature. |
| Voice | `realtime.createClientSecret` issues an OpenAI Realtime client secret; browser then connects directly to OpenAI WebRTC. |
| Tests | Server auth, JUNI tools, and orchestration tests exist. |

## 4. Shared Packages

The target package directories do not exist:

- `packages/shared` — NOT FOUND.
- `packages/provider-core` — NOT FOUND.
- `packages/storage-core` — NOT FOUND.
- `packages/provenance-core` — NOT FOUND.

The current shared code is under `shared/`:

| Current module | Purpose | Public exports / important types | Dependencies | Tests |
|---|---|---|---|---|
| `shared/juni.ts` | JUNI/SONA personas, OpenAI Realtime model, supported languages, safe tool declarations | `REALTIME_MODEL`, `JUNI_PERSONAS`, `SUPPORTED_LANGUAGES`, `safeLiveToolDeclarations`, `PersonaId`, `LanguageId` | TypeScript only | Covered indirectly by `server/juni.tools.test.ts` |
| `shared/const.ts` | Cookie names, OAuth state, shared error constants | OAuth/session constants and error messages | None beyond shared types | Covered indirectly by auth tests |
| `shared/types.ts` | Unified type export | Re-exports Drizzle user types and shared errors | `drizzle/schema.ts` | No direct test |
| `shared/_core/errors.ts` | Shared error definitions | Shared error types/constants | None observed | No direct test |

There are no provider, storage, or provenance package interfaces yet. `server/orchestration.ts` is the closest existing provider-neutral orchestration abstraction.

## 5. Database

The repository uses Drizzle/MySQL-compatible schema definitions. There is no Prisma schema and no Prisma directory.

### Models that actually exist

| Model/table | Definition | Current purpose |
|---|---|---|
| `users` / `User` | `drizzle/schema.ts` | Manus OAuth users, profile fields, role, timestamps, and last sign-in time. |

`users` fields include `id`, `openId`, `name`, `email`, `loginMethod`, `role`, `createdAt`, `updatedAt`, and `lastSignedIn`.

### Requested domain models not found

The following were not found in the Drizzle schema or current database helpers:

- Conversation — NOT FOUND
- Message — NOT FOUND
- File — NOT FOUND
- Memory — NOT FOUND
- MemoryCandidate — NOT FOUND
- Task — NOT FOUND
- Activity — NOT FOUND
- Audit/Provenance — NOT FOUND

Existing migration files are present under `drizzle/`, but no feature tables for these domains were identified.

## 6. API Routes

The server exposes one Express OAuth route, one storage proxy route, and a tRPC endpoint. tRPC procedures are listed by their logical procedure path; the transport is handled under `POST /api/trpc` by the tRPC adapter.

| Method | Path / procedure | Auth required? | Owner check? | Purpose |
|---|---|---:|---:|---|
| GET | `/api/oauth/callback` | OAuth state/code flow; no existing session required | OAuth state cookie check; no resource owner check | Exchange OAuth code, upsert user, create session, redirect home |
| GET | `/manus-storage/*` | No explicit authentication middleware | No explicit owner check | Request a Forge signed URL and redirect to storage object |
| POST | `/api/trpc/system.health` | No | No | Public health query with timestamp validation |
| POST | `/api/trpc/system.notifyOwner` | Admin | No resource owner; admin role check | Send owner notification |
| POST | `/api/trpc/auth.me` | No | No | Return current authenticated user or null |
| POST | `/api/trpc/auth.logout` | No | No | Clear the session cookie |
| POST | `/api/trpc/realtime.createClientSecret` | Yes | Session user is used for safety identifier; no persisted resource owner | Create OpenAI Realtime client secret |
| POST | `/api/trpc/files.analyze` | Yes | Session user authorization only; no persisted file owner | Analyze image/PDF/text input through OpenAI Responses API |
| POST | `/api/trpc/account.dashboard` | Yes | Session user ID used in response; no persisted account owner model | Return safe provider-not-connected dashboard state |
| POST | `/api/trpc/account.getRechargeInfo` | Yes | Session user ID used in response; no persisted account owner model | Return safe read-only recharge status |
| POST | `/api/trpc/account.startRecharge` | Yes | Session user ID used in response; no persisted recharge resource | Validate amount and return preview recharge intent |

No separate REST route for chat, memory, research, tasks, or voice audio streaming was found. The browser connects to OpenAI Realtime after receiving the temporary client secret.

## 7. Frontend Routes

The registered routes in `client/src/App.tsx` are:

| Path | Page | Status |
|---|---|---|
| `/` | `Home` | Registered primary voice companion |
| `/audit` | `Audit` | Registered preserved security audit dashboard |
| `/404` | `NotFound` | Registered not-found page |
| fallback | `NotFound` | Registered fallback for all unmatched routes |

The following routes were not found as registered frontend routes: `/login`, `/home`, `/chat`, `/voice`, `/files`, `/memory`, and `/settings`.

## 8. Environment Variables

Only names are recorded; values are intentionally omitted.

### Server and authentication

- `DATABASE_URL`
- `JWT_SECRET`
- `VITE_APP_ID`
- `OAUTH_SERVER_URL`
- `OWNER_OPEN_ID`
- `OWNER_NAME`
- `NODE_ENV`
- `PORT`

### AI/provider and Forge integrations

- `OPENAI_API_KEY`
- `BUILT_IN_FORGE_API_URL`
- `BUILT_IN_FORGE_API_KEY`
- `VITE_FRONTEND_FORGE_API_URL`
- `VITE_FRONTEND_FORGE_API_KEY`

### OAuth template name

- `VITE_OAUTH_PORTAL_URL` appears in the environment template and documentation, but current direct `process.env` usage was not found in the inspected source files.

No research-specific environment variable was found. No dedicated storage bucket configuration variable was found; Forge storage uses the built-in Forge URL/key pair.

## 9. NPM Scripts

Available scripts from `package.json`:

| Command | Actual script | Inventory status |
|---|---|---|
| `npm run dev` | `NODE_ENV=development tsx watch server/_core/index.ts` | Available |
| `npm run build` | Vite build plus server esbuild bundle | Available; passed |
| `npm run start` | Starts `dist/index.js` in production mode | Available |
| `npm run check` | `tsc --noEmit` | Available; passed |
| `npm run format` | `prettier --write .` | Available; not run because inventory must not modify source |
| `npm test` | `vitest run` | Available; passed |
| `npm run db:push` | `drizzle-kit generate && drizzle-kit migrate` | Available; not run because it may modify database state |
| `npm run lint` | — | **NOT AVAILABLE** |
| `npm run typecheck` | — | **NOT AVAILABLE**; `npm run check` is the available equivalent |
| `npm run db:sanity` | — | **NOT AVAILABLE** |
| `npm run db:validate` | — | **NOT AVAILABLE** |
| `npm run security:scan` | — | **NOT AVAILABLE** |

## 10. Tests

### Unit tests

- `client/src/lib/voiceState.test.ts`
- `client/src/lib/workspaceStatus.test.ts`
- `server/juni.tools.test.ts`
- `server/orchestration.test.ts`

### Integration/API tests

- `server/auth.logout.test.ts` exercises the auth logout procedure.
- No broader HTTP/API integration suite was found.

### Database tests

NOT FOUND. No database integration or schema validation test file was found.

### Frontend tests

Two frontend library test files exist. No component-rendering or browser end-to-end suite was found.

### Security tests

No dedicated security test suite or `security:scan` script was found. Some security behavior is covered indirectly by auth and safe-tool tests.

### Current test count

`npm test` completed successfully:

- 3 test files passed
- 8 tests passed

## 11. Existing Reusable Systems

| System | Location | Status | Notes |
|---|---|---|---|
| Authentication | `server/_core/oauth.ts`, `server/_core/sdk.ts`, `server/_core/trpc.ts`, `client/src/_core/hooks/useAuth.ts` | CAN REUSE | OAuth callback, session cookie, public/protected/admin middleware, and client hook exist. |
| Typed API client | `client/src/lib/trpc.ts`, `server/routers.ts` | CAN REUSE | Current application API contract is tRPC-based. |
| General AI orchestration | `server/orchestration.ts` and `server/_core/llm.ts` | CAN REUSE | Server-side normalized text orchestration exists, but current Realtime path bypasses it. |
| OpenAI Realtime broker | `server/routers.ts` | CAN REUSE WITH CONSOLIDATION | Client-secret procedure exists, but provider logic is in the router rather than provider-core. |
| Database access | `server/db.ts`, `drizzle/schema.ts` | CAN REUSE | Drizzle/MySQL access and user repository helpers exist. |
| File storage | `server/storage.ts`, `server/_core/storageProxy.ts` | CAN REUSE WITH CONSOLIDATION | Forge storage helpers and signed download proxy exist; ownership metadata is absent. |
| Shared domain contracts | `shared/juni.ts`, `shared/const.ts`, `shared/types.ts` | CAN REUSE | Current shared directory should evolve toward `packages/shared`. |
| Authorization middleware | `server/_core/trpc.ts` | CAN REUSE | `protectedProcedure` and `adminProcedure` are reusable foundations. |
| Error handling | tRPC errors, Express status responses, thrown `Error` values | NEEDS CONSOLIDATION | Multiple error styles exist and no shared domain error policy was found. |

## 12. Duplicate Systems

| Concern | Finding | Classification |
|---|---|---|
| Authentication | OAuth/session/auth hook are one primary system; no second full auth implementation found. | CAN REUSE |
| AI provider calls | `server/orchestration.ts` uses built-in Forge LLM; `server/routers.ts` directly calls OpenAI Realtime and Responses; `server/_core/llm.ts` also contains provider/Forge logic. | NEEDS CONSOLIDATION |
| Database access | `server/db.ts` is the main helper; no second database client found. | CAN REUSE |
| Memory | No memory implementation found. | NOT IMPLEMENTED |
| File storage | `server/storage.ts` and `server/_core/storageProxy.ts` are complementary write/helper and download-proxy paths, but durable user file records are absent. | CAN REUSE WITH CONSOLIDATION |
| Authorization | Central middleware exists, but resource-level authorization cannot yet be verified because resource models are absent. | NEEDS VERIFICATION |
| Error handling | tRPC, Express, and direct thrown errors coexist. | NEEDS CONSOLIDATION |
| API clients | tRPC client is centralized, but `Home.tsx` also performs a direct provider fetch. | NEEDS CONSOLIDATION |
| Server entrypoints | `server/_core/index.ts` is active while `server/index.ts` is a second legacy entrypoint. | NEEDS CONSOLIDATION |
| Voice UI | `Home.tsx` has the active OpenAI flow and `VoiceSystem.tsx` is a separate legacy voice component. | NEEDS CONSOLIDATION |

## 13. Architecture Violations

No fixes were made during this inventory step. Detailed severity classification is in [JUNI-AI-ARCHITECTURE-RISKS.md](./JUNI-AI-ARCHITECTURE-RISKS.md).

Observed or unresolved checks:

- **Web → Provider:** FOUND. `client/src/pages/Home.tsx` directly posts SDP to OpenAI using a temporary token. This conflicts with the strict architecture rule that provider communication remains behind the API/orchestrator/provider-core boundary.
- **Web → Database:** NOT FOUND in the inspected frontend source.
- **API route → raw database everywhere:** NOT FOUND. OAuth uses `server/db.ts` helpers; feature persistence is largely absent.
- **Duplicated provider logic:** FOUND. Built-in Forge LLM orchestration and direct OpenAI router/provider calls coexist without a provider-core adapter boundary.
- **Duplicated authorization:** NEEDS VERIFICATION. Central procedure middleware exists, but resource-level authorization cannot be tested without resource tables.
- **Client-controlled ownership:** NOT FOUND in current feature-router inputs; no resource ownership model exists to validate comprehensively.
- **Secrets in frontend:** Long-lived `OPENAI_API_KEY` was not found in frontend code. `VITE_FRONTEND_FORGE_API_KEY` is intentionally exposed to the map proxy from client code and requires verification that it is a restricted public/proxy credential rather than a privileged secret.
- **Circular package dependencies:** Target package graph does not exist; NEEDS VERIFICATION after package extraction.
- **Unprotected storage proxy:** FOUND. `/manus-storage/*` has no explicit authenticated user or resource-owner check in the route itself; signed-path security depends on the Forge storage design and path secrecy.

## 14. Unknowns

- Whether the exposed frontend Forge map key is restricted to the intended proxy/origins.
- Whether Forge storage paths are unguessable and independently authorized by the storage backend.
- Whether OpenAI Realtime direct WebRTC negotiation from the browser is an accepted temporary exception or must be moved behind an API/WebRTC relay for the target architecture.
- Whether the built-in Forge LLM and direct OpenAI calls are both required product capabilities or one is legacy.
- Whether `server/index.ts` is intentionally retained for a separate deployment mode.
- Whether `VoiceSystem.tsx`, `CapabilityBoard.tsx`, and `AIChatBox.tsx` remain product requirements or are legacy/template components.
- Whether any external scheduled tasks, webhooks, or deployment routes exist outside this repository.
- Whether database migrations have been applied to the deployed database.
- Whether there are production secrets or provider settings configured outside the repository.
- Whether a future `packages/provenance-core` must be introduced before memory and research sections.

## 15. Recommended Next Actions

These are recommendations only; no implementation was performed in Step 3.

1. Decide and document whether the current browser-to-OpenAI WebRTC negotiation is a temporary exception or must be mediated by the API boundary.
2. Establish the `apps/` and `packages/` target structure incrementally, beginning with shared contracts and provider-core boundaries.
3. Consolidate the active and legacy server entrypoints.
4. Consolidate the active Home voice implementation and legacy `VoiceSystem` implementation.
5. Define resource ownership and authorization before adding conversations, files, memory, tasks, or activities.
6. Add database sanity/validation scripts and tests before introducing feature tables.
7. Add lint, security-scan, API integration, and browser tests rather than treating missing commands as passed.
8. Verify Forge storage path authorization and frontend map-key restrictions.
9. Keep the constitution’s “no silent memory” rule as a prerequisite for any Memory implementation.

## Section 21–25 Status Matrix

| Section | Expected | Actual | Status |
|---|---|---|---|
| 21 Authentication | Auth UI, OAuth/session API, authorization foundation | Manus OAuth, session cookie, auth hook, protected/admin tRPC middleware exist | VERIFY — core exists; resource authorization needs verification |
| 22 Home | Primary authenticated home experience | `/` renders the JUNI/SONA voice-first Home page | VERIFY — route exists; auth is action-gated rather than route-gated |
| 23 Chat | Chat UI and API/orchestration path | `AIChatBox.tsx` exists; no registered chat route or chat procedure found | VERIFY — partial/template-only |
| 24 Voice | Voice UI and provider boundary | OpenAI Realtime UI and client-secret procedure exist; direct browser provider SDP call violates target boundary | VERIFY — functional core with architecture risk |
| 25 Files | File UI, API, storage, ownership | File analysis UI/API exists; durable file model, storage ownership, and malware/retention controls absent | VERIFY — partial |

## Validation Results

Requested commands were attempted exactly as instructed:

| Command | Result |
|---|---|
| `npm test` | PASS — 3 files, 8 tests |
| `npm run lint` | NOT AVAILABLE — missing script |
| `npm run typecheck` | NOT AVAILABLE — missing script |
| `npm run build` | PASS — Vite and server bundle completed; chunk-size warning emitted |
| `npm run db:sanity` | NOT AVAILABLE — missing script |
| `npm run db:validate` | NOT AVAILABLE — missing script |
| `npm run security:scan` | NOT AVAILABLE — missing script |
| `npm run check` | PASS — TypeScript completed with no errors; available equivalent to typecheck |

`npm run db:push` exists but was intentionally not executed because it can generate/apply database migrations and modify database state. `npm run format` exists but was not executed because this was an inspect-and-document step and it may rewrite source files.
