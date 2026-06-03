import json

from labor_dashboard.models import Indicator
from labor_dashboard.providers.dol import DOLProvider, _date_filter
from labor_dashboard.settings import Settings


def _indicator() -> Indicator:
    return Indicator(
        id="initial_claims_sa",
        title="Initial claims",
        provider="dol",
        source_id="dol_ui_claims",
        series_id="ETA/ui_national_weekly_claims/c5",
        group="core",
        frequency="W",
        units="Number",
        seasonal_adjustment="SA",
        start_year=2000,
        api_params={
            "agency": "ETA",
            "endpoint": "ui_national_weekly_claims",
            "date_field": "rptdate",
            "value_field": "c5",
            "limit": 2,
        },
    )


def test_date_filter_builds_dol_and_filter() -> None:
    payload = json.loads(_date_filter("rptdate", 2000, 2026))
    assert payload == {
        "and": [
            {"field": "rptdate", "operator": "gt", "value": "1999-12-31"},
            {"field": "rptdate", "operator": "lt", "value": "2027-01-01"},
        ]
    }


def test_fetch_indicator_paginates_and_normalizes() -> None:
    provider = DOLProvider(Settings(DOL_API_KEY="test-key"))
    calls = []

    def fake_get(agency: str, endpoint: str, params: dict) -> dict:
        calls.append((agency, endpoint, params))
        offset = int(params["offset"])
        rows = [
            {"rptdate": "2024-01-06", "c5": 200000},
            {"rptdate": "2024-01-13", "c5": "201,000"},
            {"rptdate": "2024-01-20", "c5": "."},
        ]
        return {"data": rows[offset : offset + int(params["limit"])]}

    provider._get = fake_get  # type: ignore[method-assign]
    result = provider.fetch_indicator(_indicator(), start_year=2024, end_year=2024)

    assert [call[0:2] for call in calls] == [
        ("ETA", "ui_national_weekly_claims"),
        ("ETA", "ui_national_weekly_claims"),
    ]
    assert calls[0][2]["fields"] == "rptdate,c5"
    assert "format" not in calls[0][2]
    assert "sort_by" not in calls[0][2]
    assert "sort" not in calls[0][2]
    assert "filter_object" not in calls[0][2]
    assert result.data["date"].tolist() == ["2024-01-06", "2024-01-13", "2024-01-20"]
    assert result.data["value"].tolist()[:2] == [200000.0, 201000.0]
    assert result.data["value"].isna().tolist()[2]
