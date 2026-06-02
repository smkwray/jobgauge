# jobgauge

Static U.S. labor-market dashboard — and an offline data toolkit your coding agent can query in plain English.

**Live dashboard:** https://smkwray.github.io/jobgauge/

jobgauge tracks the U.S. labor market with curated series from official statistical agencies (BLS, Census, BEA, DOL), with some series mirrored via FRED for context. A Python pipeline normalizes the data and exports a deterministic static data contract; a zero-build single-page app renders it on GitHub Pages with no server. Because the data ships in the repository, you can also clone it and ask a local AI coding agent questions about it — completely offline, no API keys.

## Two ways to use it

### 1. The dashboard

Visit the live site above. Explore indicators, build comparisons, derive your own series from a formula, rank states on a map, and export any chart to PNG / SVG / CSV with full source provenance. Every view is shareable through the URL.

### 2. Clone it and ask your agent

The repository bundles a small, read-only command-line tool plus instructions that let **OpenAI Codex** or **Claude Code** answer labor-market questions from the bundled data — offline, with no API keys.

From the repository root, hand your agent something like:

> Use this jobgauge repo to answer U.S. labor-market questions from the bundled data only. Read `AGENTS.md` (and `CLAUDE.md` if you are Claude), run `bash scripts/bootstrap_jobgauge_tools.sh`, then use `./.jobgauge/bin/jg` for queries. Keep it offline and cite the source for every number.

Then ask things like:

- "How has the Black–White unemployment gap moved since 2019?"
- "Latest job openings vs hires vs quits, as a chart."
- "Export prime-age participation to CSV."
- "Which states have the highest unemployment right now?"

The CLI (`tools/jobgauge_data.py`, Python standard library only) provides:

- `search` / `info` — find indicators and read their metadata
- `latest` / `series` — current values and full history, with transforms (change, % change, year-over-year, rolling, indexed)
- `combine` — derive a new series from two others (ratio, difference, sum, share, or a safe custom formula)
- `rank` / `compare` — rank or compare states and geographies
- `summarize` — a plain-language summary of a series
- `export-csv` / `chart` — spreadsheet exports and dependency-free SVG charts
- `doctor` — check the bundled data's freshness and export profile

See `docs/DATA_TOOLS_AGENT_GUIDE.md` for the full command reference and recipes, and `docs/FAILURE_MODES.md` for troubleshooting.

## How it works

```
catalog/  (indicator + source metadata, YAML)
   │   Python pipeline: fetch → normalize → transform → export
   ▼
site/public/data/    catalog.json · manifest.json · latest.json · series/<id>.json
site/public/search/  index.json (client-side fuzzy search)
   │
   ├─ rendered by the static SPA in site/public/      → GitHub Pages
   └─ queried offline by the bundled CLI (tools/jobgauge_data.py)
```

Each observation in the series files carries precomputed transform columns (changes, year-over-year, rolling averages, an index), so the dashboard and the CLI read consistent values without recomputing. The contract is documented in `docs/STATIC_DATA_CONTRACT.md`.

## Data sources & attribution

Data comes from the U.S. Bureau of Labor Statistics, Census Bureau (QWI / LEHD), Bureau of Economic Analysis, and Department of Labor, with some series mirrored via FRED for convenience. Source owner, series ID, units, frequency, seasonal adjustment, and geography are preserved throughout. FRED mirrors appear only in the hosted export; redistributable offline packages are built FRED-free with `make export-static-origin`. See `NOTICE.md`.

## Local development

Run the dashboard against the bundled data:

```bash
cd site/public
python3 -m http.server 8137 --bind 127.0.0.1
# open http://127.0.0.1:8137/
```

Run the data pipeline (free API keys required only for live refreshes):

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
- `tools/` — the offline data-tools CLI
- `docs/` — data contract, source map, tool guides, and refresh notes
- `.github/workflows/` — CI, scheduled data refresh, and Pages deploy

## License

Released under the [MIT License](LICENSE). The underlying data originates from U.S. public-sector statistical agencies; see `NOTICE.md` for source attribution requirements.
