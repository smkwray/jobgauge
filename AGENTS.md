# jobgauge — repository guide

jobgauge is a static U.S. labor-market dashboard with a Python data pipeline. The pipeline ingests curated public series and exports a deterministic static data contract under `site/public/` that a zero-build dashboard renders on GitHub Pages, and that a local coding agent can query offline through the bundled CLI (see "Local economist data tools" below).

## Repository rules

1. Never commit secrets. Use a local `.env` (gitignored); copy `.env.example` to start.
2. Prefer official source APIs and flat files over scraped pages.
3. Declare every indicator in catalog YAML before wiring it into a provider.
4. Outputs under `site/public/data` and `site/public/search` must be deterministic and browser-readable.
5. Preserve source attribution, release names, units, frequency, seasonal adjustment, and geography in metadata (see `NOTICE.md`).
6. The local data-tools layer is additive and read-only over `site/public/data` and `site/public/search`; do not change the static data contract to satisfy a tools request.
7. Build offline redistributable packages from the origin-agency export (`make export-static-origin`), not the hosted export; do not bundle FRED-derived value files into offline packages.

## Commit style

Small commits with scope prefixes: `catalog:`, `providers:`, `pipeline:`, `docs:`, `tests:`, `site:`, `tools:`.

# Local economist data tools

The user may be a non-technical economist asking plain-English labor-market questions. Answer with the bundled static data only. The canonical command is:

```bash
python3 tools/jobgauge_data.py --data site/public/data <command> ...
# after bootstrap, this wrapper is also available:
./.jobgauge/bin/jg <command> ...
```

Run this once at the start of a local data-analysis session:

```bash
python3 tools/jobgauge_data.py --data site/public/data doctor --format json
```

If `profile` is not `origin_only`, warn that the checkout is not the redistributable offline package. You may still use the local files for analysis, but do not represent a hosted/FRED-containing export as the offline package.

## Query protocol for economist questions

1. Search before computing unless the indicator id is obvious:

   ```bash
   ./.jobgauge/bin/jg search "prime age participation" --available-only --format table
   ./.jobgauge/bin/jg info prime_age_labor_force_participation_rate --format json
   ```

2. Use catalog metadata for labels, units, frequency, seasonal adjustment, release, provider, and series id. Never hard-code units or source names.
3. Prefer CLI outputs over manually reading raw JSON. The CLI mirrors the static contract and frontend transforms.
4. Cite every numeric answer with at least: indicator id, title, series id, source/provider, units, seasonal adjustment, geography, and observation date.
5. Never invent missing values. If the CLI returns no rows or `null`, say the bundled data do not contain the requested value.
6. Keep query-time work offline. Do not use live APIs, web search, FRED, BLS API, Census API, or telemetry to answer local data questions.
7. Generated user exports/charts may go under `exports/agent/`. Do not write into `site/public/data`, `site/public/search`, or provider/backend source data.

## Common CLI recipes

Black–White unemployment gap since 2019:

```bash
./.jobgauge/bin/jg combine unemployment_rate_black unemployment_rate_white \
  --op diff --start 2019-01-01 --tail --format table --summary
```

Latest job openings vs hires vs quits as a chart:

```bash
./.jobgauge/bin/jg chart job_openings_level hires_level quits_level \
  --start 2019-01-01 --output exports/agent/jolts_openings_hires_quits.svg --format text
./.jobgauge/bin/jg latest job_openings_level --format table
./.jobgauge/bin/jg latest hires_level --format table
./.jobgauge/bin/jg latest quits_level --format table
```

Export prime-age participation to CSV:

```bash
./.jobgauge/bin/jg export-csv prime_age_labor_force_participation_rate \
  --output exports/agent/prime_age_lfpr.csv
```

States with highest unemployment right now:

```bash
./.jobgauge/bin/jg rank laus_state_unemployment_template -n 10 --format table
```

Compare unemployment for selected states:

```bash
./.jobgauge/bin/jg compare laus_state_unemployment_template \
  --geos CA NY TX --start 2019-01-01 --chart exports/agent/state_unemployment_ca_ny_tx.svg --format table --tail
```

A single-series summary:

```bash
./.jobgauge/bin/jg summarize unemployment_rate --start 2019-01-01 --format text
```

Specific transforms:

```bash
./.jobgauge/bin/jg series unemployment_rate --transform yoy --tail --format table
./.jobgauge/bin/jg series total_nonfarm_payrolls --field change_12 --tail --format table
./.jobgauge/bin/jg series total_nonfarm_payrolls --transform indexed --start 2019-01-01 --tail --format table
```

Safe custom formula over up to eight series (`a`-`h`):

```bash
./.jobgauge/bin/jg combine unemployment_rate u6_underemployment_rate \
  --formula "b - a" --start 2019-01-01 --format json --tail
```

## Output choice

- Use `--format json` when you need to reason from structured values.
- Use `--format table` for a human-facing quick check.
- Use `export-csv` or `--format csv --output ...` when the user asks for a spreadsheet-ready file.
- Use `chart ... --output path.svg` for quick offline charts. The SVG is static and has no JavaScript or network dependency.

## Failure handling

- If an indicator is missing, run `search` with broader terms and show the nearest available alternatives.
- If the question is outside the bundled data, say so and list the closest local indicators. Do not fetch live data.
- If a command fails because a series file is absent, run `doctor`; the clone may be stale, sparse, or not built with the origin-only export.
- If macOS, Codex, or Claude blocks file access, ask the human for the minimum permission click needed; do not request full-disk access unless the repo is stored in a protected folder and narrower Files & Folders access failed.

See `docs/DATA_TOOLS_AGENT_GUIDE.md` for detailed command reference and `docs/FAILURE_MODES.md` for mitigations.
