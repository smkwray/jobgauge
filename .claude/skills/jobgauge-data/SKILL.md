---
name: jobgauge-data
description: Answer local U.S. labor-market data questions from jobgauge's bundled static JSON using the offline jobgauge-data CLI. Use for unemployment, payrolls, JOLTS, claims, participation, state rankings, CSV exports, and SVG charts.
---

Use the repo-local CLI, not live APIs:

```bash
./.jobgauge/bin/jg <command> ...
# or, before bootstrap:
python3 tools/jobgauge_data.py --data site/public/data <command> ...
```

Read `CLAUDE.md`, `AGENTS.md`, and `docs/DATA_TOOLS_AGENT_GUIDE.md`. Cite indicator id, series id, source/provider, units, frequency, seasonal adjustment, geography, and observation date. Keep query-time work offline and write requested exports under `exports/agent/`.
