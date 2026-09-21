import { CLAIM_RELATIONS } from "./model.js";

export function validateCitations(citations, sources, evidenceById) {
  const sourceIds = new Set(sources.map((s)=>s.id));
  const validated = [];
  const rejected = [];
  for(const citation of Array.isArray(citations)?citations:[]){
    if(!sourceIds.has(citation.sourceId) || !CLAIM_RELATIONS.includes(citation.relation??"supports")){
      rejected.push({...citation,reason:"unknown_source_or_relation"});
      continue;
    }
    const evidenceIds=(citation.evidenceIds??[]).filter((id)=>evidenceById.has(id)&&evidenceById.get(id).sourceId===citation.sourceId);
    if(!evidenceIds.length && citation.citationType!=="native"){
      rejected.push({...citation,reason:"no_supporting_evidence"});
      continue;
    }
    validated.push({
      ...citation,
      relation:citation.relation??"supports",
      evidenceIds,
      citationType:citation.citationType??"application",
      citedExcerpt:evidenceIds.length?evidenceById.get(evidenceIds[0]).excerpt:null,
    });
  }
  return {validated,rejected};
}

export function nativeCitationToModel(annotation, sourceLookup) {
  const url=annotation?.url??annotation?.uri;
  if(!url) return null;
  const source=sourceLookup(url);
  if(!source) return null;
  return {
    sourceId:source.id,
    relation:"supports",
    evidenceIds:[],
    citationType:"native",
    citedExcerpt:annotation.citedText??annotation.cited_text??null,
    startIndex:annotation.startIndex??annotation.start_index??null,
    endIndex:annotation.endIndex??annotation.end_index??null,
    native:annotation,
  };
}
