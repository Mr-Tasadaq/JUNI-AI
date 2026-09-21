PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  memory_type TEXT NOT NULL,
  content_json TEXT NOT NULL,
  content_text TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_ref TEXT,
  confidence REAL,
  importance REAL NOT NULL DEFAULT 0,
  trust_level TEXT NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL,
  embedding_ref TEXT,
  provenance_ref TEXT,
  retention_expires_at TEXT,
  checksum TEXT NOT NULL,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  size_bytes INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_scope_status
  ON memory_records (tenant_id, user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_type
  ON memory_records (tenant_id, user_id, memory_type, status);

CREATE TABLE IF NOT EXISTS memory_versions (
  memory_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  memory_type TEXT NOT NULL,
  content_json TEXT NOT NULL,
  content_text TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_ref TEXT,
  confidence REAL,
  importance REAL NOT NULL,
  trust_level TEXT NOT NULL,
  status TEXT NOT NULL,
  embedding_ref TEXT,
  provenance_ref TEXT,
  retention_expires_at TEXT,
  checksum TEXT NOT NULL,
  change_type TEXT NOT NULL,
  change_summary TEXT,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  created_at TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  PRIMARY KEY (memory_id, version)
);
CREATE INDEX IF NOT EXISTS idx_memory_versions_scope
  ON memory_versions (tenant_id, user_id, memory_id, version DESC);

CREATE TABLE IF NOT EXISTS conversation_context (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id TEXT,
  role TEXT NOT NULL,
  content_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  size_bytes INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_context_recent
  ON conversation_context (tenant_id, user_id, conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  knowledge_type TEXT NOT NULL,
  title TEXT,
  content_json TEXT NOT NULL,
  content_text TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_ref TEXT,
  confidence REAL,
  importance REAL NOT NULL DEFAULT 0,
  trust_level TEXT NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL,
  embedding_ref TEXT,
  provenance_ref TEXT,
  retention_expires_at TEXT,
  checksum TEXT NOT NULL,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  size_bytes INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_knowledge_scope_status
  ON knowledge_records (tenant_id, user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_type
  ON knowledge_records (tenant_id, user_id, knowledge_type, status);

CREATE TABLE IF NOT EXISTS knowledge_versions (
  knowledge_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  knowledge_type TEXT NOT NULL,
  title TEXT,
  content_json TEXT NOT NULL,
  content_text TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_ref TEXT,
  confidence REAL,
  importance REAL NOT NULL,
  trust_level TEXT NOT NULL,
  status TEXT NOT NULL,
  embedding_ref TEXT,
  provenance_ref TEXT,
  retention_expires_at TEXT,
  checksum TEXT NOT NULL,
  change_type TEXT NOT NULL,
  change_summary TEXT,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  created_at TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  PRIMARY KEY (knowledge_id, version)
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mime_type TEXT,
  document_type TEXT NOT NULL,
  source_url TEXT,
  title TEXT,
  size_bytes INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  storage_uri TEXT,
  current_version INTEGER NOT NULL DEFAULT 1,
  processing_status TEXT NOT NULL,
  retention_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_scope
  ON documents (tenant_id, user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS document_versions (
  document_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  extracted_text TEXT,
  extraction_method TEXT,
  extracted_at TEXT,
  source_url TEXT,
  checksum TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (document_id, version)
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  url TEXT,
  title TEXT,
  retrieved_at TEXT,
  checksum TEXT,
  provider TEXT,
  tool TEXT,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  size_bytes INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sources_scope
  ON sources (tenant_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS provenance_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_url TEXT,
  source_title TEXT,
  retrieval_timestamp TEXT,
  source_hash TEXT,
  provider TEXT,
  tool TEXT,
  related_ids_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  size_bytes INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_provenance_subject
  ON provenance_records (tenant_id, user_id, subject_id, created_at DESC);

CREATE TABLE IF NOT EXISTS embeddings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  vector_json TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_ref TEXT,
  metadata_json TEXT NOT NULL,
  checksum TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  size_bytes INTEGER NOT NULL,
  UNIQUE (tenant_id, user_id, object_type, object_id, version, provider, model)
);
CREATE INDEX IF NOT EXISTS idx_embeddings_scope
  ON embeddings (tenant_id, user_id, object_type, object_id, version);

CREATE TABLE IF NOT EXISTS research_results (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  query TEXT NOT NULL,
  title TEXT,
  url TEXT,
  retrieved_at TEXT NOT NULL,
  content TEXT NOT NULL,
  source_hash TEXT,
  provider TEXT,
  tool TEXT,
  metadata_json TEXT NOT NULL,
  retention_expires_at TEXT,
  created_at TEXT NOT NULL,
  size_bytes INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cache_entries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  source_ref TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  UNIQUE (tenant_id, user_id, cache_key)
);

CREATE TABLE IF NOT EXISTS media_metadata (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  media_type TEXT NOT NULL,
  storage_uri TEXT,
  metadata_json TEXT NOT NULL,
  checksum TEXT,
  retention_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  size_bytes INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS learning_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  object_id TEXT,
  object_type TEXT,
  stage TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  approved INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  size_bytes INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS model_provider_metadata (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  size_bytes INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_model_metadata_scope
  ON model_provider_metadata (tenant_id, user_id, provider, model);

CREATE TABLE IF NOT EXISTS audit_records (
  event_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  object_id TEXT,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL,
  size_bytes INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_scope
  ON audit_records (tenant_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ledger_events (
  event_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  object_id TEXT,
  object_version INTEGER,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  previous_hash TEXT NOT NULL,
  current_hash TEXT NOT NULL,
  source_hash TEXT,
  provider TEXT,
  model TEXT,
  size_bytes INTEGER NOT NULL,
  UNIQUE (tenant_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_ledger_scope_sequence
  ON ledger_events (tenant_id, sequence);


CREATE TABLE IF NOT EXISTS saved_answers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  question_text TEXT NOT NULL,
  normalized_question TEXT NOT NULL,
  answer_text TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_ref TEXT,
  provider TEXT,
  model TEXT,
  status TEXT NOT NULL,
  needs_review INTEGER NOT NULL DEFAULT 1,
  confidence REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  ttl_seconds INTEGER NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  approved_by TEXT,
  approved_at TEXT,
  checksum TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  size_bytes INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saved_answers_scope_question
  ON saved_answers (tenant_id, user_id, normalized_question, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_answers_expiry
  ON saved_answers (tenant_id, user_id, expires_at);

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_reset ON rate_limit_buckets (reset_at);

CREATE TABLE IF NOT EXISTS research_sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  query TEXT NOT NULL,
  mode TEXT NOT NULL,
  requested_freshness TEXT NOT NULL,
  output_format TEXT NOT NULL,
  citation_required INTEGER NOT NULL,
  allow_knowledge_candidate INTEGER NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  selected_provider TEXT,
  selected_model TEXT,
  answer TEXT,
  result_json TEXT NOT NULL,
  warnings_json TEXT NOT NULL,
  errors_json TEXT NOT NULL,
  tools_json TEXT NOT NULL,
  providers_json TEXT NOT NULL,
  models_json TEXT NOT NULL,
  retention_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  size_bytes INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_sessions_scope ON research_sessions (tenant_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_sessions_status ON research_sessions (tenant_id, user_id, status);

CREATE TABLE IF NOT EXISTS research_operations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  status TEXT NOT NULL,
  query TEXT,
  url TEXT,
  provider TEXT,
  model TEXT,
  tool TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 1,
  cache_hit INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  usage_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  size_bytes INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_ops_session ON research_operations (tenant_id, user_id, session_id, started_at DESC);

CREATE TABLE IF NOT EXISTS research_sources (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  title TEXT,
  domain TEXT,
  publisher TEXT,
  author TEXT,
  publication_date TEXT,
  retrieved_at TEXT NOT NULL,
  content_type TEXT,
  language TEXT,
  status TEXT NOT NULL,
  source_type TEXT NOT NULL,
  primary_source_candidate INTEGER NOT NULL DEFAULT 0,
  relevance_score REAL NOT NULL DEFAULT 0,
  corroboration_count INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT,
  metadata_hash TEXT,
  provider TEXT,
  tool TEXT,
  content TEXT,
  content_size_bytes INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL,
  duplicate_of_source_id TEXT,
  size_bytes INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_sources_session ON research_sources (tenant_id, user_id, session_id);
CREATE INDEX IF NOT EXISTS idx_research_sources_canonical ON research_sources (tenant_id, user_id, canonical_url);
CREATE INDEX IF NOT EXISTS idx_research_sources_hash ON research_sources (tenant_id, user_id, content_hash);

CREATE TABLE IF NOT EXISTS research_evidence (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  start_offset INTEGER,
  end_offset INTEGER,
  locator TEXT,
  extraction_basis TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  size_bytes INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_evidence_source ON research_evidence (tenant_id, user_id, source_id);
CREATE INDEX IF NOT EXISTS idx_research_evidence_session ON research_evidence (tenant_id, user_id, session_id);

CREATE TABLE IF NOT EXISTS research_claims (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  claim_text TEXT NOT NULL,
  claim_type TEXT NOT NULL,
  status TEXT NOT NULL,
  confidence REAL,
  rationale TEXT,
  created_at TEXT NOT NULL,
  size_bytes INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_claims_session ON research_claims (tenant_id, user_id, session_id);

CREATE TABLE IF NOT EXISTS research_citations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  claim_id TEXT,
  source_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  evidence_ids_json TEXT NOT NULL,
  citation_type TEXT NOT NULL,
  cited_excerpt TEXT,
  start_index INTEGER,
  end_index INTEGER,
  provider TEXT,
  model TEXT,
  native_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  size_bytes INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_citations_session ON research_citations (tenant_id, user_id, session_id);
CREATE INDEX IF NOT EXISTS idx_research_citations_claim ON research_citations (tenant_id, user_id, claim_id);

CREATE TABLE IF NOT EXISTS knowledge_candidates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  proposed_title TEXT,
  proposed_knowledge_json TEXT NOT NULL,
  source_ids_json TEXT NOT NULL,
  evidence_ids_json TEXT NOT NULL,
  confidence REAL,
  rationale TEXT,
  provenance_ref TEXT,
  status TEXT NOT NULL,
  candidate_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  size_bytes INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_knowledge_candidates_scope ON knowledge_candidates (tenant_id, user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_candidates_session ON knowledge_candidates (tenant_id, user_id, session_id);
