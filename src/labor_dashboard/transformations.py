from __future__ import annotations

import re

import pandas as pd

GEOGRAPHY_PATTERN = re.compile(r"(?:^|;\s*)geography=([^;]+)")


def _extract_geography(value: object) -> str | None:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    match = GEOGRAPHY_PATTERN.search(str(value))
    return match.group(1).strip() if match else None


def with_entity_fields(frame: pd.DataFrame, default_geography: str | None = None) -> pd.DataFrame:
    """Add stable geography/entity fields used by transforms, latest snapshots, and maps."""
    if frame.empty:
        return frame.copy()
    data = frame.copy()
    derived_geography = data["footnotes"].map(_extract_geography) if "footnotes" in data.columns else pd.Series([None] * len(data), index=data.index)
    if "geography" in data.columns:
        data["geography"] = data["geography"].where(pd.notna(data["geography"]), derived_geography)
    else:
        data["geography"] = derived_geography
    if default_geography:
        data["geography"] = data["geography"].fillna(default_geography)
    data["geography"] = data["geography"].fillna("US").astype(str)
    data["geo_id"] = data["geography"]
    data["geo_label"] = data["geography"]
    data["entity_key"] = data["indicator_id"].astype(str) + "|" + data["geography"]
    return data


def _entity_group_columns(frame: pd.DataFrame) -> list[str]:
    if "entity_key" in frame.columns:
        return ["indicator_id", "entity_key"]
    return ["indicator_id"]


def add_standard_transforms(frame: pd.DataFrame, default_geography: str | None = None) -> pd.DataFrame:
    """Add chart-ready transforms per indicator.

    Input must be long form with `indicator_id`, `date`, and `value`.
    Output preserves original rows and adds common derived columns that the frontend can use
    without recomputing: month/quarter/year-over-year changes, rolling means, and index-to-first.
    """
    if frame.empty:
        return frame
    data = with_entity_fields(frame, default_geography=default_geography)
    data["date"] = pd.to_datetime(data["date"])
    group_columns = _entity_group_columns(data)
    data = data.sort_values([*group_columns, "date"])
    grouped = data.groupby(group_columns, group_keys=False)
    data["change_1"] = grouped["value"].diff(1)
    data["pct_change_1"] = grouped["value"].pct_change(1) * 100
    data["change_4"] = grouped["value"].diff(4)
    data["pct_change_4"] = grouped["value"].pct_change(4) * 100
    data["change_12"] = grouped["value"].diff(12)
    data["pct_change_12"] = grouped["value"].pct_change(12) * 100
    data["rolling_3"] = grouped["value"].rolling(3, min_periods=1).mean().reset_index(level=group_columns, drop=True)
    data["rolling_4"] = grouped["value"].rolling(4, min_periods=1).mean().reset_index(level=group_columns, drop=True)
    data["rolling_6"] = grouped["value"].rolling(6, min_periods=1).mean().reset_index(level=group_columns, drop=True)
    data["rolling_12"] = grouped["value"].rolling(12, min_periods=1).mean().reset_index(level=group_columns, drop=True)

    first_values = grouped["value"].transform(lambda values: values.dropna().iloc[0] if values.dropna().size else pd.NA)
    data["index_first_100"] = data["value"] / first_values * 100
    data["date"] = data["date"].dt.date.astype(str)
    return data


def latest_snapshot(frame: pd.DataFrame) -> pd.DataFrame:
    if frame.empty:
        return frame
    data = with_entity_fields(frame)
    data["date"] = pd.to_datetime(data["date"])
    group_columns = _entity_group_columns(data)
    idx = data.sort_values([*group_columns, "date"]).groupby(group_columns).tail(1).index
    latest = data.loc[idx].sort_values(group_columns)
    latest["date"] = latest["date"].dt.date.astype(str)
    return latest
