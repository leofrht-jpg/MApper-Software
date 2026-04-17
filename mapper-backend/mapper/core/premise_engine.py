"""Wrapper around the ``premise`` library for generating prospective LCI databases.

A single :class:`ProspectiveDBGenerator` instance targets one base ecoinvent
database and one IAM/SSP combo, generating a set of year slices in a single
``NewDatabase`` batch call — premise shares its technosphere work across years.
"""
from __future__ import annotations

import time
from typing import Callable

from premise import NewDatabase, clear_cache


# Public premise encryption key (required, not secret).
PREMISE_KEY = b"tUePmX_S5B8ieF_SA7mufQ=="

AVAILABLE_IAMS: list[str] = ["remind", "image"]
AVAILABLE_SSPS: list[str] = ["SSP1-Base", "SSP2-Base", "SSP5-Base"]
AVAILABLE_YEARS: list[int] = list(range(2025, 2101, 5))

ProgressCallback = Callable[[str, float], None]


def prospective_db_name(base_db: str, iam: str, ssp: str, year: int) -> str:
    """Canonical naming used for generated databases."""
    return f"{base_db}_premise_{iam.lower()}_{ssp.lower()}_{year}"


class ProspectiveDBGenerator:
    """Generate prospective ecoinvent databases via premise.

    ``on_progress`` receives ``(stage: str, pct: float 0..1)``.
    """

    def __init__(
        self,
        base_db: str,
        iam: str,
        ssp: str,
        years: list[int],
        source_version: str = "3.9",
        system_model: str = "cutoff",
        on_progress: ProgressCallback | None = None,
    ) -> None:
        iam_l = iam.lower()
        if iam_l not in AVAILABLE_IAMS:
            raise ValueError(f"IAM {iam!r} not supported; choose from {AVAILABLE_IAMS}")
        if ssp not in AVAILABLE_SSPS:
            raise ValueError(f"SSP {ssp!r} not supported; choose from {AVAILABLE_SSPS}")
        if not years:
            raise ValueError("At least one target year is required")
        for y in years:
            if y not in AVAILABLE_YEARS:
                raise ValueError(f"Year {y} not in supported set {AVAILABLE_YEARS}")

        self.base_db = base_db
        self.iam = iam_l
        self.ssp = ssp
        self.years = sorted(set(years))
        self.source_version = source_version
        self.system_model = system_model
        self._cb = on_progress

    def _emit(self, stage: str, pct: float) -> None:
        if self._cb is not None:
            try:
                self._cb(stage, max(0.0, min(1.0, pct)))
            except Exception:
                pass

    def generate(self) -> list[str]:
        """Run premise for every configured year. Returns list of DB names written."""
        self._emit("initialising", 0.02)
        scenarios = [
            {"model": self.iam, "pathway": self.ssp, "year": year}
            for year in self.years
        ]
        t0 = time.time()
        ndb = NewDatabase(
            scenarios=scenarios,
            source_db=self.base_db,
            source_version=self.source_version,
            key=PREMISE_KEY,
            system_model=self.system_model,
            quiet=True,
        )
        self._emit("loading inventories", 0.1)

        self._emit("applying transformations", 0.2)
        ndb.update_all()
        self._emit("transformations complete", 0.75)

        names = [
            prospective_db_name(self.base_db, self.iam, self.ssp, year)
            for year in self.years
        ]
        self._emit("writing databases to brightway", 0.85)
        ndb.write_db_to_brightway(name=names)
        self._emit(f"done in {time.time() - t0:.0f}s", 1.0)
        return names


def clear_premise_cache() -> None:
    try:
        clear_cache()
    except Exception:
        pass
