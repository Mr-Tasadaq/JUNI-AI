import { describe, expect, it, vi } from "vitest";
import {
  lookupCurrentWeather,
  WeatherAdapterError,
  weatherAdapterInternals,
} from "./weather";

const apiKey = "test-google-weather-key";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const providerPayload = {
  currentTime: "2026-09-06T00:00:00Z",
  timeZone: { id: "Asia/Karachi" },
  weatherCondition: { description: { text: "Clear" } },
  temperature: { degrees: 29.5, unit: "CELSIUS" },
  feelsLikeTemperature: { degrees: 31, unit: "CELSIUS" },
  relativeHumidity: 55,
  precipitation: { probability: { percent: 10, type: "RAIN" } },
  wind: { speed: { value: 18, unit: "KILOMETERS_PER_HOUR" } },
};

describe("Google Weather adapter", () => {
  it("normalizes a valid provider response into the JUNI DTO", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(providerPayload));

    await expect(
      lookupCurrentWeather(
        { latitude: 31.5204, longitude: 74.3587 },
        apiKey,
        fetchMock
      )
    ).resolves.toEqual({
      location: { latitude: 31.5204, longitude: 74.3587 },
      observedAt: "2026-09-06T00:00:00Z",
      timezone: "Asia/Karachi",
      condition: "Clear",
      temperatureC: 29.5,
      apparentTemperatureC: 31,
      humidityPercent: 55,
      windSpeedMps: 5,
      precipitationProbabilityPercent: 10,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      `${weatherAdapterInternals.GOOGLE_WEATHER_ORIGIN}${weatherAdapterInternals.GOOGLE_WEATHER_PATH}?key=${apiKey}&location.latitude=31.5204&location.longitude=74.3587&unitsSystem=METRIC`
    );
    expect(init).toMatchObject({ method: "GET", redirect: "error" });
  });

  it.each([
    ["invalid latitude", { latitude: 90.1, longitude: 0 }],
    ["invalid longitude", { latitude: 0, longitude: 180.1 }],
    ["NaN latitude", { latitude: Number.NaN, longitude: 0 }],
    [
      "infinite longitude",
      { latitude: 0, longitude: Number.POSITIVE_INFINITY },
    ],
  ])("rejects %s", async (_label, coordinates) => {
    const fetchMock = vi.fn<typeof fetch>();
    await expect(
      lookupCurrentWeather(coordinates, apiKey, fetchMock)
    ).rejects.toMatchObject({
      code: "invalid_input",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails safely when configuration is missing", async () => {
    await expect(
      lookupCurrentWeather({ latitude: 0, longitude: 0 }, "", vi.fn())
    ).rejects.toMatchObject({
      code: "configuration",
      message: "Weather service configuration is unavailable.",
    });
  });

  it("normalizes provider timeout without exposing provider details", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(
      Object.assign(new Error("socket timeout with secret body"), {
        name: "AbortError",
      })
    );

    await expect(
      lookupCurrentWeather({ latitude: 0, longitude: 0 }, apiKey, fetchMock)
    ).rejects.toMatchObject({
      code: "timeout",
      message: "The weather provider request timed out.",
    });
  });

  it("maps provider rate limiting to a safe error", async () => {
    await expect(
      lookupCurrentWeather(
        { latitude: 0, longitude: 0 },
        apiKey,
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(response({ error: "raw provider body" }, 429))
      )
    ).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("maps other provider HTTP failures without returning the provider body", async () => {
    const rawBody = `provider failure ${apiKey}`;
    const error = await lookupCurrentWeather(
      { latitude: 0, longitude: 0 },
      apiKey,
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: rawBody }), { status: 503 })
        )
    ).catch(value => value as WeatherAdapterError);

    expect(error).toMatchObject({
      code: "provider_error",
      message: "The weather provider returned an unsuccessful response.",
    });
    expect(error.message).not.toContain(rawBody);
    expect(JSON.stringify(error)).not.toContain(apiKey);
  });

  it("rejects malformed provider responses without returning raw data", async () => {
    const rawBody = "provider-debug-secret-payload";
    const error = await lookupCurrentWeather(
      { latitude: 0, longitude: 0 },
      apiKey,
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ rawBody }), { status: 200 })
        )
    ).catch(value => value as WeatherAdapterError);

    expect(error).toMatchObject({
      code: "malformed_response",
      message: "The weather provider returned an unusable response.",
    });
    expect(error.message).not.toContain(rawBody);
    expect(JSON.stringify(error)).not.toContain(apiKey);
  });

  it("does not accept a caller-controlled provider URL", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(providerPayload));
    await lookupCurrentWeather(
      { latitude: 0, longitude: 0 },
      apiKey,
      fetchMock
    );
    expect(String(fetchMock.mock.calls[0][0])).toMatch(
      /^https:\/\/weather\.googleapis\.com\/v1\/currentConditions:lookup\?/
    );
  });
});
