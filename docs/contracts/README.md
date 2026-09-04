# JUNI AI Contract Directory

This directory documents the canonical contracts that currently exist in the JUNI AI repository. It is intentionally narrower than the target architecture. A contract is listed as implemented only when its source definition and at least one real consumer exist in the codebase.

## Contract Ownership Rule

Every domain contract has one canonical owner. Consumers import that definition rather than silently redefining the same concept. Database-inferred types remain owned by the Drizzle schema. API input and output contracts remain owned by the tRPC router until a dedicated domain module is justified. Shared contracts must be browser-safe and must not contain provider credentials, database credentials, session-signing secrets, or private tokens.

## Current Canonical Contract Map

| Contract                                                          | Canonical location             | Owning package or layer          | Consumers                                                     | Validation strategy                                                |
| ----------------------------------------------------------------- | ------------------------------ | -------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------ |
| `User`                                                            | `drizzle/schema.ts`            | Drizzle database schema          | Authentication context, database helpers, shared type exports | Drizzle inference and `pnpm check`                                 |
| `UserId`                                                          | `shared/contracts/identity.ts` | Shared identity contract         | Authenticated account API output in `server/routers.ts`       | Compile-time equality with `User["id"]` and an account-output test |
| `PersonaId`, `LanguageId`, `JUNI_PERSONAS`, `SUPPORTED_LANGUAGES` | `shared/juni.ts`               | Shared AI identity contract      | Home UI and realtime API validation                           | Literal types and router-schema tests                              |
| `safeLiveToolDeclarations`                                        | `shared/juni.ts`               | Shared tool-declaration contract | Realtime client-secret configuration                          | Allowlist and parameter-structure tests                            |
| `User` database row and insert types                              | `drizzle/schema.ts`            | Drizzle database schema          | Server authentication and data access                         | Drizzle inference                                                  |
| API input and inferred output contracts                           | `server/routers.ts`            | tRPC API boundary                | Client tRPC caller and server procedures                      | Zod parsing, unit tests, and TypeScript checking                   |
| `TrpcContext`                                                     | `server/_core/context.ts`      | Server request-context layer     | tRPC middleware and procedures                                | TypeScript checking                                                |
| `HttpError` and HTTP error factories                              | `shared/_core/errors.ts`       | Shared error module              | Server SDK and error paths                                    | Existing error-path behavior                                       |

## Implemented Identity Contract

`UserId` is a type alias for the Drizzle-derived `User["id"]` primary-key type. The current `users.id` column is an auto-incremented MySQL integer, so `UserId` resolves to the same numeric identifier used by persisted user records. The contract deliberately does not introduce a branded ID or a second `User` interface. A future database migration that changes the primary-key representation will update the type through Drizzle inference.

The account procedures derive `UserId` from `ctx.user.id` after `protectedProcedure` has authenticated the request. They do not accept a browser-supplied owner identifier. The contract is exported type-only through `@shared/types` for server or shared consumers that need the canonical name without importing a database connection.

## Session Boundary

No `SessionId` contract is implemented. The current authentication mechanism stores a signed JWT in the `app_session_id` cookie and does not maintain a durable session record with a repository-owned identifier. The cookie name and token payload are authentication implementation details, not a canonical `SessionId`. Authentication sessions must remain separate from future AI conversation identifiers.

## Deferred Domain Identifiers

| Identifier                         | Status          | Reason for deferral                                                                  |
| ---------------------------------- | --------------- | ------------------------------------------------------------------------------------ |
| `ConversationId`                   | Not implemented | No conversation table, API procedure, or persistent conversation consumer exists.    |
| `MessageId`                        | Not implemented | Current messages are provider or UI shapes; no durable message domain exists.        |
| `FileId`                           | Not implemented | File analysis accepts transient data URLs but does not persist file records.         |
| `MemoryId` and `MemoryCandidateId` | Not implemented | No memory lifecycle, approval flow, or persistent memory consumer exists.            |
| `ResearchId`                       | Not implemented | No research domain record or service contract exists.                                |
| `TaskId`                           | Not implemented | No JUNI task domain table or API contract exists.                                    |
| `ActivityId`                       | Not implemented | Activity is currently Home-local UI state, not a durable domain record.              |
| `ProvenanceId`                     | Not implemented | Provenance is architectural documentation only; no runtime domain consumer exists.   |
| `OwnedByUser`                      | Not implemented | No persistent user-owned resource contract currently needs a shared ownership shape. |

## Boundary Decisions

The provider-facing message, tool, and response types in `server/_core/llm.ts` remain provider-adapter implementation contracts. They are not re-exported as JUNI domain contracts. Similarly, `safeLiveToolDeclarations` remains a current shared capability allowlist, but its OpenAI Realtime request shape is documented as existing provider coupling rather than a general provider-neutral tool interface.

No database migration, database table, event bus, vector store, automatic-memory behavior, or speculative enum was introduced by this contract foundation. Future domain work must add a canonical contract only alongside a real domain implementation, its authorized inputs, its output boundary, and focused validation.
