import { assertScope } from "../memory/model.js";

export function resolveResearchScope(req, config) {
  const authenticated = req?.auth?.user ?? req?.user ?? req?.auth ?? null;
  const headerTenant = req?.headers?.["x-tenant-id"];
  const headerUser = req?.headers?.["x-user-id"];
  const tenantId = authenticated?.tenantId ?? authenticated?.tenant_id
    ?? (config.research.allowIdentityHeaders ? headerTenant : null)
    ?? config.research.fixedTenantId;
  const userId = authenticated?.userId ?? authenticated?.user_id ?? authenticated?.id
    ?? (config.research.allowIdentityHeaders ? headerUser : null)
    ?? config.research.fixedUserId;
  try { assertScope({tenantId,userId}); } catch {
    const error=new Error("Authenticated research identity is not configured.");
    error.code="RESEARCH_IDENTITY_NOT_CONFIGURED";
    throw error;
  }
  return Object.freeze({tenantId:String(tenantId),userId:String(userId)});
}
