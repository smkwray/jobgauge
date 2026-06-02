#!/usr/bin/env python3
"""jobgauge_data.py — read-only CLI over jobgauge's bundled static JSON.

The tool intentionally uses only Python's standard library. It never performs
network calls, never writes into site/public/data, and treats catalog/manifest
metadata as authoritative for labels, source attribution, units, frequency,
seasonal adjustment, and geography.
"""
from __future__ import annotations

import argparse
import ast
import csv
import html
import json
import math
import os
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

VERSION = "0.1.0"
VARS = "abcdefgh"

STATE_TO_FIPS = {
    "alabama": "state:01", "al": "state:01",
    "alaska": "state:02", "ak": "state:02",
    "arizona": "state:04", "az": "state:04",
    "arkansas": "state:05", "ar": "state:05",
    "california": "state:06", "ca": "state:06",
    "colorado": "state:08", "co": "state:08",
    "connecticut": "state:09", "ct": "state:09",
    "delaware": "state:10", "de": "state:10",
    "district of columbia": "state:11", "dc": "state:11", "washington dc": "state:11",
    "florida": "state:12", "fl": "state:12",
    "georgia": "state:13", "ga": "state:13",
    "hawaii": "state:15", "hi": "state:15",
    "idaho": "state:16", "id": "state:16",
    "illinois": "state:17", "il": "state:17",
    "indiana": "state:18", "in": "state:18",
    "iowa": "state:19", "ia": "state:19",
    "kansas": "state:20", "ks": "state:20",
    "kentucky": "state:21", "ky": "state:21",
    "louisiana": "state:22", "la": "state:22",
    "maine": "state:23", "me": "state:23",
    "maryland": "state:24", "md": "state:24",
    "massachusetts": "state:25", "ma": "state:25",
    "michigan": "state:26", "mi": "state:26",
    "minnesota": "state:27", "mn": "state:27",
    "mississippi": "state:28", "ms": "state:28",
    "missouri": "state:29", "mo": "state:29",
    "montana": "state:30", "mt": "state:30",
    "nebraska": "state:31", "ne": "state:31",
    "nevada": "state:32", "nv": "state:32",
    "new hampshire": "state:33", "nh": "state:33",
    "new jersey": "state:34", "nj": "state:34",
    "new mexico": "state:35", "nm": "state:35",
    "new york": "state:36", "ny": "state:36",
    "north carolina": "state:37", "nc": "state:37",
    "north dakota": "state:38", "nd": "state:38",
    "ohio": "state:39", "oh": "state:39",
    "oklahoma": "state:40", "ok": "state:40",
    "oregon": "state:41", "or": "state:41",
    "pennsylvania": "state:42", "pa": "state:42",
    "rhode island": "state:44", "ri": "state:44",
    "south carolina": "state:45", "sc": "state:45",
    "south dakota": "state:46", "sd": "state:46",
    "tennessee": "state:47", "tn": "state:47",
    "texas": "state:48", "tx": "state:48",
    "utah": "state:49", "ut": "state:49",
    "vermont": "state:50", "vt": "state:50",
    "virginia": "state:51", "va": "state:51",
    "washington": "state:53", "wa": "state:53",
    "west virginia": "state:54", "wv": "state:54",
    "wisconsin": "state:55", "wi": "state:55",
    "wyoming": "state:56", "wy": "state:56",
    "puerto rico": "state:72", "pr": "state:72",
    "us": "US", "u.s.": "US", "united states": "US",
}


FIPS_TO_STATE_NAME = {
    "state:01": "Alabama", "state:02": "Alaska", "state:04": "Arizona", "state:05": "Arkansas",
    "state:06": "California", "state:08": "Colorado", "state:09": "Connecticut", "state:10": "Delaware",
    "state:11": "District of Columbia", "state:12": "Florida", "state:13": "Georgia", "state:15": "Hawaii",
    "state:16": "Idaho", "state:17": "Illinois", "state:18": "Indiana", "state:19": "Iowa",
    "state:20": "Kansas", "state:21": "Kentucky", "state:22": "Louisiana", "state:23": "Maine",
    "state:24": "Maryland", "state:25": "Massachusetts", "state:26": "Michigan", "state:27": "Minnesota",
    "state:28": "Mississippi", "state:29": "Missouri", "state:30": "Montana", "state:31": "Nebraska",
    "state:32": "Nevada", "state:33": "New Hampshire", "state:34": "New Jersey", "state:35": "New Mexico",
    "state:36": "New York", "state:37": "North Carolina", "state:38": "North Dakota", "state:39": "Ohio",
    "state:40": "Oklahoma", "state:41": "Oregon", "state:42": "Pennsylvania", "state:44": "Rhode Island",
    "state:45": "South Carolina", "state:46": "South Dakota", "state:47": "Tennessee", "state:48": "Texas",
    "state:49": "Utah", "state:50": "Vermont", "state:51": "Virginia", "state:53": "Washington",
    "state:54": "West Virginia", "state:55": "Wisconsin", "state:56": "Wyoming", "state:72": "Puerto Rico",
    "US": "US",
}

DEFAULT_COLUMNS = [
    "date", "value", "geo_label", "indicator_id", "series_id", "units", "frequency",
    "seasonal_adjustment", "source", "footnotes",
]


class CLIError(Exception):
    """User-facing command error."""


def eprint(*parts: Any) -> None:
    print(*parts, file=sys.stderr)


def read_json(path: Path) -> Any:
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        raise CLIError(f"Missing required file: {path}")
    except json.JSONDecodeError as exc:
        raise CLIError(f"Invalid JSON in {path}: {exc}")


def write_json(obj: Any) -> None:
    json.dump(obj, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")


def norm_text(s: Any) -> str:
    return re.sub(r"\s+", " ", str(s or "").strip().lower())


def compact_text(s: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(s or "").strip().lower())


def finite_num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def as_float(v: Any) -> Optional[float]:
    if finite_num(v):
        return float(v)
    return None


def parse_limit(value: Optional[str], default: Optional[int]) -> Optional[int]:
    if value is None:
        return default
    if str(value).lower() in {"all", "none", "unlimited", "0"}:
        return None
    try:
        n = int(value)
    except ValueError:
        raise CLIError("--limit must be a positive integer or 'all'")
    if n < 0:
        raise CLIError("--limit must be a positive integer or 'all'")
    return n


def limit_rows(rows: List[Dict[str, Any]], limit: Optional[int], tail: bool = False) -> Tuple[List[Dict[str, Any]], bool]:
    if limit is None or len(rows) <= limit:
        return rows, False
    if tail:
        return rows[-limit:], True
    return rows[:limit], True


def sorted_rows(rows: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(rows, key=lambda r: (str(r.get("entity_key") or ""), str(r.get("date") or "")))


def rolling_field(freq: Optional[str]) -> str:
    return "rolling_4" if freq in {"W", "Q"} else "rolling_3"


def field_for_transform(transform: str, freq: Optional[str]) -> str:
    return {
        "level": "value",
        "change": "change_1",
        "pct_change": "pct_change_1",
        "yoy": "pct_change_12",
        "rolling": rolling_field(freq),
    }.get(transform, "value")


def transform_unit(transform: str, units: Optional[str], field: Optional[str] = None) -> str:
    if field:
        if field.startswith("pct_change"):
            return "Percent change"
        if field.startswith("change"):
            return "Change (pp)" if "percent" in norm_text(units) else f"Change, {units or ''}".strip()
        if field.startswith("rolling"):
            return units or ""
        if field == "index_first_100":
            return "Index (first observation = 100)"
    if transform in {"pct_change", "yoy"}:
        return "Percent change"
    if transform == "indexed":
        return "Index (visible start = 100)"
    if transform == "change":
        return "Change (pp)" if "percent" in norm_text(units) else f"Change, {units or ''}".strip()
    return units or ""


def transform_label(transform: str, field: Optional[str] = None) -> str:
    if field:
        return field
    return {
        "level": "level",
        "change": "period change",
        "pct_change": "period percent change",
        "yoy": "year-over-year percent change",
        "rolling": "rolling average",
        "indexed": "indexed to visible start = 100",
    }.get(transform, transform)


def date_in_range(date: str, start: Optional[str], end: Optional[str]) -> bool:
    if start and date < start:
        return False
    if end and date > end:
        return False
    return True


def geo_query_variants(query: str) -> set[str]:
    q = norm_text(query)
    variants = {q, compact_text(q)}
    mapped = STATE_TO_FIPS.get(q)
    if mapped:
        variants.add(norm_text(mapped))
        variants.add(compact_text(mapped))
    return {v for v in variants if v}


def display_geo_label(row: Dict[str, Any]) -> str:
    label = row.get("geo_label") or row.get("geo_id") or row.get("geography") or ""
    label_s = str(label)
    return FIPS_TO_STATE_NAME.get(label_s, FIPS_TO_STATE_NAME.get(norm_text(label_s), label_s))


def row_matches_geo(row: Dict[str, Any], query: Optional[str]) -> bool:
    if not query:
        return True
    variants = geo_query_variants(query)
    fields = [
        row.get("geo_id"), row.get("geo_label"), row.get("geography"), row.get("entity_key"),
    ]
    normalized = set()
    for field in fields:
        if field is None:
            continue
        normalized.add(norm_text(field))
        normalized.add(compact_text(field))
    return bool(variants & normalized)


def row_matches_entity(row: Dict[str, Any], entity: Optional[str]) -> bool:
    if not entity:
        return True
    e = norm_text(entity)
    return e in {
        norm_text(row.get("entity_key")),
        norm_text(row.get("geo_id")),
        norm_text(row.get("geo_label")),
        norm_text(row.get("series_id")),
    }


def filter_observations(
    rows: Iterable[Dict[str, Any]],
    start: Optional[str] = None,
    end: Optional[str] = None,
    geo: Optional[str] = None,
    entity: Optional[str] = None,
) -> List[Dict[str, Any]]:
    out = []
    for row in rows:
        date = str(row.get("date") or "")
        if not date_in_range(date, start, end):
            continue
        if not row_matches_geo(row, geo):
            continue
        if not row_matches_entity(row, entity):
            continue
        copied = dict(row)
        copied["geo_label"] = display_geo_label(copied)
        out.append(copied)
    return sorted_rows(out)


def group_by_entity(rows: Iterable[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    grouped: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for row in rows:
        key = str(row.get("entity_key") or row.get("geo_id") or row.get("indicator_id") or "series")
        grouped[key].append(row)
    for key in grouped:
        grouped[key].sort(key=lambda r: str(r.get("date") or ""))
    return dict(grouped)


def apply_transform(rows: List[Dict[str, Any]], transform: str = "level", field: Optional[str] = None) -> List[Dict[str, Any]]:
    rows = sorted_rows(rows)
    if field:
        out = []
        for row in rows:
            new = dict(row)
            new["raw_value"] = row.get("value")
            new["value"] = row.get(field) if finite_num(row.get(field)) else None
            new["transform"] = field
            new["transform_field"] = field
            out.append(new)
        return out

    if transform == "indexed":
        out = []
        for _, group in group_by_entity(rows).items():
            base = next((as_float(r.get("value")) for r in group if as_float(r.get("value")) not in {None, 0.0}), None)
            for row in group:
                new = dict(row)
                raw = as_float(row.get("value"))
                new["raw_value"] = row.get("value")
                new["value"] = (raw / base * 100.0) if raw is not None and base not in {None, 0.0} else None
                new["transform"] = transform
                new["transform_field"] = "computed_visible_index"
                out.append(new)
        return sorted_rows(out)

    out = []
    for row in rows:
        freq = row.get("frequency")
        f = field_for_transform(transform, freq)
        new = dict(row)
        new["raw_value"] = row.get("value")
        new["value"] = row.get(f) if finite_num(row.get(f)) else None
        new["transform"] = transform
        new["transform_field"] = f
        out.append(new)
    return out


def round_value(v: Any, digits: int = 4) -> Any:
    if not finite_num(v):
        return None
    if abs(float(v)) >= 1000:
        return round(float(v), 2)
    return round(float(v), digits)


def fmt_value(v: Any) -> str:
    if v is None:
        return "—"
    if finite_num(v):
        x = float(v)
        if abs(x) >= 1000:
            return f"{x:,.0f}" if abs(x - round(x)) < 1e-9 else f"{x:,.2f}"
        if abs(x) >= 100:
            return f"{x:,.2f}".rstrip("0").rstrip(".")
        return f"{x:,.4f}".rstrip("0").rstrip(".")
    return str(v)


def truncate_cell(s: Any, width: int = 34) -> str:
    text = "—" if s is None else str(s)
    if len(text) <= width:
        return text
    return text[: max(0, width - 1)] + "…"


def print_table(rows: List[Dict[str, Any]], columns: Sequence[Tuple[str, str]], note: Optional[str] = None) -> None:
    if not rows:
        print("(no rows)")
        if note:
            print(note)
        return
    rendered = []
    for row in rows:
        rendered.append([fmt_value(row.get(key)) if key == "value" or key.endswith("_value") else truncate_cell(row.get(key)) for key, _ in columns])
    headers = [label for _, label in columns]
    widths = [len(h) for h in headers]
    for r in rendered:
        for i, cell in enumerate(r):
            widths[i] = min(max(widths[i], len(cell)), 42)
    def line(vals: Sequence[str]) -> str:
        return "  ".join(str(vals[i]).ljust(widths[i]) for i in range(len(vals)))
    print(line(headers))
    print(line(["-" * w for w in widths]))
    for r in rendered:
        print(line([truncate_cell(r[i], widths[i]) for i in range(len(r))]))
    if note:
        print(note)


def write_csv_rows(path: Optional[str], rows: List[Dict[str, Any]], columns: Optional[Sequence[str]] = None) -> None:
    if columns is None:
        seen = []
        for preferred in DEFAULT_COLUMNS:
            if any(preferred in r for r in rows):
                seen.append(preferred)
        for row in rows:
            for key in row:
                if key not in seen and not isinstance(row.get(key), (dict, list)):
                    seen.append(key)
        columns = seen
    fh = open(path, "w", newline="", encoding="utf-8") if path else sys.stdout
    try:
        writer = csv.DictWriter(fh, fieldnames=list(columns), extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k) for k in columns})
    finally:
        if path:
            fh.close()


def ensure_parent(path: str) -> None:
    Path(path).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)


class DataStore:
    def __init__(self, data_dir: str | Path):
        self.data_dir = Path(data_dir).expanduser().resolve()
        self._manifest: Optional[Dict[str, Any]] = None
        self._catalog: Optional[Dict[str, Any]] = None
        self._latest: Optional[Dict[str, Any]] = None
        self._search_index: Optional[Dict[str, Any]] = None
        self._indicator_by_id: Optional[Dict[str, Dict[str, Any]]] = None

    @property
    def manifest(self) -> Dict[str, Any]:
        if self._manifest is None:
            self._manifest = read_json(self.data_dir / "manifest.json")
        return self._manifest

    @property
    def catalog(self) -> Dict[str, Any]:
        if self._catalog is None:
            self._catalog = read_json(self.data_dir / "catalog.json")
        return self._catalog

    @property
    def latest(self) -> Dict[str, Any]:
        if self._latest is None:
            self._latest = read_json(self.data_dir / "latest.json")
        return self._latest

    @property
    def indicator_by_id(self) -> Dict[str, Dict[str, Any]]:
        if self._indicator_by_id is None:
            self._indicator_by_id = {str(i.get("id")): i for i in self.catalog.get("indicators", []) if i.get("id")}
        return self._indicator_by_id

    def search_index_path(self) -> Path:
        raw = self.manifest.get("search_index") or "../search/index.json"
        return (self.data_dir / str(raw)).resolve()

    @property
    def search_index(self) -> Dict[str, Any]:
        if self._search_index is None:
            path = self.search_index_path()
            if path.exists():
                self._search_index = read_json(path)
            else:
                self._search_index = {"documents": []}
        return self._search_index

    def available_ids_contract(self) -> set[str]:
        return {str(x) for x in self.manifest.get("available_indicator_ids", [])}

    def series_rel_path(self, indicator_id: str) -> str:
        mapping = self.manifest.get("series_file_by_indicator") or {}
        return str(mapping.get(indicator_id) or f"series/{indicator_id}.json")

    def series_path(self, indicator_id: str) -> Path:
        return (self.data_dir / self.series_rel_path(indicator_id)).resolve()

    def series_exists(self, indicator_id: str) -> bool:
        return self.series_path(indicator_id).exists()

    def indicator(self, indicator_id: str) -> Dict[str, Any]:
        if indicator_id not in self.indicator_by_id:
            raise CLIError(f"Unknown indicator_id: {indicator_id}")
        return self.indicator_by_id[indicator_id]

    def load_series_payload(self, indicator_id: str) -> Dict[str, Any]:
        self.indicator(indicator_id)  # fail with useful message before file lookup
        path = self.series_path(indicator_id)
        if not path.exists():
            raise CLIError(f"Series file for {indicator_id!r} is not present at {path}")
        return read_json(path)

    def load_series(self, indicator_id: str) -> List[Dict[str, Any]]:
        payload = self.load_series_payload(indicator_id)
        rows = payload.get("observations") or []
        return sorted_rows(dict(r) for r in rows)

    def latest_rows(self, indicator_id: Optional[str] = None) -> List[Dict[str, Any]]:
        rows = [dict(r) for r in self.latest.get("observations", [])]
        if indicator_id:
            rows = [r for r in rows if r.get("indicator_id") == indicator_id]
        return sorted_rows(rows)

    def search(self, query: str, limit: int = 10, available_only: bool = False) -> List[Dict[str, Any]]:
        q = norm_text(query)
        tokens = [t for t in re.split(r"[^a-z0-9]+", q) if t]
        docs = self.search_index.get("documents") or []
        if not docs:
            docs = []
            for ind in self.catalog.get("indicators", []):
                parts = [ind.get("id"), ind.get("title"), ind.get("short_title"), ind.get("series_id"), ind.get("release")]
                parts += list(ind.get("tags") or []) + list(ind.get("aliases") or [])
                docs.append({**ind, "haystack": " ".join(str(p) for p in parts if p)})
        results = []
        contract_ids = self.available_ids_contract()
        for doc in docs:
            indicator_id = str(doc.get("id") or "")
            if not indicator_id:
                continue
            file_exists = self.series_exists(indicator_id)
            contract_available = indicator_id in contract_ids
            if available_only and not file_exists:
                continue
            title = norm_text(doc.get("title"))
            short = norm_text(doc.get("short_title"))
            hay = norm_text(doc.get("haystack") or " ".join(str(v) for v in doc.values() if not isinstance(v, (dict, list))))
            aliases = [norm_text(a) for a in (doc.get("aliases") or [])]
            tags = [norm_text(t) for t in (doc.get("tags") or [])]
            series_id = norm_text(doc.get("series_id"))
            score = 0.0
            if q == indicator_id.lower(): score += 120
            if q == series_id: score += 110
            if q and q in {title, short}: score += 95
            if q and (q in title or q in short): score += 45
            if q and any(q in a for a in aliases): score += 35
            if q and any(q == t or q in t for t in tags): score += 25
            for token in tokens:
                if token in indicator_id.lower(): score += 12
                if token in title: score += 10
                if token in short: score += 8
                if token in series_id: score += 10
                if any(token in a for a in aliases): score += 7
                if any(token in t for t in tags): score += 5
                if token in hay: score += 2
            if not tokens and q:
                score = 0
            if score > 0:
                row = {
                    "id": indicator_id,
                    "title": doc.get("title"),
                    "short_title": doc.get("short_title"),
                    "provider": doc.get("provider"),
                    "source_id": doc.get("source_id"),
                    "series_id": doc.get("series_id"),
                    "release": doc.get("release"),
                    "frequency": doc.get("frequency"),
                    "units": doc.get("units"),
                    "seasonal_adjustment": doc.get("seasonal_adjustment"),
                    "geography": doc.get("geography"),
                    "tags": doc.get("tags") or [],
                    "aliases": doc.get("aliases") or [],
                    "contract_available": contract_available,
                    "series_file_exists": file_exists,
                    "series_path": self.series_rel_path(indicator_id),
                    "score": round(score, 3),
                }
                results.append(row)
        results.sort(key=lambda r: (-float(r["score"]), str(r["id"])))
        return results[:limit]

    def resolve_indicator_id(self, value: str) -> str:
        if value in self.indicator_by_id:
            return value
        matches = self.search(value, limit=1, available_only=False)
        if not matches:
            raise CLIError(f"Could not resolve indicator from {value!r}. Try `search {value!r}`.")
        return str(matches[0]["id"])


def metadata_for_indicator(store: DataStore, indicator_id: str, transform: str = "level", field: Optional[str] = None) -> Dict[str, Any]:
    ind = dict(store.indicator(indicator_id))
    units = transform_unit(transform, ind.get("units"), field)
    return {
        "indicator_id": indicator_id,
        "title": ind.get("title"),
        "short_title": ind.get("short_title"),
        "provider": ind.get("provider"),
        "source_id": ind.get("source_id"),
        "series_id": ind.get("series_id"),
        "release": ind.get("release"),
        "frequency": ind.get("frequency"),
        "units": units,
        "base_units": ind.get("units"),
        "seasonal_adjustment": ind.get("seasonal_adjustment"),
        "geography": ind.get("geography"),
        "transform": transform_label(transform, field),
    }


def summarize_rows(rows: List[Dict[str, Any]], metadata: Dict[str, Any]) -> Dict[str, Any]:
    finite = [r for r in rows if finite_num(r.get("value"))]
    if not finite:
        return {
            "text": "No finite observations are available for the requested selection.",
            "n_observations": len(rows),
            "n_finite": 0,
        }
    first = finite[0]
    last = finite[-1]
    values = [float(r["value"]) for r in finite]
    min_row = finite[values.index(min(values))]
    max_row = finite[values.index(max(values))]
    change = float(last["value"]) - float(first["value"])
    pct = (change / float(first["value"]) * 100.0) if float(first["value"]) != 0 else None
    units = metadata.get("units") or ""
    title = metadata.get("title") or metadata.get("label") or metadata.get("indicator_id") or "series"
    text = (
        f"{title}: latest {fmt_value(last.get('value'))} {units} on {last.get('date')}; "
        f"from {first.get('date')} to {last.get('date')}, the change was {fmt_value(change)} {units}"
    )
    if pct is not None and metadata.get("transform") in {"level", "computed", None}:
        text += f" ({fmt_value(pct)}%)."
    else:
        text += "."
    text += (
        f" Range in this selection: low {fmt_value(min_row.get('value'))} on {min_row.get('date')}, "
        f"high {fmt_value(max_row.get('value'))} on {max_row.get('date')}."
    )
    source_bits = [metadata.get("source_id") or metadata.get("provider"), metadata.get("series_id"), metadata.get("frequency"), metadata.get("seasonal_adjustment")]
    source_note = ", ".join(str(x) for x in source_bits if x)
    if source_note:
        text += f" Source metadata: {source_note}."
    return {
        "text": text,
        "n_observations": len(rows),
        "n_finite": len(finite),
        "first": slim_row(first),
        "latest": slim_row(last),
        "change": change,
        "pct_change_from_first": pct,
        "min": slim_row(min_row),
        "max": slim_row(max_row),
    }


def slim_row(row: Dict[str, Any]) -> Dict[str, Any]:
    keys = ["date", "value", "raw_value", "indicator_id", "geo_id", "geo_label", "series_id", "units", "frequency", "seasonal_adjustment", "source", "footnotes"]
    out = {k: row.get(k) for k in keys if k in row}
    if "geo_label" in out:
        out["geo_label"] = display_geo_label(row)
    return out


class SafeFormula:
    def __init__(self, expr: str, n_vars: int):
        self.expr = norm_text(expr).replace(" ", "")
        self.n_vars = n_vars
        if not self.expr:
            raise CLIError("Formula is empty")
        try:
            self.tree = ast.parse(self.expr, mode="eval")
        except SyntaxError as exc:
            raise CLIError(f"Invalid formula syntax: {exc}")
        self._validate(self.tree)

    def _validate(self, node: ast.AST) -> None:
        if isinstance(node, ast.Expression):
            self._validate(node.body)
        elif isinstance(node, ast.BinOp):
            if not isinstance(node.op, (ast.Add, ast.Sub, ast.Mult, ast.Div)):
                raise CLIError("Formula may only use +, -, *, and /")
            self._validate(node.left); self._validate(node.right)
        elif isinstance(node, ast.UnaryOp):
            if not isinstance(node.op, (ast.UAdd, ast.USub)):
                raise CLIError("Formula may only use unary + or -")
            self._validate(node.operand)
        elif isinstance(node, ast.Name):
            if node.id not in VARS[: self.n_vars]:
                allowed = ", ".join(VARS[: self.n_vars])
                raise CLIError(f"Formula variable {node.id!r} is not available; allowed variables: {allowed}")
        elif isinstance(node, ast.Constant):
            if not isinstance(node.value, (int, float)) or isinstance(node.value, bool):
                raise CLIError("Formula constants must be numbers")
        else:
            raise CLIError("Formula may only contain variables a-h, numbers, parentheses, and + - * /")

    def eval(self, values: Sequence[float]) -> Optional[float]:
        env = {VARS[i]: values[i] for i in range(min(len(values), self.n_vars))}
        try:
            result = self._eval_node(self.tree.body, env)
        except ZeroDivisionError:
            return None
        return result if finite_num(result) else None

    def _eval_node(self, node: ast.AST, env: Dict[str, float]) -> float:
        if isinstance(node, ast.BinOp):
            a = self._eval_node(node.left, env)
            b = self._eval_node(node.right, env)
            if isinstance(node.op, ast.Add): return a + b
            if isinstance(node.op, ast.Sub): return a - b
            if isinstance(node.op, ast.Mult): return a * b
            if isinstance(node.op, ast.Div): return a / b
        if isinstance(node, ast.UnaryOp):
            v = self._eval_node(node.operand, env)
            return +v if isinstance(node.op, ast.UAdd) else -v
        if isinstance(node, ast.Name):
            return float(env[node.id])
        if isinstance(node, ast.Constant):
            return float(node.value)
        raise CLIError("Unexpected formula node")


def op_to_formula(op: str) -> str:
    return {
        "ratio": "a / b",
        "diff": "a - b",
        "sum": "a + b",
        "share": "a / b * 100",
    }[op]


def combine_units(op: str, metas: Sequence[Dict[str, Any]]) -> str:
    base_units = [m.get("units") for m in metas]
    if op == "share": return "Percent"
    if op == "ratio": return "Ratio"
    if op in {"diff", "sum"} and len(set(base_units)) == 1:
        if op == "diff" and "percent" in norm_text(base_units[0]):
            return "Percentage points"
        return str(base_units[0] or "")
    return op.title()


def make_combined_label(op: str, metas: Sequence[Dict[str, Any]], formula: str) -> str:
    names = [m.get("short_title") or m.get("title") or m.get("indicator_id") for m in metas]
    if op == "ratio" and len(names) >= 2: return f"{names[0]} ÷ {names[1]}"
    if op == "diff" and len(names) >= 2: return f"{names[0]} − {names[1]}"
    if op == "sum" and len(names) >= 2: return " + ".join(str(n) for n in names)
    if op == "share" and len(names) >= 2: return f"{names[0]} as % of {names[1]}"
    label = formula
    for i, name in enumerate(names):
        label = re.sub(rf"\b{VARS[i]}\b", f"[{name}]", label)
    return label


def build_svg_chart(
    series_list: Sequence[Dict[str, Any]],
    title: str,
    units: str,
    width: int = 960,
    height: int = 540,
) -> str:
    """Return a simple offline SVG line chart; no JS, fonts, or network."""
    margin_left, margin_right, margin_top, margin_bottom = 72, 32, 58, 72
    plot_w = max(10, width - margin_left - margin_right)
    plot_h = max(10, height - margin_top - margin_bottom)
    points: List[Tuple[str, float, str]] = []
    for s in series_list:
        for row in s.get("rows", []):
            if finite_num(row.get("value")) and row.get("date"):
                points.append((str(row["date"]), float(row["value"]), str(s.get("label") or "series")))
    if not points:
        raise CLIError("No finite data points available for chart")
    dates = sorted({p[0] for p in points})
    x_index = {d: i for i, d in enumerate(dates)}
    ymin = min(p[1] for p in points)
    ymax = max(p[1] for p in points)
    if ymin == ymax:
        ymin -= 1.0; ymax += 1.0
    pad = (ymax - ymin) * 0.08
    ymin -= pad; ymax += pad
    denom_x = max(1, len(dates) - 1)
    def x_for(date: str) -> float:
        return margin_left + (x_index[date] / denom_x) * plot_w
    def y_for(value: float) -> float:
        return margin_top + (1 - ((value - ymin) / (ymax - ymin))) * plot_h
    colors = ["#1f77b4", "#d62728", "#2ca02c", "#9467bd", "#ff7f0e", "#17becf", "#8c564b", "#7f7f7f"]
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="{html.escape(title)}">',
        '<rect width="100%" height="100%" fill="white"/>',
        f'<text x="{margin_left}" y="32" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="20" font-weight="600">{html.escape(title)}</text>',
        f'<line x1="{margin_left}" y1="{margin_top + plot_h}" x2="{margin_left + plot_w}" y2="{margin_top + plot_h}" stroke="#333"/>',
        f'<line x1="{margin_left}" y1="{margin_top}" x2="{margin_left}" y2="{margin_top + plot_h}" stroke="#333"/>',
    ]
    # y ticks
    for i in range(5):
        value = ymin + (ymax - ymin) * i / 4
        y = y_for(value)
        parts.append(f'<line x1="{margin_left - 4}" y1="{y:.1f}" x2="{margin_left + plot_w}" y2="{y:.1f}" stroke="#e6e6e6"/>')
        parts.append(f'<text x="{margin_left - 8}" y="{y + 4:.1f}" text-anchor="end" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="12" fill="#333">{html.escape(fmt_value(value))}</text>')
    # x labels: first, midpoint, last
    for idx in sorted(set([0, len(dates)//2, len(dates)-1])):
        date = dates[idx]
        x = x_for(date)
        parts.append(f'<text x="{x:.1f}" y="{margin_top + plot_h + 24}" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="12" fill="#333">{html.escape(date[:10])}</text>')
    parts.append(f'<text x="{margin_left}" y="{height - 18}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="12" fill="#555">Units: {html.escape(units or "")}</text>')
    legend_y = margin_top
    for idx, s in enumerate(series_list):
        rows = [r for r in s.get("rows", []) if finite_num(r.get("value")) and r.get("date")]
        if not rows:
            continue
        color = colors[idx % len(colors)]
        poly = " ".join(f'{x_for(str(r["date"])):.1f},{y_for(float(r["value"])):.1f}' for r in rows)
        parts.append(f'<polyline fill="none" stroke="{color}" stroke-width="2.4" points="{poly}"/>')
        lx = margin_left + 8
        ly = legend_y + 18 * idx
        parts.append(f'<rect x="{lx}" y="{ly - 9}" width="12" height="3" fill="{color}"/>')
        parts.append(f'<text x="{lx + 18}" y="{ly - 5}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="12" fill="#333">{html.escape(str(s.get("label") or "series"))}</text>')
    parts.append("</svg>")
    return "\n".join(parts)


def maybe_write_chart(path: Optional[str], series_list: Sequence[Dict[str, Any]], title: str, units: str, width: int, height: int) -> None:
    if not path:
        return
    ensure_parent(path)
    svg = build_svg_chart(series_list, title, units, width, height)
    Path(path).expanduser().write_text(svg, encoding="utf-8")


def command_doctor(args: argparse.Namespace) -> None:
    store = DataStore(args.data)
    manifest = store.manifest
    catalog = store.catalog
    latest = store.latest
    warnings = []
    for fname in ["catalog.json", "manifest.json", "latest.json"]:
        if not (store.data_dir / fname).exists():
            warnings.append(f"missing {fname}")
    missing_series = []
    for indicator_id, rel in (manifest.get("series_file_by_indicator") or {}).items():
        if not (store.data_dir / str(rel)).exists():
            missing_series.append({"indicator_id": indicator_id, "path": rel})
    fred_rows = [r for r in latest.get("observations", []) if "fred" in norm_text(r.get("source"))]
    fred_catalog = [i for i in catalog.get("indicators", []) if "fred" in norm_text(i.get("provider")) or "fred" in norm_text(i.get("source_id"))]
    profile = manifest.get("profile")
    if profile != "origin_only":
        warnings.append(f"manifest profile is {profile!r}, not 'origin_only'; do not use this export as the redistributable offline package")
    if fred_rows or fred_catalog:
        warnings.append(f"FRED mirror metadata/rows detected (catalog={len(fred_catalog)}, latest_rows={len(fred_rows)}); offline redistributable exports should be origin-only")
    if missing_series:
        warnings.append(f"manifest references {len(missing_series)} series file(s) not present in this checkout/sample")
    payload = {
        "ok": not warnings,
        "data_dir": str(store.data_dir),
        "schema_version": manifest.get("schema_version"),
        "profile": profile,
        "generated_at": manifest.get("generated_at"),
        "catalog_indicators": len(catalog.get("indicators", [])),
        "manifest_available_indicator_ids": len(manifest.get("available_indicator_ids", [])),
        "manifest_series_files": len(manifest.get("series_files", [])),
        "latest_rows": len(latest.get("observations", [])),
        "search_index": str(store.search_index_path()),
        "search_documents": len(store.search_index.get("documents", [])),
        "missing_series_count": len(missing_series),
        "missing_series_sample": missing_series[:20],
        "fred_catalog_count": len(fred_catalog),
        "fred_latest_rows_count": len(fred_rows),
        "warnings": warnings,
    }
    if args.require_origin_only and (profile != "origin_only" or fred_rows or fred_catalog):
        payload["ok"] = False
    if args.format == "json":
        write_json(payload)
    else:
        rows = [{k: v for k, v in payload.items() if not isinstance(v, (list, dict))}]
        print_table(rows, [("data_dir", "data_dir"), ("profile", "profile"), ("generated_at", "generated_at"), ("catalog_indicators", "catalog"), ("manifest_series_files", "series"), ("latest_rows", "latest"), ("missing_series_count", "missing")])
        if warnings:
            print("\nWarnings:")
            for w in warnings:
                print(f"- {w}")
    if args.strict and (warnings or not payload["ok"]):
        raise CLIError("doctor found warnings; rerun without --strict to inspect details")


def command_search(args: argparse.Namespace) -> None:
    store = DataStore(args.data)
    results = store.search(args.query, limit=args.limit, available_only=args.available_only)
    if args.format == "json":
        write_json({"query": args.query, "count": len(results), "results": results})
    else:
        cols = [("id", "id"), ("title", "title"), ("units", "units"), ("frequency", "freq"), ("geography", "geo"), ("series_file_exists", "file"), ("series_id", "series_id")]
        print_table(results, cols)


def command_info(args: argparse.Namespace) -> None:
    store = DataStore(args.data)
    indicator_id = store.resolve_indicator_id(args.indicator)
    ind = dict(store.indicator(indicator_id))
    ind["contract_available"] = indicator_id in store.available_ids_contract()
    ind["series_file_exists"] = store.series_exists(indicator_id)
    ind["series_path"] = store.series_rel_path(indicator_id)
    if args.format == "json":
        write_json(ind)
    else:
        rows = [{"field": k, "value": json.dumps(v, ensure_ascii=False) if isinstance(v, (list, dict)) else v} for k, v in ind.items()]
        print_table(rows, [("field", "field"), ("value", "value")])


def command_latest(args: argparse.Namespace) -> None:
    store = DataStore(args.data)
    target = args.indicator or args.query
    if not target:
        raise CLIError("Provide an indicator id or --query")
    indicator_id = store.resolve_indicator_id(target)
    rows = store.latest_rows(indicator_id)
    rows = filter_observations(rows, geo=args.geo, entity=args.entity)
    rows = apply_transform(rows, args.transform, args.field)
    rows.sort(key=lambda r: (str(r.get("geo_label") or ""), str(r.get("entity_key") or "")))
    limit = parse_limit(args.limit, 20)
    shown, truncated = limit_rows(rows, limit)
    meta = metadata_for_indicator(store, indicator_id, args.transform, args.field)
    if args.format == "json":
        write_json({"metadata": meta, "count": len(rows), "truncated": truncated, "rows": [slim_row(r) for r in shown]})
    elif args.format == "csv":
        write_csv_rows(args.output, rows)
    else:
        note = f"Showing {len(shown)} of {len(rows)} row(s)." + (" Use --limit all to show all." if truncated else "")
        cols = [("date", "date"), ("value", "value"), ("geo_label", "geo"), ("indicator_id", "indicator"), ("series_id", "series_id"), ("units", "units")]
        print_table(shown, cols, note=note)


def command_series(args: argparse.Namespace) -> None:
    store = DataStore(args.data)
    indicator_id = store.resolve_indicator_id(args.indicator)
    rows = store.load_series(indicator_id)
    rows = filter_observations(rows, start=args.start, end=args.end, geo=args.geo, entity=args.entity)
    rows = apply_transform(rows, args.transform, args.field)
    meta = metadata_for_indicator(store, indicator_id, args.transform, args.field)
    limit = parse_limit(args.limit, 24)
    shown, truncated = limit_rows(rows, limit, tail=args.tail)
    if args.output:
        ensure_parent(args.output)
    if args.format == "csv":
        write_csv_rows(args.output, rows)
    elif args.format == "json":
        payload = {"metadata": meta, "count": len(rows), "truncated": truncated, "rows": [slim_row(r) for r in shown]}
        write_json(payload)
    else:
        note = f"Showing {len(shown)} of {len(rows)} row(s)." + (" Use --limit all to show all." if truncated else "")
        cols = [("date", "date"), ("value", "value"), ("geo_label", "geo"), ("raw_value", "raw"), ("series_id", "series_id"), ("footnotes", "footnotes")]
        print_table(shown, cols, note=note)


def command_export_csv(args: argparse.Namespace) -> None:
    args.format = "csv"
    args.limit = "all"
    command_series(args)


def command_rank(args: argparse.Namespace) -> None:
    store = DataStore(args.data)
    indicator_id = store.resolve_indicator_id(args.indicator)
    rows: List[Dict[str, Any]]
    if args.date == "latest":
        rows = store.latest_rows(indicator_id)
        rows = filter_observations(rows, geo=args.geo)
        if args.transform == "indexed" and not args.field:
            raise CLIError("rank --transform indexed needs a bounded series range; use a field like --field index_first_100 or compare/chart instead")
        rows = apply_transform(rows, args.transform, args.field)
    else:
        all_rows = store.load_series(indicator_id)
        all_rows = filter_observations(all_rows, end=args.date, geo=args.geo)
        chosen = []
        for group in group_by_entity(all_rows).values():
            eligible = [r for r in group if str(r.get("date") or "") <= args.date]
            if eligible:
                chosen.append(dict(eligible[-1]))
        rows = apply_transform(chosen, args.transform, args.field)
    rows = [r for r in rows if finite_num(r.get("value"))]
    rows.sort(key=lambda r: float(r.get("value")), reverse=(args.order == "desc"))
    rows = rows[: args.n]
    for i, row in enumerate(rows, 1):
        row["rank"] = i
    meta = metadata_for_indicator(store, indicator_id, args.transform, args.field)
    if args.format == "json":
        write_json({"metadata": meta, "date": args.date, "order": args.order, "count": len(rows), "rows": [slim_row(r) | {"rank": r["rank"]} for r in rows]})
    elif args.format == "csv":
        write_csv_rows(args.output, rows, ["rank", "date", "value", "geo_id", "geo_label", "indicator_id", "series_id", "units", "source"])
    else:
        cols = [("rank", "rank"), ("geo_label", "geo"), ("value", "value"), ("date", "date"), ("series_id", "series_id"), ("units", "units")]
        print_table(rows, cols)


def command_compare(args: argparse.Namespace) -> None:
    store = DataStore(args.data)
    indicator_id = store.resolve_indicator_id(args.indicator)
    all_rows = store.load_series(indicator_id)
    series_list = []
    long_rows = []
    for geo in args.geos:
        rows = filter_observations(all_rows, start=args.start, end=args.end, geo=geo)
        rows = apply_transform(rows, args.transform, args.field)
        label = rows[0].get("geo_label") if rows else geo
        series_list.append({"label": str(label), "rows": rows})
        for row in rows:
            new = slim_row(row)
            new["requested_geo"] = geo
            long_rows.append(new)
    meta = metadata_for_indicator(store, indicator_id, args.transform, args.field)
    maybe_write_chart(args.chart, series_list, f"{meta['title']} — geography comparison", meta.get("units") or "", args.width, args.height)
    limit = parse_limit(args.limit, 40)
    shown, truncated = limit_rows(long_rows, limit, tail=args.tail)
    if args.format == "json":
        payload = {"metadata": meta, "geos": args.geos, "count": len(long_rows), "truncated": truncated, "chart": args.chart, "rows": shown}
        write_json(payload)
    elif args.format == "csv":
        write_csv_rows(args.output, long_rows)
    else:
        note = f"Showing {len(shown)} of {len(long_rows)} row(s)." + (f" Chart written to {args.chart}." if args.chart else "")
        cols = [("date", "date"), ("geo_label", "geo"), ("value", "value"), ("series_id", "series_id"), ("units", "units")]
        print_table(shown, cols, note=note)


def command_combine(args: argparse.Namespace) -> None:
    store = DataStore(args.data)
    if len(args.indicators) > len(VARS):
        raise CLIError(f"combine supports at most {len(VARS)} input series")
    ids = [store.resolve_indicator_id(x) for x in args.indicators]
    if args.formula:
        formula = args.formula
        op = "custom"
    else:
        op = args.op
        if op in {"ratio", "diff", "share"} and len(ids) < 2:
            raise CLIError(f"--op {op} requires at least two series")
        formula = op_to_formula(op)
    compiled = SafeFormula(formula, len(ids))
    metas = [metadata_for_indicator(store, i, args.transform, args.field) for i in ids]
    transformed_series = []
    for indicator_id in ids:
        rows = store.load_series(indicator_id)
        rows = filter_observations(rows, start=args.start, end=args.end, geo=args.geo, entity=args.entity)
        rows = apply_transform(rows, args.transform, args.field)
        transformed_series.append(rows)
    maps = [{str(r.get("date")): r for r in rows} for rows in transformed_series]
    out_rows = []
    if not transformed_series:
        raise CLIError("No input series")
    for row0 in transformed_series[0]:
        date = str(row0.get("date") or "")
        inputs = []
        components = {}
        ok = True
        for i, m in enumerate(maps):
            row = m.get(date)
            value = row.get("value") if row else None
            components[VARS[i]] = value
            if not finite_num(value):
                ok = False
            else:
                inputs.append(float(value))
        result = compiled.eval(inputs) if ok else None
        out = {
            "date": date,
            "value": result,
            "formula": formula,
        }
        if args.include_components:
            out.update({f"{k}_value": v for k, v in components.items()})
        out_rows.append(out)
    label = make_combined_label(op, metas, formula)
    units = combine_units(op, metas)
    metadata = {
        "label": label,
        "operation": op,
        "formula": formula,
        "units": units,
        "transform": transform_label(args.transform, args.field),
        "inputs": metas,
    }
    summary = summarize_rows(out_rows, metadata)
    maybe_write_chart(args.chart, [{"label": label, "rows": out_rows}], label, units, args.width, args.height)
    if args.output:
        ensure_parent(args.output)
        write_csv_rows(args.output, out_rows)
    limit = parse_limit(args.limit, 24)
    shown, truncated = limit_rows(out_rows, limit, tail=args.tail)
    if args.format == "json":
        write_json({"metadata": metadata, "summary": summary, "count": len(out_rows), "truncated": truncated, "chart": args.chart, "csv": args.output, "rows": shown})
    elif args.format == "csv":
        write_csv_rows(None, out_rows)
    else:
        note = f"Showing {len(shown)} of {len(out_rows)} row(s)."
        if args.chart: note += f" Chart written to {args.chart}."
        if args.output: note += f" CSV written to {args.output}."
        cols = [("date", "date"), ("value", "value")]
        if args.include_components:
            cols += [(f"{VARS[i]}_value", VARS[i]) for i in range(len(ids))]
        print_table(shown, cols, note=note)
        if args.summary:
            print("\n" + summary["text"])


def command_summarize(args: argparse.Namespace) -> None:
    store = DataStore(args.data)
    indicator_id = store.resolve_indicator_id(args.indicator)
    rows = store.load_series(indicator_id)
    rows = filter_observations(rows, start=args.start, end=args.end, geo=args.geo, entity=args.entity)
    rows = apply_transform(rows, args.transform, args.field)
    meta = metadata_for_indicator(store, indicator_id, args.transform, args.field)
    summary = summarize_rows(rows, meta)
    if args.format == "json":
        write_json({"metadata": meta, "summary": summary})
    else:
        print(summary["text"])


def command_chart(args: argparse.Namespace) -> None:
    store = DataStore(args.data)
    ids = [store.resolve_indicator_id(x) for x in args.indicators]
    series_list = []
    metas = []
    for indicator_id in ids:
        rows = store.load_series(indicator_id)
        rows = filter_observations(rows, start=args.start, end=args.end, geo=args.geo, entity=args.entity)
        rows = apply_transform(rows, args.transform, args.field)
        meta = metadata_for_indicator(store, indicator_id, args.transform, args.field)
        metas.append(meta)
        series_list.append({"label": meta.get("short_title") or meta.get("title") or indicator_id, "rows": rows})
    units_set = {m.get("units") for m in metas if m.get("units")}
    units = units_set.pop() if len(units_set) == 1 else "Mixed units"
    title = args.title or " vs. ".join(str(s["label"]) for s in series_list)
    ensure_parent(args.output)
    maybe_write_chart(args.output, series_list, title, units, args.width, args.height)
    payload = {
        "chart": args.output,
        "title": title,
        "units": units,
        "series": metas,
        "warnings": ["Input series have mixed units; do not over-interpret a shared-axis chart."] if units == "Mixed units" else [],
    }
    if args.format == "json":
        write_json(payload)
    else:
        print(f"Chart written to {args.output}")
        if payload["warnings"]:
            print("Warning: " + payload["warnings"][0])


def add_common_series_filters(p: argparse.ArgumentParser) -> None:
    p.add_argument("--start", help="inclusive YYYY-MM-DD start date")
    p.add_argument("--end", help="inclusive YYYY-MM-DD end date")
    p.add_argument("--geo", help="geography filter: e.g. US, CA, California, state:06")
    p.add_argument("--entity", help="entity_key/geo_id/series_id exact-ish filter")
    p.add_argument("--transform", default="level", choices=["level", "change", "pct_change", "yoy", "rolling", "indexed"], help="transform to apply; uses precomputed fields except visible-range indexed")
    p.add_argument("--field", help="explicit observation field to read, e.g. change_12, pct_change_4, rolling_12, index_first_100")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="jobgauge-data",
        description="Read-only, offline CLI over jobgauge static JSON data.",
    )
    p.add_argument("--data", default=os.environ.get("JOBGAUGE_DATA_DIR", "site/public/data"), help="path to site/public/data (default: %(default)s or JOBGAUGE_DATA_DIR)")
    p.add_argument("--version", action="version", version=f"jobgauge-data {VERSION}")
    sub = p.add_subparsers(dest="command", required=True)

    d = sub.add_parser("doctor", help="validate local static-data availability and offline packaging warnings")
    d.add_argument("--format", choices=["json", "table"], default="table")
    d.add_argument("--strict", action="store_true", help="exit non-zero on warnings")
    d.add_argument("--require-origin-only", action="store_true", help="mark hosted/FRED exports as not OK")
    d.set_defaults(func=command_doctor)

    s = sub.add_parser("search", help="search catalog/search index for indicators")
    s.add_argument("query")
    s.add_argument("-n", "--limit", type=int, default=10)
    s.add_argument("--available-only", action="store_true", help="only return indicators whose series file exists locally")
    s.add_argument("--format", choices=["json", "table"], default="json")
    s.set_defaults(func=command_search)

    i = sub.add_parser("info", help="show metadata for one indicator")
    i.add_argument("indicator")
    i.add_argument("--format", choices=["json", "table"], default="json")
    i.set_defaults(func=command_info)

    l = sub.add_parser("latest", help="get latest snapshot rows for national or panel indicators")
    l.add_argument("indicator", nargs="?", help="indicator id or search phrase")
    l.add_argument("--query", help="search phrase if not using an id")
    l.add_argument("--geo", help="geography filter: e.g. US, CA, California, state:06")
    l.add_argument("--entity", help="entity_key/geo_id/series_id exact-ish filter")
    l.add_argument("--transform", default="level", choices=["level", "change", "pct_change", "yoy", "rolling", "indexed"])
    l.add_argument("--field", help="explicit observation field, e.g. change_12")
    l.add_argument("--limit", default="20")
    l.add_argument("--format", choices=["json", "table", "csv"], default="json")
    l.add_argument("--output", help="CSV path when --format csv")
    l.set_defaults(func=command_latest)

    ser = sub.add_parser("series", help="get a transformed time series")
    ser.add_argument("indicator")
    add_common_series_filters(ser)
    ser.add_argument("--limit", default="24", help="stdout row limit; use 'all' for all rows")
    ser.add_argument("--tail", action="store_true", help="show the last N rows instead of first N rows")
    ser.add_argument("--format", choices=["json", "table", "csv"], default="json")
    ser.add_argument("--output", help="write CSV to path when --format csv")
    ser.set_defaults(func=command_series)

    exp = sub.add_parser("export-csv", help="export a transformed series to CSV")
    exp.add_argument("indicator")
    add_common_series_filters(exp)
    exp.add_argument("--output", required=True)
    exp.add_argument("--tail", action="store_false", help=argparse.SUPPRESS)
    exp.set_defaults(func=command_export_csv)

    r = sub.add_parser("rank", help="rank entities/geographies for a panel indicator")
    r.add_argument("indicator")
    r.add_argument("--date", default="latest", help="latest or YYYY-MM-DD; date uses latest observation <= date")
    r.add_argument("--geo", help="optional geography filter")
    r.add_argument("--transform", default="level", choices=["level", "change", "pct_change", "yoy", "rolling", "indexed"])
    r.add_argument("--field", help="explicit observation field, e.g. change_12")
    r.add_argument("--order", choices=["desc", "asc"], default="desc")
    r.add_argument("-n", type=int, default=10)
    r.add_argument("--format", choices=["json", "table", "csv"], default="json")
    r.add_argument("--output", help="CSV path when --format csv")
    r.set_defaults(func=command_rank)

    c = sub.add_parser("compare", help="compare one panel indicator across geographies")
    c.add_argument("indicator")
    c.add_argument("--geos", nargs="+", required=True, help="geographies: e.g. CA NY TX or state:06 state:36")
    add_common_series_filters(c)
    c.add_argument("--limit", default="40")
    c.add_argument("--tail", action="store_true")
    c.add_argument("--format", choices=["json", "table", "csv"], default="json")
    c.add_argument("--output", help="CSV path when --format csv")
    c.add_argument("--chart", help="optional SVG chart output path")
    c.add_argument("--width", type=int, default=960)
    c.add_argument("--height", type=int, default=540)
    c.set_defaults(func=command_compare)

    comb = sub.add_parser("combine", help="combine 2-8 national or filtered series by ratio/diff/sum/share/formula")
    comb.add_argument("indicators", nargs="+")
    comb.add_argument("--op", choices=["ratio", "diff", "sum", "share"], default="diff")
    comb.add_argument("--formula", help="safe arithmetic over variables a-h; overrides --op")
    add_common_series_filters(comb)
    comb.add_argument("--include-components", action="store_true")
    comb.add_argument("--summary", action="store_true", help="print plain-language summary after table output")
    comb.add_argument("--limit", default="24")
    comb.add_argument("--tail", action="store_true")
    comb.add_argument("--format", choices=["json", "table", "csv"], default="json")
    comb.add_argument("--output", help="optional CSV output path")
    comb.add_argument("--chart", help="optional SVG chart output path")
    comb.add_argument("--width", type=int, default=960)
    comb.add_argument("--height", type=int, default=540)
    comb.set_defaults(func=command_combine)

    summ = sub.add_parser("summarize", help="plain-language summary for one series")
    summ.add_argument("indicator")
    add_common_series_filters(summ)
    summ.add_argument("--format", choices=["text", "json"], default="text")
    summ.set_defaults(func=command_summarize)

    ch = sub.add_parser("chart", help="write a simple offline SVG line chart for one or more series")
    ch.add_argument("indicators", nargs="+")
    add_common_series_filters(ch)
    ch.add_argument("--output", required=True, help="SVG path to write")
    ch.add_argument("--title")
    ch.add_argument("--width", type=int, default=960)
    ch.add_argument("--height", type=int, default=540)
    ch.add_argument("--format", choices=["json", "text"], default="json")
    ch.set_defaults(func=command_chart)

    return p


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        args.func(args)
    except CLIError as exc:
        eprint(f"error: {exc}")
        return 2
    except BrokenPipeError:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
