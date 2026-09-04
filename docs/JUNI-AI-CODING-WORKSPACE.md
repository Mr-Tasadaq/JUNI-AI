# JUNI AI Coding Workspace

**Workspace root:** `/home/ubuntu/JUNI-AI-upload`

**Mode:** `IMPLEMENTATION`

**Execution model:**

```text
READ
→ UNDERSTAND
→ EDIT
→ TEST
→ FIX
→ VERIFY
```

## Workspace checklist

- [x] Repository identified.
- [x] Actual root verified as `/home/ubuntu/JUNI-AI-upload`.
- [x] Package manager verified as pnpm.
- [x] Dependencies installed with `pnpm install`.
- [x] Dependency tree inventoried with `pnpm list --depth 0`.
- [x] Commands inventoried in `JUNI-AI-COMMAND-REGISTRY.md`.
- [x] Baseline tests run.
- [x] Baseline typecheck run.
- [x] Baseline build run.
- [x] Node version recorded as `v22.13.0`.
- [x] pnpm version recorded as `10.4.1`.
- [x] Environment template audited without copying secret values.
- [x] Git state checked before editing.
- [x] Existing changes protected; no pre-existing working-tree changes existed.
- [x] Coding journal created.
- [x] File-change protocol established.
- [x] Security protocol established.
- [x] Database protocol established.
- [x] Provider security protocol established.
- [x] API-before-UI rule established.
- [x] Schema-before-persistence rule established.
- [x] Testing protocol established.
- [x] Minimal-diff rule established.
- [x] Rollback and focused-commit rule established.
- [x] Coding-agent document created.
- [x] Diff reviewed with `git diff --check`.

## Source-change protocol

Before editing, run `git status` and `git diff`. Existing user changes are protected and must not be deleted, stashed destructively, or overwritten. Every logical unit identifies files created, modified, moved, or deleted. Deletion requires stronger justification than modification.

The preferred loop is:

```text
INSPECT
→ PLAN ONE SMALL CHANGE
→ WRITE
→ TYPECHECK
→ TEST
→ FIX ROOT CAUSE
→ BUILD/CHECK
→ REVIEW DIFF
→ COMMIT
```

Do not use a blind `git add .` when unrelated files may exist. Add only the files belonging to the focused change.

## Dependency protocol

Before adding an import, verify whether the package or a local helper already exists, whether it creates a cycle, and whether it belongs on the client or server side. Use pnpm consistently because the repository is lockfile-based.

## API and UI protocol

For backend-driven features:

```text
contract
→ API
→ API tests
→ UI integration
```

Do not build a fake UI for nonexistent API behavior. Protected operations must use server authentication and ownership checks; client-supplied owner IDs and roles are not authoritative.

## Database protocol

For persistence:

```text
domain
→ schema
→ migration
→ repository
→ API
→ UI
```

Inspect schema, migrations, relations, and queries before any change. Never run `pnpm db:push` casually. Do not manually edit applied migrations. Identify data risk and rollback/compensation before destructive operations.

## Provider and secrets protocol

Provider credentials remain server-only. Never print, commit, or place `OPENAI_API_KEY`, `DATABASE_URL`, `JWT_SECRET`, private tokens, or other secrets in client code, shared browser modules, public configuration, or documentation.

The target integration boundary is:

```text
Client
  ↓
Server API
  ↓
Orchestrator
  ↓
Provider boundary
  ↓
External AI
```

Provider-specific request and response details should not spread into unrelated domain modules.

## Testing protocol

Each logical unit must identify happy-path, invalid-input, unauthorized, forbidden, empty, failure, edge-case, and duplicate-request coverage where applicable. Use the repository’s existing Vitest convention. Do not report PASS unless the command actually ran successfully.

Current available validation commands are recorded in `JUNI-AI-COMMAND-REGISTRY.md`. There is no current lint or security-scan script.

## Completion protocol

Use only these status values:

```text
NOT STARTED
IN PROGRESS
PASSING
PARTIAL
BLOCKED
COMPLETE
```

A feature is complete only when code exists, integration works, validation passes, authorization works, error handling works, tests exist, and known blockers are documented. A missing optional capability is PARTIAL; an unresolved safety/correctness blocker is BLOCKED.
