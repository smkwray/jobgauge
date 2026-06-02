from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from labor_dashboard.models import Indicator, Source, StaticManifest
from labor_dashboard.transformations import add_standard_transforms, latest_snapshot


def _json_records(frame: pd.DataFrame) -> list[dict]:
    clean = frame.replace([float("inf"), -float("inf")], pd.NA).astype(object)
    clean = clean.where(pd.notna(clean), None)
    return clean.to_dict(orient="records")


def _write_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, indent=2, default=str, allow_nan=False), encoding="utf-8")


def write_indicator_metadata(indicators: list[Indicator], sources: dict[str, Source], static_dir: Path) -> Path:
    static_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": "0.1",
        "indicators": [indicator.model_dump(mode="json") for indicator in indicators],
        "sources": [source.model_dump(mode="json") for source in sources.values()],
    }
    path = static_dir / "catalog.json"
    _write_json(path, payload)
    return path


def _clean_series_dir(static_dir: Path) -> None:
    series_dir = static_dir / "series"
    if not series_dir.exists():
        return
    for path in series_dir.glob("*.json"):
        path.unlink()


def write_series_static(indicator: Indicator, frame: pd.DataFrame, static_dir: Path) -> Path:
    series_dir = static_dir / "series"
    series_dir.mkdir(parents=True, exist_ok=True)
    transformed = add_standard_transforms(frame, default_geography=indicator.geography)
    path = series_dir / f"{indicator.id}.json"
    payload = {
        "schema_version": "0.1",
        "indicator": indicator.model_dump(mode="json"),
        "observations": _json_records(transformed),
    }
    _write_json(path, payload)
    return path


def export_processed_to_static(
    indicators: list[Indicator],
    sources: dict[str, Source],
    processed_dir: Path,
    static_dir: Path,
    search_path: str = "../search/index.json",
    allowed_providers: set[str] | None = None,
) -> StaticManifest:
    static_dir.mkdir(parents=True, exist_ok=True)
    selected_indicators = [indicator for indicator in indicators if allowed_providers is None or indicator.provider in allowed_providers]
    selected_source_ids = {indicator.source_id for indicator in selected_indicators}
    selected_sources = {source_id: source for source_id, source in sources.items() if source_id in selected_source_ids}
    write_indicator_metadata(selected_indicators, selected_sources, static_dir)
    _clean_series_dir(static_dir)
    series_files: list[str] = []
    series_file_by_indicator: dict[str, str] = {}
    all_frames: list[pd.DataFrame] = []
    for indicator in selected_indicators:
        parquet_path = processed_dir / f"{indicator.id}.parquet"
        csv_path = processed_dir / f"{indicator.id}.csv"
        if parquet_path.exists():
            frame = pd.read_parquet(parquet_path)
        elif csv_path.exists():
            frame = pd.read_csv(csv_path)
        else:
            continue
        if frame.empty:
            continue
        out_path = write_series_static(indicator, frame, static_dir)
        relative_path = str(out_path.relative_to(static_dir))
        series_files.append(relative_path)
        series_file_by_indicator[indicator.id] = relative_path
        all_frames.append(add_standard_transforms(frame, default_geography=indicator.geography))

    if all_frames:
        combined = pd.concat(all_frames, ignore_index=True)
        latest = latest_snapshot(combined)
        _write_json(static_dir / "latest.json", {"schema_version": "0.1", "observations": _json_records(latest)})
    else:
        _write_json(static_dir / "latest.json", {"schema_version": "0.1", "observations": []})

    manifest = StaticManifest(
        indicators=len(selected_indicators),
        series_files=series_files,
        series_file_by_indicator=series_file_by_indicator,
        available_indicator_ids=list(series_file_by_indicator),
        search_index=search_path,
        profile="origin_only" if allowed_providers is not None else "hosted",
    )
    _write_json(static_dir / "manifest.json", manifest.model_dump(mode="json"))
    return manifest
