.PHONY: setup catalog validate-catalog build-search search search-query dry-run refresh-dry-run refresh-core refresh-ids refresh-origin refresh-with-mirrors refresh-static refresh-static-origin export-static export-static-origin test lint backend-check ai-brief clean

VENV ?= $(HOME)/venvs/jobgauge
PYTHON ?= $(VENV)/bin/python
PYTHON_ENV = PYTHONDONTWRITEBYTECODE=1 PYTHONPYCACHEPREFIX=/tmp/jobgauge-pycache PYTHONPATH=src
PYTEST_ENV = PYTEST_ADDOPTS="-p no:cacheprovider"
RUFF_ENV = RUFF_CACHE_DIR=/tmp/jobgauge-ruff-cache

setup:
	mkdir -p "$$(dirname "$(VENV)")"
	python3 -m venv "$(VENV)"
	$(PYTHON_ENV) "$(PYTHON)" -B -m pip install --upgrade pip
	$(PYTHON_ENV) "$(PYTHON)" -B -m pip install -e ".[dev]"
	rm -rf src/*.egg-info

catalog: validate-catalog

validate-catalog:
	$(PYTHON_ENV) "$(PYTHON)" -B -m labor_dashboard.cli catalog validate

build-search:
	$(PYTHON_ENV) "$(PYTHON)" -B -m labor_dashboard.cli search build

search: build-search

search-query:
	$(PYTHON_ENV) "$(PYTHON)" -B -m labor_dashboard.cli search query "$(QUERY)"

dry-run: refresh-dry-run

refresh-dry-run:
	$(PYTHON_ENV) "$(PYTHON)" -B -m labor_dashboard.cli refresh --dry-run --limit 20

refresh-core:
	$(PYTHON_ENV) "$(PYTHON)" -B -m labor_dashboard.cli refresh --providers bls,fred,dol --priorities core --start-year 2000

refresh-ids:
	$(PYTHON_ENV) "$(PYTHON)" -B -m labor_dashboard.cli refresh --ids "$(IDS)" --start-year $(or $(START_YEAR),2000)

refresh-origin:
	$(PYTHON_ENV) "$(PYTHON)" -B -m labor_dashboard.cli refresh --providers bls,bea,qcew,census_qwi --start-year $(or $(START_YEAR),2000)

refresh-with-mirrors:
	$(PYTHON_ENV) "$(PYTHON)" -B -m labor_dashboard.cli refresh --providers bls,bea,qcew,census_qwi,fred --start-year $(or $(START_YEAR),2000)

refresh-static: refresh-origin export-static build-search

refresh-static-origin: refresh-origin export-static-origin build-search

export-static:
	$(PYTHON_ENV) "$(PYTHON)" -B -m labor_dashboard.cli export-static

export-static-origin:
	$(PYTHON_ENV) "$(PYTHON)" -B -m labor_dashboard.cli export-static --origin-only

test:
	$(PYTHON_ENV) $(PYTEST_ENV) "$(PYTHON)" -B -m pytest -q

lint:
	$(PYTHON_ENV) $(RUFF_ENV) "$(PYTHON)" -B -m ruff check src tests

backend-check: validate-catalog build-search test
	$(PYTHON_ENV) "$(PYTHON)" -B -m labor_dashboard.cli status

clean:
	rm -rf .pytest_cache .ruff_cache .mypy_cache .cache src/*.egg-info

include Makefile.data-tools
