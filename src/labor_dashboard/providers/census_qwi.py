from __future__ import annotations

from datetime import UTC, date, datetime

import httpx
import pandas as pd
from tenacity import retry, stop_after_attempt, wait_exponential

from labor_dashboard.models import Indicator
from labor_dashboard.providers.base import (
    DataProvider,
    ProviderResult,
    empty_frame,
    normalize_numeric,
)
from labor_dashboard.settings import Settings


class CensusQWIProvider(DataProvider):
    provider_id = "census_qwi"
    base_url = "https://api.census.gov/data/timeseries/qwi"

    def __init__(self, settings: Settings):
        self.settings = settings

    @retry(wait=wait_exponential(multiplier=1, min=1, max=12), stop=stop_after_attempt(3), reraise=True)
    def _get(self, endpoint: str, params: dict) -> list[list[str]]:
        with httpx.Client(timeout=self.settings.request_timeout_seconds) as client:
            response = client.get(f"{self.base_url}/{endpoint}", params=params)
            if response.status_code == 204:
                return []
            response.raise_for_status()
            return response.json()

    def fetch_indicator(
        self,
        indicator: Indicator,
        start_year: int | None = None,
        end_year: int | None = None,
    ) -> ProviderResult:
        endpoint = indicator.api_params.get("endpoint", "sa")
        qwi_get = indicator.api_params.get("get", "Emp")
        geography_for = indicator.api_params.get("for", "state:*")
        geography_in = indicator.api_params.get("in")
        start = start_year or indicator.start_year or self.settings.default_start_year
        end = end_year or datetime.now(UTC).year

        base_params = {
            "get": qwi_get,
            "time": f"from {start}-Q1 to {end}-Q4",
        }
        if geography_in:
            base_params["in"] = geography_in
        for key, value in indicator.api_params.items():
            if key not in {"endpoint", "get", "for", "in"}:
                base_params[key] = value
        if self.settings.census_api_key:
            base_params["key"] = self.settings.census_api_key

        payload = self._get_many(endpoint, base_params, geography_for)
        if not payload:
            return ProviderResult(indicator=indicator, data=empty_frame(), raw_payload=payload)
        header = payload[0]
        records = [dict(zip(header, row, strict=False)) for row in payload[1:]]
        value_field = qwi_get.split(",")[0]
        rows = []
        for row in records:
            obs_date = _parse_qwi_time(row.get("time") or _compose_qwi_time(row))
            if obs_date is None:
                continue
            geography_bits = [row.get("state"), row.get("county"), row.get("metropolitan statistical area/micropolitan statistical area")]
            geo = ":".join([bit for bit in geography_bits if bit]) or indicator.geography
            rows.append(
                {
                    "indicator_id": indicator.id,
                    "date": obs_date.isoformat(),
                    "value": normalize_numeric(row.get(value_field)),
                    "source": indicator.source_id,
                    "series_id": indicator.series_id or value_field,
                    "frequency": indicator.frequency,
                    "seasonal_adjustment": indicator.seasonal_adjustment,
                    "units": indicator.units,
                    "realtime_start": None,
                    "realtime_end": None,
                    "footnotes": f"geography={geo}",
                }
            )
        data = pd.DataFrame(rows) if rows else empty_frame()
        if not data.empty:
            data = data.sort_values(["indicator_id", "date"])
        return ProviderResult(indicator=indicator, data=data, raw_payload=payload)

    def _get_many(self, endpoint: str, base_params: dict, geography_for: str) -> list[list[str]]:
        geographies = _expand_qwi_geographies(geography_for)
        combined_header: list[str] | None = None
        combined_rows: list[list[str]] = []
        for geography in geographies:
            params = dict(base_params)
            params["for"] = geography
            payload = self._get(endpoint, params)
            if not payload:
                continue
            header, rows = payload[0], payload[1:]
            if combined_header is None:
                combined_header = header
            elif combined_header != header:
                raise RuntimeError(f"QWI response header changed for geography {geography}")
            combined_rows.extend(rows)
        return [combined_header, *combined_rows] if combined_header else []


def _expand_qwi_geographies(geography_for: str) -> list[str]:
    if geography_for == "state:*":
        return [f"state:{state}" for state in STATE_FIPS]
    return [geography_for]


STATE_FIPS = [
    "01",
    "02",
    "04",
    "05",
    "06",
    "08",
    "09",
    "10",
    "11",
    "12",
    "13",
    "15",
    "16",
    "17",
    "18",
    "19",
    "20",
    "21",
    "22",
    "23",
    "24",
    "25",
    "26",
    "27",
    "28",
    "29",
    "30",
    "31",
    "32",
    "33",
    "34",
    "35",
    "36",
    "37",
    "38",
    "39",
    "40",
    "41",
    "42",
    "44",
    "45",
    "46",
    "47",
    "48",
    "49",
    "50",
    "51",
    "53",
    "54",
    "55",
    "56",
    "72",
]


def _compose_qwi_time(row: dict) -> str | None:
    if row.get("year") and row.get("quarter"):
        return f"{row['year']}-Q{row['quarter']}"
    return None


def _parse_qwi_time(value: object) -> date | None:
    if value is None:
        return None
    text = str(value)
    if "Q" not in text:
        return None
    year = int(text[:4])
    quarter = int(text[-1])
    return date(year, ((quarter - 1) * 3) + 1, 1)
