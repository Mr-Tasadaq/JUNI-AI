import { afterEach, describe, expect, it, vi } from "vitest";
import { COOKIE_NAME } from "../shared/const";
import * as db from "./db";
import { sdk } from "./_core/sdk";
import type { Request } from "express";

const user = {
  id: 42,
  openId: "browser-user-42",
  name: "Browser User",
  email: "browser@example.com",
  loginMethod: "manus",
  role: "user" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

function request(headers: Record<string, string> = {}): Request {
  return {
    protocol: "https",
    headers,
  } as Request;
}

afterEach(() => vi.restoreAllMocks());

describe("SDK request authentication", () => {
  it("authenticates a normal browser request from the HttpOnly session cookie", async () => {
    const getUser = vi.spyOn(db, "getUserByOpenId").mockResolvedValue(user);
    const upsertUser = vi.spyOn(db, "upsertUser").mockResolvedValue();
    const verifySession = vi.spyOn(sdk, "verifySession").mockResolvedValue({
      openId: user.openId,
      appId: "test-app",
      name: user.name,
    });
    const token = "valid-cookie-session";

    await expect(
      sdk.authenticateRequest(
        request({ cookie: `${COOKIE_NAME}=${encodeURIComponent(token)}` })
      )
    ).resolves.toMatchObject({ id: user.id, openId: user.openId });
    expect(verifySession).toHaveBeenCalledWith(token);
    expect(getUser).toHaveBeenCalledWith(user.openId);
    expect(upsertUser).toHaveBeenCalledWith(
      expect.objectContaining({ openId: user.openId })
    );
  });

  it("rejects a missing cookie and never accepts an arbitrary browser bearer token", async () => {
    const verifySession = vi
      .spyOn(sdk, "verifySession")
      .mockResolvedValue(null);

    await expect(sdk.authenticateRequest(request())).rejects.toThrow();
    await expect(
      sdk.authenticateRequest(
        request({ authorization: "Bearer valid-cookie-session" })
      )
    ).rejects.toThrow();
    expect(verifySession).toHaveBeenNthCalledWith(1, undefined);
    expect(verifySession).toHaveBeenNthCalledWith(2, undefined);
  });

  it("rejects expired and malformed session cookies", async () => {
    const verifySession = vi
      .spyOn(sdk, "verifySession")
      .mockResolvedValue(null);

    await expect(
      sdk.authenticateRequest(
        request({ cookie: `${COOKIE_NAME}=expired-session` })
      )
    ).rejects.toThrow();
    await expect(
      sdk.authenticateRequest(request({ cookie: `${COOKIE_NAME}=not-a-jwt` }))
    ).rejects.toThrow();
    expect(verifySession).toHaveBeenNthCalledWith(1, "expired-session");
    expect(verifySession).toHaveBeenNthCalledWith(2, "not-a-jwt");
  });

  it("preserves the legitimate scheduled-task session flow", async () => {
    const cronInfo = {
      openId: "cron_task-owner",
      name: "Scheduled Task",
      taskUid: "task-123",
    };
    const getUserInfoWithJwt = vi
      .spyOn(sdk, "getUserInfoWithJwt")
      .mockResolvedValue(cronInfo as never);
    const verifySession = vi.spyOn(sdk, "verifySession").mockResolvedValue({
      openId: cronInfo.openId,
      appId: "test-app",
      name: cronInfo.name,
    });
    const token = "valid-cron-cookie-session";

    await expect(
      sdk.authenticateRequest(request({ cookie: `${COOKIE_NAME}=${token}` }))
    ).resolves.toMatchObject({
      isCron: true,
      taskUid: cronInfo.taskUid,
      openId: cronInfo.openId,
    });
    expect(verifySession).toHaveBeenCalledWith(token);
    expect(getUserInfoWithJwt).toHaveBeenCalledWith(token);
  });
});
