# Static data contract

The backend produces static browser-readable files under `site/public`. GitHub Pages can serve these directly.

There are two supported export profiles:

- `make export-static`: full hosted-dashboard export. Includes all processed providers, including FRED mirror series where present.
- `make export-static-origin`: redistributable offline export. Includes origin-agency providers only and excludes FRED mirror values from catalog, latest snapshot, manifest, and series files.

## Paths

```text
site/public/data/catalog.json
site/public/data/manifest.json
site/public/data/latest.json
site/public/data/series/<indicator_id>.json
site/public/search/index.json
```

## `data/catalog.json`

Top-level payload:

```json
{
  "schema_version": "0.1",
  "indicators": [],
  "sources": []
}
```

Each indicator contains the fields from `labor_dashboard.models.Indicator`, including:

- `id`
- `title`
- `short_title`
- `provider`
- `source_id`
- `series_id`
- `group`
- `subgroup`
- `priority`
- `frequency`
- `units`
- `seasonal_adjustment`
- `geography`
- `release`
- `tags`
- `aliases`
- `notes`
- `chart`

Frontend rule: use catalog metadata for labels and filters. Do not hard-code units or source names.

## `data/series/<indicator_id>.json`

Top-level payload:

```json
{
  "schema_version": "0.1",
  "indicator": {},
  "observations": []
}
```

Each observation should contain at minimum:

```json
{
  "indicator_id": "unemployment_rate",
  "date": "2025-01-01",
  "value": 4.0,
  "source": "bls_public_api",
  "series_id": "LNS14000000",
  "frequency": "M",
  "seasonal_adjustment": "SA",
  "units": "Percent",
  "realtime_start": null,
  "realtime_end": null,
  "footnotes": "",
  "geography": "US",
  "geo_id": "US",
  "geo_label": "US",
  "entity_key": "unemployment_rate|US",
  "change_1": 0.1,
  "pct_change_1": 2.5,
  "change_4": 0.2,
  "pct_change_4": 5.0,
  "change_12": 0.4,
  "pct_change_12": 11.1,
  "rolling_3": 4.0,
  "rolling_4": 4.0,
  "rolling_6": 4.0,
  "rolling_12": 4.0,
  "index_first_100": 100.0
}
```

Transform columns may be null near the start of a series. `change_4`, `pct_change_4`, and `rolling_4` are available for quarterly and weekly use cases, but labels remain frequency-aware UI responsibility. Panel indicators group transforms by `entity_key`, so state/QWI rows do not mix values across geographies.

All static payloads are strict JSON: missing, `NaN`, and infinite numeric values are serialized as `null`.

## `data/latest.json`

A compact latest-observation snapshot for cards and tables:

```json
{
  "observations": []
}
```

The frontend should join these rows back to `catalog.json` by `indicator_id` for labels.

For panel indicators, `latest.json` may contain one row per `entity_key`, not one row per catalog indicator. Headline cards should use national single-entity rows unless a geography filter is active.

## `data/manifest.json`

```json
{
  "generated_at": "2026-06-01T00:00:00Z",
  "indicators": 109,
  "series_files": ["series/unemployment_rate.json"],
  "series_file_by_indicator": {"unemployment_rate": "series/unemployment_rate.json"},
  "available_indicator_ids": ["unemployment_rate"],
  "search_index": "../search/index.json",
  "profile": "hosted",
  "schema_version": "0.1"
}
```

Use this file to discover which series files exist after a refresh. `indicators` is the number of indicators included in the exported catalog; it can be larger than `series_files.length` when a cataloged indicator has not been fetched yet. `available_indicator_ids` and `series_file_by_indicator` are the frontend source of truth for whether a chart route can load in the current export profile.

`profile` is `hosted` for the full dashboard export and `origin_only` for redistributable/offline exports that exclude FRED-derived values.

## `search/index.json`

```json
{
  "version": "0.1",
  "documents": []
}
```

Each document contains compact metadata plus a `haystack` field for fuzzy search. Documents also include `has_series` and `series_path` based on currently processed local files, but the frontend should still prefer `manifest.json` for availability in the loaded export profile.

The frontend should build field-aware search over separate fields such as title, aliases, tags, release, source, and series ID. Plain haystack search is acceptable for backend smoke tests, not for the production search experience.

## Backward compatibility

Breaking schema changes require:

1. bumping `schema_version`;
2. updating this document;
3. updating tests;
4. notifying frontend maintainers before implementation proceeds.
