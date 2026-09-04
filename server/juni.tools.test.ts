import { describe, expect, it } from "vitest";
import {
  JUNI_PERSONAS,
  LIVE_MODEL,
  safeLiveToolDeclarations,
} from "../shared/juni";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createContext(): TrpcContext {
  const user = {
    id: 7,
    openId: "juni-test-user",
    name: "Juni Tester",
    email: "juni@example.com",
    loginMethod: "test",
    role: "user" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("JUNI Live contracts", () => {
  it("keeps both assistants distinct and audio-only", () => {
    expect(JUNI_PERSONAS.juni.gender).toBe("Male");
    expect(JUNI_PERSONAS.sona.gender).toBe("Female");
    expect(JUNI_PERSONAS.juni.voiceName).not.toBe(JUNI_PERSONAS.sona.voiceName);
    expect(LIVE_MODEL).toBe("gemini-3.1-flash-live-preview");
  });

  it("exposes only the three explicitly allowlisted safe tools", () => {
    expect(safeLiveToolDeclarations.map(tool => tool.name)).toEqual([
      "open_website",
      "get_recharge_info",
      "start_recharge",
    ]);
  });
});

describe("safe recharge tools", () => {
  it("returns a non-billing preview intent and never a checkout URL", async () => {
    const caller = appRouter.createCaller(createContext());
    const result = await caller.live.startRecharge({ amount: 500 });

    expect(result).toMatchObject({
      status: "awaiting_provider",
      amount: 500,
      currency: "PKR",
      checkoutUrl: null,
    });
  });

  it("rejects amounts outside the guarded range", async () => {
    const caller = appRouter.createCaller(createContext());
    await expect(caller.live.startRecharge({ amount: 50 })).rejects.toThrow();
    await expect(
      caller.live.startRecharge({ amount: 100001 })
    ).rejects.toThrow();
  });
});
