from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path

import yaml

from labor_dashboard.models import Indicator, Source


class CatalogError(ValueError):
    pass


def _read_yaml(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}
    if not isinstance(data, dict):
        raise CatalogError(f"{path} must contain a YAML mapping")
    return data


def load_sources(catalog_dir: Path = Path("catalog")) -> dict[str, Source]:
    path = catalog_dir / "sources.yml"
    data = _read_yaml(path)
    raw_sources = data.get("sources", [])
    sources = [Source.model_validate(item) for item in raw_sources]
    return {source.id: source for source in sources}


def indicator_files(catalog_dir: Path = Path("catalog")) -> Iterable[Path]:
    indicators_dir = catalog_dir / "indicators"
    yield from sorted(indicators_dir.glob("*.yml"))
    yield from sorted(indicators_dir.glob("*.yaml"))


def load_indicators(catalog_dir: Path = Path("catalog")) -> list[Indicator]:
    records: list[Indicator] = []
    for path in indicator_files(catalog_dir):
        data = _read_yaml(path)
        for item in data.get("indicators", []):
            record = Indicator.model_validate(item)
            records.append(record)
    ids = [indicator.id for indicator in records]
    duplicates = sorted({item for item in ids if ids.count(item) > 1})
    if duplicates:
        raise CatalogError(f"duplicate indicator ids: {', '.join(duplicates)}")
    return records


def validate_catalog(catalog_dir: Path = Path("catalog")) -> tuple[list[Source], list[Indicator]]:
    sources = load_sources(catalog_dir)
    indicators = load_indicators(catalog_dir)
    missing_sources = sorted({indicator.source_id for indicator in indicators if indicator.source_id not in sources})
    if missing_sources:
        raise CatalogError(f"indicators reference missing sources: {', '.join(missing_sources)}")
    return list(sources.values()), indicators


def filter_indicators(
    indicators: list[Indicator],
    providers: set[str] | None = None,
    groups: set[str] | None = None,
    priorities: set[str] | None = None,
) -> list[Indicator]:
    filtered = indicators
    if providers:
        filtered = [indicator for indicator in filtered if indicator.provider in providers]
    if groups:
        filtered = [indicator for indicator in filtered if indicator.group in groups]
    if priorities:
        filtered = [indicator for indicator in filtered if indicator.priority in priorities]
    return filtered
