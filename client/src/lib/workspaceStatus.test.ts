import { describe, expect, it } from "vitest";
import { getWorkspaceStatus } from "./workspaceStatus";

describe("getWorkspaceStatus", () => {
  it("exposes a retryable creation failure state", () => {
    expect(
      getWorkspaceStatus({ sendError: false, creationError: true })
    ).toEqual({
      message:
        "JUNI could not create a conversation. Check your connection and try again.",
      tone: "error",
      showRetryCreate: true,
    });
  });

  it("keeps provider-boundary disclosure in the neutral state", () => {
    expect(
      getWorkspaceStatus({ sendError: false, creationError: false })
    ).toMatchObject({
      tone: "neutral",
      showRetryCreate: false,
    });
  });
});
