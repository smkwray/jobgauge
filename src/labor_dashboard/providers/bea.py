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


class BEAProvider(DataProvider):
    provider_id = "bea"
    api_url = "https://apps.bea.gov/api/data/"

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
        if not self.settings.bea_api_key:
            raise RuntimeError("BEA_API_KEY is required for BEA provider")
        params = {
            "UserID": self.settings.bea_api_key,
            "method": "GetData",
            "ResultFormat": "JSON",
        }
        params.update(indicator.api_params)
        if "Year" not in params:
            start = start_year or indicator.start_year or self.settings.default_start_year
            end = end_year or datetime.now(UTC).year
            params["Year"] = ",".join(str(year) for year in range(start, end + 1))
        payload = self._get(params)
        records = payload.get("BEAAPI", {}).get("Results", {}).get("Data", [])

        series_code = indicator.api_params.get("SeriesCode") or indicator.series_id
        line_number = indicator.api_params.get("LineNumber")
        if series_code:
            records = [row for row in records if row.get("SeriesCode") == series_code]
        if line_number:
            records = [row for row in records if str(row.get("LineNumber")) == str(line_number)]

        rows = []
        for row in records:
            time_period = row.get("TimePeriod") or row.get("TimePeriodName")
            obs_date = _parse_bea_time_period(time_period)
            if obs_date is None:
                continue
            rows.append(
                {
                    "indicator_id": indicator.id,
                    "date": obs_date.isoformat(),
                    "value": normalize_numeric(row.get("DataValue")),
                    "source": indicator.source_id,
                    "series_id": series_code or indicator.series_id or row.get("SeriesCode"),
                    "frequency": indicator.frequency,
                    "seasonal_adjustment": indicator.seasonal_adjustment,
                    "units": indicator.units,
                    "realtime_start": None,
                    "realtime_end": None,
                    "footnotes": row.get("NoteRef", ""),
                }
            )
        data = pd.DataFrame(rows) if rows else empty_frame()
        if not data.empty:
            data = data.drop_duplicates(subset=["indicator_id", "date", "series_id"]).sort_values("date")
        return ProviderResult(indicator=indicator, data=data, raw_payload=payload)


def _parse_bea_time_period(value: object) -> date | None:
    if value is None:
        return None
    text = str(value)
    if "Q" in text and len(text) >= 6:
        year = int(text[:4])
        quarter = int(text[-1])
        return date(year, ((quarter - 1) * 3) + 1, 1)
    if "M" in text and len(text) >= 6:
        year = int(text[:4])
        month = int(text[-2:])
        return date(year, month, 1)
    if len(text) == 4 and text.isdigit():
        return date(int(text), 1, 1)
    return None
