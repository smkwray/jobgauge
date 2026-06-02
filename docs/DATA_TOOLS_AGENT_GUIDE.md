# jobgauge data tools agent guide

Use this guide when answering local labor-market questions from the bundled static jobgauge data.

## Ground rules

- Query-time work is offline and read-only over `site/public/data` and `site/public/search`.
- Do not call live APIs or web search for values that should come from the bundled data.
- Use `catalog.json` metadata through the CLI. Never invent source names, units, series ids, or seasonal adjustment.
- Preserve and cite source metadata in prose answers.
- If a value is missing, say it is missing and show the closest available series.
- Use the origin-only export for redistributable offline packages. A hosted export may include FRED mirror rows; do not package that as the offline bundle.

## Setup check

From the repo root:

```bash
bash scripts/bootstrap_jobgauge_tools.sh
./.jobgauge/bin/jg doctor --format json
```

Interpretation:

- `profile: origin_only` is expected for the redistributable offline clone.
- `profile: hosted` means this is not the redistributable offline package.
- Missing series files mean the clone/export is sparse or stale, or the sample bundle is incomplete.

## CLI command reference

### Search indicators

```bash
./.jobgauge/bin/jg search "unemployment" --available-only --format table -n 10
./.jobgauge/bin/jg search "prime age participation" --format json
```

Use search first for plain-English indicator names.

### Metadata

```bash
./.jobgauge/bin/jg info unemployment_rate --format json
```

Use this before writing prose so the answer cites the correct source metadata.

### Latest observation

```bash
./.jobgauge/bin/jg latest unemployment_rate --format table
./.jobgauge/bin/jg latest laus_state_unemployment_template --geo CA --format json
```

For panel/state series, omitting `--geo` returns multiple latest rows. Use `--limit all` if needed.

### Series

```bash
./.jobgauge/bin/jg series unemployment_rate --start 2019-01-01 --tail --format table
./.jobgauge/bin/jg series unemployment_rate --transform yoy --tail --format json
./.jobgauge/bin/jg series total_nonfarm_payrolls --field change_12 --tail --format table
```

Transforms:

- `level` → `value`
- `change` → `change_1`
- `pct_change` → `pct_change_1`
- `yoy` → `pct_change_12`
- `rolling` → `rolling_4` for weekly/quarterly data, otherwise `rolling_3`
- `indexed` → recomputed from the first finite value in the visible range, matching the frontend’s visible-range index behavior

Use `--field` for explicit precomputed columns such as `change_12`, `pct_change_4`, `rolling_12`, or `index_first_100`.

### Combine series

```bash
./.jobgauge/bin/jg combine unemployment_rate_black unemployment_rate_white \
  --op diff --start 2019-01-01 --tail --format table --summary
```

Operations:

- `ratio`: `a / b`
- `diff`: `a - b`
- `sum`: `a + b`
- `share`: `a / b * 100`
- Custom formula: `--formula "(a - b) / b * 100"`

The custom formula compiler only allows variables `a`-`h`, numbers, parentheses, and `+ - * /`. It cannot call functions, access attributes, import code, or execute arbitrary Python.

### Rank states/geographies

```bash
./.jobgauge/bin/jg rank laus_state_unemployment_template -n 10 --format table
./.jobgauge/bin/jg rank laus_state_unemployment_template --order asc -n 10 --format table
./.jobgauge/bin/jg rank laus_state_unemployment_template --field change_12 -n 10 --format table
```

`--date latest` uses `latest.json`. A specific date selects the latest observation at or before that date for each entity.

### Compare geographies

```bash
./.jobgauge/bin/jg compare laus_state_unemployment_template \
  --geos CA NY TX --start 2019-01-01 --tail --format table
```

State filters accept state names, postal abbreviations, and `state:<FIPS>` IDs.

### Summary

```bash
./.jobgauge/bin/jg summarize unemployment_rate --start 2019-01-01 --format text
```

Use summaries for first pass prose, then verify key numbers with `series`, `latest`, `rank`, or `combine`.

### CSV export

```bash
./.jobgauge/bin/jg export-csv prime_age_labor_force_participation_rate \
  --output exports/agent/prime_age_lfpr.csv
```

### SVG chart

```bash
./.jobgauge/bin/jg chart job_openings_level hires_level quits_level \
  --start 2019-01-01 \
  --output exports/agent/jolts_openings_hires_quits.svg \
  --format text
```

The SVG is static and offline. If input units differ, the CLI warns that a shared-axis chart should not be over-interpreted.

## Plain-English question mappings

### “How has the Black–White unemployment gap moved since 2019?”

1. Search if ids are uncertain:

   ```bash
   ./.jobgauge/bin/jg search "Black unemployment" --format table
   ./.jobgauge/bin/jg search "White unemployment" --format table
   ```

2. Compute the gap:

   ```bash
   ./.jobgauge/bin/jg combine unemployment_rate_black unemployment_rate_white \
     --op diff --start 2019-01-01 --tail --format json
   ```

3. Answer in percentage points, cite both series ids and latest date.

### “Latest job openings vs hires vs quits, as a chart”

```bash
./.jobgauge/bin/jg chart job_openings_level hires_level quits_level \
  --start 2019-01-01 --output exports/agent/jolts_openings_hires_quits.svg --format text
./.jobgauge/bin/jg latest job_openings_level --format table
./.jobgauge/bin/jg latest hires_level --format table
./.jobgauge/bin/jg latest quits_level --format table
```

Return the chart path and a short note with the latest values.

### “Export prime-age participation to CSV”

```bash
./.jobgauge/bin/jg export-csv prime_age_labor_force_participation_rate \
  --output exports/agent/prime_age_lfpr.csv
```

Return the file path and source metadata.

### “Which states have the highest unemployment right now?”

```bash
./.jobgauge/bin/jg rank laus_state_unemployment_template -n 10 --format table
```

Report the top states, latest date, units, seasonal adjustment, and source/series pattern.

## Answer template

Use this shape for numeric answers:

> Using bundled jobgauge data, `[indicator title]` (`indicator_id`, `series_id`, source/provider, units, SA/frequency, geography) was `[value]` on `[date]`. Over `[range]`, it changed by `[change]` `[units]`. Caveat: `[footnote/profile/staleness if any]`.

For derived results:

> I computed `[formula/op]` from `[input indicator ids and series ids]` aligned by observation date. Latest derived value: `[value]` `[derived units]` on `[date]`.
