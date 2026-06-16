"""File-based persistence for parameter tables.

Layout under ``STORAGE_DIR``::

    {project_name}/parameters/table.json          (current format)
    {project_name}/parameters/legacy/{set_id}.json (pre-migration backup)

``load_all`` returns ``{project_name -> ParameterTable}``. On first load after
the schema change, any legacy ``{set_id}.json`` files found at the root of
the project's parameters directory are merged into a single ``ParameterTable``
and then moved under ``legacy/`` so the migration is idempotent.

Migration rules (multiple legacy ParameterSets → one ParameterTable):

* The set with the most recent ``updated_at`` becomes the Base column
  (values go into ``Parameter.base_value``).
* Every other set becomes a scenario column named after its ``name``. Only
  parameters that *differ* from Base are stored as scenario overrides — equal
  values inherit from Base (empty cells in the frontend).
* Parameters that exist only in non-Base sets are added to the table with
  ``base_value`` copied from their own value and no override (they aren't
  diff-able against a Base that doesn't include them).
"""
from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

import platformdirs

from mapper.models.parameter_schemas import (
    Parameter,
    ParameterSet,
    ParameterTable,
)


STORAGE_DIR = Path(platformdirs.user_data_dir("mapper")) / "parameters"
PARAMETERS_SUBDIR = "parameters"
TABLE_FILENAME = "table.json"
LEGACY_SUBDIR = "legacy"

_UNSAFE_PROJECT = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def _safe_project(project: str) -> str:
    cleaned = _UNSAFE_PROJECT.sub("_", (project or "").strip())
    return cleaned or "default"


def _project_dir(project: str) -> Path:
    return STORAGE_DIR / _safe_project(project) / PARAMETERS_SUBDIR


def _ensure_project_dir(project: str) -> Path:
    d = _project_dir(project)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _table_path(project: str) -> Path:
    return _project_dir(project) / TABLE_FILENAME


def _write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
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


# ── Public: ParameterTable CRUD ─────────────────────────────────────────────


def save_parameter_table(project: str, table: ParameterTable) -> None:
    _ensure_project_dir(project)
    _write_json(_table_path(project), table.model_dump())


def delete_project_parameters(project: str) -> None:
    d = _project_dir(project)
    if d.exists():
        shutil.rmtree(d, ignore_errors=True)


def load_parameter_table(project: str) -> ParameterTable | None:
    data = _read_json(_table_path(project))
    if data is None:
        return None
    try:
        return ParameterTable(**data)
    except Exception:
        return None


# ── Legacy migration ────────────────────────────────────────────────────────


def _load_legacy_sets(project_dir: Path) -> list[ParameterSet]:
    """Read legacy ``{set_id}.json`` files directly under ``project_dir``."""
    out: list[ParameterSet] = []
    if not project_dir.exists():
        return out
    for path in project_dir.glob("*.json"):
        if path.name == TABLE_FILENAME:
            continue
        data = _read_json(path)
        if data is None:
            continue
        try:
            out.append(ParameterSet(**data))
        except Exception:
            continue
    return out


def _merge_sets_to_table(sets: list[ParameterSet]) -> ParameterTable:
    """Diff-based merge: most-recent set = Base; others = scenarios.

    Empty input returns an empty table. Single-set input returns a table with
    no scenario columns.
    """
    if not sets:
        return ParameterTable()

    ordered = sorted(
        sets,
        key=lambda s: (s.updated_at or s.created_at or "", s.name),
    )
    base_set = ordered[-1]  # most recent
    others = ordered[:-1]

    params: dict[str, Parameter] = {}
    for p in base_set.parameters:
        params[p.name] = Parameter(
            name=p.name,
            base_value=float(p.value),
            unit=p.unit,
            description=p.description,
            category=p.category,
            scenario_overrides={},
        )

    scenarios: list[str] = []
    for other in others:
        scen = other.name or f"scenario_{ordered.index(other)}"
        if scen in scenarios or scen == ParameterTable.BASE_SCENARIO:
            # Disambiguate collisions against Base and duplicates.
            idx = 2
            while f"{scen} ({idx})" in scenarios:
                idx += 1
            scen = f"{scen} ({idx})"
        scenarios.append(scen)

        for p in other.parameters:
            if p.name in params:
                if float(p.value) != params[p.name].base_value:
                    params[p.name].scenario_overrides[scen] = float(p.value)
                # else: equal to base => inherit (no override row).
            else:
                # Parameter not in Base — add with base_value = its own value,
                # no override for this scenario (inherits).
                params[p.name] = Parameter(
                    name=p.name,
                    base_value=float(p.value),
                    unit=p.unit,
                    description=p.description,
                    category=p.category,
                    scenario_overrides={},
                )

    return ParameterTable(
        parameters=params,
        scenarios=scenarios,
        created_at=min((s.created_at for s in sets if s.created_at), default=None),
        updated_at=max((s.updated_at for s in sets if s.updated_at), default=None),
    )


def _archive_legacy_files(project_dir: Path) -> None:
    legacy_dir = project_dir / LEGACY_SUBDIR
    legacy_dir.mkdir(parents=True, exist_ok=True)
    for path in project_dir.glob("*.json"):
        if path.name == TABLE_FILENAME:
            continue
        try:
            path.rename(legacy_dir / path.name)
        except OSError:
            pass


def _migrate_project_if_needed(project_dir: Path) -> ParameterTable | None:
    """If ``table.json`` is missing but legacy sets exist, build the table,
    write it, and archive the legacy files. Returns the resulting table (or
    the existing one when no migration is needed)."""
    table_file = project_dir / TABLE_FILENAME
    if table_file.exists():
        data = _read_json(table_file)
        if data is None:
            return None
        try:
            return ParameterTable(**data)
        except Exception:
            return None

    sets = _load_legacy_sets(project_dir)
    if not sets:
        return None
    table = _merge_sets_to_table(sets)
    _write_json(table_file, table.model_dump())
    _archive_legacy_files(project_dir)
    return table


def load_all() -> dict[str, ParameterTable]:
    """Scan ``STORAGE_DIR`` and return ``{project_name -> ParameterTable}``,
    running legacy-set migration on first load."""
    result: dict[str, ParameterTable] = {}
    if not STORAGE_DIR.exists():
        return result
    for proj_dir in STORAGE_DIR.iterdir():
        if not proj_dir.is_dir():
            continue
        sub = proj_dir / PARAMETERS_SUBDIR
        if not sub.exists():
            continue
        table = _migrate_project_if_needed(sub)
        if table is not None:
            result[proj_dir.name] = table
    return result


# ── Back-compat shims for callers still using the old names ────────────────
#
# parameters.py currently calls ``save_parameter_set`` / ``delete_parameter_set``
# per write. Step 4 replaces parameters.py with table-oriented writes, but in
# the meantime these shims keep the backend bootable.


def save_parameter_set(project: str, pset: ParameterSet) -> None:
    """Legacy shim: fold a single set into the project's table and persist."""
    table = load_parameter_table(project)
    if table is None:
        table = ParameterTable()
    # Treat the saved set as the new Base (common case: only one set was ever
    # present). Overrides are preserved for any scenarios already in the table.
    new_params: dict[str, Parameter] = {}
    for p in pset.parameters:
        existing = table.parameters.get(p.name)
        new_params[p.name] = Parameter(
            name=p.name,
            base_value=float(p.value),
            unit=p.unit,
            description=p.description,
            category=p.category,
            scenario_overrides=dict(existing.scenario_overrides) if existing else {},
        )
    table = ParameterTable(
        parameters=new_params,
        scenarios=list(table.scenarios),
        created_at=table.created_at or pset.created_at,
        updated_at=pset.updated_at or table.updated_at,
    )
    save_parameter_table(project, table)


def delete_parameter_set(project: str, set_id: str) -> None:
    """Legacy shim: single-table model has no set ids, so this is a no-op."""
    return None
