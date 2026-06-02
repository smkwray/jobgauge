import re
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings loaded from environment variables and .env."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    bls_api_key: str | None = Field(default=None, alias="BLS_API_KEY")
    bls_api_keys_raw: str | None = Field(default=None, alias="BLS_API_KEYS")
    fred_api_key: str | None = Field(default=None, alias="FRED_API_KEY")
    bea_api_key: str | None = Field(default=None, alias="BEA_API_KEY")
    census_api_key: str | None = Field(default=None, alias="CENSUS_API_KEY")
    dol_api_key: str | None = Field(default=None, alias="DOL_API_KEY")

    catalog_dir: Path = Field(default=Path("catalog"), alias="LABOR_DASHBOARD_CATALOG_DIR")
    raw_dir: Path = Field(default=Path("data/raw"), alias="LABOR_DASHBOARD_RAW_DIR")
    processed_dir: Path = Field(default=Path("data/processed"), alias="LABOR_DASHBOARD_PROCESSED_DIR")
    static_dir: Path = Field(default=Path("site/public/data"), alias="LABOR_DASHBOARD_STATIC_DIR")
    search_dir: Path = Field(default=Path("site/public/search"), alias="LABOR_DASHBOARD_SEARCH_DIR")

    default_start_year: int = 1990
    request_timeout_seconds: int = 60

    def ensure_dirs(self) -> None:
        for path in [self.raw_dir, self.processed_dir, self.static_dir, self.search_dir]:
            path.mkdir(parents=True, exist_ok=True)

    @property
    def bls_api_keys(self) -> list[str]:
        keys: list[str] = []
        if self.bls_api_key:
            keys.append(self.bls_api_key)
        if self.bls_api_keys_raw:
            keys.extend([item for item in re.split(r"[\s,;]+", self.bls_api_keys_raw) if item])
        deduped = []
        for key in keys:
            if key not in deduped:
                deduped.append(key)
        return deduped


settings = Settings()
