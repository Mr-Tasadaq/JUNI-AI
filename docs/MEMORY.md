# JUNI Memory, Knowledge Storage & Provenance — Step 2

## 1. Storage model

Juni has a configurable **10 GiB persistent memory/storage budget** by default:

`10 × 1024³ = 10,737,418,240 bytes`

This is a logical quota. It is not a promise about physical disk allocation and it is not a model-size or intelligence measurement.

The quota tracks logical application data in these categories:

- documents
- memory
- embeddings
- logs
- cache
- provenance
- other

Version history is counted because historical knowledge is part of persistent storage.

## 2. Data model

### Memory

`memory_records` is the current normalized memory state.

Fields include:

- id
- tenant_id / user_id
- memory_type
- content
- source_type / source_ref
- confidence
- importance
- trust_level
- status
- version
- embedding_ref
- provenance_ref
- retention_expires_at
- checksum
- deleted_at
- created_at / updated_at
- logical size

Supported memory states:

- transient
- candidate
- important
- permanent
- archived
- deleted

Important/permanent writes require explicit approval. Model-generated content defaults to generated/untrusted metadata and is not automatically promoted.

### Memory history

`memory_versions` is append-oriented history.

An update creates a new version instead of erasing the prior state.

Deletion creates a tombstone version. The record remains inspectable with `includeDeleted: true`, while normal retrieval excludes it.

### Knowledge

`knowledge_records` and `knowledge_versions` provide the same current-state + historical-version model for learned knowledge.

Important knowledge cannot be silently overwritten.

## 3. Short-term context

`conversation_context` stores short-lived conversational state separately from long-term memory.

This is designed for recent-context retrieval and has expiration support.

The application does not automatically promote every conversation into permanent memory.

## 4. Documents

Step 2 stores document metadata and extracted text only when processing actually supplies extracted text.

Supported document type labels include:

- PDF
- TXT
- Markdown
- DOC
- DOCX
- web page
- image
- audio
- video
- other

Registering a document does **not** claim that Juni semantically understood it.

The `documents` table records file metadata, checksum, source URL, size, storage URI, and processing status.

`document_versions` stores versioned extracted text and extraction metadata.

Raw files can live in an object/file store in a later step; the database stores their references and logical accounting metadata.

## 5. Embeddings

The memory layer depends on the provider-neutral `VectorStore` interface:

- insert
- update
- delete
- search
- metadata filtering
- source filtering
- tenant/user isolation
- version filtering

`LibsqlVectorStore` is the Step 2 implementation.

It stores vectors as JSON plus provider/model metadata and calculates cosine similarity in application code.

This is intentionally an abstraction, not a permanent commitment to one vector database. A future vector backend can implement the same interface.

The local implementation scans only a bounded result set when a caller supplies filters and always applies tenant/user predicates at the database layer. For larger deployments, a native vector index should replace the application-side scan without changing the retrieval interface.

## 6. Source provenance

External-source metadata can preserve:

- URL
- title
- retrieval timestamp
- source checksum
- provider
- tool
- related object IDs

The actual source content is not copied into the cryptographic ledger.

`sources` stores normal source metadata; `provenance_records` stores provenance references.

URLs are validated as HTTP/HTTPS.

## 7. Learning pipeline

Step 2 exposes:

`normalize → classify → validate → provenance → approval → memory/knowledge write → optional embedding → audit`

The implementation is intentionally controlled.

A missing approval does not block useful candidate records; it keeps them in candidate state. Retrieval defaults exclude candidates from semantic long-term memory.

No autonomous Internet access or unrestricted self-learning is implemented.

## 8. Storage quota

`StorageQuotaManager` answers:

- quota bytes
- used bytes
- remaining bytes
- usage percentage
- per-category usage
- warning thresholds
- remaining writable logical bytes
- hard-limit enforcement state

Quota checks are transaction-aware for the core write services.

A larger current record that is replaced by a smaller record can free logical bytes because the delta is evaluated from current usage.

## 9. Retention

Retention policies are configurable per data class.

Defaults:

| Data | Days |
| --- | ---: |
| transient context | 1 |
| logs | 30 |
| cache | 7 |
| media metadata | 365 |
| conversation history | 90 |
| memory | 0 = no configured expiry |
| research artifacts | 30 |

Retention does not silently erase important user memory.

The retention service first creates an expiration plan. Actual purge requires explicit confirmation, and important/permanent memories are excluded from normal expiration candidates.

## 10. Tamper-evident provenance ledger

`TamperEvidentLedger` is an append-oriented, cryptographically chained audit/provenance layer.

Each record contains:

- event ID
- tenant/user scope
- sequence
- event type
- timestamp
- actor
- object ID
- object version
- canonical payload
- payload hash
- previous event hash
- current event hash
- source hash
- provider
- model
- logical size

The first event uses:

`GENESIS`

as its previous-hash marker.

For later records:

`previous_hash = prior.current_hash`

The current hash is SHA-256 over a canonical representation of the event metadata and payload hash.

This makes history tamper-evident and allows chain verification.

### Verification

`ledger.verify(scope)` recomputes:

- sequence continuity
- previous-hash links
- payload hashes
- current hashes
- presence of previous hashes

It returns `valid: false` plus issue types for detected corruption.

The ledger is **not** described as mathematically immutable. It has no distributed consensus and no external anchoring in Step 2.

An actor capable of rewriting the entire database could rewrite the chain as well. A later step can add external anchoring or another independent trust mechanism.

## 11. Provenance event types

The ledger supports:

- memory_created
- memory_updated
- memory_deleted
- knowledge_created
- knowledge_updated
- document_ingested
- document_changed
- source_registered
- research_completed
- learning_event
- embedding_created
- embedding_updated
- model_used
- provider_used
- user_correction
- audit_event

## 12. Audit inspection API

`MemoryInspectionService` exposes scoped application services for:

- inspect memory
- inspect memory versions
- inspect knowledge
- inspect knowledge versions
- inspect provenance
- inspect storage usage
- inspect audit records
- inspect learning events
- verify provenance chain

Every operation requires tenant + user scope.

No memory export endpoint was added to the HTTP surface because Step 1 does not yet provide a real end-user identity/session system. Exposing arbitrary tenant/user headers would create an insecure impersonation path.

Step 3 can add those HTTP endpoints after authenticated identity is available.

## 13. Provider independence

Memory services import no Anthropic, OpenAI, or Gemini SDKs.

Providers can all call the same internal memory/knowledge/vector services.

Provider/model information is stored as metadata, not as the memory schema itself.

## 14. Database architecture

Step 2 uses `@libsql/client`.

Local development:

`JUNI_DATABASE_URL=file:juni.db`

Vercel fallback:

`file:/tmp/juni.db`

The Vercel fallback is only for runtime compatibility; it is not durable across instances.

For persistent production memory, configure `JUNI_DATABASE_URL` to a hosted LibSQL/Turso-compatible database and provide `JUNI_DATABASE_AUTH_TOKEN`.

The schema is kept in `storage/schema.sql` so database structure is inspectable and migration-ready.

## 15. Security model

Every persistent service takes:

`{ tenantId, userId }`

and applies both values to every read/write predicate.

Missing scope is rejected.

Model output is not trusted as permanent knowledge automatically.

Candidate records exist so potentially useful but unapproved information can be reviewed later.

Important/permanent promotion requires approval.

Secrets are not accepted as provenance content by design, and existing Step 1 event sanitization remains in place for operational events.

## 16. Future learning and research

Future Steps can attach to these interfaces:

- web/research tools write `research_results` + `sources` + provenance
- document processing writes document versions
- embedding providers populate `VectorStore`
- memory retrieval feeds relevant items into Juni Core
- identity/session services can expose scoped HTTP memory APIs
- an external anchor can periodically commit a ledger checkpoint hash
