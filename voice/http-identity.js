import { assertScope } from "../memory/model.js";

export function resolveVoiceScope(req, config) {
  const auth = req?.auth?.user ?? req?.user ?? req?.auth ?? null;
  const tenantId = auth?.tenantId ?? auth?.tenant_id ?? config.voice.fixedTenantId;
  const userId = auth?.userId ?? auth?.user_id ?? auth?.id ?? config.voice.fixedUserId;
  if (!tenantId || !userId) {
    const error = new Error("Authenticated voice identity is not configured.");
    error.code = "VOICE_IDENTITY_NOT_CONFIGURED";
    throw error;
  }
  assertScope({ tenantId, userId });
  return Object.freeze({ tenantId: String(tenantId), userId: String(userId) });
}
