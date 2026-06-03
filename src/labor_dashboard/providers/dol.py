from __future__ import annotations

import json
from datetime import date

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


class DOLProvider(DataProvider):
    """Generic client for the modern DOL data portal.

    The DOL portal exposes dataset-specific endpoints discovered through the data catalog.
    For high-frequency national UI claims, the dashboard catalog also includes FRED fallback
    series such as ICSA and CCSA. Use this provider when a DOL endpoint/agency pair has been
    confirmed in the catalog.
    """

    provider_id = "dol"
    base_url = "https://apiprod.dol.gov/v4/get"

    def __init__(self, settings: Settings):
        self.settings = settings

    @retry(wait=wait_exponential(multiplier=1, min=1, max=12), stop=stop_after_attempt(3), reraise=True)
    def _get(self, agency: str, endpoint: str, params: dict) -> dict | list:
        if not self.settings.dol_api_key:
            raise RuntimeError("DOL_API_KEY is required for DOL data portal endpoints")
        params = {key: value for key, value in params.items() if value is not None}
        params["X-API-KEY"] = self.settings.dol_api_key
        with httpx.Client(timeout=self.settings.request_timeout_seconds) as client:
            response = client.get(f"{self.base_url}/{agency}/{endpoint}/json", params=params)
            if response.status_code == 429:
                raise RuntimeError("DOL API rate limit exceeded; wait before retrying")
            response.raise_for_status()
            return response.json()

    def fetch_indicator(
        self,
        indicator: Indicator,
        start_year: int | None = None,
        end_year: int | None = None,
    ) -> ProviderResult:
        agency = indicator.api_params.get("agency")
        endpoint = indicator.api_params.get("endpoint")
        date_field = indicator.api_params.get("date_field")
        value_field = indicator.api_params.get("value_field")
        if not all([agency, endpoint, date_field, value_field]):
            return ProviderResult(
                indicator=indicator,
                data=empty_frame(),
                message="DOL indicator requires agency, endpoint, date_field, and value_field api_params",
            )
        params = {
            k: v
            for k, v in indicator.api_params.items()
            if k not in {"agency", "endpoint", "date_field", "value_field"}
        }
        params.setdefault("fields", f"{date_field},{value_field}")
        params.setdefault("limit", 1000)

        records, raw_payloads = self._get_all_pages(str(agency), str(endpoint), params)
        rows = []
        for row in records:
            obs_date = _parse_date(row.get(date_field))
            if obs_date is None:
                continue
            if start_year is not None and obs_date.year < start_year:
                continue
            if end_year is not None and obs_date.year > end_year:
                continue
            rows.append(
                {
                    "indicator_id": indicator.id,
                    "date": obs_date.isoformat(),
                    "value": normalize_numeric(row.get(value_field)),
                    "source": indicator.source_id,
                    "series_id": indicator.series_id or f"dol:{agency}:{endpoint}:{value_field}",
                    "frequency": indicator.frequency,
                    "seasonal_adjustment": indicator.seasonal_adjustment,
                    "units": indicator.units,
                    "realtime_start": None,
                    "realtime_end": None,
                    "footnotes": "",
                }
            )
        data = pd.DataFrame(rows) if rows else empty_frame()
        if not data.empty:
            data = data.drop_duplicates(subset=["indicator_id", "date", "series_id"]).sort_values("date")
        return ProviderResult(indicator=indicator, data=data, raw_payload=raw_payloads)

    def _get_all_pages(self, agency: str, endpoint: str, params: dict) -> tuple[list[dict], list[dict | list]]:
        limit = int(params.get("limit", 10000))
        offset = int(params.get("offset", 0))
        records: list[dict] = []
        raw_payloads: list[dict | list] = []
        while True:
            page_params = dict(params)
            page_params["limit"] = limit
            page_params["offset"] = offset
            payload = self._get(agency, endpoint, page_params)
            raw_payloads.append(payload)
            page_records = _records_from_payload(payload)
            records.extend(page_records)
            if len(page_records) < limit:
                break
            offset += limit
        return records, raw_payloads


def _records_from_payload(payload: dict | list) -> list[dict]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    records = payload.get("data", payload.get("results", []))
    return [item for item in records if isinstance(item, dict)]


def _date_filter(date_field: str, start_year: int | None, end_year: int | None) -> str | None:
    conditions = []
    if start_year is not None:
        conditions.append({"field": date_field, "operator": "gt", "value": f"{start_year - 1}-12-31"})
    if end_year is not None:
        conditions.append({"field": date_field, "operator": "lt", "value": f"{end_year + 1}-01-01"})
    if not conditions:
        return None
    if len(conditions) == 1:
        return json.dumps(conditions[0])
    return json.dumps({"and": conditions})


def _parse_date(value: object) -> date | None:
    if value is None:
        return None
    try:
        return parse_iso_date(str(value))
    except ValueError:
        return None
