const GOOGLE_WEATHER_ORIGIN = "https://weather.googleapis.com";
const GOOGLE_WEATHER_PATH = "/v1/currentConditions:lookup";
const WEATHER_TIMEOUT_MS = 5_000;
const WEATHER_MAX_RESPONSE_BYTES = 64 * 1024;

export type WeatherLookupInput = {
  readonly latitude: number;
  readonly longitude: number;
};

export type WeatherResult = {
  readonly location: {
    readonly latitude: number;
    readonly longitude: number;
  };
  readonly observedAt: string | null;
  readonly timezone: string | null;
  readonly condition: string | null;
  readonly temperatureC: number | null;
  readonly apparentTemperatureC: number | null;
  readonly humidityPercent: number | null;
  readonly windSpeedMps: number | null;
  readonly precipitationProbabilityPercent: number | null;
};

export type WeatherAdapterErrorCode =
  | "invalid_input"
  | "configuration"
  | "timeout"
  | "rate_limited"
  | "provider_error"
  | "malformed_response";

export class WeatherAdapterError extends Error {
  readonly code: WeatherAdapterErrorCode;

  constructor(code: WeatherAdapterErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "WeatherAdapterError";
    this.code = code;
  }
}

type GoogleWeatherResponse = {
  currentTime?: unknown;
  timeZone?: { id?: unknown };
  weatherCondition?: { description?: { text?: unknown } };
  temperature?: { degrees?: unknown; unit?: unknown };
  feelsLikeTemperature?: { degrees?: unknown; unit?: unknown };
  relativeHumidity?: unknown;
  precipitation?: { probability?: { percent?: unknown } };
  wind?: { speed?: { value?: unknown; unit?: unknown } };
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function roundCoordinate(value: number): number {
  return Number(value.toFixed(6));
}

export function normalizeWeatherInput(
  input: WeatherLookupInput
): WeatherLookupInput {
  if (
    !isFiniteNumber(input.latitude) ||
    input.latitude < -90 ||
    input.latitude > 90 ||
    !isFiniteNumber(input.longitude) ||
    input.longitude < -180 ||
    input.longitude > 180
  ) {
    throw new WeatherAdapterError(
      "invalid_input",
      "Weather coordinates are outside the supported range."
    );
  }

  return {
    latitude: roundCoordinate(input.latitude),
    longitude: roundCoordinate(input.longitude),
  };
}

function optionalFiniteNumber(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function readResponseBody(response: Response): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    if (
      new TextEncoder().encode(text).byteLength > WEATHER_MAX_RESPONSE_BYTES
    ) {
      throw new WeatherAdapterError(
        "provider_error",
        "The weather provider response was too large."
      );
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > WEATHER_MAX_RESPONSE_BYTES) {
        throw new WeatherAdapterError(
          "provider_error",
          "The weather provider response was too large."
        );
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

function toMetersPerSecond(value: unknown, unit: unknown): number | null {
  if (!isFiniteNumber(value) || unit !== "KILOMETERS_PER_HOUR") return null;
  return Number((value / 3.6).toFixed(3));
}

function parseGoogleWeatherResponse(
  body: unknown,
  coordinates: WeatherLookupInput
): WeatherResult {
  if (!body || typeof body !== "object") {
    throw new WeatherAdapterError(
      "malformed_response",
      "The weather provider returned an unexpected response."
    );
  }

  const response = body as GoogleWeatherResponse;
  const temperature = response.temperature;
  const apparentTemperature = response.feelsLikeTemperature;
  const windSpeed = response.wind?.speed;
  const result: WeatherResult = {
    location: coordinates,
    observedAt: optionalString(response.currentTime),
    timezone: optionalString(response.timeZone?.id),
    condition: optionalString(response.weatherCondition?.description?.text),
    temperatureC:
      temperature?.unit === "CELSIUS"
        ? optionalFiniteNumber(temperature.degrees)
        : null,
    apparentTemperatureC:
      apparentTemperature?.unit === "CELSIUS"
        ? optionalFiniteNumber(apparentTemperature.degrees)
        : null,
    humidityPercent: optionalFiniteNumber(response.relativeHumidity),
    windSpeedMps: toMetersPerSecond(windSpeed?.value, windSpeed?.unit),
    precipitationProbabilityPercent: optionalFiniteNumber(
      response.precipitation?.probability?.percent
    ),
  };

  if (
    result.observedAt === null &&
    result.timezone === null &&
    result.condition === null &&
    result.temperatureC === null &&
    result.apparentTemperatureC === null &&
    result.humidityPercent === null &&
    result.windSpeedMps === null &&
    result.precipitationProbabilityPercent === null
  ) {
    throw new WeatherAdapterError(
      "malformed_response",
      "The weather provider returned an unusable response."
    );
  }

  return result;
}

export async function lookupCurrentWeather(
  input: WeatherLookupInput,
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<WeatherResult> {
  const coordinates = normalizeWeatherInput(input);
  if (!apiKey.trim()) {
    throw new WeatherAdapterError(
      "configuration",
      "Weather service configuration is unavailable."
    );
  }

  const url = new URL(GOOGLE_WEATHER_PATH, GOOGLE_WEATHER_ORIGIN);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("location.latitude", String(coordinates.latitude));
  url.searchParams.set("location.longitude", String(coordinates.longitude));
  url.searchParams.set("unitsSystem", "METRIC");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEATHER_TIMEOUT_MS);

  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        redirect: "error",
        signal: controller.signal,
      });
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error as Error)?.name === "AbortError"
      ) {
        throw new WeatherAdapterError(
          "timeout",
          "The weather provider request timed out.",
          error
        );
      }
      throw new WeatherAdapterError(
        "provider_error",
        "The weather provider request failed.",
        error
      );
    }

    if (response.status === 429) {
      throw new WeatherAdapterError(
        "rate_limited",
        "The weather provider is rate limiting requests."
      );
    }
    if (!response.ok) {
      throw new WeatherAdapterError(
        "provider_error",
        "The weather provider returned an unsuccessful response."
      );
    }

    const text = await readResponseBody(response);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch (error) {
      throw new WeatherAdapterError(
        "malformed_response",
        "The weather provider returned invalid data.",
        error
      );
    }
    return parseGoogleWeatherResponse(body, coordinates);
  } finally {
    clearTimeout(timeout);
  }
}

export const weatherAdapterInternals = {
  GOOGLE_WEATHER_ORIGIN,
  GOOGLE_WEATHER_PATH,
  WEATHER_TIMEOUT_MS,
};
