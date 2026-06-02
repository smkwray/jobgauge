# jobgauge

A static U.S. labor-market dashboard.

**Live dashboard:** https://smkwray.github.io/jobgauge/

jobgauge tracks the U.S. labor market using curated series from official statistical agencies (BLS, Census, BEA, DOL), with some series mirrored via FRED for context. A Python pipeline ingests and normalizes the data and exports a static data contract (JSON); a zero-build single-page app renders it on GitHub Pages with no server at request time.

The dashboard lets you explore indicators, build comparisons, derive new series from a formula, rank states on a map, and export charts to PNG, SVG, or CSV with full source provenance. Every view is shareable through its URL.

## How it works

```
catalog/  (indicator + source metadata, YAML)
   │   Python pipeline: fetch → normalize → transform → export
   ▼
site/public/data/    catalog.json · manifest.json · latest.json · series/<id>.json
site/public/search/  index.json (client-side fuzzy search)
   │
   └─ rendered by the static single-page app in site/public/  →  GitHub Pages
```

Each observation in the series files carries precomputed transform columns (changes, year-over-year, rolling averages, an index), so the dashboard reads consistent values without recomputing. The contract is documented in `docs/STATIC_DATA_CONTRACT.md`.

## Data sources & attribution

Data comes from the U.S. Bureau of Labor Statistics, Census Bureau (QWI / LEHD), Bureau of Economic Analysis, and Department of Labor, with some series mirrored via FRED for convenience. Source owner, series ID, units, frequency, seasonal adjustment, and geography are preserved throughout. See `NOTICE.md`.

## Local development

Serve the dashboard against the bundled data:

```bash
cd site/public
python3 -m http.server 8137 --bind 127.0.0.1
# open http://127.0.0.1:8137/
```

Run the data pipeline (free API keys are required only for live refreshes):

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env          # add keys
make validate-catalog
make export-static && make build-search
```

See `docs/REFRESH_AUTOMATION.md` for refresh and export targets.

## Repository layout

- `site/public/` — the static dashboard (HTML/CSS/ES-module JS + ECharts) and the exported data contract
- `src/labor_dashboard/` — the Python data pipeline (providers, transforms, static export)
- `catalog/` — indicator and source metadata (YAML)
- `tools/` — a standalone command-line tool for querying the exported data offline
- `docs/` — data contract, tool reference, and refresh notes
- `.github/workflows/` — CI, scheduled data refresh, and Pages deploy

## License

Released under the [MIT License](LICENSE). The underlying data originates from U.S. public-sector statistical agencies; see `NOTICE.md` for source attribution requirements.
