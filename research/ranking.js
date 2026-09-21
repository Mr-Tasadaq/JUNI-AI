export function rankSources(sources, query) {
  const terms = tokenize(query);
  return sources.map((source) => {
    const haystack = [
      source.title, source.publisher, source.author, source.domain, source.content?.slice(0, 20_000),
    ].filter(Boolean).join(" ").toLowerCase();
    const matches = terms.reduce((sum,term)=>sum+(haystack.includes(term)?1:0),0);
    const primary = isLikelyPrimary(source);
    const freshness = freshnessScore(source.publicationDate, source.retrievedAt);
    const directness = source.content ? 1 : 0.4;
    const score = matches + (primary ? 1.5 : 0) + freshness + directness;
    const qualityBasis = {
      relevanceTermMatches: matches,
      primarySourceBasis: primary ? "official_or_first_party_domain_signal" : "no_primary_source_signal",
      freshnessBasis: source.publicationDate ? "publication_date_available" : "retrieval_only",
      directnessBasis: source.content ? "source_content_retrieved" : "metadata_only",
      scoreIsHeuristic: true,
    };
    return {...source,relevanceScore:score,primarySourceCandidate:primary,metadata:{...(source.metadata??{}),qualityBasis}};
  }).sort((a,b)=>b.relevanceScore-a.relevanceScore);
}

export function corroborationCounts(sources) {
  const tokenSets = sources.map((source)=>new Set(tokenize([source.title,source.content].filter(Boolean).join(" "))));
  return sources.map((source,index)=>{
    let count=0;
    for(let i=0;i<tokenSets.length;i+=1) if(i!==index){
      const overlap=intersection(tokenSets[index],tokenSets[i]);
      if(overlap>=3) count+=1;
    }
    return {...source,corroborationCount:count};
  });
}

function isLikelyPrimary(source) {
  const domain=String(source.domain??"").toLowerCase();
  const publisher=String(source.publisher??"").toLowerCase();
  if (source.primarySource===true) return true;
  return /\.(gov|mil)$/.test(domain) || domain.startsWith("docs.") || domain.startsWith("developer.")
    || /official|government|university|documentation|research/.test(publisher);
}
function freshnessScore(publicationDate,retrievedAt){
  const date=new Date(publicationDate??retrievedAt??Date.now());
  if(Number.isNaN(date.getTime())) return 0;
  const days=Math.max(0,(Date.now()-date.getTime())/86_400_000);
  return Math.max(0,1-Math.min(days,365)/365);
}
function tokenize(text){return [...new Set(String(text??"").toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)??[])].slice(0,40);}
function intersection(a,b){let n=0;for(const x of a)if(b.has(x))n+=1;return n;}
