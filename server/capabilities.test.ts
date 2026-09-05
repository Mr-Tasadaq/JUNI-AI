import { describe, expect, it, vi } from "vitest";
import type { InvokeParams, InvokeResult } from "./_core/llm";
import {
  CAPABILITIES,
  JuniProviderError,
  createCapabilityRegistry,
  createForgeLLMAdapter,
  getCapabilityStatus,
  resolveCapability,
} from "./capabilities";

const result = {
  choices: [{ message: { content: "ok" } }],
} as InvokeResult;

function configuredAdapter(invoke = vi.fn().mockResolvedValue(result)) {
  return createForgeLLMAdapter(invoke, true);
}

describe("JUNI capability contracts", () => {
  it("resolves SMART_GENERAL to the real current server-side adapter", () => {
    const adapter = configuredAdapter();
    const resolution = resolveCapability(
      "SMART_GENERAL",
      createCapabilityRegistry([adapter])
    );

    expect(resolution.capability).toBe("SMART_GENERAL");
    expect(resolution.provider).toBe("manus-forge-llm");
    expect(resolution.adapter).toBe(adapter);
  });

  it("rejects unsupported capabilities without pretending they are implemented", () => {
    expect(() =>
      resolveCapability(
        "VISION",
        createCapabilityRegistry([configuredAdapter()])
      )
    ).toThrowError("Capability VISION is not currently available.");

    const status = getCapabilityStatus(
      createCapabilityRegistry([configuredAdapter()])
    );
    expect(status.find(item => item.capability === "VISION")?.status).toBe(
      "unsupported"
    );
    expect(CAPABILITIES).toContain("VOICE_REALTIME");
  });

  it("does not select an unconfigured provider", () => {
    const adapter = createForgeLLMAdapter(vi.fn(), false);
    expect(() =>
      resolveCapability("SMART_GENERAL", createCapabilityRegistry([adapter]))
    ).toThrowError("Capability SMART_GENERAL is not currently available.");
  });

  it("normalizes provider failures and keeps credentials out of errors", async () => {
    const invoke = vi
      .fn<(params: InvokeParams) => Promise<InvokeResult>>()
      .mockRejectedValue(
        new Error("401 Authorization Bearer secret-key-should-not-leak")
      );
    const adapter = configuredAdapter(invoke);

    await expect(adapter.invoke({ messages: [] })).rejects.toMatchObject({
      name: "JuniProviderError",
      category: "provider_error",
      message: "The requested AI service is temporarily unavailable.",
    });
    await expect(adapter.invoke({ messages: [] })).rejects.not.toThrow(
      "secret-key-should-not-leak"
    );
    expect(adapter.getHealth()).toMatchObject({
      state: "unhealthy",
      lastErrorCategory: "provider_error",
    });
  });

  it("keeps realtime voice outside the normal text adapter", () => {
    const adapter = configuredAdapter();
    expect(adapter.capabilities).not.toContain("VOICE_REALTIME");
    expect(() =>
      resolveCapability("VOICE_REALTIME", createCapabilityRegistry([adapter]))
    ).toThrowError(JuniProviderError);
  });
});
