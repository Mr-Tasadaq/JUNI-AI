# JUNI AI Workspace — Living Architecture Record

## Current status

**Status: PARTIAL.** The authenticated workspace foundation is implemented and validated. It includes a responsive conversation UI, user-scoped persistence, a server-only provider boundary, transparent capability messaging, and a metadata model for future object-storage uploads. Realtime voice, web research, multimodal processing, durable memory, and actual upload UX remain intentionally deferred.

## Implemented architecture

| Boundary                 | Current implementation                                                                                                                                        | Truthful status                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Authentication           | Scaffold-provided Manus OAuth and authenticated client session hook                                                                                           | Implemented by scaffold and used by the workspace                                  |
| Workspace UI             | Responsive React page with desktop sidebar, mobile stacking, accessible buttons, empty/loading/error states, and status disclosures                           | Implemented and visually checked at 1280px and 375px widths                        |
| Conversation persistence | `conversations` and `messages` tables with user IDs, timestamps, role/status fields, and indexes                                                              | Implemented; migration applied                                                     |
| Typed API                | Protected tRPC procedures for listing/creating conversations, reading messages, sending messages, and registering file metadata                               | Implemented                                                                        |
| AI boundary              | `server/orchestration.ts` converts trusted system guidance, user input, history, and untrusted context into a provider request                                | Implemented and unit tested                                                        |
| Provider mediation       | Existing server-only `invokeLLM` helper is called from the server orchestration layer                                                                         | Implemented; browser receives only the resulting assistant message                 |
| Object storage           | Protected `files.upload` calls server-only `storagePut`, generates a user-scoped key, hashes bytes, and persists `storedFiles` metadata separately from bytes | Upload service implemented; upload UI and content-processing pipeline are deferred |

## Security decisions

External context is placed inside explicit `UNTRUSTED_CONTEXT` delimiters and is described to the provider as data only. It cannot change system instructions, permissions, or confirmation policy. Conversation and file procedures are protected and require the authenticated user ID from the server context; conversation lookup always filters by both resource ID and owner ID. Provider credentials are read only from server environment configuration through the existing LLM helper. No provider key is imported into client code, local storage, query parameters, or rendered errors.

The current send procedure persists the user message before invoking the model. If the provider fails, JUNI records a user-visible assistant error state and returns a generic failure without exposing provider details. This preserves truthful status and allows a safe retry, but the current operation is not yet wrapped in a transaction or idempotency key.

## Validation evidence

The following checks were actually run in the project workspace:

| Check                          | Result                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| `pnpm check`                   | Passed with no TypeScript errors                                                                  |
| `pnpm test` | Passed: 6 test files, 12 tests |
| `pnpm build`                   | Passed; Vite emitted a non-blocking large-chunk warning from the existing markdown/diagram bundle |
| Database migration generation  | Passed; `drizzle/0001_motionless_whistler.sql` generated                                          |
| Database migration application | Passed; four tables and five indexes were created                                                 |
| Desktop visual check           | Passed at 1280×720; authenticated workspace rendered with branded hierarchy and status messaging  |
| Mobile visual check            | Passed at 375×812; sidebar stacks above workspace and primary actions remain visible              |

## Known risks and limitations

The current conversation send flow is sequential rather than transactional. A future retry/idempotency design should prevent duplicate user messages if a client retries after a network timeout. The schema currently stores ownership IDs and indexes without foreign-key constraints because the scaffold’s baseline schema does not yet define relational constraints; this should be revisited with a controlled migration. Provider model selection is delegated to the existing gateway default and should later gain capability-aware routing and explicit availability reporting.

The workspace currently supports text conversations only. The protected upload service exists, but there is no upload surface, content scanning pipeline, document extraction, media processing, or retrieval index. The provider boundary has a security envelope for retrieved context, but no live web research connector is enabled in this milestone.

## Next incremental milestones

1. Add explicit conversation deletion/rename and idempotent send semantics with authorization tests.
2. Add a server upload procedure that uses `storagePut`, hashes content, validates MIME and size, and persists `storedFiles` metadata only after successful storage.
3. Add document extraction and provenance records before exposing uploaded content to the AI boundary.
4. Add capability-aware model discovery, provider health status, and structured provider failure telemetry.
5. Add research tools behind a named, permissioned tool registry with source citations and prompt-injection defenses.
6. Add realtime voice as a separate transport/session subsystem rather than coupling it to text chat.
