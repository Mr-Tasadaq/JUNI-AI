import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { isUserStorageKey } from "./_core/storageProxy";
import { appRouter } from "./routers";

function createContext(
  userId: number | null,
  role: "user" | "admin" = "user"
): TrpcContext {
  return {
    user:
      userId === null
        ? null
        : {
            id: userId,
            openId: `security-user-${userId}`,
            name: `Security User ${userId}`,
            email: `security-${userId}@example.com`,
            loginMethod: "test",
            role,
            createdAt: new Date(),
            updatedAt: new Date(),
            lastSignedIn: new Date(),
          },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

function readClientSource(directory: string): string {
  return readdirSync(directory)
    .flatMap(entry => {
      const path = join(directory, entry);
      return statSync(path).isDirectory()
        ? readClientSource(path)
        : path.endsWith(".ts") || path.endsWith(".tsx")
          ? [readFileSync(path, "utf8")]
          : [];
    })
    .join("\n");
}

describe("authentication and authorization boundaries", () => {
  it("rejects unauthenticated access to every protected procedure", async () => {
    const caller = appRouter.createCaller(createContext(null));

    await expect(
      caller.realtime.createClientSecret({ persona: "juni", language: "en" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      caller.files.analyze({
        name: "note.txt",
        mimeType: "text/plain",
        dataUrl: "data:text/plain;base64,SGVsbG8=",
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.account.dashboard()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(caller.account.getRechargeInfo()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      caller.account.startRecharge({ amount: 500 })
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(caller.admin.dashboard()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("derives ownership from the server context, not client input", async () => {
    const caller = appRouter.createCaller(createContext(101));

    const result = await caller.account.startRecharge({
      amount: 500,
      userId: 202,
    } as { amount: number; userId: number });

    expect(result.userId).toBe(101);
    expect(result.userId).not.toBe(202);
  });

  it("allows admins but rejects normal users for admin procedures", async () => {
    const userCaller = appRouter.createCaller(createContext(101));
    const adminCaller = appRouter.createCaller(createContext(1, "admin"));

    await expect(userCaller.admin.dashboard()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(adminCaller.admin.dashboard()).resolves.toMatchObject({
      viewer: { id: 1, role: "admin" },
      system: { authentication: "manus_oauth" },
      personas: expect.arrayContaining([
        expect.objectContaining({ id: "juni", name: "JUNI AI" }),
        expect.objectContaining({ id: "sona", name: "SONA AI" }),
      ]),
    });
  });

  it("denies cross-user storage keys", () => {
    expect(isUserStorageKey("users/101/report.pdf", 101)).toBe(true);
    expect(isUserStorageKey("users/202/report.pdf", 101)).toBe(false);
    expect(isUserStorageKey("users/101/report.pdf", null)).toBe(false);
    expect(isUserStorageKey("report.pdf", 101)).toBe(false);
  });

  it("returns a generic provider error without exposing configuration details", async () => {
    const caller = appRouter.createCaller(createContext(101));

    await expect(
      caller.realtime.createClientSecret({ persona: "juni", language: "en" })
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "The requested AI service is temporarily unavailable.",
    });
  });

  it("keeps privileged provider credentials and browser bearer forwarding out of client code", () => {
    const clientSource = readClientSource("client/src");
    const transportSource = readFileSync("client/src/main.tsx", "utf8");
    const sdkSource = readFileSync("server/_core/sdk.ts", "utf8");

    expect(clientSource).not.toContain("OPENAI_API_KEY");
    expect(clientSource).not.toContain("BUILT_IN_FORGE_API_KEY");
    expect(transportSource).not.toContain("Authorization: `Bearer");
    expect(transportSource).not.toContain(
      'sessionStorage.getItem("manus-cookie")'
    );
    expect(sdkSource).not.toContain("req.headers.authorization");
  });
});
