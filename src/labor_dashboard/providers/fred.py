from __future__ import annotations

from datetime import UTC, datetime

import httpx
import pandas as pd
from tenacity import retry, stop_after_attempt, wait_exponential

from labor_dashboard.models import Indicator
from labor_dashboard.providers.base import (
    DataProvider,
    ProviderResult,
    empty_frame,
    normalize_numeric,
    parse_iso_date,
)
from labor_dashboard.settings import Settings


class FREDProvider(DataProvider):
    provider_id = "fred"
    api_url = "https://api.stlouisfed.org/fred/series/observations"

    def __init__(self, settings: Settings):
        self.settings = settings

    @retry(wait=wait_exponential(multiplier=1, min=1, max=12), stop=stop_after_attempt(3))
    def _get(self, params: dict) -> dict:
        with httpx.Client(timeout=self.settings.request_timeout_seconds) as client:
            response = client.get(self.api_url, params=params)
            response.raise_for_status()
            return response.json()

    def fetch_indicator(
        self,
        indicator: Indicator,
        start_year: int | None = None,
        end_year: int | None = None,
    ) -> ProviderResult:
        if not indicator.series_id:
            return ProviderResult(indicator, empty_frame(), message="missing FRED series_id")
        if not self.settings.fred_api_key:
            raise RuntimeError("FRED_API_KEY is required for FRED provider")

        start = start_year or indicator.start_year or self.settings.default_start_year
        end = end_year or datetime.now(UTC).year
        params = {
            "series_id": indicator.series_id,
            "api_key": self.settings.fred_api_key,
            "file_type": "json",
            "observation_start": f"{start}-01-01",
            "observation_end": f"{end}-12-31",
        }
        payload = self._get(params)
        rows = []
        for obs in payload.get("observations", []):
            rows.append(
                {
                    "indicator_id": indicator.id,
                    "date": parse_iso_date(obs["date"]).isoformat(),
                    "value": normalize_numeric(obs.get("value")),
                    "source": indicator.source_id,
                    "series_id": indicator.series_id,
                    "frequency": indicator.frequency,
                    "seasonal_adjustment": indicator.seasonal_adjustment,
                    "units": indicator.units,
                    "realtime_start": obs.get("realtime_start"),
                    "realtime_end": obs.get("realtime_end"),
                    "footnotes": "",
                }
            )
        data = pd.DataFrame(rows) if rows else empty_frame()
        if not data.empty:
            data = data.drop_duplicates(subset=["indicator_id", "date", "series_id"]).sort_values("date")
        return ProviderResult(indicator=indicator, data=data, raw_payload=payload)
