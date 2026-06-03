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

## Scheduled hosted refresh

`.github/workflows/update-data.yml` refreshes the hosted dashboard weekly on Monday at
15:30 UTC. The workflow:

1. validates the catalog;
2. refreshes hosted providers with FRED mirrors using `make refresh-with-mirrors START_YEAR=1990`;
3. exports browser data with `make export-static`;
4. rebuilds `site/public/search/index.json`;
5. runs the local data-tools doctor and test suite;
6. commits changed files under `site/public/data/**` and `site/public/search/**`; and
7. deploys `site/public` to GitHub Pages in the same workflow run.

The direct deploy step is intentional. Commits made by the default GitHub Actions token do
not reliably trigger a second Pages workflow, so the data-update workflow deploys the
freshly generated site itself.

Manual runs are available from GitHub Actions:

- `profile=hosted` refreshes the hosted dashboard and deploys Pages.
- `profile=hosted` plus `include_dol=true` also retries the DOL-origin claims rows. DOL
  failures are warnings because hosted claims are covered by FRED mirrors.
- `profile=origin-check` builds an origin-only export and runs
  `doctor --require-origin-only` without committing or deploying. Use this as an offline
  package smoke check, not as the hosted site output.

Configure these repository secrets in
`Settings -> Secrets and variables -> Actions -> Repository secrets`:

- `BLS_API_KEY`
- `BLS_API_KEYS` (optional fallback keys, comma- or space-separated)
- `FRED_API_KEY`
- `BEA_API_KEY`
- `CENSUS_API_KEY`
- `DOL_API_KEY` (optional until DOL claims are reliable)

The hosted workflow intentionally excludes DOL from the scheduled refresh because the
DOL claims endpoint is currently rate/server limited. Keep `DOL_API_KEY` configured so
manual retries can be run without editing the workflow.

## Rate-limit behavior

- BLS: broad API refreshes can hit daily quota. Use `make refresh-ids` for small backfills, or prefer flat files for large LAUS/CES/BED backfills.
- BLS: optional `BLS_API_KEYS` fallback keys can be provided as comma- or space-separated values. The provider tries `BLS_API_KEY` first, then fallbacks.
- DOL: UI claims endpoint is confirmed, but local probes have returned transient endpoint/rate-limit errors. Retry claims after cooldown with the provider's minimal query shape.
