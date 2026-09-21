import { randomUUID } from "node:crypto";
import { assertScope } from "../memory/model.js";
import { byteSize, hashObject, hashString, toJson, fromJson } from "../storage/serialization.js";
import { assertResearchMode, assertCandidateStatus } from "./model.js";

export class ResearchStorage {
  #client; #quota; #ledger; #provenance;

  constructor({ client, quota, ledger, provenance }) {
    this.#client = client; this.#quota = quota; this.#ledger = ledger; this.#provenance = provenance;
  }

  async startSession(scope, request) {
    assertScope(scope); assertResearchMode(request.mode);
    const id = request.sessionId ?? randomUUID();
    const now = new Date().toISOString();
    const sizeBytes = byteSize({ id, scope, request, now });
    const tx = await this.#client.transaction("write");
    try {
      await this.#quota.assertWithinQuota(scope, sizeBytes, { category: "other", executor: tx });
      await tx.execute({
        sql: "INSERT INTO research_sessions (id,tenant_id,user_id,query,mode,requested_freshness,output_format,citation_required,allow_knowledge_candidate,status,started_at,completed_at,selected_provider,selected_model,answer,result_json,warnings_json,errors_json,tools_json,providers_json,models_json,retention_expires_at,created_at,updated_at,size_bytes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        args: [id,scope.tenantId,scope.userId,request.query,request.mode,request.requestedFreshness,request.outputFormat,request.citationRequired?1:0,request.allowKnowledgeCandidate?1:0,"started",now,null,null,null,null,toJson({}),toJson([]),toJson([]),toJson([]),toJson([]),toJson([]),request.retentionExpiresAt??null,now,now,sizeBytes],
      });
      await this.#ledger.appendInTransaction(tx, scope, {
        eventType: "research_started", actorType: request.actorType ?? "user", actorId: request.actorId ?? null,
        objectId: id, objectVersion: 1,
        payload: { query: request.query, mode: request.mode, requestedFreshness: request.requestedFreshness },
      });
      await tx.commit(); return this.getSession(scope,id);
    } catch (error) { await tx.rollback(); throw error; }
  }

  async updateSession(scope,id,changes={}) {
    assertScope(scope);
    const current=await this.getSession(scope,id);
    if(!current){const e=new Error("Research session not found.");e.code="RESEARCH_SESSION_NOT_FOUND";throw e;}
    const record={
      status:changes.status??current.status, completedAt:changes.completedAt??current.completed_at,
      selectedProvider:changes.selectedProvider??current.selected_provider, selectedModel:changes.selectedModel??current.selected_model,
      answer:changes.answer??current.answer, result:changes.result??fromJson(current.result_json,{}),
      warnings:changes.warnings??fromJson(current.warnings_json,[]), errors:changes.errors??fromJson(current.errors_json,[]),
      tools:changes.tools??fromJson(current.tools_json,[]), providers:changes.providers??fromJson(current.providers_json,[]),
      models:changes.models??fromJson(current.models_json,[]), retentionExpiresAt:changes.retentionExpiresAt??current.retention_expires_at,
    };
    const now=new Date().toISOString();
    const nextSize=byteSize(record);
    const delta=nextSize-Number(current.size_bytes);
    await this.#quota.assertWithinQuota(scope,delta,{category:"other"});
    await this.#client.execute({
      sql:"UPDATE research_sessions SET status=?,completed_at=?,selected_provider=?,selected_model=?,answer=?,result_json=?,warnings_json=?,errors_json=?,tools_json=?,providers_json=?,models_json=?,retention_expires_at=?,updated_at=?,size_bytes=? WHERE tenant_id=? AND user_id=? AND id=?",
      args:[record.status,record.completedAt,record.selectedProvider,record.selectedModel,record.answer,toJson(record.result),toJson(record.warnings),toJson(record.errors),toJson(record.tools),toJson(record.providers),toJson(record.models),record.retentionExpiresAt,now,nextSize,scope.tenantId,scope.userId,id],
    });
    return this.getSession(scope,id);
  }

  async getSession(scope,id){assertScope(scope);const r=await this.#client.execute({sql:"SELECT * FROM research_sessions WHERE tenant_id=? AND user_id=? AND id=?",args:[scope.tenantId,scope.userId,id]});return r.rows[0]?parseSession(r.rows[0]):null;}
  async listSessions(scope,{limit=50,status=null}={}){assertScope(scope);const safe=Math.max(1,Math.min(100,Number(limit)||50));const args=[scope.tenantId,scope.userId];let sql="SELECT * FROM research_sessions WHERE tenant_id=? AND user_id=?";if(status){sql+=" AND status=?";args.push(status);}sql+=" ORDER BY created_at DESC LIMIT ?";args.push(safe);const r=await this.#client.execute({sql,args});return r.rows.map(parseSession);}

  async addOperation(scope,input){
    assertScope(scope);const id=input.id??randomUUID();const startedAt=input.startedAt??new Date().toISOString();const completedAt=input.completedAt??null;
    const usage=input.usage??{};const metadata=input.metadata??{};const sizeBytes=byteSize({id,...input,usage,metadata,startedAt,completedAt});
    await this.#quota.assertWithinQuota(scope,sizeBytes,{category:"other"});
    await this.#client.execute({sql:"INSERT INTO research_operations (id,tenant_id,user_id,session_id,operation_type,status,query,url,provider,model,tool,started_at,completed_at,attempts,cache_hit,error_code,usage_json,metadata_json,size_bytes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      args:[id,scope.tenantId,scope.userId,input.sessionId,input.operationType,input.status??"completed",input.query??null,input.url??null,input.provider??null,input.model??null,input.tool??null,startedAt,completedAt,input.attempts??1,input.cacheHit?1:0,input.errorCode??null,toJson(usage),toJson(metadata),sizeBytes]});
    return this.getOperation(scope,id);
  }

  async getOperation(scope,id){assertScope(scope);const r=await this.#client.execute({sql:"SELECT * FROM research_operations WHERE tenant_id=? AND user_id=? AND id=?",args:[scope.tenantId,scope.userId,id]});const row=r.rows[0];return row?{...row,usage:fromJson(row.usage_json),metadata:fromJson(row.metadata_json)}:null;}
  async listOperations(scope,sessionId,{limit=100}={}){assertScope(scope);const safe=Math.max(1,Math.min(200,Number(limit)||100));const r=await this.#client.execute({sql:"SELECT * FROM research_operations WHERE tenant_id=? AND user_id=? AND session_id=? ORDER BY started_at ASC LIMIT ?",args:[scope.tenantId,scope.userId,sessionId,safe]});return r.rows.map(row=>({...row,usage:fromJson(row.usage_json),metadata:fromJson(row.metadata_json)}));}

  async addSource(scope,sessionId,source,context={}){
    assertScope(scope);
    const duplicate=await this.findDuplicateSource(scope,sessionId,source); if(duplicate)return {...duplicate,duplicate:true};
    const now=source.retrievedAt??new Date().toISOString();const sourceId=source.id??randomUUID();
    const metadata={...(source.metadata??{}),qualityBasis:{
      sourceType:source.sourceType??"external",
      primarySourceCandidate:source.primarySourceCandidate===true,
      freshness:source.publicationDate?"publication_date_available":"publication_date_unknown",
      directness:source.content?"retrieved_content":"search_result_metadata_only",
      retrievalSuccess:source.status==="retrieved"||source.status==="partial",
      citationAvailability:Boolean(context.nativeCitationCount),
    }};
    const content=String(source.content??"");
    const sizeBytes=byteSize({sourceId,sessionId,source:{...source,content},metadata,createdAt:now});
    const tx=await this.#client.transaction("write");
    try{
      await this.#quota.assertWithinQuota(scope,sizeBytes,{category:"other",executor:tx});
      let provenance=null;
      if(source.url){
        const registered=await this.#provenance.registerSource(scope,{subjectId:sourceId,sourceType:"external",url:source.url,title:source.title??null,retrievedAt:now,checksum:source.contentHash??null,provider:context.provider??source.provider??null,tool:context.tool??source.tool??null,relatedIds:[sessionId],metadata});
        provenance=registered.provenance;
      }
      await tx.execute({sql:"INSERT INTO research_sources (id,tenant_id,user_id,session_id,url,canonical_url,title,domain,publisher,author,publication_date,retrieved_at,content_type,language,status,source_type,primary_source_candidate,relevance_score,corroboration_count,content_hash,metadata_hash,provider,tool,content,content_size_bytes,metadata_json,duplicate_of_source_id,size_bytes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        args:[sourceId,scope.tenantId,scope.userId,sessionId,source.url,source.canonicalUrl,source.title??null,source.domain??null,source.publisher??null,source.author??null,source.publicationDate??null,now,source.contentType??null,source.language??null,source.status??"retrieved","external",source.primarySourceCandidate?1:0,Number(source.relevanceScore??0),Number(source.corroborationCount??0),source.contentHash??null,source.metadataHash??null,context.provider??source.provider??null,context.tool??source.tool??null,content,Buffer.byteLength(content,"utf8"),toJson(metadata),null,sizeBytes]});
      await tx.commit();return {id:sourceId,...source,provenanceRef:provenance?.id??null,metadata,sizeBytes};
    }catch(error){await tx.rollback();throw error;}
  }

  async findDuplicateSource(scope,sessionId,source){
    assertScope(scope);const base=[scope.tenantId,scope.userId,sessionId];
    if(source.contentHash){const r=await this.#client.execute({sql:"SELECT * FROM research_sources WHERE tenant_id=? AND user_id=? AND session_id=? AND content_hash=? LIMIT 1",args:[...base,source.contentHash]});if(r.rows[0])return parseSource(r.rows[0]);}
    const r=await this.#client.execute({sql:"SELECT * FROM research_sources WHERE tenant_id=? AND user_id=? AND session_id=? AND canonical_url=? LIMIT 1",args:[...base,source.canonicalUrl]});return r.rows[0]?parseSource(r.rows[0]):null;
  }

  async getSource(scope,id){assertScope(scope);const r=await this.#client.execute({sql:"SELECT * FROM research_sources WHERE tenant_id=? AND user_id=? AND id=?",args:[scope.tenantId,scope.userId,id]});return r.rows[0]?parseSource(r.rows[0]):null;}
  async listSources(scope,sessionId,{limit=100}={}){assertScope(scope);const safe=Math.max(1,Math.min(200,Number(limit)||100));const r=await this.#client.execute({sql:"SELECT * FROM research_sources WHERE tenant_id=? AND user_id=? AND session_id=? ORDER BY relevance_score DESC,retrieved_at DESC LIMIT ?",args:[scope.tenantId,scope.userId,sessionId,safe]});return r.rows.map(parseSource);}

  async addEvidence(scope,input){
    assertScope(scope);const id=input.id??randomUUID();const createdAt=input.createdAt??new Date().toISOString();const contentHash=input.contentHash??hashString(input.excerpt);
    const sizeBytes=byteSize({id,...input,contentHash,createdAt});await this.#quota.assertWithinQuota(scope,sizeBytes,{category:"other"});
    await this.#client.execute({sql:"INSERT INTO research_evidence (id,tenant_id,user_id,session_id,source_id,evidence_type,excerpt,start_offset,end_offset,locator,extraction_basis,content_hash,created_at,size_bytes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      args:[id,scope.tenantId,scope.userId,input.sessionId,input.sourceId,input.evidenceType??"excerpt",input.excerpt,input.startOffset??null,input.endOffset??null,input.locator??null,input.extractionBasis??"deterministic_keyword_sentence_match",contentHash,createdAt,sizeBytes]});
    return this.getEvidence(scope,id);
  }

  async getEvidence(scope,id){assertScope(scope);const r=await this.#client.execute({sql:"SELECT * FROM research_evidence WHERE tenant_id=? AND user_id=? AND id=?",args:[scope.tenantId,scope.userId,id]});return r.rows[0]??null;}
  async listEvidence(scope,sessionId,{sourceId=null,limit=200}={}){assertScope(scope);const safe=Math.max(1,Math.min(500,Number(limit)||200));const args=[scope.tenantId,scope.userId,sessionId];let sql="SELECT * FROM research_evidence WHERE tenant_id=? AND user_id=? AND session_id=?";if(sourceId){sql+=" AND source_id=?";args.push(sourceId);}sql+=" ORDER BY created_at ASC LIMIT ?";args.push(safe);return (await this.#client.execute({sql,args})).rows;}

  async addClaim(scope,input){
    assertScope(scope);const id=input.id??randomUUID();const createdAt=new Date().toISOString();const sizeBytes=byteSize({id,...input,createdAt});await this.#quota.assertWithinQuota(scope,sizeBytes,{category:"other"});
    await this.#client.execute({sql:"INSERT INTO research_claims (id,tenant_id,user_id,session_id,claim_text,claim_type,status,confidence,rationale,created_at,size_bytes) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      args:[id,scope.tenantId,scope.userId,input.sessionId,input.claimText,input.claimType??"factual",input.status??"supported",input.confidence??null,input.rationale??null,createdAt,sizeBytes]});
    return this.getClaim(scope,id);
  }

  async getClaim(scope,id){assertScope(scope);const r=await this.#client.execute({sql:"SELECT * FROM research_claims WHERE tenant_id=? AND user_id=? AND id=?",args:[scope.tenantId,scope.userId,id]});return r.rows[0]??null;}
  async listClaims(scope,sessionId,{limit=100}={}){assertScope(scope);const safe=Math.max(1,Math.min(200,Number(limit)||100));const r=await this.#client.execute({sql:"SELECT * FROM research_claims WHERE tenant_id=? AND user_id=? AND session_id=? ORDER BY created_at ASC LIMIT ?",args:[scope.tenantId,scope.userId,sessionId,safe]});return r.rows.map(row=>({...row,confidence:row.confidence==null?null:Number(row.confidence)}));}

  async addCitation(scope,input){
    assertScope(scope);const id=input.id??randomUUID();const createdAt=new Date().toISOString();const sizeBytes=byteSize({id,...input,createdAt});await this.#quota.assertWithinQuota(scope,sizeBytes,{category:"other"});
    await this.#client.execute({sql:"INSERT INTO research_citations (id,tenant_id,user_id,session_id,claim_id,source_id,relation,evidence_ids_json,citation_type,cited_excerpt,start_index,end_index,provider,model,native_json,created_at,size_bytes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      args:[id,scope.tenantId,scope.userId,input.sessionId,input.claimId??null,input.sourceId,input.relation??"supports",toJson(input.evidenceIds??[]),input.citationType??"application",input.citedExcerpt??null,input.startIndex??null,input.endIndex??null,input.provider??null,input.model??null,toJson(input.native??{}),createdAt,sizeBytes]});
    return {id,...input,createdAt,sizeBytes};
  }

  async listCitations(scope,sessionId,{limit=200}={}){assertScope(scope);const safe=Math.max(1,Math.min(500,Number(limit)||200));const r=await this.#client.execute({sql:"SELECT * FROM research_citations WHERE tenant_id=? AND user_id=? AND session_id=? ORDER BY created_at ASC LIMIT ?",args:[scope.tenantId,scope.userId,sessionId,safe]});return r.rows.map(row=>({...row,evidenceIds:fromJson(row.evidence_ids_json,[]),native:fromJson(row.native_json,{})}));}

  async addCandidate(scope,input){
    assertScope(scope);const id=input.id??randomUUID();const now=new Date().toISOString();const proposed=input.proposedKnowledge??input.content??"";const sourceIds=[...new Set(input.sourceIds??[])];const evidenceIds=[...new Set(input.evidenceIds??[])];const candidateHash=input.candidateHash??hashObject({proposed,sourceIds,evidenceIds});
    assertCandidateStatus(input.status??"candidate");const sizeBytes=byteSize({id,...input,proposed,sourceIds,evidenceIds,candidateHash,now});
    const tx=await this.#client.transaction("write");
    try{
      await this.#quota.assertWithinQuota(scope,sizeBytes,{category:"other",executor:tx});
      const registered=await this.#provenance.createInTransaction(tx,scope,{subjectId:id,sourceType:"external",sourceUrl:null,sourceTitle:input.proposedTitle??"Research knowledge candidate",retrievalTimestamp:now,sourceHash:candidateHash,provider:input.provider??null,tool:input.tool??"research",relatedIds:sourceIds,metadata:{sessionId:input.sessionId,evidenceIds}});
      await tx.execute({sql:"INSERT INTO knowledge_candidates (id,tenant_id,user_id,session_id,proposed_title,proposed_knowledge_json,source_ids_json,evidence_ids_json,confidence,rationale,provenance_ref,status,candidate_hash,created_at,updated_at,size_bytes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        args:[id,scope.tenantId,scope.userId,input.sessionId,input.proposedTitle??null,toJson(proposed),toJson(sourceIds),toJson(evidenceIds),input.confidence??null,input.rationale??null,registered.id,input.status??"candidate",candidateHash,now,now,sizeBytes]});
      await this.#ledger.appendInTransaction(tx,scope,{eventType:"knowledge_created",actorType:input.actorType??"system",actorId:input.actorId??null,objectId:id,objectVersion:1,payload:{kind:"research_knowledge_candidate",sessionId:input.sessionId,sourceIds,evidenceIds,candidateHash},sourceHash:candidateHash,provider:input.provider??null,model:input.model??null});
      await tx.commit();return this.getCandidate(scope,id);
    }catch(error){await tx.rollback();throw error;}
  }

  async getCandidate(scope,id){assertScope(scope);const r=await this.#client.execute({sql:"SELECT * FROM knowledge_candidates WHERE tenant_id=? AND user_id=? AND id=?",args:[scope.tenantId,scope.userId,id]});return r.rows[0]?parseCandidate(r.rows[0]):null;}
  async listCandidates(scope,{sessionId=null,status=null,limit=100}={}){assertScope(scope);const safe=Math.max(1,Math.min(200,Number(limit)||100));const args=[scope.tenantId,scope.userId];let sql="SELECT * FROM knowledge_candidates WHERE tenant_id=? AND user_id=?";if(sessionId){sql+=" AND session_id=?";args.push(sessionId);}if(status){assertCandidateStatus(status);sql+=" AND status=?";args.push(status);}sql+=" ORDER BY updated_at DESC LIMIT ?";args.push(safe);return (await this.#client.execute({sql,args})).rows.map(parseCandidate);}

  async updateCandidate(scope,id,changes={}){
    assertScope(scope);const current=await this.getCandidate(scope,id);if(!current){const e=new Error("Knowledge candidate not found.");e.code="KNOWLEDGE_CANDIDATE_NOT_FOUND";throw e;}
    if(["approved","rejected","superseded"].includes(current.status)&&changes.status!==current.status){const e=new Error("Finalized knowledge candidate cannot change status.");e.code="KNOWLEDGE_CANDIDATE_FINALIZED";throw e;}
    const status=changes.status??current.status;assertCandidateStatus(status);const now=new Date().toISOString();
    const nextSize=byteSize({id,status,rationale:changes.rationale??current.rationale,confidence:changes.confidence??current.confidence,updatedAt:now});
    await this.#quota.assertWithinQuota(scope,nextSize-Number(current.size_bytes),{category:"other"});
    await this.#client.execute({sql:"UPDATE knowledge_candidates SET status=?,rationale=?,confidence=?,updated_at=?,size_bytes=? WHERE tenant_id=? AND user_id=? AND id=?",args:[status,changes.rationale??current.rationale,changes.confidence??current.confidence,now,nextSize,scope.tenantId,scope.userId,id]});
    return this.getCandidate(scope,id);
  }
}

function parseSession(row){return {...row,citationRequired:Boolean(Number(row.citation_required)),allowKnowledgeCandidate:Boolean(Number(row.allow_knowledge_candidate)),result:fromJson(row.result_json,{}),warnings:fromJson(row.warnings_json,[]),errors:fromJson(row.errors_json,[]),tools:fromJson(row.tools_json,[]),providers:fromJson(row.providers_json,[]),models:fromJson(row.models_json,[])};}
function parseSource(row){return {...row,primarySourceCandidate:Boolean(Number(row.primary_source_candidate)),relevanceScore:Number(row.relevance_score),corroborationCount:Number(row.corroboration_count),metadata:fromJson(row.metadata_json,{})};}
function parseCandidate(row){return {...row,proposedKnowledge:fromJson(row.proposed_knowledge_json,null),sourceIds:fromJson(row.source_ids_json,[]),evidenceIds:fromJson(row.evidence_ids_json,[]),confidence:row.confidence==null?null:Number(row.confidence)};}

export { hashString, hashObject };
