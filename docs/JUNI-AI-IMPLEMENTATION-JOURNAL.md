# JUNI AI Implementation Journal

This journal records implementation-agent sessions and the evidence produced by each focused change.

## Session 13 — Coding Workspace Setup

**Step:** Section 13 workspace setup and documentation-only micro-step

**Objective:** Establish the real repository root, package-manager workflow, baseline commands, environment classification, Git protection rules, file-change protocol, database/provider/testing protocols, and coding-agent identity before Section 14 code implementation.

### Files created

- `docs/JUNI-AI-COMMAND-REGISTRY.md`
- `docs/JUNI-AI-BASELINE.md`
- `docs/JUNI-AI-CODING-WORKSPACE.md`
- `docs/JUNI-AI-CODING-AGENT.md`
- `docs/JUNI-AI-IMPLEMENTATION-JOURNAL.md`

### Files modified

None.

### Files moved

None.

### Files deleted

None.

### Repository inspection

- Actual repository root verified as `/home/ubuntu/JUNI-AI-upload`.
- Required frontend, backend, shared, database, configuration, migration, and documentation paths verified.
- Existing Git state was clean before this setup change.
- The branch was one commit ahead of `origin/main`; no pre-existing working-tree changes were overwritten.

### Dependency and baseline validation

- `pnpm install` — PASS.
- `pnpm list --depth 0` — PASS.
- `pnpm test` — PASS: 3 test files and 8 tests.
- `pnpm check` — PASS.
- `pnpm build` — PASS.

### Problems and warnings

- pnpm reports that the legacy `pnpm` field is no longer read for patched dependencies and overrides.
- Build reports a JavaScript chunk larger than 500 kB.
- No `lint` or security-scan scripts are available.
- Database push was intentionally not run because it changes database state.

### Fixes

No source or configuration fix was required. The setup was documentation-only.

### Final status

**COMPLETE** for Section 13 workspace setup after validation and focused commit. Section 14 has not started.

## Session 14 — Core Types and Contract Foundation

**Step:** Section 14 controlled contract implementation

**Objective:** Establish the smallest repository-supported canonical domain contract without duplicating Drizzle-derived types or introducing speculative future domains.

### Files created

- `shared/contracts/identity.ts`
- `server/identity.contract.test.ts`
- `docs/contracts/README.md`

### Files modified

- `shared/types.ts`
- `server/routers.ts`
- `server/juni.tools.test.ts`
- `docs/JUNI-AI-CONTRACT-REGISTRY.md`
- `docs/JUNI-AI-IMPLEMENTATION-JOURNAL.md`

### Implemented contract

- `UserId` is the canonical shared identity type in `shared/contracts/identity.ts`.
- It aliases the Drizzle-derived `User["id"]` type, preserving `drizzle/schema.ts` as the authority for the actual primary-key representation.
- Protected account procedures derive `UserId` from `ctx.user.id`; no browser-supplied owner ID is accepted.
- `UserId` is re-exported type-only from `shared/types.ts`.

### Deferred contracts

`SessionId`, `ConversationId`, `MessageId`, `FileId`, `MemoryId`, `MemoryCandidateId`, `ResearchId`, `TaskId`, `ActivityId`, `ProvenanceId`, and `OwnedByUser` were not implemented. The source inspection found no durable database record, API boundary, or production consumer that could justify any of those contracts. Their current status is documented, not implemented, in `docs/contracts/README.md`.

### Existing-contract verification

- `JUNI_PERSONAS`, `PersonaId`, `SUPPORTED_LANGUAGES`, `LanguageId`, and `safeLiveToolDeclarations` were preserved in `shared/juni.ts`.
- The router’s persona and language Zod schemas are now exported for direct validation tests, without changing their accepted values.
- Contract tests now cover valid and invalid persona and language values, the safe-tool allowlist and parameter structure, and `UserId` compatibility with the Drizzle user primary key.

### Security and boundary review

- No secrets, provider credentials, database credentials, or session-signing secrets were added.
- No database table, migration, event bus, vector database, or automatic-memory behavior was added.
- The shared identity contract imports only the Drizzle type definition and has no server-runtime, browser-runtime, or database-connection dependency.
- Provider request and response types in `server/_core/llm.ts` remain provider-adapter contracts and were not exposed as JUNI domain contracts.

### Validation

- `pnpm install --frozen-lockfile` — PASS.
- Pre-change `pnpm check` — PASS.
- Pre-change `pnpm test` — PASS: 3 files and 8 tests.
- Focused `pnpm exec vitest run server/identity.contract.test.ts` — PASS: 1 file and 2 tests.
- Final Prettier check — PASS for the Section 14 source, test, and newly created documentation files.
- Final `git diff --check` — PASS. The existing registry layout was retained to avoid unrelated formatting churn.
- Final `pnpm check` — PASS.
- Final `pnpm test` — PASS: 4 files and 11 tests.
- Final `pnpm build` — PASS.

### Problems and fixes

- The first final formatting check identified style drift in `server/routers.ts`, the contract-directory README, and the contract registry. Running Prettier on only the intended changed files corrected the issue; the repeated formatting check passed.
- pnpm emitted its existing warning that the legacy `pnpm` field is no longer read for patched dependencies and overrides. The warning did not affect type checking, testing, or the production build.

### Final status

**COMPLETE** for Section 14. The only implemented new domain contract is `UserId`; all unsupported future domains are explicitly documented as deferred.
