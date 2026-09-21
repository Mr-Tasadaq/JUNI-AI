import { hashObject } from "../storage/serialization.js";

export class ResearchCache {
  #cache; #ttlSeconds;
  constructor({ cacheService, ttlSeconds=900 }) { this.#cache=cacheService; this.#ttlSeconds=ttlSeconds; }
  async get(scope,key) {
    const hit=await this.#cache.get(scope,key);
    if(!hit) return {value:null,hit:false};
    if(hit.expires_at && new Date(hit.expires_at).getTime()<=Date.now()){await this.#cache.delete(scope,key);return {value:null,hit:false};}
    return {value:hit.value,hit:true};
  }
  async set(scope,key,value,{ttlSeconds=this.#ttlSeconds,sourceRef=null}={}) {
    const expiresAt=ttlSeconds>0?new Date(Date.now()+ttlSeconds*1000).toISOString():null;
    return this.#cache.set(scope,{cacheKey:key,value,sourceRef,expiresAt});
  }
  static key(kind,value){return "research:"+kind+":"+hashObject(value);}
}
