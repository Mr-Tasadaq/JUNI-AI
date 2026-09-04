# JUNI AI Command Registry

**Repository:** `/home/ubuntu/JUNI-AI-upload`

**Package manager:** `pnpm`, selected because the repository contains `pnpm-lock.yaml` and declares a pnpm package manager.

## Actual package scripts

The scripts below are taken directly from `package.json`; no unavailable commands are presented as implemented.

| Purpose | Command | Status | Notes |
|---|---|---|---|
| Install | `pnpm install` | EXISTS | Lockfile was up to date and dependencies installed successfully. |
| Development | `pnpm dev` | EXISTS | Runs `NODE_ENV=development tsx watch server/_core/index.ts`. |
| Production start | `pnpm start` | EXISTS | Runs the built `dist/index.js` in production mode. |
| Test | `pnpm test` | EXISTS | Runs `vitest run`. |
| Typecheck | `pnpm check` | EXISTS | Runs `tsc --noEmit`. |
| Build | `pnpm build` | EXISTS | Runs Vite build and bundles the server with esbuild. |
| Database | `pnpm db:push` | EXISTS | Runs `drizzle-kit generate && drizzle-kit migrate`; not run during workspace setup because this step makes database changes. |
| Format | `pnpm format` | EXISTS | Runs `prettier --write .`; not run globally during setup to preserve minimal diff. |
| Lint | `pnpm lint` | NOT AVAILABLE | No `lint` script exists in `package.json`. |
| Security scan | — | NOT AVAILABLE | No security-scan script exists in `package.json`; no fabricated result is reported. |

## Baseline commands executed

```text
pnpm install   PASS
pnpm list --depth 0   PASS
pnpm test      PASS
pnpm check     PASS
pnpm build     PASS
```

## Known command warnings

pnpm reported that the legacy `pnpm` field in `package.json` is no longer read for `patchedDependencies` and `overrides`. This is an existing package-management warning, not an installation failure. The production build also reported an existing JavaScript chunk larger than 500 kB.

## Safety rules

Do not invent `lint`, `security`, database sanity, or database validation commands. If a future step requires one, add an intentional script or record the command as unavailable before relying on it. Do not run `pnpm db:push` without a domain/schema/migration plan and explicit database validation scope.

## Environment classification

Only variable names from `.env.example` are recorded here; no values are copied.

| Variable | Classification | Browser exposure | Purpose |
|---|---|---:|---|
| `OPENAI_API_KEY` | SERVER_ONLY / AI_PROVIDER | No | Server-side provider credential |
| `DATABASE_URL` | SERVER_ONLY / DATABASE | No | Server-side database connection |
| `JWT_SECRET` | SERVER_ONLY / AUTH | No | Server-side session signing secret |
| `VITE_APP_ID` | PUBLIC / AUTH | Yes, by Vite convention | Manus application identifier |
| `OAUTH_SERVER_URL` | SERVER_ONLY / AUTH | No | OAuth server endpoint used by server flow |
| `VITE_OAUTH_PORTAL_URL` | PUBLIC / AUTH | Yes, by Vite convention | Browser login portal URL |
| `OWNER_OPEN_ID` | SERVER_ONLY / AUTH | No | Server-side owner identity comparison |
| `OWNER_NAME` | SERVER_ONLY / OPTIONAL | No | Server-side owner metadata |

The `.gitignore` correctly excludes `.env`, local/development/test/production environment files, `node_modules`, build outputs, logs, and local database files. The template contains no secret values.
