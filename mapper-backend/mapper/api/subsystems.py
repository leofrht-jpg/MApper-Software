# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""FastAPI router for Subsystems (coupled product populations).

Primary subsystems are synthesized from ``SystemDefinition`` at read time and
are not persisted. Only dependent subsystems are stored.

Layout under the per-system storage dir::

    {system_id}/subsystems.json         # dependent subsystems only
    {system_id}/subsystem_results.json  # last compute output per dependent

Dependent-subsystem results are invalidated whenever the primary simulation
result is cleared (see :mod:`mapper.api.dsm`).
"""
from __future__ import annotations

import threading
import uuid

import bw2data
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from mapper.api.dsm import (
    _get_system,
    _proj_results,
    _proj_systems,
    _sanitize_filename,
)
from mapper.api.parameters import get_parameter_set
from mapper.core import dsm_storage
from mapper.core.dsm_engine import (
    dependent_stock_template_csv,
    non_age_dimensions,
    parse_dependent_stock_file,
)
from mapper.core.parameter_engine import ParameterEngine, ParameterError
from mapper.core.subsystem_engine import (
    compute_dependent_subsystem,
    validate_dependency_rule,
)
from mapper.models.dsm_schemas import SimulationResult
from mapper.models.subsystem_schemas import (
    DependencyRule,
    Subsystem,
    SubsystemList,
    SubsystemSummary,
)


router = APIRouter(prefix="/dsm", tags=["subsystems"])

# In-memory stores, hydrated from disk at startup.
# ``{project -> {system_id -> {subsystem_id -> Subsystem}}}``. Only dependent
# subsystems live here; the primary is synthesized from SystemDefinition.
_subsystems: dict[str, dict[str, dict[str, Subsystem]]] = {}
# ``{project -> {system_id -> {subsystem_id -> SimulationResult}}}``.
_subsystem_results: dict[str, dict[str, dict[str, SimulationResult]]] = {}
_lock = threading.Lock()


def _current_project() -> str:
    return bw2data.projects.current


def _proj_subs(project: str | None = None) -> dict[str, dict[str, Subsystem]]:
    p = project or _current_project()
    return _subsystems.setdefault(p, {})


def _proj_sub_results(project: str | None = None) -> dict[str, dict[str, SimulationResult]]:
    p = project or _current_project()
    return _subsystem_results.setdefault(p, {})


def _sys_subs(system_id: str, project: str | None = None) -> dict[str, Subsystem]:
    return _proj_subs(project).setdefault(system_id, {})


def _sys_sub_results(system_id: str, project: str | None = None) -> dict[str, SimulationResult]:
    return _proj_sub_results(project).setdefault(system_id, {})


def invalidate_results(system_id: str, project: str | None = None) -> None:
    """Drop cached dependent-subsystem simulation results for ``system_id``.

    Called from the DSM router when the primary system definition or its
    simulation output changes.
    """
    res = _proj_sub_results(project)
    res.pop(system_id, None)


# ── Primary synthesis ───────────────────────────────────────────────────────


def _synthesize_primary(system_id: str) -> Subsystem:
    sys_def = _get_system(system_id)
    return Subsystem(
        id=system_id,
        name=sys_def.name,
        type="primary",
        dimensions=list(sys_def.dimensions),
        depends_on=None,
        dependency_rules=[],
    )


def _summary_for(sub: Subsystem, result: SimulationResult | None = None) -> SubsystemSummary:
    if sub.type == "primary":
        # Primary archetype count = number of non-age cohort combinations.
        from mapper.core.dsm_engine import all_cohort_keys
        cohort_count = len(all_cohort_keys(sub.dimensions))
        return SubsystemSummary(
            id=sub.id,
            name=sub.name,
            type="primary",
            dimension_count=len(non_age_dimensions(sub.dimensions)),
            archetype_count=cohort_count,
            rule_count=0,
            depends_on=None,
        )
    # Dependent: archetype count = unique ids across rules.
    archetype_ids = {r.dependent_archetype_id for r in sub.dependency_rules}
    return SubsystemSummary(
        id=sub.id,
        name=sub.name,
        type="dependent",
        dimension_count=len(non_age_dimensions(sub.dimensions)),
        archetype_count=len(archetype_ids),
        rule_count=len(sub.dependency_rules),
        depends_on=sub.depends_on,
    )


# ── Validation ──────────────────────────────────────────────────────────────


def _validate_subsystem_shape(body: Subsystem, system_id: str) -> None:
    if body.type != "dependent":
        raise HTTPException(
            status_code=400,
            detail="Only dependent subsystems can be created/updated via this API.",
        )
    if not body.name or not body.name.strip():
        raise HTTPException(status_code=400, detail="Subsystem name is required.")
    if body.depends_on and body.depends_on != system_id:
        raise HTTPException(
            status_code=400,
            detail=f"depends_on '{body.depends_on}' must match system_id '{system_id}'.",
        )
    nads = non_age_dimensions(body.dimensions)
    seen: set[str] = set()
    for d in nads:
        if not d.name:
            raise HTTPException(status_code=400, detail="Each dimension needs a name.")
        if d.name in seen:
            raise HTTPException(
                status_code=400, detail=f"Duplicate dimension name '{d.name}'"
            )
        seen.add(d.name)
        if not d.labels:
            raise HTTPException(
                status_code=400,
                detail=f"Dimension '{d.name}' must have at least one label.",
            )

    primary = _get_system(system_id)
    rule_ids: set[str] = set()
    for rule in body.dependency_rules:
        errors = validate_dependency_rule(rule, primary.dimensions)
        if errors:
            raise HTTPException(
                status_code=400,
                detail=f"Rule {rule.id or '?'}: {'; '.join(errors)}",
            )
        if rule.id and rule.id in rule_ids:
            raise HTTPException(
                status_code=400, detail=f"Duplicate rule id '{rule.id}'"
            )
        if rule.id:
            rule_ids.add(rule.id)


# ── Routes: listing ─────────────────────────────────────────────────────────


@router.get("/systems/{system_id}/subsystems", response_model=SubsystemList)
async def list_subsystems(system_id: str) -> SubsystemList:
    """Return the synthesized primary subsystem plus all stored dependents."""
    primary = _synthesize_primary(system_id)
    deps = list(_sys_subs(system_id).values())
    return SubsystemList(subsystems=[primary] + deps)


@router.get(
    "/systems/{system_id}/subsystems/summary", response_model=list[SubsystemSummary]
)
async def list_subsystem_summaries(system_id: str) -> list[SubsystemSummary]:
    primary = _synthesize_primary(system_id)
    deps = list(_sys_subs(system_id).values())
    return [_summary_for(primary)] + [_summary_for(s) for s in deps]


@router.get(
    "/systems/{system_id}/subsystems/{subsystem_id}", response_model=Subsystem
)
async def get_subsystem(system_id: str, subsystem_id: str) -> Subsystem:
    if subsystem_id == system_id:
        return _synthesize_primary(system_id)
    sub = _sys_subs(system_id).get(subsystem_id)
    if sub is None:
        raise HTTPException(status_code=404, detail="Subsystem not found")
    return sub


# ── Routes: CRUD ────────────────────────────────────────────────────────────


def _persist_subs(project: str, system_id: str) -> None:
    dsm_storage.save_subsystems(project, system_id, _sys_subs(system_id, project))


def _persist_sub_results(project: str, system_id: str) -> None:
    results = _sys_sub_results(system_id, project)
    if results:
        dsm_storage.save_subsystem_results(project, system_id, results)
    else:
        dsm_storage.clear_subsystem_results(project, system_id)


@router.post("/systems/{system_id}/subsystems", response_model=Subsystem)
async def create_subsystem(system_id: str, body: Subsystem) -> Subsystem:
    # Verify the primary exists before accepting the dependent.
    _get_system(system_id)
    # Assign server-side ids where missing.
    body.id = str(uuid.uuid4())
    body.depends_on = system_id
    body.type = "dependent"
    for rule in body.dependency_rules:
        if not rule.id:
            rule.id = str(uuid.uuid4())
    _validate_subsystem_shape(body, system_id)
    project = _current_project()
    with _lock:
        _sys_subs(system_id, project)[body.id] = body
        _sys_sub_results(system_id, project).pop(body.id, None)
    _persist_subs(project, system_id)
    _persist_sub_results(project, system_id)
    return body


@router.put(
    "/systems/{system_id}/subsystems/{subsystem_id}", response_model=Subsystem
)
async def update_subsystem(
    system_id: str, subsystem_id: str, body: Subsystem
) -> Subsystem:
    if subsystem_id == system_id:
        raise HTTPException(
            status_code=400,
            detail="Primary subsystems are defined by the system itself — edit the system instead.",
        )
    subs = _sys_subs(system_id)
    if subsystem_id not in subs:
        raise HTTPException(status_code=404, detail="Subsystem not found")
    body.id = subsystem_id
    body.depends_on = system_id
    body.type = "dependent"
    for rule in body.dependency_rules:
        if not rule.id:
            rule.id = str(uuid.uuid4())
    _validate_subsystem_shape(body, system_id)
    project = _current_project()
    with _lock:
        subs[subsystem_id] = body
        _sys_sub_results(system_id, project).pop(subsystem_id, None)
    _persist_subs(project, system_id)
    _persist_sub_results(project, system_id)
    return body


@router.delete("/systems/{system_id}/subsystems/{subsystem_id}")
async def delete_subsystem(system_id: str, subsystem_id: str) -> dict[str, bool]:
    if subsystem_id == system_id:
        raise HTTPException(
            status_code=400, detail="Cannot delete a primary subsystem."
        )
    project = _current_project()
    subs = _sys_subs(system_id, project)
    if subsystem_id not in subs:
        raise HTTPException(status_code=404, detail="Subsystem not found")
    with _lock:
        subs.pop(subsystem_id, None)
        _sys_sub_results(system_id, project).pop(subsystem_id, None)
    _persist_subs(project, system_id)
    _persist_sub_results(project, system_id)
    return {"deleted": True}


# ── Routes: initial stock ───────────────────────────────────────────────────


class InitialStockUploadResult(BaseModel):
    archetypes_found: int
    total_items: float
    rows_parsed: int


def _check_stock_ext(filename: str) -> None:
    import os
    ext = os.path.splitext(filename)[1].lower()
    if ext not in (".csv", ".xlsx", ".xls"):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Upload a .csv or .xlsx file.",
        )


@router.post(
    "/systems/{system_id}/subsystems/{subsystem_id}/stock/upload",
    response_model=InitialStockUploadResult,
)
async def upload_subsystem_initial_stock(
    system_id: str,
    subsystem_id: str,
    file: UploadFile = File(...),
) -> InitialStockUploadResult:
    if subsystem_id == system_id:
        raise HTTPException(
            status_code=400,
            detail="Primary initial stock uploads use /systems/{id}/stock/upload.",
        )
    subs = _sys_subs(system_id)
    sub = subs.get(subsystem_id)
    if sub is None:
        raise HTTPException(status_code=404, detail="Subsystem not found")
    filename = file.filename or ""
    _check_stock_ext(filename)
    raw = await file.read()
    try:
        parsed, rows = parse_dependent_stock_file(raw, filename, sub.dimensions)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    project = _current_project()
    with _lock:
        sub.initial_stock = parsed
        # Invalidate cached results — they depended on the old base-year floor.
        _sys_sub_results(system_id, project).pop(subsystem_id, None)
    _persist_subs(project, system_id)
    _persist_sub_results(project, system_id)
    return InitialStockUploadResult(
        archetypes_found=len(parsed),
        total_items=float(sum(parsed.values())),
        rows_parsed=rows,
    )


@router.delete(
    "/systems/{system_id}/subsystems/{subsystem_id}/stock",
)
async def clear_subsystem_initial_stock(
    system_id: str, subsystem_id: str
) -> dict[str, bool]:
    if subsystem_id == system_id:
        raise HTTPException(status_code=400, detail="Primary system — use the DSM API.")
    subs = _sys_subs(system_id)
    sub = subs.get(subsystem_id)
    if sub is None:
        raise HTTPException(status_code=404, detail="Subsystem not found")
    project = _current_project()
    with _lock:
        sub.initial_stock = {}
        _sys_sub_results(system_id, project).pop(subsystem_id, None)
    _persist_subs(project, system_id)
    _persist_sub_results(project, system_id)
    return {"cleared": True}


@router.post(
    "/systems/{system_id}/subsystems/{subsystem_id}/stock/template",
)
async def template_subsystem_stock(system_id: str, subsystem_id: str) -> Response:
    if subsystem_id == system_id:
        raise HTTPException(status_code=400, detail="Primary template — use the DSM API.")
    sub = _sys_subs(system_id).get(subsystem_id)
    if sub is None:
        raise HTTPException(status_code=404, detail="Subsystem not found")
    csv_text = dependent_stock_template_csv(sub.dimensions)
    fname = f"stock_template_{_sanitize_filename(sub.name)}.csv"
    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# ── Routes: rule validation ─────────────────────────────────────────────────


class RuleValidationResult(BaseModel):
    ok: bool
    errors: list[str]


@router.post(
    "/systems/{system_id}/subsystems/validate-rule",
    response_model=RuleValidationResult,
)
async def validate_rule(system_id: str, rule: DependencyRule) -> RuleValidationResult:
    primary = _get_system(system_id)
    errors = validate_dependency_rule(rule, primary.dimensions)
    # Also try to parse the expression against the currently active params
    # so users see syntax errors in the UI without waiting for a compute.
    engine = ParameterEngine()
    try:
        engine.resolve(
            rule.expression,
            extra_vars={"filtered_stock": 0.0, "total_primary_stock": 0.0, "year": 0.0},
        )
    except ParameterError as e:
        errors.append(str(e))
    return RuleValidationResult(ok=not errors, errors=errors)


# ── Routes: compute ─────────────────────────────────────────────────────────


class ComputeRequest(BaseModel):
    parameter_set_id: str | None = None


class ComputeAllResponse(BaseModel):
    subsystem_results: dict[str, SimulationResult]


def _require_primary_result(system_id: str) -> SimulationResult:
    result = _proj_results().get(system_id)
    if result is None:
        raise HTTPException(
            status_code=400,
            detail="No primary simulation yet. Run /dsm/systems/{id}/simulate first.",
        )
    return result


def _build_engine(parameter_set_id: str | None) -> ParameterEngine:
    if not parameter_set_id:
        return ParameterEngine()
    pset = get_parameter_set(parameter_set_id)
    if pset is None:
        raise HTTPException(
            status_code=404,
            detail=f"Parameter set '{parameter_set_id}' not found",
        )
    return ParameterEngine(pset.parameters)


@router.post(
    "/systems/{system_id}/subsystems/{subsystem_id}/compute",
    response_model=SimulationResult,
)
async def compute_subsystem(
    system_id: str,
    subsystem_id: str,
    body: ComputeRequest | None = None,
) -> SimulationResult:
    if subsystem_id == system_id:
        # Primary is computed via the DSM /simulate endpoint.
        return _require_primary_result(system_id)
    sub = _sys_subs(system_id).get(subsystem_id)
    if sub is None:
        raise HTTPException(status_code=404, detail="Subsystem not found")
    primary_def = _get_system(system_id)
    primary_result = _require_primary_result(system_id)
    engine = _build_engine(body.parameter_set_id if body else None)
    try:
        result = compute_dependent_subsystem(sub, primary_def, primary_result, engine)
    except ParameterError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    project = _current_project()
    with _lock:
        _sys_sub_results(system_id, project)[subsystem_id] = result
    _persist_sub_results(project, system_id)
    return result


@router.post(
    "/systems/{system_id}/subsystems/compute-all", response_model=ComputeAllResponse
)
async def compute_all_subsystems(
    system_id: str, body: ComputeRequest | None = None
) -> ComputeAllResponse:
    """Run every dependent subsystem against the current primary simulation.

    Returns a map of ``{subsystem_id → SimulationResult}``. Errors in one
    subsystem are surfaced with its id in the message but abort the batch.
    """
    primary_def = _get_system(system_id)
    primary_result = _require_primary_result(system_id)
    subs = _sys_subs(system_id)
    engine = _build_engine(body.parameter_set_id if body else None)
    results: dict[str, SimulationResult] = {}
    for sub_id, sub in subs.items():
        try:
            results[sub_id] = compute_dependent_subsystem(
                sub, primary_def, primary_result, engine
            )
        except ParameterError as e:
            raise HTTPException(
                status_code=400,
                detail=f"Subsystem '{sub.name}' ({sub_id}): {e}",
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    project = _current_project()
    with _lock:
        _sys_sub_results(system_id, project).clear()
        _sys_sub_results(system_id, project).update(results)
    _persist_sub_results(project, system_id)
    return ComputeAllResponse(subsystem_results=results)


@router.get(
    "/systems/{system_id}/subsystems/{subsystem_id}/results",
    response_model=SimulationResult,
)
async def get_subsystem_result(system_id: str, subsystem_id: str) -> SimulationResult:
    if subsystem_id == system_id:
        return _require_primary_result(system_id)
    res = _sys_sub_results(system_id).get(subsystem_id)
    if res is None:
        raise HTTPException(
            status_code=404,
            detail="No results yet. Run /compute for this subsystem first.",
        )
    return res


# ── Public accessors (used by DSM-LCA aggregation) ──────────────────────────


def get_subsystems_for_system(
    system_id: str, project: str | None = None
) -> dict[str, Subsystem]:
    """Return the stored dependent subsystems for ``system_id``."""
    return dict(_sys_subs(system_id, project))


def get_subsystem_results_for_system(
    system_id: str, project: str | None = None
) -> dict[str, SimulationResult]:
    """Return cached dependent-subsystem simulation results."""
    return dict(_sys_sub_results(system_id, project))
