from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date

import pandas as pd

from labor_dashboard.models import Indicator


@dataclass
class ProviderResult:
    indicator: Indicator
    data: pd.DataFrame
    raw_payload: object | None = None
    message: str = ""


def empty_frame() -> pd.DataFrame:
    return pd.DataFrame(
        columns=[
            "indicator_id",
            "date",
            "value",
            "source",
            "series_id",
            "frequency",
            "seasonal_adjustment",
            "units",
            "realtime_start",
            "realtime_end",
            "footnotes",
        ]
    )


class DataProvider(ABC):
    provider_id: str

    @abstractmethod
    def fetch_indicator(
        self,
        indicator: Indicator,
        start_year: int | None = None,
        end_year: int | None = None,
    ) -> ProviderResult:
        raise NotImplementedError


def normalize_numeric(value: object) -> float | None:
    if value is None:
        return None
    if isinstance(value, str):
        value = value.replace(",", "").strip()
        if value in {"", ".", "NA", "N/A", "null"}:
            return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_year_period(year: str | int, period: str) -> date | None:
    y = int(year)
    p = period.upper()
    if p.startswith("M"):
        month = int(p[1:])
        if month == 13:
            return None
        return date(y, month, 1)
    if p.startswith("Q"):
        quarter = int(p[1:])
        return date(y, ((quarter - 1) * 3) + 1, 1)
    if p in {"A", "A01"}:
        return date(y, 1, 1)
    return None


def parse_iso_date(value: str) -> date:
    return date.fromisoformat(value[:10])
