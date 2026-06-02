#!/usr/bin/env bash
set -euo pipefail

python -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e '.[dev]'
cp -n .env.example .env || true
make catalog
make search

echo "Bootstrap complete. Add API keys to .env before refreshing live data."
