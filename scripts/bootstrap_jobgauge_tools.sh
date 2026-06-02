#!/usr/bin/env bash
# Bootstrap jobgauge's local data-tools CLI from the repository root.
# This script is intentionally dependency-free and offline after the repo exists.
set -euo pipefail

ROOT="${1:-$(pwd)}"
cd "$ROOT"

if [[ ! -f "site/public/data/manifest.json" ]]; then
  echo "error: run this from the jobgauge repo root, or pass the repo root as the first argument" >&2
  echo "expected: site/public/data/manifest.json" >&2
  exit 2
fi

PYTHON_BIN="${PYTHON_BIN:-}"
if [[ -z "$PYTHON_BIN" ]]; then
  if command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="$(command -v python3)"
  else
    cat >&2 <<'EOF'
error: python3 was not found.

Ask the agent to install Python 3.10+ once, then rerun this script.
Recommended macOS paths:
  - Homebrew if already installed: brew install python
  - python.org signed installer: https://www.python.org/downloads/macos/

No Python package dependencies are needed for jobgauge-data itself.
EOF
    exit 2
  fi
fi

"$PYTHON_BIN" - <<'PY'
import sys
if sys.version_info < (3, 10):
    raise SystemExit("error: Python 3.10+ is required; found " + sys.version.split()[0])
PY

if [[ ! -f "tools/jobgauge_data.py" ]]; then
  echo "error: tools/jobgauge_data.py is missing. Copy the data-tools files into the repo root first." >&2
  exit 2
fi

chmod +x tools/jobgauge_data.py
mkdir -p .jobgauge/bin exports/agent
cat > .jobgauge/bin/jg <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec python3 "$ROOT/tools/jobgauge_data.py" --data "$ROOT/site/public/data" "$@"
EOF
chmod +x .jobgauge/bin/jg

# Smoke checks. Do not fail just because the attached sample is hosted or sparse;
# the warning is useful during integration.
"$PYTHON_BIN" tools/jobgauge_data.py --data site/public/data doctor --format table || true
"$PYTHON_BIN" tools/jobgauge_data.py --data site/public/data search unemployment --available-only --format table -n 3 || true

echo
cat <<EOF
jobgauge data tools are ready.

Use one of these forms from the repo root:
  python3 tools/jobgauge_data.py --data site/public/data doctor
  ./.jobgauge/bin/jg search "prime age participation" --format table
  ./.jobgauge/bin/jg rank laus_state_unemployment_template -n 10 --format table

For local agent sessions, start from the repo-root instruction files.
EOF
