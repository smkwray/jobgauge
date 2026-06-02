# jobgauge — static frontend

A zero-build static single-page app that reads the backend's exported JSON
contract from `data/` and `search/`. No server runs at request time.

## Run locally

```sh
cd site/public
python3 -m http.server 8137 --bind 127.0.0.1
# open http://127.0.0.1:8137/
```

Any static file server works (the app uses native ES modules + `fetch`, so it
must be served over `http://`, not opened from `file://`).

## Layout

```
index.html               app shell (top bar, rail, mounts) + CDN: ECharts, fonts
assets/css/app.css        design system ("statistical almanac": paper/ink, Fraunces
                          + IBM Plex Sans/Mono, deep-petrol accent, light + dark themes)
assets/js/
  format.js               number/date/unit formatting (tabular), FIPS state map
  store.js                loads catalog/manifest/latest/search; availability + series cache
  transforms.js           level/change/%change/YoY/rolling + browser-computed visible-range index
  charts.js               ECharts builders: line/area, scatter (Beveridge), bar (rankings)
  search.js               field-aware fuzzy scorer + intent expansions + preset registry
  router.js               shareable query-string state (?view&ids&transform&range)
  exporters.js            CSV / JSON / PNG / SVG / copy-link, all with full provenance
  app.js                  views (Overview/Explore/Themes/About), command palette, compare tray
```

## Contract assumptions

- Availability source of truth is `manifest.available_indicator_ids`; catalog
  entries not in that list are shown as "Catalog only · not fetched" and cannot be charted.
- Raw `value` is the source of truth; `null` renders as a gap, never zero.
- `provider: fred` series are labeled "FRED mirror" everywhere they appear.
- Panel indicators (multiple `entity_key` rows, e.g. LAUS/QWI state series) render
  as a ranked table first.
- Charts never default to dual axes; for mixed units the UI prompts to index to 100.

## Charting

Apache ECharts (CDN-loaded). Line for most series, area for single positive levels,
scatter for the Beveridge curve, horizontal bars for rankings/changes, ranked table
for state/local and as an accessible precision fallback.
