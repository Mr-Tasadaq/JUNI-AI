import { createJuniDatabase } from "../storage/database.js";
import { TamperEvidentLedger } from "../provenance/ledger.js";
import { ProvenanceService } from "../provenance/service.js";
import { createStorageQuotaManager } from "./storage-quota.js";
import { MemoryService } from "./memory-service.js";
import { KnowledgeService } from "./knowledge-service.js";
import { DocumentService } from "./document-service.js";
import { ConversationContextService } from "./context-service.js";
import { LibsqlVectorStore } from "./vector-store.js";
import { MemoryRetrievalService } from "./retrieval-service.js";
import { RetentionService } from "./retention.js";
import {
  ResearchService,
  CacheService,
  MediaMetadataService,
  ModelProviderMetadataService,
} from "./auxiliary-services.js";
import { LearningPipeline } from "./learning-pipeline.js";
import { MemoryInspectionService } from "./inspection-service.js";

export function createJuniMemoryApplication({ config, events, embedder = null, answerEmbedder = null } = {}) {
  const db = createJuniDatabase({
    url: config.storage.databaseUrl,
    authToken: config.storage.databaseAuthToken,
  });

  const quota = createStorageQuotaManager({
    client: db.client,
    quotaBytes: config.storage.quotaBytes,
    warningThresholds: config.storage.warningThresholds,
  });

  const ledger = new TamperEvidentLedger({
    client: db.client,
    quota,
  });

  const provenance = new ProvenanceService({
    client: db.client,
    ledger,
    quota,
  });

  const memory = new MemoryService({
    client: db.client,
    quota,
    ledger,
    provenance,
    events,
  });

  const knowledge = new KnowledgeService({
    client: db.client,
    quota,
    ledger,
    provenance,
    events,
    vectors: null,
    answerEmbedder,
  });

  const documents = new DocumentService({
    client: db.client,
    quota,
    ledger,
    provenance,
  });

  const context = new ConversationContextService({
    client: db.client,
    quota,
    ledger,
  });

  const vectors = new LibsqlVectorStore({
    client: db.client,
    quota,
    ledger,
  });

  knowledge.setAnswerInfrastructure({ vectors, answerEmbedder });

  const retrieval = new MemoryRetrievalService({
    memory,
    knowledge,
    vectors,
    context,
    provenance,
  });

  const retention = new RetentionService({
    client: db.client,
    policies: {
      transient_context: config.retention.transientContextDays,
      logs: config.retention.logsDays,
      cache: config.retention.cacheDays,
      media_metadata: config.retention.mediaDays,
      conversation_history: config.retention.conversationDays,
      memory: config.retention.memoryDays,
      research_artifacts: config.retention.researchDays,
    },
  });

  const research = new ResearchService({
    client: db.client,
    quota,
    ledger,
  });

  const cache = new CacheService({
    client: db.client,
    quota,
  });

  const media = new MediaMetadataService({
    client: db.client,
    quota,
  });

  const modelMetadata = new ModelProviderMetadataService({
    client: db.client,
    quota,
    ledger,
  });

  const learning = new LearningPipeline({
    client: db.client,
    quota,
    ledger,
    provenance,
    memory,
    knowledge,
    embedder,
    events,
  });

  const inspection = new MemoryInspectionService({
    client: db.client,
    memory,
    knowledge,
    provenance,
    ledger,
    quota,
  });

  return Object.freeze({
    db,
    ready: db.ready,
    quota,
    ledger,
    provenance,
    memory,
    knowledge,
    documents,
    context,
    vectors,
    retrieval,
    retention,
    research,
    cache,
    media,
    modelMetadata,
    learning,
    inspection,
  });
}
