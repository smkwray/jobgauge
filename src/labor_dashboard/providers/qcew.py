from __future__ import annotations

from datetime import UTC, datetime
from io import StringIO

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


class QCEWProvider(DataProvider):
    provider_id = "qcew"
    base_url = "https://data.bls.gov/cew/data/api"

    def __init__(self, settings: Settings):
        self.settings = settings

    @retry(wait=wait_exponential(multiplier=1, min=1, max=12), stop=stop_after_attempt(3), reraise=True)
    def _get_csv(self, url: str) -> str:
        with httpx.Client(timeout=self.settings.request_timeout_seconds) as client:
            response = client.get(url)
            response.raise_for_status()
            return response.text

    def fetch_indicator(
        self,
        indicator: Indicator,
        start_year: int | None = None,
        end_year: int | None = None,
    ) -> ProviderResult:
        start = start_year or indicator.start_year or self.settings.default_start_year
        end = end_year or datetime.now(UTC).year
        slice_type = indicator.api_params.get("slice_type", "area")
        slice_code = indicator.api_params.get("slice_code", "US000")
        qtr = _normalize_qcew_qtr(indicator.api_params.get("qtr", "A"))
        value_field = indicator.api_params.get("value_field", "annual_avg_emplvl")

        rows = []
        missing_years = []
        for year in range(start, end + 1):
            url = f"{self.base_url}/{year}/{qtr}/{slice_type}/{slice_code}.csv"
            try:
                csv_text = self._get_csv(url)
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 404:
                    missing_years.append(year)
                    if rows:
                        break
                    continue
                raise
            frame = pd.read_csv(StringIO(csv_text), dtype={"area_fips": str, "industry_code": str})
            for _, row in frame.iterrows():
                if not _row_matches(row, indicator.api_params):
                    continue
                rows.append(
                    {
                        "indicator_id": indicator.id,
                        "date": f"{year}-01-01" if qtr == "a" else _quarter_start(year, int(qtr)),
                        "value": normalize_numeric(row.get(value_field)),
                        "source": indicator.source_id,
                        "series_id": indicator.series_id or f"qcew:{slice_type}:{slice_code}:{value_field}",
                        "frequency": indicator.frequency,
                        "seasonal_adjustment": indicator.seasonal_adjustment,
                        "units": indicator.units,
                        "realtime_start": None,
                        "realtime_end": None,
                        "footnotes": _qcew_footnotes(row),
                    }
                )
        data = pd.DataFrame(rows) if rows else empty_frame()
        message = f"stopped at missing QCEW year(s): {missing_years[:3]}" if missing_years else ""
        return ProviderResult(indicator=indicator, data=data.sort_values("date") if not data.empty else data, raw_payload=None, message=message)


def _normalize_qcew_qtr(value: object) -> str:
    text = str(value)
    return "a" if text.upper() == "A" else text


def _row_matches(row: pd.Series, params: dict) -> bool:
    for key in ["own_code", "industry_code", "agglvl_code", "size_code", "area_fips"]:
        if key in params and str(row.get(key)) != str(params[key]):
            return False
    return True


def _quarter_start(year: int, quarter: int) -> str:
    month = ((quarter - 1) * 3) + 1
    return f"{year}-{month:02d}-01"


def _qcew_footnotes(row: pd.Series) -> str:
    parts = []
    for key in ["area_fips", "industry_code", "own_code", "agglvl_code", "disclosure_code"]:
        if key in row and pd.notna(row[key]):
            parts.append(f"{key}={row[key]}")
    return "; ".join(parts)
