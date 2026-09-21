export function createGenericResearchProvider({name="custom",model="custom",search,urlRetrieve,capabilities=["webSearch","urlRetrieval","nativeCitations"]}={}) {
  return Object.freeze({
    name,defaultModel:model,
    researchCapabilities:()=>Object.freeze([...capabilities]),
    async health(){return {available:typeof search==="function"||typeof urlRetrieve==="function",configured:true,timeoutMs:30_000,provider:name};},
    async research(request){
      const operation=request.operation??"search";
      const fn=operation==="url_context"?urlRetrieve:search;
      if(typeof fn!=="function"){const e=new Error("Research operation is not configured.");e.code="RESEARCH_CAPABILITY_UNAVAILABLE";e.retryable=false;throw e;}
      return fn(request);
    },
  });
}
