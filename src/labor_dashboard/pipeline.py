from __future__ import annotations

import json
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd

from labor_dashboard.models import Indicator, RefreshResult
from labor_dashboard.providers.base import empty_frame
from labor_dashboard.registry import provider_registry
from labor_dashboard.settings import Settings

PROCESSED_COLUMNS = list(empty_frame().columns)


def refresh_indicators(
    indicators: Iterable[Indicator],
    settings: Settings,
    providers_filter: set[str] | None = None,
    start_year: int | None = None,
    end_year: int | None = None,
    dry_run: bool = False,
    limit: int | None = None,
    static_fallback_dir: Path | None = None,
) -> list[RefreshResult]:
    settings.ensure_dirs()
    providers = provider_registry(settings)
    results: list[RefreshResult] = []
    selected = list(indicators)
    if providers_filter:
        selected = [indicator for indicator in selected if indicator.provider in providers_filter]
    if limit:
        selected = selected[:limit]

    for indicator in selected:
        if indicator.provider == "manual":
            results.append(RefreshResult(indicator_id=indicator.id, provider=indicator.provider, status="skipped", message="manual indicator"))
            continue
        if indicator.provider not in providers:
            results.append(RefreshResult(indicator_id=indicator.id, provider=indicator.provider, status="failed", message="unsupported provider"))
            continue
        if dry_run:
            msg = f"would fetch {indicator.provider}:{indicator.series_id or indicator.api_params}"
            results.append(RefreshResult(indicator_id=indicator.id, provider=indicator.provider, status="skipped", message=msg))
            continue
        try:
            result = providers[indicator.provider].fetch_indicator(indicator, start_year=start_year, end_year=end_year)
            output_path = write_processed(indicator, result.data, settings.processed_dir)
            write_raw_metadata(indicator, result.raw_payload, settings.raw_dir)
            results.append(
                RefreshResult(
                    indicator_id=indicator.id,
                    provider=indicator.provider,
                    status="fetched",
                    observations=len(result.data),
                    output_path=output_path,
                    message=result.message,
                )
            )
        except Exception as exc:  # noqa: BLE001 - CLI should continue and report all failures
            if static_fallback_dir is not None:
                try:
                    fallback_frame = read_static_fallback(indicator, static_fallback_dir)
                except Exception as fallback_exc:  # noqa: BLE001 - preserve original refresh failure in the summary
                    results.append(
                        RefreshResult(
                            indicator_id=indicator.id,
                            provider=indicator.provider,
                            status="failed",
                            message=f"{exc}; static fallback failed: {fallback_exc}",
                        )
                    )
                    continue
                if fallback_frame is not None:
                    output_path = write_processed(indicator, fallback_frame, settings.processed_dir)
                    results.append(
                        RefreshResult(
                            indicator_id=indicator.id,
                            provider=indicator.provider,
                            status="stale",
                            observations=len(fallback_frame),
                            output_path=output_path,
                            message=f"using existing static series after refresh failed: {exc}",
                        )
                    )
                    continue
            results.append(RefreshResult(indicator_id=indicator.id, provider=indicator.provider, status="failed", message=str(exc)))
    write_refresh_summary(
        results,
        settings.processed_dir,
        dry_run=dry_run,
        providers_filter=providers_filter,
        start_year=start_year,
        end_year=end_year,
        limit=limit,
        static_fallback_dir=static_fallback_dir,
    )
    return results


def write_processed(indicator: Indicator, frame: pd.DataFrame, processed_dir: Path) -> Path:
    processed_dir.mkdir(parents=True, exist_ok=True)
    path = processed_dir / f"{indicator.id}.parquet"
    if frame.empty:
        pd.DataFrame().to_parquet(path, index=False)
    else:
        frame.to_parquet(path, index=False)
    return path


def read_static_fallback(indicator: Indicator, static_dir: Path) -> pd.DataFrame | None:
    path = static_dir / "series" / f"{indicator.id}.json"
    if not path.exists():
        return None
    payload = json.loads(path.read_text(encoding="utf-8"))
    observations = payload.get("observations")
    if not isinstance(observations, list) or not observations:
        return None

    frame = pd.DataFrame.from_records(observations)
    if frame.empty:
        return None
    defaults = {
        "indicator_id": indicator.id,
        "source": indicator.source_id,
        "series_id": indicator.series_id,
        "frequency": indicator.frequency,
        "seasonal_adjustment": indicator.seasonal_adjustment,
        "units": indicator.units,
        "realtime_start": None,
        "realtime_end": None,
        "footnotes": "",
    }
    for column in PROCESSED_COLUMNS:
        if column not in frame.columns:
            frame[column] = defaults.get(column)
    frame["indicator_id"] = frame["indicator_id"].fillna(indicator.id)
    return frame[PROCESSED_COLUMNS]


def write_raw_metadata(indicator: Indicator, payload: object, raw_dir: Path) -> Path | None:
    if payload is None:
        return None
    raw_dir.mkdir(parents=True, exist_ok=True)
    path = raw_dir / f"{indicator.id}.raw.json"
    path.write_text(json.dumps(payload, indent=2, default=str, allow_nan=False), encoding="utf-8")
    return path


def write_refresh_summary(
    results: list[RefreshResult],
    processed_dir: Path,
    *,
    dry_run: bool,
    providers_filter: set[str] | None,
    start_year: int | None,
    end_year: int | None,
    limit: int | None,
    static_fallback_dir: Path | None,
) -> Path:
    processed_dir.mkdir(parents=True, exist_ok=True)
    status_counts: dict[str, int] = {}
    for result in results:
        status_counts[result.status] = status_counts.get(result.status, 0) + 1
    payload = {
        "schema_version": "0.1",
        "generated_at": datetime.now(UTC).isoformat(),
        "dry_run": dry_run,
        "filters": {
            "providers": sorted(providers_filter) if providers_filter else None,
            "start_year": start_year,
            "end_year": end_year,
            "limit": limit,
            "static_fallback_dir": str(static_fallback_dir) if static_fallback_dir is not None else None,
        },
        "status_counts": status_counts,
        "results": [result.model_dump(mode="json") for result in results],
    }
    path = processed_dir / "refresh_summary.json"
    path.write_text(json.dumps(payload, indent=2, default=str, allow_nan=False), encoding="utf-8")
    return path
