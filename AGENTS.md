# JUNI-AI Repository Agent Rules

## Scope

This repository permits full development work through the authenticated GitHub account: read and edit source files, create files and branches, run tests and builds, commit changes, push branches, and create or update pull requests and issues when requested.

## Required workflow

1. Inspect the repository and existing implementation before changing files.
2. Preserve valuable existing work and make the smallest safe change that satisfies the request.
3. Run the relevant formatter, type checker, tests, and production build before committing.
4. Review `git diff --check`, the changed-file list, and the final repository status before pushing.
5. Use clear, focused commit messages and report the commit, validation evidence, and pushed branch.

## Approval boundaries

The agent must request explicit approval before performing any of these actions:

- Deleting the repository, branches, tags, files, releases, issues, or pull requests.
- Changing repository visibility, ownership, collaborators, teams, deploy keys, OAuth applications, or account security.
- Changing branch protection, required reviews, required checks, merge restrictions, or rulesets.
- Creating, rotating, exposing, or deleting repository, environment, or organization secrets and variables.
- Triggering production deployment, billing changes, or irreversible external operations.
- Force-pushing, rewriting shared history, or bypassing required checks.

## Secrets and credentials

Never print, commit, or expose credentials, access tokens, private keys, cookies, database URLs, or provider secrets. Use configured environment variables and server-side secret handling. Do not place secrets in client code, documentation, screenshots, logs, or issue/PR text.

## GitHub operating policy

Normal development pushes are allowed on feature branches and on `main` when explicitly requested by the user. Prefer a pull request for broad or risky changes. Do not infer permission to modify security, access, or repository governance settings from permission to modify application code.

## JUNI-AI project boundaries

Preserve the existing JUNI AI contract ownership model. Prefer database-derived types over duplicated domain types, keep provider adapters behind server boundaries, do not invent persistence or memory infrastructure without a real consumer, and document deferred work honestly.
