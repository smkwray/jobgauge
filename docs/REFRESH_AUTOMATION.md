# Refresh automation notes

The backend can refresh data programmatically from the catalog. Keep generated raw/processed data ignored unless a maintainer explicitly approves committing a compact public static export.

## Local refresh commands

Use targeted refreshes when API quota is tight:

```bash
make refresh-ids IDS="unemployment_rate,total_nonfarm_payrolls" START_YEAR=2000
make export-static
make search
```

Use the full dashboard export for the hosted dashboard. This includes available FRED mirror series alongside origin-agency series:

```bash
make refresh-with-mirrors START_YEAR=2000
make export-static
make search
```

Use origin-source refreshes when preparing a redistributable offline package or repository snapshot that must not bundle FRED-derived values:

```bash
make refresh-origin START_YEAR=2000
make export-static-origin
make search
```

Use FRED mirrors for hosted-dashboard context, local development, or runtime user-key fetches:

```bash
make refresh-with-mirrors START_YEAR=2000
```

## Scheduling posture

Automated scheduled refresh is appropriate after two gates are closed:

1. The workflow has a declared export target: full hosted dashboard (`make export-static`) or redistributable offline package (`make export-static-origin`).
2. The maintainer approves the exact repository/write path for scheduled commits.

Until then, do not add an auto-committing workflow. A future hosted-dashboard workflow should run `make catalog`, refresh providers including FRED mirrors, run `make export-static`, run `make search`, and run tests. A future redistributable offline workflow should run origin-source providers only, run `make export-static-origin`, run `make search`, and only publish deterministic origin-source static outputs.

## Rate-limit behavior

- BLS: broad API refreshes can hit daily quota. Use `make refresh-ids` for small backfills, or prefer flat files for large LAUS/CES/BED backfills.
- BLS: optional `BLS_API_KEYS` fallback keys can be provided as comma- or space-separated values. The provider tries `BLS_API_KEY` first, then fallbacks.
- DOL: UI claims endpoint is confirmed, but local probes have returned transient endpoint/rate-limit errors. Retry claims after cooldown with the provider's minimal query shape.
