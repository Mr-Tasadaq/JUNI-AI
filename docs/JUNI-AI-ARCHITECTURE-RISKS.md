# JUNI AI Architecture Risks

**Scope:** Documentation-only audit for Step 3. No source-code or architecture fixes were applied.

**Severity:** `CRITICAL` blocks safe operation or exposes a severe security/data risk; `HIGH` violates a core boundary or creates a material security/maintainability risk; `MEDIUM` creates meaningful delivery or correctness risk; `LOW` is limited-scope technical debt; `INFO` is an observation or unknown requiring later confirmation.

## CRITICAL

### No confirmed CRITICAL finding in this inventory

No confirmed critical vulnerability was established from static inspection alone. This does not replace a production security assessment, dependency audit, penetration test, or review of deployed configuration.

## HIGH

### H-01 — Browser directly negotiates with OpenAI

- **Evidence:** `client/src/pages/Home.tsx` directly POSTs SDP to `https://api.openai.com/v1/realtime/calls` using a temporary OpenAI client secret.
- **Rule affected:** AI Boundary Rule and the required `Web → API → Orchestrator → Provider Core → Provider` path.
- **Impact:** Provider-specific transport and endpoint behavior live in the UI, making provider replacement, policy enforcement, auditability, and centralized rate/authorization control harder.
- **Status:** OPEN — do not fix during inventory.
- **Recommended follow-up:** Decide whether WebRTC direct media negotiation is an explicitly accepted exception. If not, introduce an API/provider-core session boundary or a documented relay architecture.

### H-02 — Storage download proxy has no explicit application authorization check

- **Evidence:** `server/_core/storageProxy.ts` registers `GET /manus-storage/*`, validates only the path and Forge configuration, and redirects to a Forge-signed URL. No authenticated-user or resource-owner check is performed in this route.
- **Impact:** If storage paths are guessable, leaked, or insufficiently scoped by the Forge backend, a caller may retrieve another user’s object.
- **Status:** OPEN — ownership/storage behavior is unknown.
- **Recommended follow-up:** Verify Forge path authorization and add an application-level ownership lookup before issuing a signed URL for user-owned objects.

### H-03 — File analysis accepts large base64 payloads without durable ownership/retention controls

- **Evidence:** `files.analyze` accepts a base64 data URL up to 12,000,000 characters and sends supported content to OpenAI. No file table, retention policy, malware scan, or durable owner record exists.
- **Impact:** Increased memory/request pressure, unclear data lifecycle, and incomplete user ownership/audit controls for uploaded content.
- **Status:** OPEN — feature is partial by design.
- **Recommended follow-up:** Introduce storage-core upload metadata, user ownership, size/content validation, retention/deletion policy, malware scanning where appropriate, and provider-sharing disclosure.

## MEDIUM

### M-01 — Target architecture packages do not exist

- **Evidence:** `apps/`, `packages/shared`, `packages/provider-core`, `packages/storage-core`, and `packages/provenance-core` are absent.
- **Impact:** Current architecture remains organized around `client/`, `server/`, and `shared/`, so boundary rules are documented but not structurally enforced.
- **Status:** OPEN — planned incremental migration.

### M-02 — Provider logic is split across multiple systems

- **Evidence:** `server/orchestration.ts` uses the built-in Forge LLM helper; `server/_core/llm.ts` contains Forge LLM logic; `server/routers.ts` directly calls OpenAI Realtime and Responses endpoints.
- **Impact:** Different capabilities have different provider/error/configuration paths, increasing duplication and making provider selection and failure semantics inconsistent.
- **Status:** OPEN.
- **Recommended follow-up:** Define provider-core interfaces and adapters, then route orchestration through normalized provider contracts.

### M-03 — Active and legacy server entrypoints coexist

- **Evidence:** `package.json` uses `server/_core/index.ts`, while `server/index.ts` contains a second static Express server and is not referenced by current scripts.
- **Impact:** Future changes may be made to the inactive entrypoint or deployments may diverge from local development behavior.
- **Status:** OPEN.
- **Recommended follow-up:** Confirm deployment usage, document the legacy entrypoint, then consolidate or remove it in a dedicated change.

### M-04 — Active and legacy voice implementations coexist

- **Evidence:** `client/src/pages/Home.tsx` contains the active OpenAI WebRTC implementation, while `client/src/components/VoiceSystem.tsx` is a separate voice system component.
- **Impact:** Voice behavior and provider assumptions can drift; maintainers may update the wrong implementation.
- **Status:** OPEN.
- **Recommended follow-up:** Identify references and product intent, then consolidate behind one voice boundary.

### M-05 — Resource-level authorization cannot be verified because domain tables are absent

- **Evidence:** Only the `users` table exists. Conversation, message, file, memory, task, activity, and provenance tables are not present.
- **Impact:** Protected procedures authenticate a user but cannot yet enforce ownership for persisted feature resources.
- **Status:** OPEN / NEEDS VERIFICATION as features are added.
- **Recommended follow-up:** Define ownership columns, repository predicates, and authorization tests before adding user-owned domain operations.

### M-06 — Required quality/security commands are missing

- **Evidence:** `npm run lint`, `npm run typecheck`, `npm run db:sanity`, `npm run db:validate`, and `npm run security:scan` are not defined.
- **Impact:** Required release gates cannot currently be executed through the prescribed commands.
- **Status:** OPEN.
- **Recommended follow-up:** Add real scripts and CI checks; do not treat unavailable commands as passing.

### M-07 — Client-exposed Forge map credential requires restriction verification

- **Evidence:** `client/src/components/Map.tsx` reads `VITE_FRONTEND_FORGE_API_KEY` and places it in a browser map-script URL.
- **Impact:** Any credential exposed through `VITE_` is public to browser users. If it is privileged rather than origin/referer-restricted, it could be abused.
- **Status:** OPEN / NEEDS VERIFICATION.
- **Recommended follow-up:** Confirm this is a deliberately public, restricted proxy credential; otherwise move privileged access server-side.

## LOW

### L-01 — Error handling uses multiple styles

- **Evidence:** tRPC errors, direct thrown `Error` values, and Express status responses coexist.
- **Impact:** Error shape and user/operator observability may be inconsistent.
- **Status:** OPEN.
- **Recommended follow-up:** Define shared error contracts in the shared/provider boundaries and normalize API responses.

### L-02 — Main voice UI embeds substantial provider/session logic

- **Evidence:** `Home.tsx` owns WebRTC setup, provider event parsing, tool dispatch, recording, transcript capture, and UI state.
- **Impact:** Large component surface makes testing and provider replacement harder.
- **Status:** OPEN.
- **Recommended follow-up:** Extract UI-neutral session and tool orchestration services after the target boundaries are established.

### L-03 — Browser-local history is not an owned server resource

- **Evidence:** Home stores history in `localStorage` under `juni-history`.
- **Impact:** History is device-local, not multi-device, not server-auditable, and has no server retention/deletion enforcement.
- **Status:** OPEN / intentional partial behavior.
- **Recommended follow-up:** If promoted to product memory/history, add explicit consent, user ownership, retention, export, deletion, and provenance controls.

### L-04 — No browser or end-to-end test suite

- **Evidence:** Only unit/library and server procedure tests were found.
- **Impact:** WebRTC, OAuth, file upload, confirmation UI, and route behavior are not covered by automated browser tests.
- **Status:** OPEN.
- **Recommended follow-up:** Add focused browser tests after the route and provider boundaries stabilize.

## INFO

### I-01 — Memory is not implemented

No Memory, MemoryCandidate, or related persistence model, route, or UI was found. This is consistent with the instruction not to begin Memory implementation yet.

### I-02 — Research and task systems are not implemented

Research and task/activity target areas appear in documentation and UI language, but no registered research/task domain routes or persistence models were found.

### I-03 — Chat is partial/template-only

`AIChatBox.tsx` exists and contains example behavior, but no registered chat page or chat procedure was found in the current route/API inventory.

### I-04 — Database migration state is unknown

Migration files exist, but this inventory did not apply migrations or connect to a deployed database. The deployed schema state is therefore `NEEDS VERIFICATION`.

### I-05 — Direct OpenAI use may be a deliberate WebRTC transport choice

OpenAI recommends browser WebRTC for low-latency voice. The architecture risk is not that the transport is inherently invalid; the risk is that the current repository constitution requires provider isolation and the implementation places endpoint negotiation in the web app. This requires an explicit architecture decision.

## Risk Gate

Before implementing Memory or additional user-owned systems, address or explicitly accept the following:

1. H-01 browser/provider boundary decision.
2. H-02 storage ownership and signed-download authorization verification.
3. H-03 file lifecycle and ownership design.
4. M-05 resource-level authorization design.
5. M-06 real validation/security scripts.
6. M-07 public Forge credential restriction verification.
