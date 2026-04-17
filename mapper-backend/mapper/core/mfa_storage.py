"""File-based persistence for MFA systems, state, results, cohort mappings, and archetypes.

Everything is scoped to the active brightway2 project. Layout under
``STORAGE_DIR``::

    {project_name}/{system_id}/system.json
    {project_name}/{system_id}/state.json
    {project_name}/{system_id}/results.json
    {project_name}/{system_id}/cohort_mappings.json
    {project_name}/archetypes/{archetype_id}.json

On startup, :func:`load_all` scans every project subfolder and returns nested
dicts to install into the in-memory stores.
"""
from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

import platformdirs

from mapper.models.bom_schemas import Archetype, CohortMapping
from mapper.models.mfa_schemas import (
    MFASystemState,
    SimulationResult,
    SystemDefinition,
)


STORAGE_DIR = Path(platformdirs.user_data_dir("mapper")) / "mfa"

SYSTEM_FILE = "system.json"
STATE_FILE = "state.json"
RESULTS_FILE = "results.json"
COHORT_MAPPINGS_FILE = "cohort_mappings.json"
ARCHETYPES_DIR = "archetypes"

_UNSAFE_PROJECT = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def _safe_project(project: str) -> str:
    """Make a bw2 project name safe as a directory segment."""
    cleaned = _UNSAFE_PROJECT.sub("_", (project or "").strip())
    return cleaned or "default"


def _project_dir(project: str) -> Path:
    return STORAGE_DIR / _safe_project(project)


def _system_dir(project: str, system_id: str) -> Path:
    return _project_dir(project) / system_id


def _archetypes_dir(project: str) -> Path:
    return _project_dir(project) / ARCHETYPES_DIR


def _ensure_system_dir(project: str, system_id: str) -> Path:
    d = _system_dir(project, system_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _ensure_archetypes_dir(project: str) -> Path:
    d = _archetypes_dir(project)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _write_json(path: Path, data: dict) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")
    tmp.replace(path)


def _read_json(path: Path) -> dict | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


# ── Save helpers ─────────────────────────────────────────────────────────────


def save_system(project: str, system: SystemDefinition) -> None:
    if not system.id:
        return
    d = _ensure_system_dir(project, system.id)
    _write_json(d / SYSTEM_FILE, system.model_dump())


def save_state(project: str, system_id: str, state: MFASystemState) -> None:
    d = _ensure_system_dir(project, system_id)
    _write_json(d / STATE_FILE, state.model_dump())


def save_results(project: str, system_id: str, results: SimulationResult) -> None:
    d = _ensure_system_dir(project, system_id)
    _write_json(d / RESULTS_FILE, results.model_dump())


def clear_results(project: str, system_id: str) -> None:
    path = _system_dir(project, system_id) / RESULTS_FILE
    if path.exists():
        path.unlink()


def save_cohort_mappings(project: str, system_id: str, mapping: CohortMapping) -> None:
    d = _ensure_system_dir(project, system_id)
    _write_json(d / COHORT_MAPPINGS_FILE, mapping.model_dump())


def delete_system_dir(project: str, system_id: str) -> None:
    d = _system_dir(project, system_id)
    if d.exists():
        shutil.rmtree(d, ignore_errors=True)


def save_archetype(project: str, archetype: Archetype) -> None:
    if not archetype.id:
        return
    d = _ensure_archetypes_dir(project)
    _write_json(d / f"{archetype.id}.json", archetype.model_dump())


def delete_archetype_file(project: str, archetype_id: str) -> None:
    path = _archetypes_dir(project) / f"{archetype_id}.json"
    if path.exists():
        path.unlink()


FOLDERS_FILE = "folders.json"


def _folders_path(project: str) -> Path:
    return _archetypes_dir(project) / FOLDERS_FILE


def load_folders(project: str) -> list[str]:
    data = _read_json(_folders_path(project))
    if not isinstance(data, list):
        return []
    return [p for p in data if isinstance(p, str)]


def save_folders(project: str, folders: list[str]) -> None:
    d = _ensure_archetypes_dir(project)
    # json.dumps a list directly via _write_json requires a dict; inline here.
    tmp = (d / FOLDERS_FILE).with_suffix(".tmp")
    tmp.write_text(json.dumps(sorted(set(folders)), indent=2), encoding="utf-8")
    tmp.replace(d / FOLDERS_FILE)


# ── Load all on startup ──────────────────────────────────────────────────────


def _load_project(project_dir: Path) -> tuple[
    dict[str, SystemDefinition],
    dict[str, MFASystemState],
    dict[str, SimulationResult],
    dict[str, CohortMapping],
    dict[str, Archetype],
]:
    systems: dict[str, SystemDefinition] = {}
    states: dict[str, MFASystemState] = {}
    results: dict[str, SimulationResult] = {}
    mappings: dict[str, CohortMapping] = {}
    archetypes: dict[str, Archetype] = {}

    for entry in project_dir.iterdir():
        if not entry.is_dir():
            continue
        if entry.name == ARCHETYPES_DIR:
            for arc_file in entry.glob("*.json"):
                data = _read_json(arc_file)
                if data is None:
                    continue
                try:
                    arc = Archetype(**data)
                    if arc.id:
                        archetypes[arc.id] = arc
                except Exception:
                    continue
            continue

        sid = entry.name
        sys_data = _read_json(entry / SYSTEM_FILE)
        if sys_data is None:
            continue
        try:
            systems[sid] = SystemDefinition(**sys_data)
        except Exception:
            continue

        state_data = _read_json(entry / STATE_FILE)
        if state_data is not None:
            try:
                states[sid] = MFASystemState(**state_data)
            except Exception:
                states[sid] = MFASystemState(system_id=sid)
        else:
            states[sid] = MFASystemState(system_id=sid)

        results_data = _read_json(entry / RESULTS_FILE)
        if results_data is not None:
            try:
                results[sid] = SimulationResult(**results_data)
            except Exception:
                pass

        mapping_data = _read_json(entry / COHORT_MAPPINGS_FILE)
        if mapping_data is not None:
            try:
                mappings[sid] = CohortMapping(**mapping_data)
            except Exception:
                pass

    return systems, states, results, mappings, archetypes


def load_all() -> tuple[
    dict[str, dict[str, SystemDefinition]],
    dict[str, dict[str, MFASystemState]],
    dict[str, dict[str, SimulationResult]],
    dict[str, dict[str, CohortMapping]],
    dict[str, dict[str, Archetype]],
]:
    """Scan STORAGE_DIR and return ``{project_name -> {...}}`` dicts for install.

    Outer key is the sanitized project directory name (treated as canonical).
    """
    systems: dict[str, dict[str, SystemDefinition]] = {}
    states: dict[str, dict[str, MFASystemState]] = {}
    results: dict[str, dict[str, SimulationResult]] = {}
    mappings: dict[str, dict[str, CohortMapping]] = {}
    archetypes: dict[str, dict[str, Archetype]] = {}

    if not STORAGE_DIR.exists():
        return systems, states, results, mappings, archetypes

    for proj_dir in STORAGE_DIR.iterdir():
        if not proj_dir.is_dir():
            continue
        proj = proj_dir.name
        sys_d, st_d, res_d, map_d, arc_d = _load_project(proj_dir)
        if sys_d:
            systems[proj] = sys_d
        if st_d:
            states[proj] = st_d
        if res_d:
            results[proj] = res_d
        if map_d:
            mappings[proj] = map_d
        if arc_d:
            archetypes[proj] = arc_d

    return systems, states, results, mappings, archetypes
