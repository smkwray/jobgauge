import json
import math
from pathlib import Path

import pandas as pd

from labor_dashboard.models import Indicator, Source
from labor_dashboard.static_export import export_processed_to_static
from labor_dashboard.transformations import add_standard_transforms, latest_snapshot


def _indicator() -> Indicator:
    return Indicator(
        id="demo_series",
        title="Demo series",
        provider="fred",
        source_id="fred_api",
        series_id="DEMO",
        group="test",
        frequency="M",
        units="Index",
    )


def _source() -> Source:
    return Source(id="fred_api", title="FRED", owner="FRB St. Louis", provider="fred", access="api")


def _bls_indicator() -> Indicator:
    return Indicator(
        id="bls_demo_series",
        title="BLS demo series",
        provider="bls",
        source_id="bls_api",
        series_id="BLSDEMO",
        group="test",
        frequency="M",
        units="Index",
    )


def _bls_source() -> Source:
    return Source(id="bls_api", title="BLS", owner="U.S. Bureau of Labor Statistics", provider="bls", access="api")


def _processed_frame(indicator_id: str, source_id: str, series_id: str) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "indicator_id": [indicator_id, indicator_id],
            "date": ["2024-01-01", "2024-02-01"],
            "value": [1.0, 2.0],
            "source": [source_id, source_id],
            "series_id": [series_id, series_id],
            "frequency": ["M", "M"],
            "seasonal_adjustment": [None, None],
            "units": ["Index", "Index"],
            "realtime_start": [None, None],
            "realtime_end": [None, None],
            "footnotes": ["", ""],
        }
    )


def _panel_frame() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "indicator_id": ["state_panel"] * 4,
            "date": ["2024-01-01", "2024-02-01", "2024-01-01", "2024-02-01"],
            "value": [1.0, 3.0, 10.0, 15.0],
            "source": ["bls_api"] * 4,
            "series_id": ["A", "A", "B", "B"],
            "frequency": ["M"] * 4,
            "seasonal_adjustment": [None] * 4,
            "units": ["Percent"] * 4,
            "realtime_start": [None] * 4,
            "realtime_end": [None] * 4,
            "footnotes": ["geography=state:01", "geography=state:01", "geography=state:02", "geography=state:02"],
        }
    )


def test_transforms_add_expected_columns() -> None:
    frame = pd.DataFrame(
        {
            "indicator_id": ["demo_series"] * 7,
            "date": [f"2024-{month:02d}-01" for month in range(1, 8)],
            "value": [100.0, 110.0, 121.0, 130.0, 141.0, 150.0, 165.0],
            "source": ["fred_api"] * 7,
            "series_id": ["DEMO"] * 7,
            "frequency": ["M"] * 7,
            "seasonal_adjustment": [None] * 7,
            "units": ["Index"] * 7,
            "realtime_start": [None] * 7,
            "realtime_end": [None] * 7,
            "footnotes": [""] * 7,
        }
    )
    transformed = add_standard_transforms(frame)
    assert "change_1" in transformed.columns
    assert transformed.loc[1, "change_1"] == 10.0
    assert transformed.loc[3, "change_3"] == 30.0
    assert transformed.loc[6, "change_6"] == 65.0
    assert math.isclose(transformed.loc[3, "pct_change_3"], 30.0)
    assert math.isclose(transformed.loc[6, "pct_change_6"], 65.0)
    assert transformed.loc[2, "index_first_100"] == 121.0
    latest = latest_snapshot(frame)
    assert latest.iloc[0]["date"] == "2024-07-01"


def test_transforms_are_entity_aware_for_panel_data() -> None:
    transformed = add_standard_transforms(_panel_frame())
    rows = transformed.sort_values(["geography", "date"]).reset_index(drop=True)

    assert rows.loc[1, "change_1"] == 2.0
    assert rows.loc[3, "change_1"] == 5.0
    assert rows.loc[2, "change_1"] is None or math.isnan(rows.loc[2, "change_1"])
    assert set(transformed["entity_key"]) == {"state_panel|state:01", "state_panel|state:02"}

    latest = latest_snapshot(transformed)
    assert len(latest) == 2
    assert set(latest["geography"]) == {"state:01", "state:02"}
    assert set(latest["date"]) == {"2024-02-01"}


def test_export_processed_to_static(tmp_path: Path) -> None:
    indicator = _indicator()
    source = _source()
    processed = tmp_path / "processed"
    static = tmp_path / "static"
    processed.mkdir()
    frame = _processed_frame("demo_series", "fred_api", "DEMO")
    frame.to_parquet(processed / "demo_series.parquet", index=False)
    manifest = export_processed_to_static([indicator], {source.id: source}, processed, static)
    assert manifest.series_files == ["series/demo_series.json"]
    assert manifest.available_indicator_ids == ["demo_series"]
    assert manifest.series_file_by_indicator == {"demo_series": "series/demo_series.json"}
    assert manifest.profile == "hosted"
    assert (static / "catalog.json").exists()
    payload = json.loads((static / "series" / "demo_series.json").read_text(encoding="utf-8"))
    assert payload["indicator"]["id"] == "demo_series"
    assert payload["observations"][1]["change_1"] == 1.0
    manifest_payload = json.loads((static / "manifest.json").read_text(encoding="utf-8"))
    assert manifest_payload["profile"] == "hosted"


def test_origin_only_export_filters_providers_and_removes_stale_series(tmp_path: Path) -> None:
    fred_indicator = _indicator()
    bls_indicator = _bls_indicator()
    fred_source = _source()
    bls_source = _bls_source()
    processed = tmp_path / "processed"
    static = tmp_path / "static"
    series_dir = static / "series"
    processed.mkdir()
    series_dir.mkdir(parents=True)

    _processed_frame("demo_series", "fred_api", "DEMO").to_parquet(processed / "demo_series.parquet", index=False)
    _processed_frame("bls_demo_series", "bls_api", "BLSDEMO").to_parquet(processed / "bls_demo_series.parquet", index=False)
    (series_dir / "demo_series.json").write_text("{}", encoding="utf-8")

    manifest = export_processed_to_static(
        [fred_indicator, bls_indicator],
        {fred_source.id: fred_source, bls_source.id: bls_source},
        processed,
        static,
        allowed_providers={"bls"},
    )

    assert manifest.indicators == 1
    assert manifest.series_files == ["series/bls_demo_series.json"]
    assert not (series_dir / "demo_series.json").exists()
    catalog = json.loads((static / "catalog.json").read_text(encoding="utf-8"))
    assert [indicator["id"] for indicator in catalog["indicators"]] == ["bls_demo_series"]
    assert [source["id"] for source in catalog["sources"]] == ["bls_api"]


def test_static_export_writes_strict_json_with_nulls_for_missing_values(tmp_path: Path) -> None:
    indicator = _indicator()
    source = _source()
    processed = tmp_path / "processed"
    static = tmp_path / "static"
    processed.mkdir()
    frame = _processed_frame("demo_series", "fred_api", "DEMO")
    frame.loc[1, "value"] = float("nan")
    frame.to_parquet(processed / "demo_series.parquet", index=False)

    export_processed_to_static([indicator], {source.id: source}, processed, static)

    for path in [static / "latest.json", static / "manifest.json", static / "catalog.json", static / "series" / "demo_series.json"]:
        payload = json.loads(path.read_text(encoding="utf-8"))
        assert payload
    series_payload = json.loads((static / "series" / "demo_series.json").read_text(encoding="utf-8"))
    assert series_payload["observations"][1]["value"] is None
