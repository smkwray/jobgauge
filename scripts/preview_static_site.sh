#!/usr/bin/env bash
set -euo pipefail
python -m http.server --directory site/public 8000
