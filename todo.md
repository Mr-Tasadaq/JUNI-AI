# Project TODO

- [x] Create a responsive authenticated JUNI workspace shell with accessible conversation navigation and composer.
- [x] Add clear loading, empty, error, and capability-status communication to the workspace.
- [x] Add user-scoped conversation and message tables with indexes and ownership boundaries.
- [x] Add typed tRPC procedures for listing, creating, and sending messages within owned conversations.
- [x] Add a server-side provider-neutral orchestration boundary separating system instructions, user input, and untrusted retrieved content.
- [x] Add server-mediated conversational AI responses without exposing provider credentials to the browser.
- [x] Add secure object-storage upload foundations and separate persisted file metadata with user ownership.
- [x] Add unit and integration tests for ownership, orchestration boundaries, provider mediation, and failure states.
- [x] Apply and verify the database migration using the project schema workflow.
- [x] Run formatting, type checking, tests, build, and responsive/browser verification.
- [x] Write a living architecture and status record covering implementation status, validation results, risks, and next milestones.
- [x] Add explicit retryable UI states for conversation-list, message-list, and conversation-creation failures.
- [x] Implement a protected server upload procedure that generates storage keys, validates content, calls storagePut, and persists metadata only after successful upload.
- [x] Add tests covering upload authorization and conversation/message query failure handling.
- [x] Add an explicit conversation-creation error state with a clear retry action near the creation controls.
- [x] Add a test covering conversation-creation failure UI behavior and retry flow.
- [x] Add a component-level Home test that simulates conversation creation failure and verifies the Retry create interaction.
- [x] Upload the current JUNI workspace checkpoint to https://github.com/Mr-Tasadaq/JUNI-AI without committing secrets or overwriting unrelated content.
