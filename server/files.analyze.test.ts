import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { JuniProviderError } from "./capabilities";

const mocks = vi.hoisted(() => {
  const invokeVision = vi.fn();
  const resolveCapability = vi.fn(() => ({
    capability: "VISION" as const,
    provider: "openai-responses-vision",
    adapter: { invokeVision },
  }));
  return { invokeVision, resolveCapability };
});

vi.mock("./capabilities", async importOriginal => {
  const actual = await importOriginal<typeof import("./capabilities")>();
  return {
    ...actual,
    normalizeCapabilityError: (error: unknown) => error,
    resolveCapability: mocks.resolveCapability,
  };
});

vi.mock("./db", () => ({}));

import { appRouter } from "./routers";

function createContext(userId: number | null): TrpcContext {
  return {
    user:
      userId === null
        ? null
        : {
            id: userId,
            openId: `vision-user-${userId}`,
            name: "Vision User",
            email: "vision@example.com",
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

const image = {
  name: "diagram.png",
  mimeType: "image/png" as const,
  dataUrl: "data:image/png;base64,AAAA",
};
const pdf = {
  name: "brief.pdf",
  mimeType: "application/pdf" as const,
  dataUrl: "data:application/pdf;base64,JVBERi0xLjQ=",
};
const text = {
  name: "notes.txt",
  mimeType: "text/plain" as const,
  dataUrl: "data:text/plain;base64,SGVsbG8=",
};

describe("files.analyze through VISION", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invokeVision.mockResolvedValue("Safe analysis output.");
  });

  it.each([
    ["image", image],
    ["PDF", pdf],
    ["plain text", text],
  ])("analyzes an authenticated %s upload", async (_label, input) => {
    const caller = appRouter.createCaller(createContext(7));

    const result = await caller.files.analyze(input);

    expect(result).toMatchObject({
      name: input.name,
      mimeType: input.mimeType,
      text: "Safe analysis output.",
      capability: "VISION",
      provider: "openai-responses-vision",
    });
    expect(mocks.resolveCapability).toHaveBeenCalledWith("VISION");
    expect(mocks.invokeVision).toHaveBeenCalledWith(
      expect.objectContaining({
        safetyIdentifier: createHash("sha256")
          .update("vision-user-7")
          .digest("hex"),
        input: expect.objectContaining({
          dataUrl: input.dataUrl,
        }),
      })
    );
  });

  it("rejects unauthenticated analysis", async () => {
    const caller = appRouter.createCaller(createContext(null));
    await expect(caller.files.analyze(image)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(mocks.invokeVision).not.toHaveBeenCalled();
  });

  it("rejects unsupported MIME types, malformed data URLs, and oversized data", async () => {
    const caller = appRouter.createCaller(createContext(7));
    await expect(
      caller.files.analyze({
        name: "archive.zip",
        // @ts-expect-error intentional unsupported input contract
        mimeType: "application/zip",
        dataUrl: "data:application/zip;base64,AAAA",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.files.analyze({ ...text, dataUrl: "not-a-data-url" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.files.analyze({
        ...text,
        dataUrl: `data:text/plain;base64,${"A".repeat(12_000_001)}`,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.invokeVision).not.toHaveBeenCalled();
  });

  it("rejects a data URL whose media type does not match the declared MIME", async () => {
    const caller = appRouter.createCaller(createContext(7));
    await expect(
      caller.files.analyze({
        ...image,
        dataUrl: "data:image/jpeg;base64,AAAA",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("normalizes provider failures without exposing credentials", async () => {
    mocks.invokeVision.mockRejectedValue(
      new JuniProviderError(
        "provider_error",
        "provider secret should never reach the browser",
        { providerId: "openai-responses-vision" }
      )
    );
    const caller = appRouter.createCaller(createContext(7));

    await expect(caller.files.analyze(image)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "The uploaded content could not be analyzed.",
    });
    await expect(caller.files.analyze(image)).rejects.not.toThrow(
      "provider secret"
    );
  });

  it("keeps uploaded instructions inside an untrusted-data prompt", async () => {
    const caller = appRouter.createCaller(createContext(7));
    await caller.files.analyze({
      ...text,
      name: "ignore-instructions.txt",
    });
    expect(mocks.invokeVision).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("untrusted data"),
      })
    );
    expect(mocks.invokeVision.mock.calls[0][0].prompt).not.toContain(
      "ignore-instructions"
    );
  });
});
