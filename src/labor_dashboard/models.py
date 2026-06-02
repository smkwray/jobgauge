from __future__ import annotations

from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

Provider = Literal["bls", "fred", "bea", "census_qwi", "qcew", "dol", "manual"]
Frequency = Literal["D", "W", "M", "Q", "A", "IRREGULAR"]


class Source(BaseModel):
    id: str
    title: str
    owner: str
    provider: Provider
    access: str
    api_key_env: str | None = None
    documentation_url: str | None = None
    notes: str = ""
    update_frequency: str | None = None
    preferred_for: list[str] = Field(default_factory=list)


class ChartSpec(BaseModel):
    default_type: str = "line"
    recommended: list[str] = Field(default_factory=lambda: ["line"])
    y_axis_label: str | None = None
    show_recession_bands: bool = False
    allow_geography_filter: bool = False
    allow_demographic_filter: bool = False
    allow_industry_filter: bool = False
    transformations: list[str] = Field(default_factory=list)


class Indicator(BaseModel):
    id: str
    title: str
    short_title: str | None = None
    provider: Provider
    source_id: str
    series_id: str | None = None
    group: str
    subgroup: str | None = None
    priority: Literal["core", "recommended", "extended", "experimental"] = "recommended"
    frequency: Frequency
    units: str
    seasonal_adjustment: str | None = None
    geography: str = "US"
    start_year: int | None = None
    release: str | None = None
    source_url: str | None = None
    documentation_url: str | None = None
    tags: list[str] = Field(default_factory=list)
    aliases: list[str] = Field(default_factory=list)
    notes: str = ""
    api_params: dict[str, Any] = Field(default_factory=dict)
    chart: ChartSpec = Field(default_factory=ChartSpec)

    @field_validator("id")
    @classmethod
    def id_must_be_slug(cls, value: str) -> str:
        allowed = set("abcdefghijklmnopqrstuvwxyz0123456789_-")
        if not value or any(ch not in allowed for ch in value):
            raise ValueError("indicator id must be lowercase slug with letters, digits, - or _")
        return value

    @property
    def display_title(self) -> str:
        return self.short_title or self.title


class Observation(BaseModel):
    indicator_id: str
    date: date
    value: float | None
    source: str
    series_id: str | None = None
    frequency: Frequency
    seasonal_adjustment: str | None = None
    units: str | None = None
    realtime_start: date | None = None
    realtime_end: date | None = None
    footnotes: list[str] = Field(default_factory=list)
    raw: dict[str, Any] = Field(default_factory=dict)


class RefreshResult(BaseModel):
    indicator_id: str
    provider: Provider
    status: Literal["skipped", "fetched", "failed"]
    observations: int = 0
    output_path: Path | None = None
    message: str = ""


class StaticManifest(BaseModel):
    generated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    indicators: int = 0
    series_files: list[str] = Field(default_factory=list)
    series_file_by_indicator: dict[str, str] = Field(default_factory=dict)
    available_indicator_ids: list[str] = Field(default_factory=list)
    search_index: str = "../search/index.json"
    profile: Literal["hosted", "origin_only"] = "hosted"
    schema_version: str = "0.1"
