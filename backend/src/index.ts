
interface Env {
  FRONTEND_ORIGIN?: string;
}

interface ElexonRow {
  startTime?: string;
  publishTime?: string;
  fuelType?: string;
  generation?: string | number | null;
}

interface WindRow {
  startTime: string;
  generation: number;
}

interface ForecastRow extends WindRow {
  publishTime: string;
}

const BASE_URL = "https://data.elexon.co.uk/bmrs/api/v1/datasets";
const START = Date.parse("2026-01-01T00:00:00Z");
const END = Date.parse("2026-02-01T00:00:00Z");

function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function corsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers();
  const origin = request.headers.get("Origin");
  const allowedOrigins = (
    env.FRONTEND_ORIGIN || "http://localhost:5173"
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (origin && allowedOrigins.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }

  headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");

  return headers;
}

function extractRecords(payload: unknown): ElexonRow[] {
  const rows =
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    "data" in payload
      ? (payload as { data: unknown }).data
      : payload;

  if (
    !Array.isArray(rows) ||
    rows.some(
      (row) => !row || typeof row !== "object" || Array.isArray(row),
    )
  ) {
    throw new Error("Unexpected Elexon response format");
  }

  return rows as ElexonRow[];
}

function timestamp(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

function numericGeneration(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;

  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function fetchElexon(
  dataset: "FUELHH" | "WINDFOR",
  params: Record<string, string>,
): Promise<ElexonRow[]> {
  const url = new URL(`${BASE_URL}/${dataset}/stream`);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  let response: Response;

  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new ApiError(504, "Elexon API request timed out");
    }
    throw new ApiError(502, "Could not connect to Elexon API");
  }

  if (!response.ok) {
    throw new ApiError(
      502,
      `Elexon API returned HTTP ${response.status}`,
    );
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    throw new ApiError(502, "Invalid response from Elexon API");
  }

  try {
    return extractRecords(payload);
  } catch {
    throw new ApiError(502, "Invalid response from Elexon API");
  }
}

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function getWindData() {
  const [actualRows, forecastRows] = await Promise.all([
    fetchElexon("FUELHH", {
      settlementDateFrom: "2026-01-01",
      settlementDateTo: "2026-01-31",
    }),
    fetchElexon("WINDFOR", {
      publishDateTimeFrom: "2025-12-31T00:00:00Z",
      publishDateTimeTo: "2026-02-01T00:00:00Z",
    }),
  ]);

  if (
    actualRows.some(
      (row) =>
        !("startTime" in row) ||
        !("fuelType" in row) ||
        !("generation" in row),
    ) ||
    forecastRows.some(
      (row) =>
        !("startTime" in row) ||
        !("publishTime" in row) ||
        !("generation" in row),
    )
  ) {
    throw new ApiError(
      502,
      "Elexon response is missing required fields",
    );
  }

  const actuals: WindRow[] = [];
  for (const row of actualRows) {
    if (String(row.fuelType).toUpperCase() !== "WIND") continue;

    const time = timestamp(row.startTime);
    const generation = numericGeneration(row.generation);

    if (
      time === null ||
      time < START ||
      time >= END ||
      generation === null
    ) {
      continue;
    }

    actuals.push({
      startTime: new Date(time).toISOString(),
      generation,
    });
  }

  const forecasts: ForecastRow[] = [];
  for (const row of forecastRows) {
    const time = timestamp(row.startTime);
    const published = timestamp(row.publishTime);
    const generation = numericGeneration(row.generation);

    if (
      time === null ||
      published === null ||
      time < START ||
      time >= END ||
      generation === null
    ) {
      continue;
    }

    // Only use forecasts published before the UTC delivery day.
    const deliveryDay = Date.parse(
      new Date(time).toISOString().slice(0, 10) + "T00:00:00Z",
    );

    if (published >= deliveryDay) continue;

    forecasts.push({
      startTime: new Date(time).toISOString(),
      publishTime: new Date(published).toISOString(),
      generation,
    });
  }

  // Preserve the Python implementation's duplicate-selection behavior.
  const actualByTime = new Map<string, WindRow>();
  for (const row of actuals) {
    actualByTime.set(row.startTime, row);
  }

  forecasts.sort(
    (a, b) => Date.parse(a.publishTime) - Date.parse(b.publishTime),
  );

  const forecastByTime = new Map<string, ForecastRow>();
  for (const row of forecasts) {
    forecastByTime.set(row.startTime, row);
  }

  const chartData = [...actualByTime.values()]
    .flatMap((actual) => {
      const forecast = forecastByTime.get(actual.startTime);
      if (!forecast) return [];

      return [{
        startTime: actual.startTime,
        actual_generation: actual.generation,
        forecast_generation: forecast.generation,
        error: actual.generation - forecast.generation,
      }];
    })
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));

  if (chartData.length === 0) {
    throw new ApiError(
      502,
      "No matching January actuals and eligible forecasts found",
    );
  }

  const errors = chartData.map((row) => row.error);
  const count = errors.length;
  const mae = errors.reduce((sum, error) => sum + Math.abs(error), 0) / count;
  const mse = errors.reduce((sum, error) => sum + error * error, 0) / count;
  const bias = errors.reduce((sum, error) => sum + error, 0) / count;

  return {
    metrics: {
      mae: round2(mae),
      rmse: round2(Math.sqrt(mse)),
      bias: round2(bias),
      sample_count: count,
    },
    chart_data: chartData,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const headers = corsHeaders(request, env);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    if (url.pathname !== "/api/wind-data") {
      return json({ error: "Not found" }, 404, headers);
    }

    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405, headers);
    }

    try {
      return json(await getWindData(), 200, headers);
    } catch (error) {
      if (error instanceof ApiError) {
        return json({ detail: error.message }, error.status, headers);
      }

      console.error("Unexpected wind-data API error:", error);
      return json({ detail: "Internal server error" }, 500, headers);
    }
  },
};
