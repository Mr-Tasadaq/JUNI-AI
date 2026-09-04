import { describe, expect, expectTypeOf, it } from "vitest";
import type { User } from "../drizzle/schema";
import type { UserId } from "../shared/contracts/identity";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createContext(userId: UserId): TrpcContext {
  return {
    user: {
      id: userId,
      openId: "identity-contract-user",
      name: "Identity Contract User",
      email: "identity@example.com",
      loginMethod: "test",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("identity contract", () => {
  it("remains aligned with the Drizzle-derived user primary key", () => {
    expectTypeOf<UserId>().toEqualTypeOf<User["id"]>();
  });

  it("derives authenticated account output ownership from context", async () => {
    const userId: UserId = 42;
    const caller = appRouter.createCaller(createContext(userId));

    const result = await caller.account.getRechargeInfo();

    expect(result.userId).toBe(userId);
  });
});
