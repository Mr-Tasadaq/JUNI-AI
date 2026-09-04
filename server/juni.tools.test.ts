import { describe, expect, it } from "vitest";
import {
  JUNI_PERSONAS,
  REALTIME_MODEL,
  safeLiveToolDeclarations,
  SUPPORTED_LANGUAGES,
} from "../shared/juni";
import { appRouter, languageSchema, personaSchema } from "./routers";
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
  it("keeps both assistants distinct and OpenAI Realtime-ready", () => {
    expect(JUNI_PERSONAS.juni.gender).toBe("Male");
    expect(JUNI_PERSONAS.sona.gender).toBe("Female");
    expect(JUNI_PERSONAS.juni.voiceName).not.toBe(JUNI_PERSONAS.sona.voiceName);
    expect(REALTIME_MODEL).toBe("gpt-realtime-2.1");
  });

  it("accepts only canonical persona and language identifiers", () => {
    expect(personaSchema.safeParse("juni").success).toBe(true);
    expect(personaSchema.safeParse("sona").success).toBe(true);
    expect(personaSchema.safeParse("unknown").success).toBe(false);

    expect(SUPPORTED_LANGUAGES.map(language => language.id)).toEqual([
      "en",
      "ur",
      "hi",
      "ar",
      "es",
    ]);
    expect(languageSchema.safeParse("ur").success).toBe(true);
    expect(languageSchema.safeParse("unknown").success).toBe(false);
  });

  it("exposes only the three structured allowlisted safe tools", () => {
    expect(safeLiveToolDeclarations.map(tool => tool.name)).toEqual([
      "open_website",
      "get_recharge_info",
      "start_recharge",
    ]);
    expect(safeLiveToolDeclarations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "open_website",
          parameters: expect.objectContaining({
            required: ["url", "reason"],
          }),
        }),
        expect.objectContaining({
          name: "get_recharge_info",
          parameters: { type: "object", properties: {} },
        }),
        expect.objectContaining({
          name: "start_recharge",
          parameters: expect.objectContaining({ required: ["amount"] }),
        }),
      ])
    );
  });
});

describe("safe recharge tools", () => {
  it("returns a non-billing preview intent and never a checkout URL", async () => {
    const caller = appRouter.createCaller(createContext());
    const result = await caller.account.startRecharge({ amount: 500 });

    expect(result).toMatchObject({
      status: "awaiting_provider",
      amount: 500,
      currency: "PKR",
      checkoutUrl: null,
    });
  });

  it("rejects amounts outside the guarded range", async () => {
    const caller = appRouter.createCaller(createContext());
    await expect(
      caller.account.startRecharge({ amount: 50 })
    ).rejects.toThrow();
    await expect(
      caller.account.startRecharge({ amount: 100001 })
    ).rejects.toThrow();
  });
});
