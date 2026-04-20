"""AESA API: Multi-D allocation model endpoints.

Reference data (boundary sets, Multi-D defaults, SSP trajectories, carbon
budget options, default sharing values), per-project AESA configurations,
compute endpoint, and xlsx export.
"""
from __future__ import annotations

import io
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Response
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from mapper.api.bom import _sanitize_filename
from mapper.api.impact import _TASKS as IMPACT_TASKS, _TASK_LOCK as IMPACT_LOCK
from mapper.api.mfa import _current_project, _get_system
from mapper.core import aesa_storage
from mapper.core.aesa_engine import (
    AESAEngine,
    MULTI_D_DEFAULTS,
    build_carbon_budget,
    build_default_multi_d_config,
    load_boundary_sets,
    load_carbon_budget_options,
    load_sharing_data,
    load_ssp_trajectories,
    suggest_method_mapping,
)
from mapper.models.aesa_schemas import (
    AESAComputeRequest,
    AESAComputeResult,
    AESAConfiguration,
    AESAConfigurationCreate,
    AESAExportRequest,
    BoundarySet,
    MethodPBMapping,
    PlanetaryBoundary,
)
from mapper.models.bom_schemas import ImpactAssessmentResult


router = APIRouter(prefix="/aesa", tags=["aesa"])


# ─── Reference data ──────────────────────────────────────────────────────────


@router.get("/boundary-sets")
async def get_boundary_sets() -> list[BoundarySet]:
    return list(load_boundary_sets().values())


@router.get("/boundary-sets/{set_id}")
async def get_boundary_set(set_id: str) -> BoundarySet:
    sets = load_boundary_sets()
    if set_id not in sets:
        raise HTTPException(status_code=404, detail=f"Boundary set '{set_id}' not found")
    return sets[set_id]


@router.get("/multi-d-defaults")
async def get_multi_d_defaults() -> list[dict]:
    """Returns the default per-PB sharing-principle assignments."""
    return [
        {"pb_id": pb_id, "principle": principle, "justification": just}
        for pb_id, (principle, just) in MULTI_D_DEFAULTS.items()
    ]


@router.get("/sharing-data")
async def get_sharing_data() -> dict:
    return load_sharing_data()


@router.get("/ssp-trajectories")
async def get_ssp_trajectories() -> list[dict]:
    return load_ssp_trajectories()


@router.get("/carbon-budget-options")
async def get_carbon_budget_options() -> list[dict]:
    return load_carbon_budget_options()


@router.post("/method-mapping/suggest")
async def post_method_mapping_suggest(body: dict) -> list[MethodPBMapping]:
    """Body: ``{"methods": [[...], ...], "boundary_set_id": "Sala2020_EF"}``."""
    methods = body.get("methods") or []
    set_id = body.get("boundary_set_id", "Sala2020_EF")
    sets = load_boundary_sets()
    bset = sets.get(set_id)
    if bset is None:
        raise HTTPException(status_code=404, detail=f"Boundary set '{set_id}' not found")
    return suggest_method_mapping(methods, bset)


@router.get("/defaults")
async def get_defaults() -> dict:
    """Full bundle a fresh UI can load in one call: boundary set(s), Multi-D
    defaults, sharing data, SSP list, carbon budget options, plus a
    ready-built default MultiDConfig + CarbonBudgetConfig."""
    return {
        "boundary_sets": [bs.model_dump() for bs in load_boundary_sets().values()],
        "multi_d_defaults": [
            {"pb_id": pb_id, "principle": principle, "justification": just}
            for pb_id, (principle, just) in MULTI_D_DEFAULTS.items()
        ],
        "sharing_data": load_sharing_data(),
        "ssp_trajectories": load_ssp_trajectories(),
        "carbon_budget_options": load_carbon_budget_options(),
        "default_multi_d": build_default_multi_d_config().model_dump(),
        "default_carbon_budget": build_carbon_budget().model_dump(),
    }


# ─── Configuration CRUD ──────────────────────────────────────────────────────


@router.get("/configurations", response_model=list[AESAConfiguration])
async def get_configurations() -> list[AESAConfiguration]:
    project = _current_project()
    raw = aesa_storage.load_all(project)
    out: list[AESAConfiguration] = []
    for r in raw:
        try:
            out.append(AESAConfiguration(**r))
        except Exception:
            continue
    out.sort(key=lambda c: c.created_at, reverse=True)
    return out


@router.get("/configurations/{config_id}", response_model=AESAConfiguration)
async def get_configuration(config_id: str) -> AESAConfiguration:
    project = _current_project()
    raw = aesa_storage.load(project, config_id)
    if raw is None:
        raise HTTPException(status_code=404, detail="AESA configuration not found")
    return AESAConfiguration(**raw)


@router.post("/configurations", response_model=AESAConfiguration)
async def post_configuration(body: AESAConfigurationCreate) -> AESAConfiguration:
    _get_system(body.mfa_system_id)  # 404 if system missing
    project = _current_project()
    config = AESAConfiguration(
        id=uuid.uuid4().hex,
        name=body.name,
        mfa_system_id=body.mfa_system_id,
        impact_mode=body.impact_mode,
        boundary_set_id=body.boundary_set_id,
        multi_d=body.multi_d,
        carbon_budget=body.carbon_budget,
        method_mapping=body.method_mapping,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    aesa_storage.save(project, config.model_dump())
    return config


@router.put("/configurations/{config_id}", response_model=AESAConfiguration)
async def put_configuration(
    config_id: str, body: AESAConfigurationCreate,
) -> AESAConfiguration:
    project = _current_project()
    existing = aesa_storage.load(project, config_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="AESA configuration not found")
    _get_system(body.mfa_system_id)
    updated = AESAConfiguration(
        id=config_id,
        name=body.name,
        mfa_system_id=body.mfa_system_id,
        impact_mode=body.impact_mode,
        boundary_set_id=body.boundary_set_id,
        multi_d=body.multi_d,
        carbon_budget=body.carbon_budget,
        method_mapping=body.method_mapping,
        created_at=existing.get("created_at") or datetime.now(timezone.utc).isoformat(),
    )
    aesa_storage.save(project, updated.model_dump())
    return updated


@router.delete("/configurations/{config_id}")
async def delete_configuration(config_id: str) -> dict:
    project = _current_project()
    deleted = aesa_storage.delete(project, config_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="AESA configuration not found")
    return {"deleted": True}


# ─── Compute ─────────────────────────────────────────────────────────────────


def _resolve_impact(
    task_id: str | None, inline: ImpactAssessmentResult | None,
) -> ImpactAssessmentResult:
    if inline is not None:
        return inline
    if task_id is None:
        raise HTTPException(status_code=400, detail="impact_task_id or impact_result required")
    with IMPACT_LOCK:
        task = IMPACT_TASKS.get(task_id)
    if task is None or task.result is None:
        raise HTTPException(status_code=404, detail=f"Impact task {task_id} not found or not finished")
    return task.result


def _resolve_config(body: AESAComputeRequest) -> AESAConfiguration:
    if body.config is not None:
        return body.config
    if body.config_id is None:
        raise HTTPException(status_code=400, detail="config_id or config required")
    project = _current_project()
    raw = aesa_storage.load(project, body.config_id)
    if raw is None:
        raise HTTPException(status_code=404, detail="AESA configuration not found")
    return AESAConfiguration(**raw)


@router.post("/compute", response_model=AESAComputeResult)
async def post_compute(body: AESAComputeRequest) -> AESAComputeResult:
    config = _resolve_config(body)
    impact = _resolve_impact(body.impact_task_id, body.impact_result)
    if impact.meta.mfa_system_id != config.mfa_system_id:
        raise HTTPException(
            status_code=400,
            detail="Impact result is for a different MFA system than the AESA config.",
        )
    sets = load_boundary_sets()
    bset = sets.get(config.boundary_set_id)
    if bset is None:
        raise HTTPException(
            status_code=400,
            detail=f"Boundary set '{config.boundary_set_id}' not found",
        )
    if body.run_sensitivity:
        return AESAEngine.compute_with_sensitivity(impact.results, config, bset)
    return AESAEngine.compute(impact.results, config, bset)


# ─── Export ──────────────────────────────────────────────────────────────────


@router.post("/export")
async def post_export(body: AESAExportRequest) -> Response:
    config = body.config
    sys_def = _get_system(config.mfa_system_id)

    wb = _build_aesa_workbook(config, body.result, sys_def.name)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    filename = f"{_sanitize_filename(sys_def.name, 'system')}_aesa.xlsx"
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _build_aesa_workbook(
    config: AESAConfiguration, result: AESAComputeResult, system_name: str,
) -> Workbook:
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill("solid", fgColor="064E3B")
    num_fmt = "0.000E+00"

    wb = Workbook()
    wb.remove(wb.active)

    def _autosize(ws) -> None:
        for col_idx, col_cells in enumerate(ws.columns, start=1):
            widest = 0
            for cell in col_cells:
                v = cell.value
                if v is None:
                    continue
                widest = max(widest, min(60, len(str(v))))
            ws.column_dimensions[get_column_letter(col_idx)].width = max(12, widest + 2)

    def _style_header(ws) -> None:
        for cell in ws[1]:
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal="center")

    # ── Summary ──
    ws = wb.create_sheet("Summary")
    ws.append(["System", system_name])
    ws.append(["AESA Configuration", config.name])
    ws.append(["Boundary Set", config.boundary_set_id])
    ws.append(["Impact Mode", config.impact_mode])
    ws.append(["Layer 2 (sector share)", config.multi_d.layer2_sector_share])
    ws.append([])
    ws.append(["Year", "Safe", "Zone of Uncertainty", "High Risk", "Assessed"])
    for row in ws.iter_rows(min_row=7, max_row=7):
        for cell in row:
            cell.font = header_font
            cell.fill = header_fill
    for y in result.summary_by_year:
        ws.append([y.year, y.safe, y.zone_of_uncertainty, y.high_risk, y.total_assessed])
    _autosize(ws)

    # ── Sustainability Ratios (matrix) ──
    ws = wb.create_sheet("Sustainability Ratios")
    pb_ids: list[str] = []
    pb_names: dict[str, str] = {}
    seen = set()
    for r in result.results:
        if r.pb_id not in seen:
            seen.add(r.pb_id)
            pb_ids.append(r.pb_id)
            pb_names[r.pb_id] = r.pb_name
    years_sorted = sorted({r.year for r in result.results})
    ws.append(["Year", *[pb_names[p] for p in pb_ids]])
    _style_header(ws)
    sr_lookup: dict[tuple[int, str], float] = {
        (r.year, r.pb_id): r.sr for r in result.results
    }
    for y in years_sorted:
        ws.append([y, *[sr_lookup.get((y, p), "") for p in pb_ids]])
    for row in ws.iter_rows(min_row=2, min_col=2):
        for cell in row:
            cell.number_format = "0.000"
    ws.freeze_panes = "A2"
    _autosize(ws)

    # ── Impacts vs SOS (long-form) ──
    ws = wb.create_sheet("Impacts vs SOS")
    ws.append([
        "Year", "PB ID", "PB Name", "EF Indicator", "Method",
        "Impact", "Allocated SOS", "SR", "Zone",
        "Principle", "L1 Factor", "L2 Factor", "Boundary Type", "Unit",
    ])
    _style_header(ws)
    for r in result.results:
        ws.append([
            r.year, r.pb_id, r.pb_name, r.ef_indicator, r.method_label,
            r.impact, r.allocated_sos, r.sr, r.zone,
            r.sharing_principle, r.sharing_factor_l1, r.sharing_factor_l2,
            r.boundary_type, r.unit,
        ])
    for row in ws.iter_rows(min_row=2, min_col=6, max_col=7):
        for cell in row:
            cell.number_format = num_fmt
    for row in ws.iter_rows(min_row=2, min_col=8, max_col=8):
        for cell in row:
            cell.number_format = "0.000"
    ws.freeze_panes = "A2"
    _autosize(ws)

    # ── By Fuel Type (cohort breakdown) ──
    ws = wb.create_sheet("By Fuel Type")
    ws.append(["Year", "PB", "Cohort", "Impact"])
    _style_header(ws)
    for r in result.results:
        for cohort, val in r.impact_by_cohort.items():
            ws.append([r.year, r.pb_name, cohort, val])
    for row in ws.iter_rows(min_row=2, min_col=4, max_col=4):
        for cell in row:
            cell.number_format = num_fmt
    ws.freeze_panes = "A2"
    _autosize(ws)

    # ── Multi-D Configuration ──
    ws = wb.create_sheet("Multi-D Configuration")
    ws.append(["PB ID", "Principle", "Justification", "System Value", "Global Value"])
    _style_header(ws)
    for pb_id, sp in config.multi_d.layer1.items():
        ws.append([
            pb_id, sp.principle, sp.justification,
            sp.system_value, sp.global_value,
        ])
    ws.append([])
    ws.append(["Layer 2 sector share", config.multi_d.layer2_sector_share])
    ws.append(["Layer 2 source", config.multi_d.layer2_source])
    _autosize(ws)

    # ── Carbon Budget ──
    if config.carbon_budget is not None:
        ws = wb.create_sheet("Carbon Budget")
        cb = config.carbon_budget
        ws.append(["Initial budget (Gt CO2)", cb.initial_budget_gt])
        ws.append(["Source", cb.budget_source])
        ws.append(["SSP scenario", cb.ssp_scenario])
        ws.append(["Start year", cb.start_year])
        ws.append(["End year", cb.end_year])
        ws.append([])
        ws.append(["Year", "Projected global CO2 (Gt)", "Remaining budget (Gt)",
                   "Annual global allocation (Gt)"])
        for row in ws.iter_rows(min_row=7, max_row=7):
            for cell in row:
                cell.font = header_font
                cell.fill = header_fill
        for y in range(cb.start_year, cb.end_year + 1):
            ws.append([
                y,
                cb.projected_emissions.get(y, 0.0),
                cb.remaining_budget(y),
                cb.annual_global_allocation(y),
            ])
        _autosize(ws)

    # ── Sensitivity (if run) ──
    if result.sensitivity:
        ws = wb.create_sheet("Sensitivity")
        ws.append(["Scenario", "Year", "PB", "SR", "Zone", "Allocated SOS"])
        _style_header(ws)
        # Baseline Multi-D first, then each uniform principle
        for r in result.results:
            ws.append([
                "Multi-D", r.year, r.pb_name, r.sr, r.zone, r.allocated_sos,
            ])
        for principle, rows in result.sensitivity.items():
            for r in rows:
                ws.append([
                    principle, r.year, r.pb_name, r.sr, r.zone, r.allocated_sos,
                ])
        for row in ws.iter_rows(min_row=2, min_col=4, max_col=4):
            for cell in row:
                cell.number_format = "0.000"
        for row in ws.iter_rows(min_row=2, min_col=6, max_col=6):
            for cell in row:
                cell.number_format = num_fmt
        ws.freeze_panes = "A2"
        _autosize(ws)

    # ── Methodology Notes ──
    ws = wb.create_sheet("Methodology")
    ws.append(["Field", "Value"])
    _style_header(ws)
    ws.append(["Configuration", config.name])
    ws.append(["Boundary set", config.boundary_set_id])
    ws.append(["Impact mode", config.impact_mode])
    ws.append(["Layer 2 (grandfathering)", f"{config.multi_d.layer2_sector_share} — {config.multi_d.layer2_source}"])
    principles = sorted({sp.principle for sp in config.multi_d.layer1.values()})
    ws.append(["Layer 1 principles used", ", ".join(principles)])
    if config.carbon_budget:
        ws.append(["Carbon budget", f"{config.carbon_budget.initial_budget_gt} Gt — {config.carbon_budget.budget_source}"])
        ws.append(["SSP scenario", config.carbon_budget.ssp_scenario])
    ws.append(["Missing PB categories",
               ", ".join(result.missing_categories) if result.missing_categories else "none"])
    ws.append(["Uncertainty", "Deterministic — Monte Carlo planned for v1.1"])
    _autosize(ws)

    return wb
