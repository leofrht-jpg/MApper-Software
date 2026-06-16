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

import logging
import os
import time
import traceback
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Literal

import platformdirs
from premise import NewDatabase, clear_cache


logger = logging.getLogger(__name__)


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

# IAM → supported SSP/pathway labels. Source of truth:
#   1. premise/iam_variables_mapping/constants.yaml → SUPPORTED_PATHWAYS
#      (only SSP1, SSP2, SSP5 — no SSP3/SSP4 in upstream premise).
#   2. premise/data/iam_output_files/*.csv (actual shipped scenario CSVs).
#   3. premise dashboard: https://premisedash-6f5a0259c487.herokuapp.com/
# Not every premise build ships every scenario file; REMIND-EU / MESSAGE /
# GCAM / TIAM-UCL pathways come via paid or newer data packages, and missing
# files will surface as a clear premise error at generate time.
SSPS_BY_IAM: dict[str, list[str]] = {
    # REMIND ships 15 scenarios in the core premise package (ecoinvent 3.10):
    # SSP1/SSP2/SSP5 × {Base, NDC, NPi, PkBudg500, PkBudg1150}. SSP2-PkBudg900
    # is a common add-on scenario.
    "remind": [
        "SSP1-Base", "SSP1-NDC", "SSP1-NPi",
        "SSP1-PkBudg500", "SSP1-PkBudg1150",
        "SSP2-Base", "SSP2-NDC", "SSP2-NPi",
        "SSP2-PkBudg500", "SSP2-PkBudg900", "SSP2-PkBudg1150",
        "SSP5-Base", "SSP5-NDC", "SSP5-NPi",
        "SSP5-PkBudg500", "SSP5-PkBudg1150",
    ],
    "remind-eu": [
        "SSP1-PkBudg500", "SSP1-PkBudg1150",
        "SSP2-Base", "SSP2-PkBudg500", "SSP2-PkBudg900", "SSP2-PkBudg1150",
        "SSP5-Base", "SSP5-PkBudg500", "SSP5-PkBudg1150",
    ],
    # IMAGE ships 4 scenarios in the core premise package; SSP1-RCP19/RCP26
    # and SSP3-Base are available via the extended data package.
    "image": [
        "SSP1-Base", "SSP1-RCP19", "SSP1-RCP26",
        "SSP2-Base", "SSP2-RCP19", "SSP2-RCP26",
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

ProspectiveMode = Literal["separate", "superstructure"]

# SDF files are stored per-project under the mapper user-data dir.
SDF_ROOT = Path(platformdirs.user_data_dir("mapper")) / "plca" / "sdf"


def prospective_db_name(base_db: str, iam: str, ssp: str, year: int) -> str:
    """Canonical naming for a single-year prospective database."""
    return f"{base_db}_premise_{iam.lower()}_{ssp.lower()}_{year}"


def superstructure_db_name(base_db: str, iam: str, ssp: str, years: list[int]) -> str:
    """Canonical naming for a superstructure database spanning multiple years."""
    ys = sorted(set(years))
    span = f"{ys[0]}-{ys[-1]}" if len(ys) > 1 else str(ys[0])
    return f"{base_db}_premise_{iam.lower()}_{ssp.lower()}_superstructure_{span}"


@dataclass
class GenerationResult:
    """Outcome of a :meth:`ProspectiveDBGenerator.generate` call."""

    mode: ProspectiveMode
    names: list[str]            # separate: one per year; superstructure: single name
    scenarios: list[dict] = field(default_factory=list)  # [{iam, ssp, year}, ...]
    sdf_path: str | None = None  # superstructure only — absolute path to the SDF file
    # Populated when the caller requested ``superstructure`` but premise failed
    # to write the superstructure workbook and we fell back to separate mode.
    fallback_warning: str | None = None


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
        mode: ProspectiveMode = "separate",
        sdf_dir: Path | None = None,
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
        if mode not in ("separate", "superstructure"):
            raise ValueError(f"mode must be 'separate' or 'superstructure', got {mode!r}")
        if mode == "superstructure" and len(set(years)) < 2:
            raise ValueError("Superstructure mode requires at least two target years")

        self.base_db = base_db
        self.iam = iam_l
        self.ssp = ssp
        self.years = sorted(set(years))
        self.source_version = source_version
        self.system_model = system_model
        self.mode: ProspectiveMode = mode
        self.sdf_dir = sdf_dir or SDF_ROOT
        self._cb = on_progress

    def _emit(self, stage: str, pct: float) -> None:
        if self._cb is not None:
            try:
                self._cb(stage, max(0.0, min(1.0, pct)))
            except BaseException as exc:  # noqa: BLE001
                # Callback exceptions are normally swallowed (UI-side
                # bookkeeping shouldn't crash a 30-minute premise run), but
                # cancellation is a deliberate signal — re-raise so the
                # worker thread can unwind cleanly. Detected by class name
                # to avoid coupling this module to mapper.api.tasks.
                if type(exc).__name__ == "CancelledOperation":
                    raise
                # other callback errors stay swallowed

    def generate(self) -> GenerationResult:
        """Run premise for every configured year and write the result(s) to Brightway.

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

        scenarios_meta = [
            {"iam": self.iam, "ssp": self.ssp, "year": y} for y in self.years
        ]

        if self.mode == "superstructure":
            db_name = superstructure_db_name(self.base_db, self.iam, self.ssp, self.years)
            self.sdf_dir.mkdir(parents=True, exist_ok=True)
            self._emit("writing superstructure database", 0.85)
            try:
                ndb.write_superstructure_db_to_brightway(
                    name=db_name,
                    filepath=str(self.sdf_dir),
                    file_format="excel",
                )
            except Exception as exc:
                # Known edge cases in premise's superstructure export path
                # (e.g. missing biosphere flow lookups on ecoinvent 3.10)
                # shouldn't block the user — the per-year databases produced
                # by ``ndb.update()`` are still valid. Fall back to writing
                # them as separate databases and surface a warning.
                tb = traceback.format_exc()
                logger.warning(
                    "premise write_superstructure_db_to_brightway failed; "
                    "falling back to separate databases.\n%s",
                    tb,
                )
                self._emit("superstructure failed — falling back to separate", 0.87)
                fallback_warning = (
                    "Superstructure generation failed — falling back to separate "
                    f"databases. Error: {exc}"
                )
                names = [
                    prospective_db_name(self.base_db, self.iam, self.ssp, year)
                    for year in self.years
                ]
                ndb.write_db_to_brightway(name=names)
                self._emit(f"done (fallback) in {time.time() - t0:.0f}s", 1.0)
                return GenerationResult(
                    mode="separate",
                    names=names,
                    scenarios=scenarios_meta,
                    fallback_warning=fallback_warning,
                )
            sdf_path = self.sdf_dir / f"scenario_diff_{db_name}.xlsx"
            self._emit(f"done in {time.time() - t0:.0f}s", 1.0)
            return GenerationResult(
                mode="superstructure",
                names=[db_name],
                scenarios=scenarios_meta,
                sdf_path=str(sdf_path),
            )

        names = [
            prospective_db_name(self.base_db, self.iam, self.ssp, year)
            for year in self.years
        ]
        self._emit("writing databases to brightway", 0.85)
        ndb.write_db_to_brightway(name=names)
        self._emit(f"done in {time.time() - t0:.0f}s", 1.0)
        return GenerationResult(mode="separate", names=names, scenarios=scenarios_meta)


def clear_premise_cache() -> None:
    try:
        clear_cache()
    except Exception:
        pass
