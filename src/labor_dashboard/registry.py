from __future__ import annotations

from labor_dashboard.providers import (
    BEAProvider,
    BLSProvider,
    CensusQWIProvider,
    DOLProvider,
    FREDProvider,
    QCEWProvider,
)
from labor_dashboard.providers.base import DataProvider
from labor_dashboard.settings import Settings


def provider_registry(settings: Settings) -> dict[str, DataProvider]:
    return {
        "bls": BLSProvider(settings),
        "fred": FREDProvider(settings),
        "bea": BEAProvider(settings),
        "census_qwi": CensusQWIProvider(settings),
        "qcew": QCEWProvider(settings),
        "dol": DOLProvider(settings),
    }
