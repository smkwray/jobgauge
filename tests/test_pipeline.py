import json
from pathlib import Path

from labor_dashboard.models import Indicator
from labor_dashboard.pipeline import refresh_indicators
from labor_dashboard.settings import Settings


def test_refresh_writes_summary_for_dry_run(tmp_path: Path) -> None:
    indicator = Indicator(
        id="demo_series",
        title="Demo series",
        provider="fred",
        source_id="fred_api",
        series_id="DEMO",
        group="test",
        frequency="M",
        units="Index",
    )
    processed = tmp_path / "processed"
    settings = Settings(
        LABOR_DASHBOARD_RAW_DIR=tmp_path / "raw",
        LABOR_DASHBOARD_PROCESSED_DIR=processed,
        LABOR_DASHBOARD_STATIC_DIR=tmp_path / "static",
        LABOR_DASHBOARD_SEARCH_DIR=tmp_path / "search",
    )

    results = refresh_indicators(
        [indicator],
        settings=settings,
        providers_filter={"fred"},
        dry_run=True,
        start_year=2020,
        limit=1,
    )

    summary = json.loads((processed / "refresh_summary.json").read_text(encoding="utf-8"))
    assert len(results) == 1
    assert summary["dry_run"] is True
    assert summary["filters"]["providers"] == ["fred"]
    assert summary["filters"]["start_year"] == 2020
    assert summary["status_counts"] == {"skipped": 1}
    assert summary["results"][0]["indicator_id"] == "demo_series"
