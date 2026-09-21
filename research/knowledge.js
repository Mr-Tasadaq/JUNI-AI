import { assertScope } from "../memory/model.js";
import { assertCandidateStatus } from "./model.js";

export class ResearchKnowledgeService {
  #storage; #knowledge; #vectors; #ledger; #embedder;
  constructor({storage,knowledge,vectors,ledger,embedder=null}) {
    this.#storage=storage;this.#knowledge=knowledge;this.#vectors=vectors;this.#ledger=ledger;this.#embedder=embedder;
  }
  async createCandidate(scope,input){assertScope(scope);return this.#storage.addCandidate(scope,input);}
  async getCandidate(scope,id){assertScope(scope);return this.#storage.getCandidate(scope,id);}
  async listCandidates(scope,opts={}){assertScope(scope);return this.#storage.listCandidates(scope,opts);}
  async reject(scope,id,{actorId=null,rationale=null}={}) {
    const candidate=await this.getCandidate(scope,id); if(!candidate) throw codeError("KNOWLEDGE_CANDIDATE_NOT_FOUND","Knowledge candidate not found.");
    assertCandidateStatus(candidate.status);
    if(candidate.status!=="candidate") return candidate;
    const updated=await this.#storage.updateCandidate(scope,id,{status:"rejected",rationale:rationale??candidate.rationale});
    await this.#ledger.append(scope,{eventType:"knowledge_updated",actorType:"user",actorId,objectId:id,objectVersion:1,payload:{candidateStatus:"rejected"}});
    return updated;
  }
  async approve(scope,id,{approvedBy,actorId=approvedBy,embedding=null}={}) {
    if(!approvedBy) throw codeError("KNOWLEDGE_APPROVAL_REQUIRED","Explicit approval identity is required.");
    const candidate=await this.getCandidate(scope,id); if(!candidate) throw codeError("KNOWLEDGE_CANDIDATE_NOT_FOUND","Knowledge candidate not found.");
    if(candidate.status!=="candidate") return candidate;
    const text=typeof candidate.proposedKnowledge==="string"?candidate.proposedKnowledge:JSON.stringify(candidate.proposedKnowledge);
    const knowledge=await this.#knowledge.create(scope,{
      knowledgeType:"learned_knowledge",
      title:candidate.proposed_title??"Research knowledge",
      content:candidate.proposedKnowledge,
      contentText:text,
      sourceType:"external",
      sourceRef:candidate.sourceIds[0]??null,
      confidence:candidate.confidence,
      importance:0.8,
      trustLevel:"reviewed",
      status:"important",
      approvedBy,
      actorType:"user",
      actorId,
      provenanceRef:candidate.provenance_ref,
    });
    let vectorResult=null;
    if(embedding || this.#embedder){
      const generated=embedding??await this.#embedder(knowledge);
      if(generated?.vector?.length){
        vectorResult=await this.#vectors.insert(scope,{
          objectType:"knowledge",objectId:knowledge.id,version:knowledge.version,
          vector:generated.vector,provider:generated.provider,model:generated.model??"research-embedding",
          sourceType:"external",sourceRef:candidate.sourceIds[0]??null,
          metadata:{researchSessionId:candidate.session_id,candidateId:id},
        });
      }
    }
    const updated=await this.#storage.updateCandidate(scope,id,{status:"approved",rationale:(candidate.rationale??"")+" Approved as persistent knowledge."});
    await this.#ledger.append(scope,{
      eventType:"knowledge_updated",actorType:"user",actorId,objectId:knowledge.id,objectVersion:knowledge.version,
      payload:{candidateId:id,status:"approved",sourceIds:candidate.sourceIds,evidenceIds:candidate.evidenceIds,knowledgeId:knowledge.id,embeddingId:vectorResult?.id??null},
    });
    return {candidate:updated,knowledge,embedding:vectorResult};
  }
}
function codeError(code,message){const e=new Error(message);e.code=code;return e;}
