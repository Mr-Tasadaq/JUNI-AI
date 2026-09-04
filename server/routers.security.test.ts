import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mockedDb = vi.hoisted(() => ({
  getConversationForUser: vi.fn(),
  listConversations: vi.fn(),
  createConversation: vi.fn(),
  createMessage: vi.fn(),
  listMessages: vi.fn(),
  touchConversation: vi.fn(),
}));

vi.mock("./db", () => mockedDb);
vi.mock("./orchestration", () => ({ orchestrateConversation: vi.fn() }));
vi.mock("./upload", () => ({ uploadUserFile: vi.fn() }));

import { appRouter } from "./routers";

function createContext(user: TrpcContext["user"]): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("protected JUNI procedures", () => {
  it("rejects unauthenticated conversation listing", async () => {
    const caller = appRouter.createCaller(createContext(null));
    await expect(caller.conversations.list()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("rejects unauthenticated uploads before storage access", async () => {
    const caller = appRouter.createCaller(createContext(null));
    await expect(
      caller.files.upload({
        originalName: "notes.txt",
        mimeType: "text/plain",
        contentBase64: "aGVsbG8=",
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("does not expose a conversation when the owner-scoped lookup finds none", async () => {
    mockedDb.getConversationForUser.mockResolvedValueOnce(undefined);
    const caller = appRouter.createCaller(
      createContext({
        id: 42,
        openId: "user-42",
        email: "user@example.com",
        name: "User 42",
        loginMethod: "manus",
        role: "user",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      })
    );

    await expect(
      caller.conversations.messages({ conversationId: 99 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockedDb.getConversationForUser).toHaveBeenCalledWith(99, 42);
  });
});
