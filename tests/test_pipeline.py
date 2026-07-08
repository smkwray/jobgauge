import json
from pathlib import Path

from labor_dashboard.models import Indicator
from labor_dashboard.pipeline import read_static_fallback, refresh_indicators
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


def test_refresh_uses_static_fallback_after_provider_failure(tmp_path: Path, monkeypatch) -> None:
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
    static_series_dir = tmp_path / "static" / "series"
    static_series_dir.mkdir(parents=True)
    (static_series_dir / "demo_series.json").write_text(
        json.dumps(
            {
                "schema_version": "0.1",
                "indicator": indicator.model_dump(mode="json"),
                "observations": [
                    {
                        "indicator_id": "demo_series",
                        "date": "2024-01-01",
                        "value": 1.0,
                        "source": "fred_api",
                        "series_id": "DEMO",
                        "frequency": "M",
                        "seasonal_adjustment": None,
                        "units": "Index",
                        "realtime_start": None,
                        "realtime_end": None,
                        "footnotes": "",
                        "change_1": None,
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    settings = Settings(
        LABOR_DASHBOARD_RAW_DIR=tmp_path / "raw",
        LABOR_DASHBOARD_PROCESSED_DIR=tmp_path / "processed",
        LABOR_DASHBOARD_STATIC_DIR=tmp_path / "static",
        LABOR_DASHBOARD_SEARCH_DIR=tmp_path / "search",
    )

    class FailingProvider:
        def fetch_indicator(self, *_args, **_kwargs):
            raise RuntimeError("upstream 503")

    monkeypatch.setattr("labor_dashboard.pipeline.provider_registry", lambda _settings: {"fred": FailingProvider()})

    results = refresh_indicators([indicator], settings=settings, static_fallback_dir=tmp_path / "static")

    summary = json.loads((tmp_path / "processed" / "refresh_summary.json").read_text(encoding="utf-8"))
    assert results[0].status == "stale"
    assert results[0].observations == 1
    assert "upstream 503" in results[0].message
    assert summary["status_counts"] == {"stale": 1}
    assert (tmp_path / "processed" / "demo_series.parquet").exists()

    fallback = read_static_fallback(indicator, tmp_path / "static")
    assert fallback is not None
    assert "change_1" not in fallback.columns
