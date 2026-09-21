import { resolveRequestIdentity } from "../core/identity.js";

export function resolveResearchScope(req, config) {
  try {
    return resolveRequestIdentity(req, {
      fixedTenantId: config.identity?.fixedTenantId ?? config.research.fixedTenantId,
      fixedUserId: config.identity?.fixedUserId ?? config.research.fixedUserId,
      allowIdentityHeaders: config.identity?.allowIdentityHeaders === true
        || config.research.allowIdentityHeaders === true,
    });
  } catch (error) {
    const normalized = new Error("Authenticated research identity is not configured.");
    normalized.code = error?.code === "REQUEST_IDENTITY_NOT_CONFIGURED"
      ? "RESEARCH_IDENTITY_NOT_CONFIGURED"
      : error?.code ?? "RESEARCH_IDENTITY_INVALID";
    normalized.cause = error;
    throw normalized;
  }
}
