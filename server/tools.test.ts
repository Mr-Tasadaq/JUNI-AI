import { describe, expect, it } from "vitest";
import {
  executeTool,
  getToolMetadata,
  listToolMetadata,
  requiresConfirmationForRisk,
  ToolRegistryError,
} from "./tools";

const authenticatedUser = { id: 7, role: "user" as const };

describe("JUNI secure Tool Registry", () => {
  it("maps risk levels to the required confirmation policy", () => {
    expect(requiresConfirmationForRisk("read_only")).toBe(false);
    expect(requiresConfirmationForRisk("external_side_effect")).toBe(true);
    expect(requiresConfirmationForRisk("sensitive_action")).toBe(true);
  });

  it("registers only the deterministic placeholder tools with safe metadata", () => {
    const metadata = listToolMetadata();

    expect(metadata.map(tool => tool.name)).toEqual([
      "weather.lookup",
      "device.status",
    ]);
    expect(metadata.every(tool => tool.requiresAuthentication)).toBe(true);
    expect(metadata.every(tool => tool.serverOnly)).toBe(true);
    expect(metadata.every(tool => tool.riskLevel === "read_only")).toBe(true);
    expect(metadata.every(tool => !tool.requiresConfirmation)).toBe(true);
    expect(JSON.stringify(metadata)).not.toMatch(
      /api[_-]?key|authorization|cookie|secret|password|token/i
    );
  });

  it("resolves a registered tool and exposes its confirmation policy", () => {
    expect(getToolMetadata("weather.lookup")).toMatchObject({
      name: "weather.lookup",
      riskLevel: "read_only",
      requiresAuthentication: true,
      requiresConfirmation: false,
      serverOnly: true,
    });
    expect(() => getToolMetadata("unknown.tool")).toThrowError(
      ToolRegistryError
    );
  });

  it("fails closed for unknown names and malformed input", async () => {
    await expect(
      executeTool("unknown.tool", {}, { user: authenticatedUser })
    ).rejects.toMatchObject({ code: "unknown_tool" });
    await expect(
      executeTool(
        "weather.lookup",
        { location: "", arbitrary: "nope" },
        { user: authenticatedUser }
      )
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      executeTool("device.status", { ownerId: 7 }, { user: authenticatedUser })
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("rejects unauthenticated execution before tool resolution", async () => {
    await expect(executeTool("device.status", {}, null)).rejects.toMatchObject({
      code: "unauthenticated",
    });
    await expect(
      executeTool("unknown.tool", {}, undefined)
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("executes the deterministic weather placeholder through the authenticated server boundary", async () => {
    await expect(
      executeTool(
        "weather.lookup",
        { location: "Lahore" },
        { user: authenticatedUser }
      )
    ).resolves.toEqual({
      toolName: "weather.lookup",
      status: "ok",
      trustBoundary: "untrusted_external_data",
      data: {
        location: "Lahore",
        status: "placeholder",
        temperature: null,
        source: "deterministic_tool_fixture",
      },
    });
  });

  it("returns normalized deterministic device status without caller identity fields", async () => {
    const first = await executeTool(
      "device.status",
      {},
      { user: authenticatedUser }
    );
    const second = await executeTool(
      "device.status",
      {},
      { user: { id: 88, role: "user" } }
    );

    expect(first).toEqual(second);
    expect(first.data).not.toHaveProperty("ownerId");
    expect(first.data).not.toHaveProperty("userId");
  });

  it("does not allow caller-supplied identity to override server context", async () => {
    await expect(
      executeTool(
        "weather.lookup",
        { location: "Lahore", userId: 999, ownerId: 999 },
        { user: authenticatedUser }
      )
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("keeps authorization isolated across authenticated users", async () => {
    const first = await executeTool(
      "weather.lookup",
      { location: "Lahore" },
      { user: { id: 7, role: "user" } }
    );
    const second = await executeTool(
      "weather.lookup",
      { location: "Lahore" },
      { user: { id: 8, role: "user" } }
    );

    expect(first).toEqual(second);
    expect(first.data).not.toHaveProperty("ownerId");
    expect(second.data).not.toHaveProperty("ownerId");
  });

  it("has no public dynamic execution surface", () => {
    expect(listToolMetadata().every(tool => tool.name.includes("."))).toBe(
      true
    );
    expect(listToolMetadata()).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: expect.stringMatching(/shell|eval|exec/i),
        }),
      ])
    );
  });
});
