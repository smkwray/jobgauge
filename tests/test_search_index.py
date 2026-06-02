from pathlib import Path

from labor_dashboard.io.catalog import load_indicators, load_sources
from labor_dashboard.search_index import build_search_index, query_index, write_search_index


def test_search_index_matches_aliases(tmp_path: Path) -> None:
    sources = load_sources(Path("catalog"))
    indicators = load_indicators(Path("catalog"))
    docs = build_search_index(indicators, sources, {"unemployment_rate": "series/unemployment_rate.json"})
    path = write_search_index(docs, tmp_path)
    assert path.exists()
    results = query_index(docs, "jobless rate", limit=5)
    ids = [result["id"] for result in results]
    assert "unemployment_rate" in ids
    unemployment_doc = next(doc for doc in docs if doc["id"] == "unemployment_rate")
    missing_doc = next(doc for doc in docs if doc["id"] != "unemployment_rate")
    assert unemployment_doc["has_series"] is True
    assert unemployment_doc["series_path"] == "series/unemployment_rate.json"
    assert missing_doc["has_series"] is False
