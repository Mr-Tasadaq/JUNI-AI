import { createJuniApplication } from "../core/app.js";
import { authorizeRequest, checkOrigin } from "../core/security.js";
import { resolveResearchScope } from "../research/http-identity.js";

let application;
function getApplication() {
  application ??= createJuniApplication();
  return application;
}
function json(res,status,body) {
  res.status(status);
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","no-store");
  return res.json(body);
}
function clientKey(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
    || req.headers["x-real-ip"]
    || "unknown";
}

export default async function handler(req,res) {
  const app=getApplication();

  if(!checkOrigin(req.headers.origin,app.config.security.allowedOrigin)) {
    return json(res,403,{error:"Origin not allowed."});
  }

  const auth=authorizeRequest(req,app.config.security.apiToken,{
    cookieName:app.config.security.authCookieName,
  });
  if(!auth.allowed) {
    return json(res,auth.reason==="server_not_configured"?503:401,{
      error:auth.reason==="server_not_configured"
        ?"The server is not configured yet. Add JUNI_API_TOKEN."
        :"Authentication required.",
    });
  }

  const limit=Number.parseInt(process.env.JUNI_RATE_LIMIT||"20",10);
  const windowSeconds=Number.parseInt(process.env.JUNI_RATE_WINDOW_SECONDS||"60",10);
  const rate=await app.rateLimiter.check(
    clientKey(req),
    Number.isFinite(limit)&&limit>0?limit:20,
    Number.isFinite(windowSeconds)&&windowSeconds>0?windowSeconds:60,
  );
  res.setHeader("X-RateLimit-Limit",String(rate.limit));
  res.setHeader("X-RateLimit-Remaining",String(rate.remaining));
  res.setHeader("X-RateLimit-Store",rate.store);
  if(!rate.allowed) {
    res.setHeader("Retry-After",String(rate.retryAfter));
    return json(res,429,{error:"Too many requests. Please try again shortly."});
  }

  let scope;
  try {
    scope=resolveResearchScope(req,app.config);
  } catch(error) {
    return json(res,503,{error:error.message,code:error.code});
  }

  if(req.method!=="GET"&&req.method!=="POST") {
    res.setHeader("Allow","GET, POST");
    return json(res,405,{error:"Method not allowed."});
  }

  const action=req.method==="GET"
    ?String(req.query?.action??"candidates")
    :String(req.body?.action??"");

  try {
    if(action==="candidates") {
      return json(res,200,{
        candidates:await app.memory.answers.listCandidates(scope,{
          limit:req.query?.limit??req.body?.limit,
        }),
      });
    }

    if(action==="candidate") {
      return json(res,200,{
        candidate:await app.memory.answers.get(scope,String(req.query?.id??req.body?.id??"")),
      });
    }

    if(action==="approve") {
      if(req.method!=="POST") return json(res,405,{error:"POST required for approval."});
      return json(res,200,{
        candidate:await app.memory.answers.approve(scope,String(req.body?.id??""),{
          approvedBy:req.body?.approvedBy,
        }),
      });
    }

    if(action==="reject") {
      if(req.method!=="POST") return json(res,405,{error:"POST required for rejection."});
      return json(res,200,{
        candidate:await app.memory.answers.reject(scope,String(req.body?.id??""),{
          rejectedBy:req.body?.rejectedBy??null,
          reason:req.body?.reason??null,
        }),
      });
    }

    return json(res,400,{error:"Unknown answer action."});
  } catch(error) {
    const status=error?.code==="ANSWER_APPROVAL_REQUIRED"
      ?400
      :error?.code==="ANSWER_CANDIDATE_NOT_FOUND"
        ?404
        :500;
    return json(res,status,{
      error:error?.message??"Answer operation failed.",
      code:error?.code??"ANSWER_ERROR",
    });
  }
}
