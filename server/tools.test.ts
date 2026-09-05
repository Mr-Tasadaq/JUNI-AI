import { describe, expect, it, vi } from "vitest";
import {
  executeTool,
  getToolMetadata,
  listToolMetadata,
  requiresConfirmationForRisk,
  ToolRegistryError,
} from "./tools";
import { WeatherAdapterError } from "./weather";

const authenticatedUser = { id: 7, role: "user" as const };
const normalizedWeather = {
  location: { latitude: 31.5204, longitude: 74.3587 },
  observedAt: "2026-09-06T00:00:00Z",
  timezone: "Asia/Karachi",
  condition: "Clear",
  temperatureC: 29.5,
  apparentTemperatureC: 31,
  humidityPercent: 55,
  windSpeedMps: 5,
  precipitationProbabilityPercent: 10,
};

vi.mock("./weather", async importOriginal => {
  const actual = await importOriginal<typeof import("./weather")>();
  return {
    ...actual,
    lookupCurrentWeather: vi.fn(async () => normalizedWeather),
  };
});

describe("JUNI secure Tool Registry", () => {
  it("maps risk levels to the required confirmation policy", () => {
    expect(requiresConfirmationForRisk("read_only")).toBe(false);
    expect(requiresConfirmationForRisk("external_side_effect")).toBe(true);
    expect(requiresConfirmationForRisk("sensitive_action")).toBe(true);
  });

  it("registers weather and device tools with safe read-only metadata", () => {
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
    expect(getToolMetadata("weather.lookup").inputSchema).toMatchObject({
      required: ["latitude", "longitude"],
      additionalProperties: false,
    });
  });

  it("fails closed for unknown names, malformed input, and unknown properties", async () => {
    await expect(
      executeTool("unknown.tool", {}, { user: authenticatedUser })
    ).rejects.toMatchObject({ code: "unknown_tool" });
    await expect(
      executeTool(
        "weather.lookup",
        { latitude: 91, longitude: 0 },
        { user: authenticatedUser }
      )
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      executeTool(
        "weather.lookup",
        { latitude: 0, longitude: 0, providerUrl: "https://attacker.example" },
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
    ).rejects.toMatchObject({
      code: "unauthenticated",
    });
  });

  it("executes weather through the authenticated server boundary", async () => {
    await expect(
      executeTool(
        "weather.lookup",
        { latitude: 31.5204, longitude: 74.3587 },
        { user: authenticatedUser }
      )
    ).resolves.toEqual({
      toolName: "weather.lookup",
      status: "ok",
      trustBoundary: "untrusted_external_data",
      data: normalizedWeather,
    });
  });

  it("preserves safe normalized adapter failures through the registry", async () => {
    const { lookupCurrentWeather } = await import("./weather");
    vi.mocked(lookupCurrentWeather).mockRejectedValueOnce(
      new WeatherAdapterError(
        "timeout",
        "The weather provider request timed out."
      )
    );
    await expect(
      executeTool(
        "weather.lookup",
        { latitude: 0, longitude: 0 },
        { user: authenticatedUser }
      )
    ).rejects.toMatchObject({
      code: "timeout",
      message: "The weather provider request timed out.",
    });
  });

  it("keeps authorization isolated across authenticated users", async () => {
    const first = await executeTool(
      "weather.lookup",
      { latitude: 0, longitude: 0 },
      { user: { id: 7, role: "user" } }
    );
    const second = await executeTool(
      "weather.lookup",
      { latitude: 0, longitude: 0 },
      { user: { id: 8, role: "user" } }
    );
    expect(first).toEqual(second);
    expect(first.data).not.toHaveProperty("ownerId");
    expect(second.data).not.toHaveProperty("userId");
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

  it("keeps unknown registry lookups typed as safe errors", () => {
    expect(() => getToolMetadata("unknown.tool")).toThrowError(
      ToolRegistryError
    );
  });
});
