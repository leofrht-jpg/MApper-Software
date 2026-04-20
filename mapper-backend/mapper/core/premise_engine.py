"""Wrapper around the ``premise`` library for generating prospective LCI databases.

A single :class:`ProspectiveDBGenerator` instance targets one base ecoinvent
database and one IAM/SSP combo, generating a set of year slices in a single
``NewDatabase`` batch call — premise shares its technosphere work across years.

The premise encryption key (Fernet) is required by ``NewDatabase`` but is not
distributed with the package. It is loaded from, in order of precedence:

  1. ``PREMISE_KEY`` environment variable
  2. ``~/.premise/premise_key`` file (single line of text)

If neither is present, :class:`PremiseKeyMissingError` is raised with
instructions for the user.
"""
from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Callable

from premise import NewDatabase, clear_cache


# ── Premise key resolution ────────────────────────────────────────────────────


class PremiseKeyMissingError(RuntimeError):
    """Raised when neither env var nor config file provides the premise key."""


PREMISE_KEY_ENV = "PREMISE_KEY"
PREMISE_KEY_FILE = Path.home() / ".premise" / "premise_key"
PREMISE_KEY_HELP = (
    "Premise key not configured. Get one from romain.sacchi@psi.ch, then either "
    f"set the {PREMISE_KEY_ENV} environment variable or write the key to "
    f"{PREMISE_KEY_FILE}."
)


def load_premise_key() -> bytes:
    """Return the premise Fernet key, or raise :class:`PremiseKeyMissingError`."""
    env = os.environ.get(PREMISE_KEY_ENV, "").strip()
    if env:
        return env.encode("utf-8")
    if PREMISE_KEY_FILE.is_file():
        try:
            text = PREMISE_KEY_FILE.read_text(encoding="utf-8").strip()
        except OSError as exc:
            raise PremiseKeyMissingError(
                f"Could not read {PREMISE_KEY_FILE}: {exc}. {PREMISE_KEY_HELP}"
            ) from exc
        if text:
            return text.encode("utf-8")
    raise PremiseKeyMissingError(PREMISE_KEY_HELP)


def premise_key_available() -> bool:
    """Cheap probe for the UI — doesn't raise."""
    try:
        load_premise_key()
        return True
    except PremiseKeyMissingError:
        return False


# ── Scenario catalogue ────────────────────────────────────────────────────────

# Canonical IAM identifiers as expected by premise's ``model`` parameter.
AVAILABLE_IAMS: list[str] = [
    "remind",
    "remind-eu",
    "image",
    "message",
    "gcam",
    "tiam-ucl",
]

# IAM → supported SSP/pathway labels. Values come from the premise dashboard
# (https://premisedash-6f5a0259c487.herokuapp.com/). Not every premise build
# ships every scenario file; missing .xlsx data packages will surface as a
# clear premise error at generate time.
SSPS_BY_IAM: dict[str, list[str]] = {
    "remind": [
        "SSP1-PkBudg500", "SSP1-PkBudg1150",
        "SSP2-Base", "SSP2-NDC", "SSP2-NPi",
        "SSP2-PkBudg500", "SSP2-PkBudg900", "SSP2-PkBudg1150",
        "SSP5-Base", "SSP5-PkBudg500", "SSP5-PkBudg1150",
    ],
    "remind-eu": [
        "SSP1-PkBudg500", "SSP1-PkBudg1150",
        "SSP2-Base", "SSP2-PkBudg500", "SSP2-PkBudg900", "SSP2-PkBudg1150",
        "SSP5-Base", "SSP5-PkBudg500", "SSP5-PkBudg1150",
    ],
    "image": [
        "SSP1-RCP19", "SSP1-RCP26",
        "SSP2-Base", "SSP2-RCP19", "SSP2-RCP26",
        "SSP3-Base",
    ],
    "message": [
        "SSP2-Base", "SSP2-RCP19", "SSP2-RCP26",
    ],
    "gcam": [
        "SSP2-Base", "SSP2-NDC", "SSP2-NPi",
    ],
    "tiam-ucl": [
        "SSP2-Base", "SSP2-RCP19", "SSP2-RCP26", "SSP2-RCP45",
    ],
}

# Flattened union, stable-ordered for backwards compatibility.
AVAILABLE_SSPS: list[str] = sorted({s for lst in SSPS_BY_IAM.values() for s in lst})

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
        source_version: str = "3.10",
        system_model: str = "cutoff",
        on_progress: ProgressCallback | None = None,
    ) -> None:
        iam_l = iam.lower()
        if iam_l not in AVAILABLE_IAMS:
            raise ValueError(f"IAM {iam!r} not supported; choose from {AVAILABLE_IAMS}")
        valid_ssps = SSPS_BY_IAM.get(iam_l, AVAILABLE_SSPS)
        if ssp not in valid_ssps:
            raise ValueError(f"SSP {ssp!r} not supported for IAM {iam!r}; choose from {valid_ssps}")
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
        """Run premise for every configured year. Returns list of DB names written.

        Raises :class:`PremiseKeyMissingError` if the key is not configured.
        """
        key = load_premise_key()

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
            key=key,
            system_model=self.system_model,
            quiet=True,
        )
        self._emit("loading inventories", 0.1)

        self._emit("applying transformations", 0.2)
        ndb.update()
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
