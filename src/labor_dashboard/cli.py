from __future__ import annotations

import json
from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

from labor_dashboard.io.catalog import (
    CatalogError,
    filter_indicators,
    load_indicators,
    load_sources,
    validate_catalog,
)
from labor_dashboard.pipeline import refresh_indicators
from labor_dashboard.search_index import build_search_index, query_index, write_search_index
from labor_dashboard.settings import settings
from labor_dashboard.static_export import export_processed_to_static

app = typer.Typer(help="jobgauge labor-market data backend CLI")
catalog_app = typer.Typer(help="Catalog utilities")
search_app = typer.Typer(help="Search index utilities")
app.add_typer(catalog_app, name="catalog")
app.add_typer(search_app, name="search")
console = Console()


def _parse_csv_set(value: str | None) -> set[str] | None:
    if not value:
        return None
    return {item.strip() for item in value.split(",") if item.strip()}


@catalog_app.command("validate")
def catalog_validate(catalog_dir: Path = typer.Option(settings.catalog_dir, help="Catalog directory")) -> None:
    try:
        sources, indicators = validate_catalog(catalog_dir)
    except CatalogError as exc:
        console.print(f"[red]Catalog validation failed:[/red] {exc}")
        raise typer.Exit(1) from exc
    console.print(f"[green]Catalog valid[/green]: {len(sources)} sources, {len(indicators)} indicators")


@catalog_app.command("list")
def catalog_list(
    providers: str | None = typer.Option(None, help="Comma-separated providers"),
    groups: str | None = typer.Option(None, help="Comma-separated groups"),
    priorities: str | None = typer.Option(None, help="Comma-separated priorities"),
) -> None:
    indicators = load_indicators(settings.catalog_dir)
    selected = filter_indicators(indicators, _parse_csv_set(providers), _parse_csv_set(groups), _parse_csv_set(priorities))
    table = Table(title="Indicators")
    table.add_column("id")
    table.add_column("provider")
    table.add_column("series")
    table.add_column("group")
    table.add_column("priority")
    table.add_column("title")
    for indicator in selected:
        table.add_row(indicator.id, indicator.provider, indicator.series_id or "", indicator.group, indicator.priority, indicator.title)
    console.print(table)


@search_app.command("build")
def search_build() -> None:
    sources = load_sources(settings.catalog_dir)
    indicators = load_indicators(settings.catalog_dir)
    series_paths = _series_paths_from_processed(indicators, settings.processed_dir)
    docs = build_search_index(indicators, sources, series_paths)
    path = write_search_index(docs, settings.search_dir)
    console.print(f"[green]Wrote search index[/green] {path} ({len(docs)} documents)")


@search_app.command("query")
def search_query(query: str, limit: int = typer.Option(10, help="Max results")) -> None:
    path = settings.search_dir / "index.json"
    if not path.exists():
        sources = load_sources(settings.catalog_dir)
        indicators = load_indicators(settings.catalog_dir)
        docs = build_search_index(indicators, sources)
    else:
        docs = json.loads(path.read_text(encoding="utf-8"))["documents"]
    results = query_index(docs, query, limit=limit)
    table = Table(title=f"Search: {query}")
    table.add_column("score", justify="right")
    table.add_column("id")
    table.add_column("series")
    table.add_column("group")
    table.add_column("title")
    for result in results:
        table.add_row(f"{result['score']:.0f}", result["id"], result.get("series_id") or "", result["group"], result["title"])
    console.print(table)


@app.command("refresh")
def refresh(
    ids: str | None = typer.Option(None, help="Comma-separated indicator ids"),
    providers: str | None = typer.Option(None, help="Comma-separated provider ids, e.g. bls,fred"),
    groups: str | None = typer.Option(None, help="Comma-separated groups, e.g. core,demographics"),
    priorities: str | None = typer.Option(None, help="Comma-separated priorities"),
    start_year: int | None = typer.Option(None, help="Override start year"),
    end_year: int | None = typer.Option(None, help="Override end year"),
    dry_run: bool = typer.Option(False, help="Plan only; do not call APIs"),
    limit: int | None = typer.Option(None, help="Limit number of indicators"),
) -> None:
    indicators = load_indicators(settings.catalog_dir)
    selected = filter_indicators(indicators, _parse_csv_set(providers), _parse_csv_set(groups), _parse_csv_set(priorities))
    ids_filter = _parse_csv_set(ids)
    if ids_filter:
        selected = [indicator for indicator in selected if indicator.id in ids_filter]
    results = refresh_indicators(
        selected,
        settings=settings,
        providers_filter=_parse_csv_set(providers),
        start_year=start_year,
        end_year=end_year,
        dry_run=dry_run,
        limit=limit,
    )
    table = Table(title="Refresh results")
    table.add_column("status")
    table.add_column("provider")
    table.add_column("indicator")
    table.add_column("obs", justify="right")
    table.add_column("message")
    failed = 0
    for result in results:
        if result.status == "failed":
            failed += 1
        status_color = {"fetched": "green", "skipped": "yellow", "failed": "red"}.get(result.status, "white")
        table.add_row(f"[{status_color}]{result.status}[/{status_color}]", result.provider, result.indicator_id, str(result.observations), result.message)
    console.print(table)
    if failed:
        raise typer.Exit(1)


@app.command("export-static")
def export_static(origin_only: bool = typer.Option(False, help="Export only origin-agency providers; exclude FRED mirrors")) -> None:
    sources = load_sources(settings.catalog_dir)
    indicators = load_indicators(settings.catalog_dir)
    allowed_providers = {"bls", "bea", "qcew", "census_qwi", "dol"} if origin_only else None
    manifest = export_processed_to_static(indicators, sources, settings.processed_dir, settings.static_dir, allowed_providers=allowed_providers)
    console.print(f"[green]Exported static data[/green]: {len(manifest.series_files)} series files")


def _series_paths_from_processed(indicators, processed_dir: Path) -> dict[str, str]:
    paths: dict[str, str] = {}
    for indicator in indicators:
        if (processed_dir / f"{indicator.id}.parquet").exists() or (processed_dir / f"{indicator.id}.csv").exists():
            paths[indicator.id] = f"series/{indicator.id}.json"
    return paths


@app.command("status")
def status() -> None:
    sources, indicators = validate_catalog(settings.catalog_dir)
    search_path = settings.search_dir / "index.json"
    static_manifest = settings.static_dir / "manifest.json"
    table = Table(title="Backend status")
    table.add_column("check")
    table.add_column("value")
    table.add_row("sources", str(len(sources)))
    table.add_row("indicators", str(len(indicators)))
    table.add_row("search index", "present" if search_path.exists() else "missing")
    table.add_row("static manifest", "present" if static_manifest.exists() else "missing")
    table.add_row("processed files", str(len(list(settings.processed_dir.glob("*.parquet"))) if settings.processed_dir.exists() else 0))
    console.print(table)


if __name__ == "__main__":
    app()
