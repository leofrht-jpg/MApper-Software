"""LCIA Method Library — installation engine for downloadable LCIA methods.

Three install paths, one install contract:

  - ``bw2package``   IMPACT World+ — download a versioned ``.bw2package`` from
                     Zenodo and import it via ``bw2io.BW2Package.import_file``.
                     Per-ecoinvent-version variants are published; the active
                     project's ecoinvent version is auto-detected.
  - ``pip``          LC-IMPACT — pip-install ``bw2_lcimpact`` at runtime, then
                     call its ``import_global_lcimpact(biosphere=...)`` entry
                     point. Keeps MApper's base install lean.
  - ``excel``        Custom user-supplied xlsx in the single-sheet
                     ``bw2io.ExcelLCIAImporter`` format.

All three produce a stream of ``(stage, pct)`` progress updates via an
optional callback, matching the pattern used by
:class:`~mapper.core.premise_engine.ProspectiveDBGenerator`.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Literal

import bw2data
import platformdirs


logger = logging.getLogger(__name__)


# ── Registry loading ─────────────────────────────────────────────────────────

REGISTRY_PATH = Path(__file__).parent.parent / "data" / "lcia_methods.json"

# Cache + download dir — one subfolder per method id.
CACHE_ROOT = Path(platformdirs.user_data_dir("mapper")) / "lcia_methods"


def _load_registry() -> list[dict]:
    if not REGISTRY_PATH.is_file():
        return []
    with REGISTRY_PATH.open(encoding="utf-8") as fh:
        data = json.load(fh)
    return list(data.get("methods", []))


def _registry_entry(method_id: str) -> dict | None:
    for entry in _load_registry():
        if entry.get("id") == method_id:
            return entry
    return None


# ── Ecoinvent version detection ──────────────────────────────────────────────

_EI_VERSION_PATTERNS = [
    # Matches ``ecoinvent-3.10-cutoff``, ``ecoinvent_3_10_cutoff``,
    # ``ecoinvent 3.11 apos``, etc.
    re.compile(r"ecoinvent[\s_-]*(\d+)[._-](\d+)", re.IGNORECASE),
]

SUPPORTED_EI_VERSIONS = ("3.10", "3.11", "3.12")


def detect_ecoinvent_version() -> str | None:
    """Inspect the active bw2 project for an installed ecoinvent DB.

    Returns the MAJOR.MINOR string (e.g. ``"3.10"``) if exactly one canonical
    variant is detected. If none or multiple different versions coexist,
    returns ``None`` — callers should prompt the user.
    """
    versions: set[str] = set()
    for name in bw2data.databases:
        for pat in _EI_VERSION_PATTERNS:
            m = pat.search(name)
            if m:
                versions.add(f"{m.group(1)}.{m.group(2)}")
                break
    if len(versions) == 1:
        v = next(iter(versions))
        return v if v in SUPPORTED_EI_VERSIONS else v
    return None


# ── Installed-state introspection ────────────────────────────────────────────

# We track *which* method tuples a given method_id installed so we can report
# accurate counts + uninstall cleanly. Stored under the cache dir.

def _manifest_path(method_id: str) -> Path:
    return CACHE_ROOT / method_id / "manifest.json"


def _read_manifest(method_id: str) -> dict | None:
    path = _manifest_path(method_id)
    if not path.is_file():
        return None
    try:
        with path.open(encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None


def _write_manifest(method_id: str, payload: dict) -> None:
    path = _manifest_path(method_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)


def _method_tuples_for(method_id: str) -> list[tuple]:
    """Return the currently-registered bw2 method tuples that belong to this id."""
    manifest = _read_manifest(method_id) or {}
    tuples = [tuple(t) for t in manifest.get("method_tuples", [])]
    return [t for t in tuples if t in bw2data.methods]


def is_installed(method_id: str) -> bool:
    return len(_method_tuples_for(method_id)) > 0


# ── Progress callback type ───────────────────────────────────────────────────

ProgressCallback = Callable[[str, float], None]


def _emit(cb: ProgressCallback | None, stage: str, pct: float) -> None:
    if cb is None:
        return
    try:
        cb(stage, max(0.0, min(1.0, pct)))
    except BaseException as exc:  # noqa: BLE001
        # CancelledOperation must propagate so the worker thread can
        # unwind cleanly. Other callback errors stay swallowed (a UI-side
        # progress hiccup should never break a 30-second LCIA install).
        if type(exc).__name__ == "CancelledOperation":
            raise


# ── Result type ──────────────────────────────────────────────────────────────

@dataclass
class InstallResult:
    method_id: str
    method_tuples: list[tuple]  # newly registered tuples
    warnings: list[str] = field(default_factory=list)


class InstallError(RuntimeError):
    """Raised by installers on unrecoverable failure."""


# ── Shared helpers ───────────────────────────────────────────────────────────


def _snapshot_method_tuples() -> set[tuple]:
    return set(tuple(t) for t in bw2data.methods)


def _download_file(url: str, dest: Path, on_progress: ProgressCallback | None = None) -> None:
    """Download ``url`` to ``dest`` with progress callbacks.

    Uses ``urllib.request`` so we don't add a new dependency. Progress is
    reported against ``Content-Length`` when the server sends it.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": "MApper/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        total = int(resp.headers.get("Content-Length") or 0)
        read = 0
        chunk = 64 * 1024
        with tmp.open("wb") as fh:
            while True:
                buf = resp.read(chunk)
                if not buf:
                    break
                fh.write(buf)
                read += len(buf)
                if total > 0:
                    _emit(on_progress, f"downloading ({read // 1024} KB)", read / total)
    tmp.replace(dest)


# ── Installer 1: .bw2package (IMPACT World+) ─────────────────────────────────


def install_bw2package(
    entry: dict,
    ecoinvent_version: str | None = None,
    on_progress: ProgressCallback | None = None,
) -> InstallResult:
    """Install a method shipped as a Brightway2 package from an HTTP URL.

    The entry must carry a ``variants`` map keyed by ecoinvent major.minor.
    If ``ecoinvent_version`` is None, we auto-detect it — raising on ambiguity.
    """
    variants = entry.get("variants") or {}
    if not variants:
        raise InstallError(f"Method {entry.get('id')!r} has no variants defined")

    version = ecoinvent_version or detect_ecoinvent_version()
    if version is None:
        raise InstallError(
            "Could not auto-detect the active project's ecoinvent version. "
            f"Pick one of: {', '.join(sorted(variants.keys()))}."
        )
    variant = variants.get(version)
    if variant is None:
        raise InstallError(
            f"No {entry.get('name')} variant for ecoinvent {version}. "
            f"Available: {', '.join(sorted(variants.keys()))}."
        )

    cache_dir = CACHE_ROOT / entry["id"]
    cache_dir.mkdir(parents=True, exist_ok=True)
    file_path = cache_dir / variant["filename"]

    if not file_path.is_file():
        _emit(on_progress, "downloading characterisation factors", 0.02)
        try:
            _download_file(variant["url"], file_path, on_progress)
        except Exception as exc:
            raise InstallError(f"Download failed: {exc}") from exc
    else:
        _emit(on_progress, "using cached download", 0.5)

    # Import via bw2io's BW2Package. The package registers methods directly.
    _emit(on_progress, "importing into Brightway2 project", 0.85)
    before = _snapshot_method_tuples()
    try:
        from bw2io import BW2Package  # type: ignore
        BW2Package.import_file(str(file_path))
    except Exception as exc:
        raise InstallError(f"bw2 import failed: {exc}") from exc
    after = _snapshot_method_tuples()

    new_tuples = sorted(after - before)
    if not new_tuples:
        # Already-registered case: no new tuples appeared. This means the
        # package matches something already in the project, but we still
        # want to record what *belongs* to this id. Claim every tuple whose
        # first segment matches the package name heuristic.
        claim_prefix = entry.get("claim_prefix", "")
        if claim_prefix:
            new_tuples = sorted(t for t in after if t and t[0].startswith(claim_prefix))
        if not new_tuples:
            raise InstallError(
                "Import completed but no new LCIA methods were registered. "
                "The package may already be installed."
            )

    _write_manifest(entry["id"], {
        "method_id": entry["id"],
        "installer": "bw2package",
        "ecoinvent_version": version,
        "file_path": str(file_path),
        "method_tuples": [list(t) for t in new_tuples],
    })
    _emit(on_progress, "done", 1.0)
    return InstallResult(method_id=entry["id"], method_tuples=new_tuples)


# ── Installer 2: pip (LC-IMPACT) ─────────────────────────────────────────────


def install_pip(
    entry: dict,
    on_progress: ProgressCallback | None = None,
) -> InstallResult:
    """Install a method distributed as a pip package with an entry function."""
    spec = entry.get("pip_spec")
    module_name = entry.get("pip_entry_module")
    func_name = entry.get("pip_entry_function")
    if not (spec and module_name and func_name):
        raise InstallError(f"Method {entry.get('id')!r} is missing pip_* fields")

    # 1. pip install (idempotent — no-op if already satisfied).
    _emit(on_progress, f"pip install {spec}", 0.05)
    try:
        proc = subprocess.run(
            [sys.executable, "-m", "pip", "install", "--quiet", spec],
            capture_output=True, text=True, timeout=180,
        )
    except subprocess.TimeoutExpired as exc:
        raise InstallError(
            "pip install timed out after 3 minutes. "
            "Check your internet connection."
        ) from exc
    if proc.returncode != 0:
        raise InstallError(
            "pip install failed. "
            "Check network access and pip permissions.\n\n"
            + (proc.stderr or proc.stdout or "")[-800:]
        )

    # 2. Import and call the entry function.
    _emit(on_progress, "importing method into project", 0.55)
    try:
        # Invalidate import caches so freshly-installed packages resolve.
        import importlib
        importlib.invalidate_caches()
        mod = importlib.import_module(module_name)
        func = getattr(mod, func_name)
    except Exception as exc:
        raise InstallError(f"Could not import {module_name}.{func_name}: {exc}") from exc

    before = _snapshot_method_tuples()
    kwargs = dict(entry.get("pip_entry_kwargs") or {})
    try:
        func(**kwargs)
    except Exception as exc:
        raise InstallError(f"{module_name}.{func_name} failed: {exc}") from exc
    after = _snapshot_method_tuples()

    new_tuples = sorted(after - before)
    if not new_tuples:
        raise InstallError(
            "Entry function ran but registered no methods. "
            "The method may already be installed, or the biosphere version "
            "is incompatible."
        )

    _write_manifest(entry["id"], {
        "method_id": entry["id"],
        "installer": "pip",
        "pip_spec": spec,
        "method_tuples": [list(t) for t in new_tuples],
    })
    _emit(on_progress, "done", 1.0)
    return InstallResult(method_id=entry["id"], method_tuples=new_tuples)


# ── Installer 3: custom xlsx upload ──────────────────────────────────────────

UNMATCHED_WARN_THRESHOLD = 0.05  # >= 5 % unmatched → fail


def install_excel(
    file_path: Path,
    method_name_tuple: tuple[str, ...],
    description: str,
    unit: str,
    on_progress: ProgressCallback | None = None,
) -> InstallResult:
    """Import a custom LCIA method from a single-sheet xlsx.

    Uses ``bw2io.ExcelLCIAImporter`` directly. The caller provides the method
    name tuple, description, and unit (these are NOT read from the file — the
    importer's constructor requires them).
    """
    try:
        from bw2io.importers.excel_lcia import ExcelLCIAImporter  # type: ignore
    except ImportError as exc:
        raise InstallError(
            "bw2io.ExcelLCIAImporter is not available. "
            "Install bw2io >= 0.9."
        ) from exc

    _emit(on_progress, "reading workbook", 0.05)
    try:
        importer = ExcelLCIAImporter(
            str(file_path),
            name=tuple(method_name_tuple),
            description=description,
            unit=unit,
        )
    except Exception as exc:
        raise InstallError(f"Could not parse xlsx: {exc}") from exc

    _emit(on_progress, "applying strategies", 0.3)
    try:
        importer.apply_strategies()
    except Exception as exc:
        raise InstallError(f"Strategy application failed: {exc}") from exc

    _emit(on_progress, "matching biosphere flows", 0.55)
    try:
        importer.match_database("biosphere3", fields=("name", "categories"))
    except Exception as exc:
        raise InstallError(f"Biosphere matching failed: {exc}") from exc

    # Strict unmatched-flow policy per spec section 5.
    stats = importer.statistics(print_stats=False) if hasattr(importer, "statistics") else None
    total = unmatched = 0
    try:
        # bw2io statistics() returns a tuple (num_datasets, num_exchanges, num_unlinked).
        if isinstance(stats, tuple) and len(stats) >= 3:
            total = int(stats[1] or 0)
            unmatched = int(stats[2] or 0)
    except Exception:
        pass
    if total > 0 and unmatched / total >= UNMATCHED_WARN_THRESHOLD:
        raise InstallError(
            f"{unmatched} of {total} biosphere flows could not be matched "
            f"(≥ {UNMATCHED_WARN_THRESHOLD:.0%}). Install refused — "
            "the method would produce incomplete results."
        )
    warnings: list[str] = []
    if unmatched > 0:
        warnings.append(
            f"{unmatched} of {total} biosphere flows unmatched. "
            "Results for affected categories may be incomplete."
        )

    _emit(on_progress, "writing methods", 0.85)
    before = _snapshot_method_tuples()
    try:
        importer.write_methods()
    except Exception as exc:
        raise InstallError(f"Failed to write methods to project: {exc}") from exc
    after = _snapshot_method_tuples()
    new_tuples = sorted(after - before)

    if not new_tuples:
        raise InstallError("No methods were registered — the workbook may be empty.")

    # Persist the file in the cache so re-install works.
    method_id = f"custom_{_hash(str(method_name_tuple))}"
    cache_dir = CACHE_ROOT / method_id
    cache_dir.mkdir(parents=True, exist_ok=True)
    cached = cache_dir / file_path.name
    if file_path.resolve() != cached.resolve():
        shutil.copy2(file_path, cached)
    _write_manifest(method_id, {
        "method_id": method_id,
        "installer": "excel",
        "name": list(method_name_tuple),
        "description": description,
        "unit": unit,
        "file_path": str(cached),
        "method_tuples": [list(t) for t in new_tuples],
    })
    _emit(on_progress, "done", 1.0)
    return InstallResult(method_id=method_id, method_tuples=new_tuples, warnings=warnings)


def _hash(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:10]


# ── Uninstall ────────────────────────────────────────────────────────────────


def uninstall(method_id: str) -> int:
    """Remove all bw2 method tuples claimed by *method_id*. Returns the count."""
    tuples = _method_tuples_for(method_id)
    removed = 0
    for t in tuples:
        if t in bw2data.methods:
            try:
                del bw2data.methods[t]
                removed += 1
            except Exception:
                logger.warning("Could not remove method %s", t)
    # Clear the manifest's tuple list but keep the cached file for quick re-install.
    manifest = _read_manifest(method_id) or {}
    manifest["method_tuples"] = []
    _write_manifest(method_id, manifest)
    return removed


# ── Listing ──────────────────────────────────────────────────────────────────


BUNDLED_FAMILY_HINTS: dict[str, dict[str, Any]] = {
    "EF v3.1": {"description": "Environmental Footprint (EU JRC)"},
    "ReCiPe 2016 v1.03, midpoint (H)": {"description": "Midpoint (H) — Huijbregts et al. (2017)"},
    "ReCiPe 2016 v1.03, endpoint (H)": {"description": "Endpoint (H) — Huijbregts et al. (2017)"},
    "CML v4.8 2016": {"description": "Leiden University CML"},
    "CML v4.8 2016 no LT": {"description": "Leiden University CML (no long-term)"},
    "TRACI v2.1": {"description": "US EPA TRACI"},
}


def _bundled_families() -> list[dict]:
    """Group the currently-registered bw2 method tuples by their family.

    A family is "bundled" (i.e. installed via ecoinvent's LCIA pack) if its
    tuples are not claimed by any downloadable or custom entry.
    """
    downloadable_ids = {e["id"] for e in _load_registry()}
    claimed: set[tuple] = set()
    for entry_id in downloadable_ids:
        claimed.update(_method_tuples_for(entry_id))
    # Also exclude custom-uploaded methods.
    for manifest_dir in CACHE_ROOT.glob("*/manifest.json") if CACHE_ROOT.is_dir() else []:
        try:
            with manifest_dir.open(encoding="utf-8") as fh:
                m = json.load(fh)
            if m.get("installer") == "excel":
                claimed.update(tuple(t) for t in m.get("method_tuples", []))
        except Exception:
            continue

    families: dict[str, list[tuple]] = {}
    for t in bw2data.methods:
        if t in claimed or len(t) == 0:
            continue
        families.setdefault(t[0], []).append(tuple(t))
    return [
        {
            "id": f"bundled::{fam}",
            "name": fam,
            "source": "bundled",
            "installed": True,
            "category_count": len(tuples),
            "description": BUNDLED_FAMILY_HINTS.get(fam, {}).get("description", ""),
        }
        for fam, tuples in sorted(families.items())
    ]


def _custom_entries() -> list[dict]:
    """Enumerate xlsx-imported custom methods from their manifests."""
    out: list[dict] = []
    if not CACHE_ROOT.is_dir():
        return out
    for manifest_path in CACHE_ROOT.glob("*/manifest.json"):
        try:
            with manifest_path.open(encoding="utf-8") as fh:
                m = json.load(fh)
        except Exception:
            continue
        if m.get("installer") != "excel":
            continue
        mid = m.get("method_id") or manifest_path.parent.name
        live_tuples = _method_tuples_for(mid)
        out.append({
            "id": mid,
            "name": " → ".join(m.get("name", [])) or "Custom method",
            "description": m.get("description", ""),
            "source": "custom",
            "installed": len(live_tuples) > 0,
            "category_count": len(live_tuples),
            "unit": m.get("unit", ""),
        })
    return out


def list_library() -> list[dict]:
    """Return the combined library: bundled + downloadable + custom entries."""
    ei_version = detect_ecoinvent_version()
    downloadable = []
    for entry in _load_registry():
        installed = is_installed(entry["id"])
        size_mb = entry.get("file_size_mb")
        resolved_variant = None
        if entry.get("installer") == "bw2package" and ei_version:
            variant = (entry.get("variants") or {}).get(ei_version)
            if variant:
                size_mb = variant.get("file_size_mb")
                resolved_variant = ei_version
        downloadable.append({
            "id": entry["id"],
            "name": entry["name"],
            "description": entry.get("description", ""),
            "long_description": entry.get("long_description", ""),
            "source": "downloadable",
            "installed": installed,
            "category_count": len(_method_tuples_for(entry["id"])) if installed else None,
            "size_mb": size_mb,
            "source_url": entry.get("source_url"),
            "citation": entry.get("citation"),
            "installer": entry.get("installer"),
            "notes": entry.get("notes"),
            "detected_ei_version": resolved_variant,
            "available_variants": sorted((entry.get("variants") or {}).keys())
                if entry.get("installer") == "bw2package" else None,
        })
    return _bundled_families() + downloadable + _custom_entries()


# ── High-level entry used by the API router ──────────────────────────────────


def install_method(
    method_id: str,
    ecoinvent_version: str | None = None,
    on_progress: ProgressCallback | None = None,
) -> InstallResult:
    entry = _registry_entry(method_id)
    if entry is None:
        raise InstallError(f"Unknown method id: {method_id!r}")
    if is_installed(method_id):
        raise InstallError(f"{entry['name']} is already installed in this project.")
    installer = entry.get("installer")
    if installer == "bw2package":
        return install_bw2package(entry, ecoinvent_version=ecoinvent_version, on_progress=on_progress)
    if installer == "pip":
        return install_pip(entry, on_progress=on_progress)
    raise InstallError(f"Unsupported installer: {installer!r}")
