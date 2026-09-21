import { SafeWebRetriever } from "./url-fetcher.js";
import { ResearchStorage } from "./storage.js";
import { ResearchOrchestrator } from "./orchestrator.js";
import { ResearchKnowledgeService } from "./knowledge.js";
import { ResearchCache } from "./cache.js";
import { assertScope } from "../memory/model.js";

export function createSafeResearchApplication({config,events,router,memory,fetchImpl=globalThis.fetch,lookup,embedder=null}={}) {
  if(!config||!router||!memory) throw new TypeError("config, router, and memory are required.");
  const retriever=new SafeWebRetriever({config,fetchImpl,lookup});
  const storage=new ResearchStorage({client:memory.db.client,quota:memory.quota,ledger:memory.ledger,provenance:memory.provenance});
  const cache=new ResearchCache({cacheService:memory.cache,ttlSeconds:config.research.cacheTtlSeconds});
  const knowledge=new ResearchKnowledgeService({storage,knowledge:memory.knowledge,vectors:memory.vectors,ledger:memory.ledger,embedder});
  const orchestrator=new ResearchOrchestrator({config,events,router,storage,cache,retriever,knowledge});
  return Object.freeze({
    ready:memory.ready,
    storage,cache,retriever,knowledge,orchestrator,
    run:(scope,input)=>orchestrator.run(scope,input),
    retrieve:(scope,url,opts)=>orchestrator.retrieveUrl(scope,url,opts),
    start:async(scope,input)=>{
      assertScope(scope);
      const request=(await import("./model.js")).normalizeResearchRequest(input);
      return storage.startSession(scope,{...request,retentionExpiresAt:new Date(Date.now()+config.retention.researchDays*86_400_000).toISOString()});
    },
    inspect:(scope,id)=>storage.getSession(scope,id),
    sessions:(scope,opts)=>storage.listSessions(scope,opts),
    sources:(scope,sessionId,opts)=>storage.listSources(scope,sessionId,opts),
    evidence:(scope,sessionId,opts)=>storage.listEvidence(scope,sessionId,opts),
    citations:(scope,sessionId,opts)=>storage.listCitations(scope,sessionId,opts),
    claims:(scope,sessionId,opts)=>storage.listClaims(scope,sessionId,opts),
    operations:(scope,sessionId,opts)=>storage.listOperations(scope,sessionId,opts),
    candidates:(scope,opts)=>knowledge.listCandidates(scope,opts),
    candidate:async(scope,id)=>knowledge.getCandidate(scope,id),
    createCandidate:(scope,input)=>knowledge.createCandidate(scope,input),
    approveCandidate:(scope,id,opts)=>knowledge.approve(scope,id,opts),
    rejectCandidate:(scope,id,opts)=>knowledge.reject(scope,id,opts),
    verifyProvenance:(scope)=>memory.inspection.verifyProvenance(scope),
    events:async(scope,{sessionId=null,limit=200}={})=>{
      assertScope(scope);const args=[scope.tenantId,scope.userId];let sql="SELECT * FROM ledger_events WHERE tenant_id=? AND user_id=?";if(sessionId){sql+=" AND object_id=?";args.push(sessionId);}sql+=" ORDER BY sequence DESC LIMIT ?";args.push(Math.max(1,Math.min(500,Number(limit)||200)));return (await memory.db.client.execute({sql,args})).rows;
    },
  });
}
