# jobgauge

A static U.S. labor-market dashboard.

**Live dashboard:** https://smkwray.github.io/jobgauge/

jobgauge tracks the U.S. labor market using curated series from official statistical agencies: the Bureau of Labor Statistics (BLS), the Census Bureau, the Bureau of Economic Analysis (BEA), and the Department of Labor (DOL), with some series mirrored through FRED (Federal Reserve Economic Data, from the St. Louis Fed) for context. A Python pipeline fetches and normalizes the data and exports static JSON files, which a zero-build single-page app renders on GitHub Pages with no server at request time.

The dashboard lets you explore indicators, build comparisons, derive new series from a formula, rank states on a map, and export charts to PNG, SVG, or CSV with source attribution. Every view is shareable through its URL.

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

Each observation in the series files carries precomputed transform columns (changes, year-over-year, rolling averages, an index), so the dashboard reads consistent values without recomputing. The file formats are documented in `docs/STATIC_DATA_CONTRACT.md`.

## Data sources & attribution

Data comes from BLS, the Census Bureau (Quarterly Workforce Indicators from the Longitudinal Employer-Household Dynamics program, QWI/LEHD), BEA, and DOL, with some series mirrored through FRED. Each series keeps its producing agency, series ID, units, frequency, seasonal adjustment, and geography. See `NOTICE.md`.

## Offline query CLI

`tools/jobgauge_data.py` queries the bundled data from the command line. It uses only the Python standard library and makes no network calls. From the repository root:

```bash
python3 tools/jobgauge_data.py search unemployment --available-only --format table
python3 tools/jobgauge_data.py latest unemployment_rate --format table
python3 tools/jobgauge_data.py rank laus_state_unemployment_template -n 5 --format table
```

To read a copy of `site/public/data` stored elsewhere, put `--data <dir>` before the command. `python3 tools/jobgauge_data.py --help` lists the other commands, including `series`, `compare`, `combine`, `export-csv`, and `chart`.

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

- `site/public/`: the static dashboard (HTML/CSS/ES-module JS + ECharts) and the exported JSON data
- `src/labor_dashboard/`: the Python data pipeline (providers, transforms, static export)
- `catalog/`: indicator and source metadata (YAML)
- `tools/`: the offline query CLI
- `docs/`: data file formats, tool reference, and refresh notes
- `.github/workflows/`: CI, scheduled data refresh, and Pages deploy

## License

Released under the [MIT License](LICENSE). The underlying data originates from U.S. public-sector statistical agencies; see `NOTICE.md` for source attribution requirements.
