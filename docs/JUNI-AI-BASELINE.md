# JUNI AI Baseline

**Date:** 2026-09-04

**Repository root:** `/home/ubuntu/JUNI-AI-upload`

## Runtime

| Item | Actual value |
|---|---|
| Node | `v22.13.0` |
| pnpm | `10.4.1` |
| Package manager declaration | `pnpm@10.4.1+sha512.c753b6...` in `package.json` |
| Project package | `security-audit-website@1.0.0` |

## Installation

**Status: PASS**

`pnpm install` completed successfully. The lockfile was up to date and the dependency resolution step was skipped. No dependency files were changed by installation.

`pnpm list --depth 0` also completed successfully. The repository has a populated dependency tree for React, Vite, tRPC, Drizzle, Vitest, OpenAI-related server code, and the existing UI stack.

## Validation

| Command | Status | Exact result |
|---|---|---|
| `pnpm test` | PASS | 3 test files passed; 8 tests passed |
| `pnpm check` | PASS | TypeScript completed with no reported errors |
| `pnpm build` | PASS | Vite frontend and esbuild server bundle completed successfully |
| `pnpm lint` | NOT AVAILABLE | No lint script exists in `package.json` |
| Security scan | NOT AVAILABLE | No security-scan script exists in `package.json` |
| `pnpm db:push` | NOT RUN | Database-changing command intentionally not run during workspace setup |

## Known warnings

1. pnpm reports that the legacy `pnpm` field in `package.json` is no longer read for `patchedDependencies` and `overrides`. Installation still succeeds.
2. The production build reports a JavaScript chunk larger than 500 kB after minification. The build still succeeds.
3. The repository contains migration-era database artifacts that do not match the active TypeScript schema; this is documented in the prior database/domain/event audits and remains unresolved.

## Baseline conclusion

The repository is **PASSING** for installation, tests, typecheck, and production build at this checkpoint. No source code or database structure was changed to obtain these results.
