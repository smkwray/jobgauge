import json
from pathlib import Path

import httpx
import pytest

from labor_dashboard.models import Indicator
from labor_dashboard.providers.base import parse_year_period
from labor_dashboard.providers.bls import (
    BLSProvider,
    _chunks,
    _geography_by_series_id,
    _is_key_related_failure,
    _parse_bls_response,
    _redact_bls_message,
    _redact_payload,
    _series_ids_for_indicator,
    _year_chunks,
)
from labor_dashboard.settings import Settings


def test_parse_year_period_skips_annual_average() -> None:
    assert parse_year_period("2024", "M13") is None
    assert parse_year_period("2024", "M01").isoformat() == "2024-01-01"
    assert parse_year_period("2024", "Q2").isoformat() == "2024-04-01"


def test_parse_bls_response_fixture() -> None:
    indicator = Indicator(
        id="unemployment_rate",
        title="Unemployment rate",
        provider="bls",
        source_id="bls_public_api",
        series_id="LNS14000000",
        group="core",
        frequency="M",
        units="Percent",
        seasonal_adjustment="SA",
    )
    payload = json.loads(Path("tests/fixtures/bls_timeseries.json").read_text(encoding="utf-8"))
    frame = _parse_bls_response(indicator, payload)
    assert len(frame) == 2
    assert frame.iloc[0]["indicator_id"] == "unemployment_rate"
    assert set(frame["date"]) == {"2024-01-01", "2024-02-01"}
    assert frame["value"].tolist() == [3.9, 3.7]


def test_multi_series_indicator_configuration() -> None:
    indicator = Indicator(
        id="laus_state_unemployment",
        title="State unemployment",
        provider="bls",
        source_id="bls_public_api",
        group="industry_state_local",
        frequency="M",
        units="Percent",
        api_params={"series_ids": ["LASST010000000000003", "LASST020000000000003"]},
    )

    assert _series_ids_for_indicator(indicator) == ["LASST010000000000003", "LASST020000000000003"]
    assert _chunks(["a", "b", "c"], 2) == [["a", "b"], ["c"]]


def test_year_chunks_stay_inside_bls_public_limit() -> None:
    assert list(_year_chunks(1994, 2026, size=10)) == [
        (1994, 2003),
        (2004, 2013),
        (2014, 2023),
        (2024, 2026),
    ]


def test_template_series_indicator_configuration() -> None:
    indicator = Indicator(
        id="laus_state_labor_force",
        title="State labor force",
        provider="bls",
        source_id="bls_public_api",
        group="industry_state_local",
        frequency="M",
        units="Persons",
        api_params={
            "series_template": "LASST{geo}0000000000006",
            "geographies": ["01", "06"],
            "geography_template": "state:{geo}",
        },
    )

    assert _series_ids_for_indicator(indicator) == ["LASST010000000000006", "LASST060000000000006"]
    assert _geography_by_series_id(indicator) == {
        "LASST010000000000006": "state:01",
        "LASST060000000000006": "state:06",
    }


def test_parse_bls_response_adds_geography_footnote() -> None:
    indicator = Indicator(
        id="laus_state_unemployment",
        title="State unemployment",
        provider="bls",
        source_id="bls_public_api",
        group="industry_state_local",
        frequency="M",
        units="Percent",
        api_params={"geography_by_series_id": {"LASST010000000000003": "state:01"}},
    )
    payload = {
        "Results": {
            "series": [
                {
                    "seriesID": "LASST010000000000003",
                    "data": [{"year": "2024", "period": "M01", "value": "3.1", "footnotes": [{}]}],
                }
            ]
        }
    }

    frame = _parse_bls_response(indicator, payload)

    assert frame.iloc[0]["series_id"] == "LASST010000000000003"
    assert frame.iloc[0]["footnotes"] == "geography=state:01"


def test_settings_bls_api_keys_dedupes_fallbacks() -> None:
    settings = Settings(BLS_API_KEY="primary", BLS_API_KEYS="secondary tertiary,primary")

    assert settings.bls_api_keys == ["primary", "secondary", "tertiary"]


def test_bls_provider_falls_back_on_key_failures() -> None:
    settings = Settings(BLS_API_KEY="expired", BLS_API_KEYS="working")
    provider = BLSProvider(settings)
    calls = []

    def fake_post(payload: dict) -> dict:
        calls.append(payload.get("registrationkey"))
        if payload.get("registrationkey") == "expired":
            return {"status": "REQUEST_FAILED", "message": ["Invalid registration key expired"]}
        return {"status": "REQUEST_SUCCEEDED", "Results": {"series": []}}

    provider._post = fake_post  # type: ignore[method-assign]

    raw_payloads = []
    response = provider._post_with_key_fallback({"seriesid": ["LNS14000000"]}, raw_payloads)

    assert response["status"] == "REQUEST_SUCCEEDED"
    assert calls == ["expired", "working"]
    assert raw_payloads[0]["message"] == ["Invalid registration key expired"]


def test_bls_provider_uses_urllib_fallback_on_transport_error(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = BLSProvider(Settings())

    class FailingClient:
        def __init__(self, *_args, **_kwargs) -> None:
            pass

        def __enter__(self) -> "FailingClient":
            return self

        def __exit__(self, *_args) -> None:
            pass

        def post(self, *_args, **_kwargs) -> None:
            raise httpx.ReadError("connection reset")

    def fake_urllib_post(payload: dict) -> dict:
        assert payload["seriesid"] == ["LNS14000000"]
        return {"status": "REQUEST_SUCCEEDED", "Results": {"series": []}}

    monkeypatch.setattr("labor_dashboard.providers.bls.httpx.Client", FailingClient)
    provider._post_with_urllib = fake_urllib_post  # type: ignore[method-assign]

    raw_payloads = []
    response = provider._post_with_key_fallback({"seriesid": ["LNS14000000"]}, raw_payloads)

    assert response["status"] == "REQUEST_SUCCEEDED"


def test_bls_message_redaction_helpers() -> None:
    message = "daily threshold allocated to key abcdef0123456789abcdef0123456789 has been reached"

    assert _is_key_related_failure([message])
    assert "abcdef" not in _redact_bls_message(message)
    redacted = _redact_payload({"message": [message]})
    assert redacted["message"] == ["daily threshold allocated to key <redacted-key> has been reached"]
