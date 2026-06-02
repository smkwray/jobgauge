from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pandas as pd
from tenacity import retry, stop_after_attempt, wait_exponential

from labor_dashboard.models import Indicator
from labor_dashboard.providers.base import (
    DataProvider,
    ProviderResult,
    empty_frame,
    normalize_numeric,
    parse_year_period,
)
from labor_dashboard.settings import Settings


class BLSProvider(DataProvider):
    provider_id = "bls"
    api_url = "https://api.bls.gov/publicAPI/v2/timeseries/data/"

    def __init__(self, settings: Settings):
        self.settings = settings

    @retry(wait=wait_exponential(multiplier=1, min=1, max=12), stop=stop_after_attempt(3))
    def _post(self, payload: dict) -> dict:
        with httpx.Client(timeout=self.settings.request_timeout_seconds) as client:
            response = client.post(self.api_url, json=payload)
            response.raise_for_status()
            return response.json()

    def fetch_indicator(
        self,
        indicator: Indicator,
        start_year: int | None = None,
        end_year: int | None = None,
    ) -> ProviderResult:
        series_ids = _series_ids_for_indicator(indicator)
        if not series_ids:
            return ProviderResult(indicator, empty_frame(), message="missing BLS series_id")

        start = start_year or indicator.start_year or self.settings.default_start_year
        end = end_year or datetime.now(UTC).year
        chunks = list(_year_chunks(start, end, size=20))
        frames: list[pd.DataFrame] = []
        raw_payloads: list[dict] = []

        for chunk_start, chunk_end in chunks:
            for series_chunk in _chunks(series_ids, size=25):
                payload = {
                    "seriesid": series_chunk,
                    "startyear": str(chunk_start),
                    "endyear": str(chunk_end),
                    "catalog": True,
                    "calculations": False,
                    "annualaverage": False,
                }
                response = self._post_with_key_fallback(payload, raw_payloads)
                frames.append(_parse_bls_response(indicator, response))

        data = pd.concat(frames, ignore_index=True) if frames else empty_frame()
        if not data.empty:
            data = data.drop_duplicates(subset=["indicator_id", "date", "series_id"]).sort_values("date")
        return ProviderResult(indicator=indicator, data=data, raw_payload=raw_payloads)

    def save_raw_payload(self, indicator: Indicator, payload: object, raw_dir: Path) -> Path:
        raw_dir.mkdir(parents=True, exist_ok=True)
        path = raw_dir / f"{indicator.id}.bls.raw.json"
        path.write_text(json.dumps(payload, indent=2, default=str, allow_nan=False), encoding="utf-8")
        return path

    def _post_with_key_fallback(self, payload: dict, raw_payloads: list[dict]) -> dict:
        keys: list[str | None] = [*self.settings.bls_api_keys]
        if not keys:
            keys = [None]
        errors = []
        for key in keys:
            request_payload = dict(payload)
            if key:
                request_payload["registrationkey"] = key
            response = self._post(request_payload)
            raw_payloads.append(_redact_payload(response))
            status = response.get("status")
            if status == "REQUEST_SUCCEEDED":
                return response
            messages = [str(item) for item in response.get("message", [])]
            msg = "; ".join(messages) or f"BLS status={status}"
            errors.append(_redact_bls_message(msg))
            if not _is_key_related_failure(messages):
                break
        raise RuntimeError("; ".join(errors) if errors else "BLS request failed")


def _year_chunks(start_year: int, end_year: int, size: int = 20):
    current = start_year
    while current <= end_year:
        chunk_end = min(current + size - 1, end_year)
        yield current, chunk_end
        current = chunk_end + 1


def _chunks(items: list[str], size: int) -> list[list[str]]:
    return [items[index : index + size] for index in range(0, len(items), size)]


def _is_key_related_failure(messages: list[str]) -> bool:
    text = " ".join(messages).lower()
    return any(
        phrase in text
        for phrase in [
            "registration key",
            "daily threshold",
            "invalid key",
            "invalid registration",
        ]
    )


def _redact_bls_message(message: str) -> str:
    return re.sub(r"\b[a-fA-F0-9]{24,64}\b", "<redacted-key>", message)


def _redact_payload(payload: dict) -> dict:
    redacted = json.loads(json.dumps(payload, default=str))
    messages = redacted.get("message")
    if isinstance(messages, list):
        redacted["message"] = [_redact_bls_message(str(item)) for item in messages]
    return redacted


def _series_ids_for_indicator(indicator: Indicator) -> list[str]:
    configured = indicator.api_params.get("series_ids")
    if isinstance(configured, list):
        return [str(item) for item in configured if item]
    template = indicator.api_params.get("series_template")
    geographies = indicator.api_params.get("geographies")
    if template and isinstance(geographies, list):
        return [str(template).format(geo=str(geo)) for geo in geographies if geo]
    return [indicator.series_id] if indicator.series_id else []


def _parse_bls_response(indicator: Indicator, payload: dict) -> pd.DataFrame:
    rows = []
    series = payload.get("Results", {}).get("series", [])
    geography_by_series_id = _geography_by_series_id(indicator)
    for series_item in series:
        series_id = series_item.get("seriesID")
        for obs in series_item.get("data", []):
            obs_date = parse_year_period(obs.get("year"), obs.get("period", ""))
            if obs_date is None:
                continue
            footnotes = [note.get("text") or note.get("code") for note in obs.get("footnotes", []) if note]
            geography = geography_by_series_id.get(series_id)
            if geography:
                footnotes.append(f"geography={geography}")
            rows.append(
                {
                    "indicator_id": indicator.id,
                    "date": obs_date.isoformat(),
                    "value": normalize_numeric(obs.get("value")),
                    "source": indicator.source_id,
                    "series_id": series_id,
                    "frequency": indicator.frequency,
                    "seasonal_adjustment": indicator.seasonal_adjustment,
                    "units": indicator.units,
                    "realtime_start": None,
                    "realtime_end": None,
                    "footnotes": "; ".join([f for f in footnotes if f]),
                }
            )
    return pd.DataFrame(rows) if rows else empty_frame()


def _geography_by_series_id(indicator: Indicator) -> dict[str, str]:
    configured = indicator.api_params.get("geography_by_series_id", {})
    if isinstance(configured, dict) and configured:
        return {str(key): str(value) for key, value in configured.items()}
    template = indicator.api_params.get("series_template")
    geographies = indicator.api_params.get("geographies")
    geography_template = indicator.api_params.get("geography_template", "{geo}")
    if template and isinstance(geographies, list):
        return {
            str(template).format(geo=str(geo)): str(geography_template).format(geo=str(geo))
            for geo in geographies
            if geo
        }
    return {}
