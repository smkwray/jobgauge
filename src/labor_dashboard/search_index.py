from __future__ import annotations

import json
from collections.abc import Iterable
from pathlib import Path

from rapidfuzz import fuzz, process

from labor_dashboard.models import Indicator, Source


def indicator_to_search_doc(indicator: Indicator, source: Source | None = None, series_path: str | None = None) -> dict:
    fields = [
        indicator.title,
        indicator.short_title or "",
        indicator.id,
        indicator.series_id or "",
        indicator.group,
        indicator.subgroup or "",
        indicator.release or "",
        indicator.units,
        indicator.geography,
        " ".join(indicator.tags),
        " ".join(indicator.aliases),
        indicator.notes,
    ]
    haystack = " ".join([field for field in fields if field]).lower()
    return {
        "id": indicator.id,
        "title": indicator.title,
        "short_title": indicator.short_title or indicator.title,
        "provider": indicator.provider,
        "source_id": indicator.source_id,
        "source_title": source.title if source else indicator.source_id,
        "series_id": indicator.series_id,
        "group": indicator.group,
        "subgroup": indicator.subgroup,
        "priority": indicator.priority,
        "frequency": indicator.frequency,
        "units": indicator.units,
        "seasonal_adjustment": indicator.seasonal_adjustment,
        "geography": indicator.geography,
        "tags": indicator.tags,
        "aliases": indicator.aliases,
        "release": indicator.release,
        "chart": indicator.chart.model_dump(),
        "has_series": series_path is not None,
        "series_path": series_path,
        "haystack": haystack,
        "boost_terms": sorted(set([indicator.group, indicator.priority, *indicator.tags, *indicator.aliases])),
    }


def build_search_index(indicators: Iterable[Indicator], sources: dict[str, Source], series_path_by_indicator: dict[str, str] | None = None) -> list[dict]:
    series_paths = series_path_by_indicator or {}
    return [indicator_to_search_doc(indicator, sources.get(indicator.source_id), series_paths.get(indicator.id)) for indicator in indicators]


def write_search_index(docs: list[dict], output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / "index.json"
    path.write_text(json.dumps({"version": "0.1", "documents": docs}, indent=2, default=str, allow_nan=False), encoding="utf-8")
    return path


def query_index(docs: list[dict], query: str, limit: int = 10) -> list[dict]:
    choices = {doc["id"]: doc["haystack"] for doc in docs}
    matches = process.extract(query.lower(), choices, scorer=fuzz.WRatio, limit=limit)
    by_id = {doc["id"]: doc for doc in docs}
    results = []
    for _choice, score, indicator_id in matches:
        doc = dict(by_id[indicator_id])
        doc["score"] = score
        results.append(doc)
    return results
