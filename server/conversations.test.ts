import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", () => ({
  addMessageForOwner: vi.fn(),
  createConversationForOwner: vi.fn(),
  getConversationForOwner: vi.fn(),
  listConversationsForOwner: vi.fn(),
  renameConversationForOwner: vi.fn(),
}));

import * as db from "./db";
import { appRouter } from "./routers";

const mockedDb = vi.mocked(db);

function createContext(userId: number | null): TrpcContext {
  return {
    user:
      userId === null
        ? null
        : {
            id: userId,
            openId: `conversation-user-${userId}`,
            name: `Conversation User ${userId}`,
            email: `user-${userId}@example.com`,
            loginMethod: "test",
            role: "user",
            createdAt: new Date("2026-01-01T00:00:00Z"),
            updatedAt: new Date("2026-01-02T00:00:00Z"),
            lastSignedIn: new Date("2026-01-03T00:00:00Z"),
          },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

const conversation = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "New conversation",
  createdAt: new Date("2026-01-04T00:00:00Z"),
  updatedAt: new Date("2026-01-04T00:00:00Z"),
};

describe("owner-scoped conversations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires authentication to create a conversation", async () => {
    const caller = appRouter.createCaller(createContext(null));
    await expect(caller.conversations.create()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(mockedDb.createConversationForOwner).not.toHaveBeenCalled();
  });

  it("creates and lists only the authenticated user's conversations", async () => {
    mockedDb.createConversationForOwner.mockResolvedValue(conversation);
    mockedDb.listConversationsForOwner.mockResolvedValue([conversation]);
    const caller = appRouter.createCaller(createContext(7));

    await expect(caller.conversations.create()).resolves.toEqual(conversation);
    await expect(caller.conversations.list()).resolves.toEqual([conversation]);
    expect(mockedDb.createConversationForOwner).toHaveBeenCalledWith(
      7,
      "New conversation"
    );
    expect(mockedDb.listConversationsForOwner).toHaveBeenCalledWith(7);
  });

  it("rejects cross-user reads and message insertion", async () => {
    mockedDb.getConversationForOwner.mockResolvedValue(undefined);
    mockedDb.addMessageForOwner.mockResolvedValue(undefined);
    const caller = appRouter.createCaller(createContext(7));
    const conversationId = conversation.id;

    await expect(
      caller.conversations.get({ conversationId })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      caller.conversations.addMessage({
        conversationId,
        role: "user",
        content: "Attempted cross-user write",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockedDb.getConversationForOwner).toHaveBeenCalledWith(
      7,
      conversationId
    );
    expect(mockedDb.addMessageForOwner).toHaveBeenCalledWith(
      7,
      conversationId,
      "user",
      "Attempted cross-user write"
    );
  });

  it("binds rename and message writes to ctx.user.id", async () => {
    mockedDb.renameConversationForOwner.mockResolvedValue({
      ...conversation,
      title: "Renamed",
    });
    mockedDb.addMessageForOwner.mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
      conversationId: conversation.id,
      role: "assistant",
      content: "Server response",
      metadata: null,
      createdAt: new Date("2026-01-04T00:01:00Z"),
    });
    const caller = appRouter.createCaller(createContext(11));

    await caller.conversations.rename({
      conversationId: conversation.id,
      title: "Renamed",
    });
    await caller.conversations.addMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "Server response",
    });

    expect(mockedDb.renameConversationForOwner).toHaveBeenCalledWith(
      11,
      conversation.id,
      "Renamed"
    );
    expect(mockedDb.addMessageForOwner).toHaveBeenCalledWith(
      11,
      conversation.id,
      "assistant",
      "Server response"
    );
  });

  it("rejects invalid IDs and excessive message content", async () => {
    const caller = appRouter.createCaller(createContext(7));
    await expect(
      caller.conversations.get({ conversationId: "not-an-id" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.conversations.addMessage({
        conversationId: conversation.id,
        role: "user",
        content: "x".repeat(20_001),
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockedDb.getConversationForOwner).not.toHaveBeenCalled();
    expect(mockedDb.addMessageForOwner).not.toHaveBeenCalled();
  });

  it("does not accept a browser owner ID or client metadata", async () => {
    mockedDb.createConversationForOwner.mockResolvedValue(conversation);
    const caller = appRouter.createCaller(createContext(19));

    await caller.conversations.create({
      title: "Private",
      // @ts-expect-error owner identity is intentionally not a procedure input
      ownerId: 999,
    });

    expect(mockedDb.createConversationForOwner).toHaveBeenCalledWith(
      19,
      "Private"
    );
  });
});
