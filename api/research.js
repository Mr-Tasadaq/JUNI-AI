import { randomUUID } from "node:crypto";
import { createJuniApplication } from "../core/app.js";
import { authorizeRequest, checkOrigin } from "../core/security.js";
import { checkRateLimit } from "../lib/rate-limit.js";
import { resolveResearchScope } from "../research/http-identity.js";

let application;
function getApplication(){ application ??= createJuniApplication(); return application; }
function json(res,status,body){res.status(status);res.setHeader("Content-Type","application/json; charset=utf-8");return res.json(body);}
function clientKey(req){return req.headers["x-forwarded-for"]?.split(",")[0]?.trim()||req.headers["x-real-ip"]||"unknown";}

export default async function handler(req,res){
  if(req.method!=="POST"){res.setHeader("Allow","POST");return json(res,405,{error:"Method not allowed."});}
  const app=getApplication();
  if(!checkOrigin(req.headers.origin,app.config.security.allowedOrigin)) return json(res,403,{error:"Origin not allowed."});
  const auth=authorizeRequest(req,app.config.security.apiToken);
  if(!auth.allowed) return json(res,auth.reason==="server_not_configured"?503:401,{error:auth.reason==="server_not_configured"?"The server is not configured yet. Add JUNI_API_TOKEN.":"Authentication required."});
  const limit=Number.parseInt(process.env.JUNI_RATE_LIMIT||"20",10);
  const windowSeconds=Number.parseInt(process.env.JUNI_RATE_WINDOW_SECONDS||"60",10);
  const rate=checkRateLimit(clientKey(req),Number.isFinite(limit)&&limit>0?limit:20,Number.isFinite(windowSeconds)&&windowSeconds>0?windowSeconds:60);
  res.setHeader("X-RateLimit-Limit",String(rate.limit));res.setHeader("X-RateLimit-Remaining",String(rate.remaining));
  if(!rate.allowed){res.setHeader("Retry-After",String(rate.retryAfter));return json(res,429,{error:"Too many requests. Please try again shortly."});}

  let scope;
  try{scope=resolveResearchScope(req,app.config);}catch(error){return json(res,503,{error:error.message,code:error.code});}
  await app.research.ready();

  const body=req.body??{};const action=String(body.action??"research");
  const requestId=body.requestId??randomUUID();
  try{
    if(action==="research"){
      const result=await app.research.run(scope,{...body,query:typeof body.query==="string"?body.query.trim():"",requestId});
      return json(res,200,result);
    }
    if(action==="start"){
      return json(res,200,await app.research.start(scope,{...body,requestId}));
    }
    if(action==="retrieve"){
      if(typeof body.url!=="string") return json(res,400,{error:"url is required."});
      return json(res,200,await app.research.retrieve(scope,body.url,{allowedDomains:app.config.research.allowedDomains,blockedDomains:app.config.research.blockedDomains,maxBytes:app.config.research.maxSourceBytes,maxRedirects:app.config.research.maxRedirects}));
    }
    if(action==="session") return json(res,200,await app.research.inspect(scope,String(body.sessionId)));
    if(action==="sessions") return json(res,200,await app.research.sessions(scope,{limit:body.limit,status:body.status}));
    if(action==="sources") return json(res,200,await app.research.sources(scope,String(body.sessionId),{limit:body.limit}));
    if(action==="evidence") return json(res,200,await app.research.evidence(scope,String(body.sessionId),{sourceId:body.sourceId,limit:body.limit}));
    if(action==="claims") return json(res,200,await app.research.claims(scope,String(body.sessionId),{limit:body.limit}));
    if(action==="citations") return json(res,200,await app.research.citations(scope,String(body.sessionId),{limit:body.limit}));
    if(action==="operations") return json(res,200,await app.research.operations(scope,String(body.sessionId),{limit:body.limit}));
    if(action==="events") return json(res,200,await app.research.events(scope,{sessionId:body.sessionId??null,limit:body.limit}));
    if(action==="candidates") return json(res,200,await app.research.candidates(scope,{sessionId:body.sessionId??null,status:body.status??null,limit:body.limit}));
    if(action==="candidate") return json(res,200,await app.research.candidate(scope,String(body.candidateId)));
    if(action==="candidate_create") return json(res,200,await app.research.createCandidate(scope,body));
    if(action==="candidate_approve") return json(res,200,await app.research.approveCandidate(scope,String(body.candidateId),{approvedBy:body.approvedBy??scope.userId,actorId:body.actorId??scope.userId}));
    if(action==="candidate_reject") return json(res,200,await app.research.rejectCandidate(scope,String(body.candidateId),{actorId:body.actorId??scope.userId,rationale:body.rationale??null}));
    if(action==="verify_provenance") return json(res,200,await app.research.verifyProvenance(scope));
    return json(res,400,{error:"Unknown research action."});
  }catch(error){
    console.error("JUNI-AI research request failed",{name:error?.name,code:error?.code,message:error?.message,requestId});
    const status=error?.code==="RESEARCH_DISABLED"?503:error?.code==="RESEARCH_IDENTITY_NOT_CONFIGURED"?503:error?.code==="STORAGE_QUOTA_EXCEEDED"?507:502;
    return json(res,status,{error:error.message||"Research request failed.",code:error.code??"RESEARCH_ERROR",requestId});
  }
}
