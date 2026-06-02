import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "tools" / "jobgauge_data.py"


def write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj), encoding="utf-8")


class JobgaugeDataCliTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.data = root / "site" / "public" / "data"
        self.search = root / "site" / "public" / "search"
        indicators = [
            {
                "id": "a_rate", "title": "A rate", "short_title": "A", "provider": "bls",
                "source_id": "bls_public_api", "series_id": "A001", "frequency": "M",
                "units": "Percent", "seasonal_adjustment": "SA", "geography": "US",
                "release": "Test Release", "tags": ["rate"], "aliases": ["alpha"], "chart": {},
            },
            {
                "id": "b_rate", "title": "B rate", "short_title": "B", "provider": "bls",
                "source_id": "bls_public_api", "series_id": "B001", "frequency": "M",
                "units": "Percent", "seasonal_adjustment": "SA", "geography": "US",
                "release": "Test Release", "tags": ["rate"], "aliases": ["beta"], "chart": {},
            },
            {
                "id": "state_rate", "title": "State rate", "short_title": "State", "provider": "bls",
                "source_id": "bls_public_api", "series_id": "S*", "frequency": "M",
                "units": "Percent", "seasonal_adjustment": "SA", "geography": "state:*",
                "release": "Test Release", "tags": ["state"], "aliases": [], "chart": {},
            },
        ]
        write_json(self.data / "catalog.json", {"schema_version": "0.1", "indicators": indicators, "sources": []})
        write_json(self.data / "manifest.json", {
            "schema_version": "0.1", "profile": "origin_only", "generated_at": "2026-01-01T00:00:00Z",
            "available_indicator_ids": ["a_rate", "b_rate", "state_rate"],
            "series_files": ["series/a_rate.json", "series/b_rate.json", "series/state_rate.json"],
            "series_file_by_indicator": {"a_rate": "series/a_rate.json", "b_rate": "series/b_rate.json", "state_rate": "series/state_rate.json"},
            "search_index": "../search/index.json", "indicators": 3,
        })
        docs = []
        for i in indicators:
            docs.append({**i, "has_series": True, "series_path": f"series/{i['id']}.json", "haystack": " ".join([i["id"], i["title"], *i.get("aliases", [])])})
        write_json(self.search / "index.json", {"version": "0.1", "documents": docs})
        def obs(ind, sid, values, geo="US", label="US"):
            rows = []
            prev = None
            first = values[0][1]
            for date, value in values:
                rows.append({
                    "indicator_id": ind, "date": date, "value": value, "source": "bls_public_api",
                    "series_id": sid, "frequency": "M", "seasonal_adjustment": "SA", "units": "Percent",
                    "geography": geo, "geo_id": geo, "geo_label": label, "entity_key": f"{ind}|{geo}",
                    "change_1": None if prev is None else value - prev,
                    "pct_change_1": None if prev in (None, 0) else (value - prev) / prev * 100,
                    "change_12": None, "pct_change_12": None, "change_4": None, "pct_change_4": None,
                    "rolling_3": value, "rolling_4": value, "rolling_6": value, "rolling_12": value,
                    "index_first_100": value / first * 100 if first else None,
                    "realtime_start": None, "realtime_end": None, "footnotes": "",
                })
                prev = value
            return rows
        a_rows = obs("a_rate", "A001", [("2026-01-01", 4.0), ("2026-02-01", 4.5)])
        b_rows = obs("b_rate", "B001", [("2026-01-01", 3.0), ("2026-02-01", 3.25)])
        state_rows = obs("state_rate", "S06", [("2026-02-01", 5.0)], "state:06", "state:06") + obs("state_rate", "S36", [("2026-02-01", 4.0)], "state:36", "state:36")
        write_json(self.data / "series" / "a_rate.json", {"schema_version": "0.1", "indicator": indicators[0], "observations": a_rows})
        write_json(self.data / "series" / "b_rate.json", {"schema_version": "0.1", "indicator": indicators[1], "observations": b_rows})
        write_json(self.data / "series" / "state_rate.json", {"schema_version": "0.1", "indicator": indicators[2], "observations": state_rows})
        write_json(self.data / "latest.json", {"schema_version": "0.1", "observations": [a_rows[-1], b_rows[-1], *state_rows]})

    def tearDown(self):
        self.tmp.cleanup()

    def run_cli(self, *args):
        cmd = [sys.executable, str(CLI), "--data", str(self.data), *args]
        return subprocess.run(cmd, text=True, capture_output=True, check=True)

    def test_search(self):
        result = self.run_cli("search", "alpha", "--format", "json")
        payload = json.loads(result.stdout)
        self.assertEqual(payload["results"][0]["id"], "a_rate")

    def test_latest(self):
        result = self.run_cli("latest", "a_rate", "--format", "json")
        payload = json.loads(result.stdout)
        self.assertEqual(payload["rows"][0]["value"], 4.5)

    def test_combine_diff(self):
        result = self.run_cli("combine", "a_rate", "b_rate", "--op", "diff", "--format", "json", "--limit", "all")
        payload = json.loads(result.stdout)
        self.assertAlmostEqual(payload["rows"][-1]["value"], 1.25)
        self.assertEqual(payload["metadata"]["units"], "Percentage points")

    def test_rank_state_names(self):
        result = self.run_cli("rank", "state_rate", "--format", "json", "-n", "1")
        payload = json.loads(result.stdout)
        self.assertEqual(payload["rows"][0]["geo_label"], "California")
        self.assertEqual(payload["rows"][0]["value"], 5.0)

    def test_export_csv_and_chart(self):
        csv_path = Path(self.tmp.name) / "out.csv"
        chart_path = Path(self.tmp.name) / "out.svg"
        self.run_cli("export-csv", "a_rate", "--output", str(csv_path))
        self.run_cli("chart", "a_rate", "b_rate", "--output", str(chart_path), "--format", "text")
        self.assertIn("date,value", csv_path.read_text())
        self.assertIn("<svg", chart_path.read_text())


if __name__ == "__main__":
    unittest.main()
