from labor_dashboard.providers.census_qwi import _expand_qwi_geographies
from labor_dashboard.providers.qcew import _normalize_qcew_qtr


def test_qcew_normalizes_annual_slice_code() -> None:
    assert _normalize_qcew_qtr("A") == "a"
    assert _normalize_qcew_qtr("a") == "a"
    assert _normalize_qcew_qtr("1") == "1"


def test_qwi_expands_state_wildcard() -> None:
    states = _expand_qwi_geographies("state:*")
    assert "state:01" in states
    assert "state:56" in states
    assert all(state.startswith("state:") for state in states)
    assert _expand_qwi_geographies("state:01") == ["state:01"]
