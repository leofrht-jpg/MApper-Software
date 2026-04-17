"""AESA API: planetary-boundary reference data, configuration CRUD,
assessment, and xlsx export."""
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
    DEFAULT_BOUNDARIES,
    SHARING_PRINCIPLES,
    SUGGESTED_METHOD_MAPPINGS,
    suggest_mappings_for_methods,
)
from mapper.models.aesa_schemas import (
    AESAAssessRequest,
    AESAConfiguration,
    AESAConfigurationCreate,
    AESAExportRequest,
    AESAResult,
    PlanetaryBoundary,
    SharingPrinciple,
)
from mapper.models.bom_schemas import ImpactAssessmentResult


router = APIRouter(prefix="/aesa", tags=["aesa"])


# ── Reference data ───────────────────────────────────────────────────────────


@router.get("/boundaries", response_model=list[PlanetaryBoundary])
async def get_boundaries() -> list[PlanetaryBoundary]:
    return [PlanetaryBoundary(**b) for b in DEFAULT_BOUNDARIES]


@router.get("/sharing-principles", response_model=list[SharingPrinciple])
async def get_sharing_principles() -> list[SharingPrinciple]:
    return [SharingPrinciple(**p) for p in SHARING_PRINCIPLES]


@router.post("/method-suggestions")
async def post_method_suggestions(body: dict) -> list[dict]:
    """Body: ``{"methods": [["EF v3.1", "climate change", ...], ...]}``.
    Returns a list of ``{method_tuple, boundary_id, match_score}``.
    """
    methods = body.get("methods") or []
    if not isinstance(methods, list):
        raise HTTPException(status_code=400, detail="methods must be a list of tuples")
    return suggest_mappings_for_methods(methods)


@router.get("/suggested-mappings")
async def get_suggested_mappings() -> dict:
    return SUGGESTED_METHOD_MAPPINGS


# ── Configuration CRUD ───────────────────────────────────────────────────────


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
        sharing_principle_id=body.sharing_principle_id,
        sharing_params=body.sharing_params,
        method_mapping=body.method_mapping,
        custom_thresholds=body.custom_thresholds,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    aesa_storage.save(project, config.model_dump())
    return config


@router.put("/configurations/{config_id}", response_model=AESAConfiguration)
async def put_configuration(config_id: str, body: AESAConfigurationCreate) -> AESAConfiguration:
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
        sharing_principle_id=body.sharing_principle_id,
        sharing_params=body.sharing_params,
        method_mapping=body.method_mapping,
        custom_thresholds=body.custom_thresholds,
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


# ── Assessment ───────────────────────────────────────────────────────────────


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


@router.post("/assess", response_model=AESAResult)
async def post_assess(body: AESAAssessRequest) -> AESAResult:
    project = _current_project()
    raw = aesa_storage.load(project, body.config_id)
    if raw is None:
        raise HTTPException(status_code=404, detail="AESA configuration not found")
    config = AESAConfiguration(**raw)

    impact = _resolve_impact(body.impact_task_id, body.impact_result)
    if impact.meta.mfa_system_id != config.mfa_system_id:
        raise HTTPException(
            status_code=400,
            detail="Impact result is for a different MFA system than the AESA config.",
        )
    return AESAEngine.assess(impact.results, config)


# ── Export ───────────────────────────────────────────────────────────────────


@router.post("/export")
async def post_export(body: AESAExportRequest) -> Response:
    project = _current_project()
    raw = aesa_storage.load(project, body.config_id)
    if raw is None:
        raise HTTPException(status_code=404, detail="AESA configuration not found")
    config = AESAConfiguration(**raw)
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
    config: AESAConfiguration, result: AESAResult, system_name: str,
) -> Workbook:
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill("solid", fgColor="064E3B")  # emerald-950
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

    # ── Summary ──
    ws = wb.create_sheet("Summary")
    ws.append(["System", system_name])
    ws.append(["AESA Configuration", config.name])
    ws.append(["Sharing Principle", config.sharing_principle_id])
    ws.append(["Boundaries Assessed", result.summary.boundaries_assessed])
    ws.append(["Safe (ratio < 0.8)", result.summary.boundaries_safe])
    ws.append(["Caution (0.8–1.0)", result.summary.boundaries_caution])
    ws.append(["Exceeded (> 1.0)", result.summary.boundaries_exceeded])
    ws.append(["Worst Indicator (final year)", result.summary.worst_indicator])
    ws.append(["Best Indicator (final year)", result.summary.best_indicator])
    ws.append(["Trend", result.summary.trend])
    _autosize(ws)

    # ── Indicators by Year (ratios) ──
    ws = wb.create_sheet("Indicators by Year")
    boundary_ids: list[str] = []
    seen = set()
    for y in result.years:
        for ind in y.indicators:
            if ind.boundary_id not in seen:
                seen.add(ind.boundary_id)
                boundary_ids.append(ind.boundary_id)
    boundary_names = {
        b: next((i.boundary_name for y in result.years for i in y.indicators if i.boundary_id == b), b)
        for b in boundary_ids
    }
    header = ["Year", *[f"{boundary_names[b]} (ratio)" for b in boundary_ids]]
    ws.append(header)
    for cell in ws[1]:
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center")
    for y in result.years:
        ratios = {i.boundary_id: i.ratio for i in y.indicators}
        ws.append([y.year, *[ratios.get(b, "") for b in boundary_ids]])
    for row in ws.iter_rows(min_row=2, min_col=2):
        for cell in row:
            cell.number_format = "0.000"
    ws.freeze_panes = "A2"
    _autosize(ws)

    # ── Thresholds ──
    ws = wb.create_sheet("Thresholds")
    ws.append(["Boundary ID", "Global Limit", "Global Unit", "Allocated Threshold", "Allocated Unit", "Sharing Principle", "Year"])
    for cell in ws[1]:
        cell.font = header_font
        cell.fill = header_fill
    from mapper.core.aesa_engine import DEFAULT_BOUNDARIES as _DB
    db_by_id = {b["id"]: b for b in _DB}
    for alloc in config.custom_thresholds:
        ref = db_by_id.get(alloc.boundary_id, {})
        ws.append([
            alloc.boundary_id,
            ref.get("global_limit") or "",
            ref.get("global_limit_unit") or "",
            alloc.allocated_threshold,
            alloc.allocated_unit,
            alloc.sharing_principle_id,
            alloc.year if alloc.year is not None else "all",
        ])
    _autosize(ws)

    # ── Detail (long-form) ──
    ws = wb.create_sheet("Detail")
    header = ["Year", "Boundary", "Method", "Impact", "Threshold", "Ratio", "Status", "Unit"]
    ws.append(header)
    for cell in ws[1]:
        cell.font = header_font
        cell.fill = header_fill
    for y in result.years:
        for ind in y.indicators:
            ws.append([
                y.year, ind.boundary_name, ind.method_label,
                ind.impact_value, ind.threshold_value, ind.ratio, ind.status, ind.unit,
            ])
    for row in ws.iter_rows(min_row=2, min_col=4, max_col=5):
        for cell in row:
            cell.number_format = num_fmt
    for row in ws.iter_rows(min_row=2, min_col=6, max_col=6):
        for cell in row:
            cell.number_format = "0.000"
    ws.freeze_panes = "A2"
    _autosize(ws)

    return wb
