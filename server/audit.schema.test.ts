import { describe, expect, it } from "vitest";
import { auditEvents } from "../drizzle/schema";

describe("audit event schema", () => {
  it("defines the durable append-only event fields", () => {
    expect(Object.keys(auditEvents)).toEqual(
      expect.arrayContaining([
        "id",
        "actorUserId",
        "action",
        "targetUserId",
        "occurredAt",
        "metadata",
      ])
    );
  });

  it("keeps the event contract free of credential-bearing fields", () => {
    const fields = Object.keys(auditEvents);
    expect(fields).not.toContain("password");
    expect(fields).not.toContain("token");
    expect(fields).not.toContain("authorization");
    expect(fields).not.toContain("requestBody");
  });
});
