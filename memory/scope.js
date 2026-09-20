import { assertScope } from "./model.js";

export function requireScope(scope) {
  assertScope(scope);
  return Object.freeze({
    tenantId: String(scope.tenantId),
    userId: String(scope.userId),
  });
}

export function withScope(sql, scopeArgs) {
  return { sql, args: scopeArgs };
}
