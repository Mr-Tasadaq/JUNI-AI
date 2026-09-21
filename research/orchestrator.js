import { randomUUID } from "node:crypto";
import { assertScope } from "../memory/model.js";
import { normalizeResearchRequest, searchQueriesForRequest } from "./model.js";
import { SafeWebRetriever } from "./url-fetcher.js";
import { normalizeSearchSource, canonicalizeUrl, nearDuplicateSimilarity } from "./normalizer.js";
import { extractEvidence } from "./evidence.js";
import { rankSources, corroborationCounts } from "./ranking.js";
import { nativeCitationToModel } from "./citations.js";
import { synthesizeResearch } from "./synthesis.js";
import { ResearchCache } from "./cache.js";

export class ResearchOrchestrator {
  #config; #events; #router; #storage; #cache; #retriever; #knowledge;
  constructor({config,events,router,storage,cache,retriever,knowledge}) {
    this.#config=config;this.#events=events;this.#router=router;this.#storage=storage;this.#cache=cache;this.#retriever=retriever;this.#knowledge=knowledge;
  }

  async run(scope,input={}) {
    assertScope(scope);
    const request=normalizeResearchRequest({...input,userScope:scope});
    if(!this.#config.research.enabled) throw codeError("RESEARCH_DISABLED","Web research is disabled.");
    const session=await this.#storage.startSession(scope,{...request,sessionId:input.sessionId,retentionExpiresAt:new Date(Date.now()+this.#config.retention.researchDays*86_400_000).toISOString()});
    const started=Date.now();
    this.#events?.emit("research.started",{sessionId:session.id,mode:request.mode,query:request.query},{requestId:request.requestId});
    const warnings=[];const errors=[];const allSources=[];const native=[];const searchQueriesIssued=[];let totalRetrievedBytes=0;
    const seenUrls=new Map(); let searchCalls=0; let retrievalCount=0; let cacheHits=0;
    try {
      if(request.urls.length){
        if(request.mode==="URL_ANALYSIS"){
          try{
            const contextual=await this.#router.research({
              query:request.query||"Analyze the provided URLs.",
              urls:request.urls,
              requestId:request.requestId,
              provider:request.provider,
              model:request.model,
              signal:input.signal,
            },{operation:"url_context"});
            native.push(...(contextual?.nativeCitations??[]));
            await this.#storage.addOperation(scope,{sessionId:session.id,operationType:"url_context",status:"completed",url:request.urls.join(","),provider:contextual?.provider??null,model:contextual?.model??null,usage:contextual?.usage??{},metadata:{nativeCitationCount:contextual?.nativeCitations?.length??0}});
          }catch(error){
            warnings.push("Provider URL-context retrieval was unavailable; controlled direct retrieval was used.");
            await this.#storage.addOperation(scope,{sessionId:session.id,operationType:"url_context",status:"failed",url:request.urls.join(","),provider:request.provider??null,model:request.model??null,errorCode:error.code??"RESEARCH_CAPABILITY_UNAVAILABLE",metadata:{message:error.message}});
          }
        }
        const result=await this.#retrieveUserUrls(scope,session.id,request,seenUrls);
        allSources.push(...result.sources);retrievalCount+=result.retrievalCount;cacheHits+=result.cacheHits;
      }
      if(!request.urls.length || ["RESEARCH","DEEP_RESEARCH","SOURCE_COMPARISON","KNOWLEDGE_ACQUISITION"].includes(request.mode)){
        for(const query of searchQueriesForRequest(request)){
          try{
            const cacheKey=ResearchCache.key("search",{query,domains:request.domains,excluded:request.excludedDomains,mode:request.mode});
            const cached=await this.#cache.get(scope,cacheKey);
            let result;
            if(cached.hit){cacheHits+=1;result=cached.value;}
            else{
              result=await this.#router.research({query,requestId:request.requestId,model:request.model,provider:request.provider,allowedDomains:request.domains,blockedDomains:request.excludedDomains,maxSearchQueries:1,operation:"search",signal:input.signal},{operation:"search"});
              searchCalls+=1;
              await this.#cache.set(scope,cacheKey,result,{sourceRef:"search:"+query});
            }
            if(result?.searchQueries?.length) searchQueriesIssued.push(...result.searchQueries);
            await this.#storage.addOperation(scope,{sessionId:session.id,operationType:"search",query,status:"completed",provider:result?.provider??null,model:result?.model??null,cacheHit:cached.hit,usage:result?.usage??{},metadata:{searchQueries:result?.searchQueries??[]}});
            const nativeCitations=Array.isArray(result?.nativeCitations)?result.nativeCitations:[];native.push(...nativeCitations);
            const raws=Array.isArray(result?.sources)?result.sources:[];
            for(const raw of raws.slice(0,request.maxSources)){
              if(!raw?.url) continue;
              const source=normalizeSearchSource(raw,{provider:result.provider,tool:"web.search",sessionId:session.id});
              if(!source||seenUrls.has(source.canonicalUrl)) continue;
              try{
                const estimatedBytes=Buffer.byteLength(String(source.content??""),"utf8");
                if(totalRetrievedBytes+estimatedBytes>request.maxRetrievedBytes) break;
                const retrieved=await this.#retrieveSource(scope,session.id,request,source);
                if(!retrieved) continue;
                const near=allSources.find((candidate)=>nearDuplicateSimilarity(candidate.content,retrieved.content)>=0.9);
                if(near){seenUrls.set(retrieved.canonicalUrl,near.id);continue;}
                const fetchedBytes=Buffer.byteLength(String(retrieved.content??""),"utf8");
                if(totalRetrievedBytes+fetchedBytes>request.maxRetrievedBytes) break;
                allSources.push(retrieved);seenUrls.set(retrieved.canonicalUrl,retrieved.id);retrievalCount+=1;totalRetrievedBytes+=fetchedBytes;
              }catch(error){errors.push({operation:"retrieve",url:source.url,code:error.code??"RETRIEVAL_FAILED"});}
              if(allSources.length>=request.maxSources) break;
            }
          }catch(error){
            searchCalls+=1;
            errors.push({operation:"search",query,code:error.code??"RESEARCH_SEARCH_FAILED"});
          }
          if(allSources.length>=request.maxSources) break;
        }
      }
      let ranked=corroborationCounts(rankSources(allSources,request.query));
      for(const source of ranked){
        const updated=await this.#storage.addSource(scope,session.id,source,{provider:source.provider,tool:source.tool,nativeCitationCount:native.length});
        if(updated?.id && !allSources.find((x)=>x.id===updated.id)) allSources.push({...source,id:updated.id});
      }
      const storedSources=await this.#storage.listSources(scope,session.id,{limit:request.maxSources});
      const evidence=[];
      for(const source of storedSources){
        for(const item of extractEvidence(source,request.query,{maxExcerpts:6})){
          const stored=await this.#storage.addEvidence(scope,{...item,sessionId:session.id});
          evidence.push({...item,id:stored.id});
        }
      }
      const sourceLookup=(url)=>storedSources.find((s)=>s.url===url||s.canonical_url===url||s.canonicalUrl===url);
      const nativeModels=native.map((a)=>nativeCitationToModel(a,sourceLookup)).filter(Boolean);
      const synthesis=await synthesizeResearch({router:this.#router,request,sources:storedSources,evidence,nativeCitations:nativeModels});
      for(const claim of synthesis.claims){
        const storedClaim=await this.#storage.addClaim(scope,{sessionId:session.id,claimText:String(claim.text??""),claimType:claim.claimType??"factual",status:claim.status??"supported",confidence:claim.confidence??null,rationale:claim.rationale??null});
        claim.id=storedClaim.id;
        for(const citation of claim.citations??[]){
          await this.#storage.addCitation(scope,{sessionId:session.id,claimId:storedClaim.id,sourceId:citation.sourceId,relation:citation.relation,evidenceIds:citation.evidenceIds,citationType:citation.citationType,citedExcerpt:citation.citedExcerpt,native:citation.native??{} ,provider:synthesis.provider,model:synthesis.model});
        }
      }
      for(const citation of nativeModels) await this.#storage.addCitation(scope,{sessionId:session.id,...citation,provider:synthesis.provider,model:synthesis.model});
      const result={
        researchSessionId:session.id,question:request.query,mode:request.mode,answer:synthesis.answer,
sources:storedSources,claims:synthesis.claims,evidence,citations:await this.#storage.listCitations(scope,session.id),searchQueries:[...new Set(searchQueriesIssued)],
        provider:synthesis.provider,model:synthesis.model,timestamp:new Date().toISOString(),
        confidence:synthesis.confidence,verification:{sourceCount:storedSources.length,evidenceCount:evidence.length,nativeCitationCount:nativeModels.length},
        warnings:[...warnings,...synthesis.warnings],errors,
        usage:{provider:synthesis.provider,model:synthesis.model,searchCalls,urlRetrievalCount:retrievalCount,cacheHits,estimatedTokens:synthesis.usage?.totalTokens??null,latencyMs:Date.now()-started},
      };
      let candidate=null;
      if(request.allowKnowledgeCandidate && (request.mode==="KNOWLEDGE_ACQUISITION" || input.createKnowledgeCandidate===true)){
        candidate=await this.#knowledge.createCandidate(scope,{sessionId:session.id,proposedTitle:input.candidateTitle??"Research knowledge candidate",proposedKnowledge:{answer:synthesis.answer,claims:synthesis.claims,sourceIds:storedSources.map((x)=>x.id),evidenceIds:evidence.map((x)=>x.id)},sourceIds:storedSources.map((x)=>x.id),evidenceIds:evidence.map((x)=>x.id),confidence:synthesis.confidence,rationale:"Candidate derived from preserved research evidence.",provider:synthesis.provider,model:synthesis.model,tool:"research"});
        result.knowledgeCandidateId=candidate.id;
      }
      await this.#storage.appendEvent(scope,{eventType:"research_completed",actorType:"system",actorId:null,objectId:session.id,objectVersion:1,payload:{sourceCount:storedSources.length,searchCalls,urlRetrievalCount:retrievalCount,cacheHits,totalRetrievedBytes,provider:synthesis.provider,model:synthesis.model}});
      await this.#storage.updateSession(scope,session.id,{status:"completed",completedAt:new Date().toISOString(),selectedProvider:synthesis.provider,selectedModel:synthesis.model,answer:synthesis.answer,result,warnings:result.warnings,errors,tools:["web.search","url.retrieve"],providers:[...new Set([synthesis.provider,...storedSources.map((s)=>s.provider).filter(Boolean)])],models:[synthesis.model].filter(Boolean)});
      this.#events?.emit("research.completed",{sessionId:session.id,sourceCount:storedSources.length,cacheHits},{requestId:request.requestId,provider:synthesis.provider,model:synthesis.model});
      return result;
    } catch(error){
      errors.push({code:error.code??"RESEARCH_FAILED",message:error.message});
      await this.#storage.appendEvent(scope,{eventType:"research_failed",actorType:"system",actorId:null,objectId:session.id,objectVersion:1,payload:{code:error.code??"RESEARCH_FAILED"}});
      await this.#storage.updateSession(scope,session.id,{status:"failed",completedAt:new Date().toISOString(),errors});
      this.#events?.emit("research.failed",{sessionId:session.id,code:error.code??"RESEARCH_FAILED"},{requestId:request.requestId});
      throw error;
    }
  }

  async retrieveUrl(scope,url,options={}){assertScope(scope);return this.#retriever.retrieve(url,options);}

  async #retrieveUserUrls(scope,sessionId,request,seenUrls){
    const sources=[];let retrievalCount=0;let cacheHits=0;
    for(const url of request.urls.slice(0,request.maxSources)){
      try{
        const normalized=normalizeSearchSource({url},{sessionId});
        if(!normalized||seenUrls.has(normalized.canonicalUrl)) continue;
        const retrieved=await this.#retrieveSource(scope,sessionId,request,normalized);
        if(retrieved){sources.push(retrieved);seenUrls.set(retrieved.canonicalUrl,retrieved.id);retrievalCount+=1;}
      }catch(error){await this.#storage.addOperation(scope,{sessionId,operationType:"retrieve",status:"failed",url,attempts:1,errorCode:error.code??"RETRIEVAL_FAILED",metadata:{message:error.message}});}
    }
    return {sources,retrievalCount,cacheHits};
  }

  async #retrieveSource(scope,sessionId,request,source){
    const cacheKey=ResearchCache.key("url",source.canonicalUrl);
    const cached=await this.#cache.get(scope,cacheKey);
    if(cached.hit){
      const cachedSource=cached.value;
      const normalized=normalizeSearchSource(cachedSource,{provider:source.provider,tool:"web.retrieve",sessionId});
      const result=await this.#storage.addSource(scope,sessionId,{...normalized,content:cachedSource.content,contentHash:cachedSource.contentHash});
      return {...normalized,id:result.id,content:cachedSource.content,contentHash:cachedSource.contentHash};
    }
    const started=Date.now();
    try{
      const fetched=await this.#retriever.retrieve(source.url,{allowedDomains:request.domains,blockedDomains:request.excludedDomains,maxBytes:request.maxSourceBytes,maxRedirects:request.maxRedirects,signal:request.signal});
      const normalized=normalizeSearchSource({...source,...fetched,title:fetched.metadata.title??source.title,publisher:fetched.metadata.publisher??source.publisher,author:fetched.metadata.author??source.author,publicationDate:fetched.metadata.publicationDate??source.publicationDate,language:fetched.metadata.language??source.language,contentType:fetched.contentType,content:fetched.content,contentHash:fetched.contentHash,metadataHash:fetched.metadataHash},{provider:source.provider,tool:"web.retrieve",sessionId});
      await this.#storage.addOperation(scope,{sessionId,operationType:"retrieve",status:"completed",url:source.url,provider:source.provider,tool:"web.retrieve",startedAt:new Date(started).toISOString(),completedAt:new Date().toISOString(),usage:{bytes:fetched.rawBytes},metadata:{redirectChain:fetched.redirectChain,promptInjectionIndicators:fetched.metadata.promptInjectionIndicators}});
      await this.#cache.set(scope,cacheKey,{...normalized,content:fetched.content,contentHash:fetched.contentHash},{sourceRef:source.url});
      const result=await this.#storage.addSource(scope,sessionId,normalized,{provider:source.provider,tool:"web.retrieve"});
      return {...normalized,id:result.id};
    }catch(error){
      await this.#storage.addOperation(scope,{sessionId,operationType:"retrieve",status:"failed",url:source.url,provider:source.provider,tool:"web.retrieve",startedAt:new Date(started).toISOString(),completedAt:new Date().toISOString(),errorCode:error.code??"RETRIEVAL_FAILED",metadata:{message:error.message}});
      throw error;
    }
  }
}

function codeError(code,message){const e=new Error(message);e.code=code;return e;}
