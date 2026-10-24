
import asyncio
import os

import httpx
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="GridBricks Wind Data API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.getenv(
            "FRONTEND_ORIGIN", "http://localhost:5173"
        ).split(",")
        if origin.strip()
    ],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)

BASE_URL = "https://data.elexon.co.uk/bmrs/api/v1/datasets"
START = pd.Timestamp("2026-01-01T00:00:00Z")
END = pd.Timestamp("2026-02-01T00:00:00Z")


def records(payload):
    if isinstance(payload, dict):
        payload = payload.get("data", [])
    if not isinstance(payload, list) or any(
        not isinstance(row, dict) for row in payload
    ):
        raise ValueError("Unexpected Elexon response format")
    return pd.DataFrame(payload)


@app.get("/api/wind-data")
async def get_wind_data():
    actual_params = {
        "settlementDateFrom": "2026-01-01",
        "settlementDateTo": "2026-01-31",
    }
    forecast_params = {
        "publishDateTimeFrom": "2025-12-31T00:00:00Z",
        "publishDateTimeTo": "2026-02-01T00:00:00Z",
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            actual_response, forecast_response = await asyncio.gather(
                client.get(
                    f"{BASE_URL}/FUELHH/stream", params=actual_params
                ),
                client.get(
                    f"{BASE_URL}/WINDFOR/stream", params=forecast_params
                ),
            )
            actual_response.raise_for_status()
            forecast_response.raise_for_status()
            actuals = records(actual_response.json())
            forecasts = records(forecast_response.json())

    except httpx.TimeoutException as exc:
        raise HTTPException(504, "Elexon API request timed out") from exc
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            502, f"Elexon API returned HTTP {exc.response.status_code}"
        ) from exc
    except httpx.RequestError as exc:
        raise HTTPException(502, "Could not connect to Elexon API") from exc
    except (ValueError, TypeError) as exc:
        raise HTTPException(502, "Invalid response from Elexon API") from exc

    required_actual = {"startTime", "fuelType", "generation"}
    required_forecast = {"startTime", "publishTime", "generation"}

    if not required_actual.issubset(actuals.columns) or not required_forecast.issubset(forecasts.columns):
        raise HTTPException(502, "Elexon response is missing required fields")

    actuals = actuals.loc[
        actuals["fuelType"].astype(str).str.upper() == "WIND",
        ["startTime", "generation"],
    ].copy()
    forecasts = forecasts[["startTime", "publishTime", "generation"]].copy()

    for df, columns in (
        (actuals, ["startTime"]),
        (forecasts, ["startTime", "publishTime"]),
    ):
        for column in columns:
            df[column] = pd.to_datetime(df[column], utc=True, errors="coerce")
        df.dropna(subset=columns, inplace=True)
        df["generation"] = pd.to_numeric(df["generation"], errors="coerce")
        df.replace([np.inf, -np.inf], np.nan, inplace=True)
        df.dropna(subset=["generation"], inplace=True)

    actuals = actuals.loc[
        (actuals["startTime"] >= START) & (actuals["startTime"] < END)
    ]
    forecasts = forecasts.loc[
        (forecasts["startTime"] >= START) & (forecasts["startTime"] < END)
    ].copy()

    # Use only forecasts published before the delivery day begins.
    # This prevents later updates from leaking into historical evaluation.
    cutoff = forecasts["startTime"].dt.normalize()
    forecasts = forecasts.loc[forecasts["publishTime"] < cutoff]

    actuals = actuals.drop_duplicates("startTime", keep="last")
    forecasts = forecasts.sort_values("publishTime").drop_duplicates(
        "startTime", keep="last"
    )

    merged = actuals.merge(
        forecasts[["startTime", "generation"]],
        on="startTime",
        how="inner",
        suffixes=("_actual", "_forecast"),
        validate="one_to_one",
    )

    if merged.empty:
        raise HTTPException(
            502, "No matching January actuals and eligible forecasts found"
        )

    merged.rename(
        columns={
            "generation_actual": "actual_generation",
            "generation_forecast": "forecast_generation",
        },
        inplace=True,
    )
    merged["error"] = (
        merged["actual_generation"] - merged["forecast_generation"]
    )

    error = merged["error"].to_numpy(dtype=float)
    metrics = {
        "mae": round(float(np.mean(np.abs(error))), 2),
        "rmse": round(float(np.sqrt(np.mean(error**2))), 2),
        "bias": round(float(np.mean(error)), 2),
        "sample_count": len(merged),
    }

    merged["startTime"] = merged["startTime"].dt.strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )

    return {"metrics": metrics, "chart_data": merged.to_dict("records")}
from workers import asgi

Default = asgi.entrypoint(app)