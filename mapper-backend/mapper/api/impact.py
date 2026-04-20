"""Unified Impact Assessment endpoints.

Single entry point that can run MFA × LCA in two modes:
- ``static``: one LCI for the whole horizon (existing MFALCAPipeline).
  BOMs may still evolve year-to-year via MaterialEvolution.
- ``projected``: year-matched prospective databases from premise-generated
  scenarios (ProjectedMFALCAPipeline).

Runs as a background task so long calculations (projected × many years ×
many methods) don't block the API. Progress is streamed over a WebSocket.
"""
from __future__ import annotations

import asyncio
import io
import logging
import threading
import time
import uuid
from typing import Any

import bw2data
from fastapi import APIRouter, HTTPException, Response, WebSocket, WebSocketDisconnect

from mapper.api.bom import (
    _build_mfa_lca_workbook,
    _current_project,
    _proj_archetypes,
    _proj_cohort_mappings,
    _proj_results,
    _sanitize_filename,
)
from mapper.api.mfa import _get_system
from mapper.core import plca_storage
from mapper.core.bom_engine import iter_all_materials
from mapper.core.bw2_wrapper import PersistentLCARunner, run_lca_multi_method
from mapper.core.mfa_lca_engine import (
    MFALCAPipeline,
    ProjectedMFALCAPipeline,
    resolve_database_for_year,
)
from mapper.models.bom_schemas import (
    ImpactAssessmentMeta,
    ImpactAssessmentRequest,
    ImpactAssessmentResult,
    ImpactComparePoint,
    ImpactCompareMethodResult,
    ImpactCompareRequest,
    ImpactCompareResult,
    ImpactExportRequest,
    MFALCAResult,
)
from openpyxl.styles import Alignment, Font, PatternFill


router = APIRouter(prefix="/impact", tags=["impact"])


# ── Task registry (mirrors plca.py) ───────────────────────────────────────────


class _TaskState:
    def __init__(self) -> None:
        self.stage: str = "queued"
        self.pct: float = 0.0
        self.done: bool = False
        self.error: str | None = None
        self.result: ImpactAssessmentResult | None = None
        self.subscribers: list[asyncio.Queue] = []


_TASKS: dict[str, _TaskState] = {}
_TASK_LOCK = threading.Lock()


def _notify_all(task: _TaskState, payload: dict[str, Any]) -> None:
    for q in list(task.subscribers):
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            pass


# ── Helpers ───────────────────────────────────────────────────────────────────


def _resolve_prospective_dbs(project: str, scenario) -> list[tuple[str, int]]:
    """Return [(db_name, year), ...] for every registered DB that matches the
    given base/iam/ssp triple."""
    log = logging.getLogger(__name__)
    registry = plca_storage.load_registry(project)
    iam = scenario.iam.lower()
    existing = set(bw2data.databases)
    log.info(
        "pLCA resolve: project=%s, scenario={base_db=%r, iam=%r, ssp=%r}, "
        "registry_entries=%d, bw2_databases=%d",
        project, scenario.base_db, scenario.iam, scenario.ssp,
        len(registry), len(existing),
    )
    log.debug("  bw2data.databases: %s", sorted(existing))
    log.debug("  registry raw: %s", registry)

    out: list[tuple[str, int]] = []
    rejected: list[tuple[str, str]] = []  # (name, reason)
    for entry in registry:
        name = entry.get("name") or "?"
        if entry.get("base_db") != scenario.base_db:
            rejected.append((name, f"base_db={entry.get('base_db')!r} != {scenario.base_db!r}"))
            continue
        if (entry.get("iam") or "").lower() != iam:
            rejected.append((name, f"iam={entry.get('iam')!r} != {iam!r}"))
            continue
        if entry.get("ssp") != scenario.ssp:
            rejected.append((name, f"ssp={entry.get('ssp')!r} != {scenario.ssp!r}"))
            continue
        if not name or name not in existing:
            rejected.append((name, "name not in bw2data.databases (was DB deleted?)"))
            continue
        try:
            out.append((name, int(entry.get("year"))))
        except (TypeError, ValueError):
            rejected.append((name, f"bad year={entry.get('year')!r}"))
            continue
    out.sort(key=lambda p: p[1])
    log.info("pLCA resolve: matched %d DB(s): %s", len(out), out)
    if rejected:
        log.info("pLCA resolve: rejected %d entries: %s", len(rejected), rejected)
    return out


def _year_to_database_map(
    sim_years: list[int],
    prospective_dbs: list[tuple[str, int]],
    year_start: int | None,
    year_end: int | None,
) -> dict[int, str]:
    out: dict[int, str] = {}
    for y in sim_years:
        if year_start is not None and y < year_start:
            continue
        if year_end is not None and y > year_end:
            continue
        match = resolve_database_for_year(y, prospective_dbs)
        if match is not None:
            out[y] = match[0]
    return out


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.post("/calculate")
async def post_calculate(body: ImpactAssessmentRequest) -> dict[str, str]:
    mode = (body.mode or "").lower()
    if mode not in {"static", "projected"}:
        raise HTTPException(status_code=400, detail="mode must be 'static' or 'projected'")
    _get_system(body.mfa_system_id)
    project = _current_project()

    sim = _proj_results(project).get(body.mfa_system_id)
    if sim is None:
        raise HTTPException(
            status_code=400,
            detail="No simulation results yet. Run /mfa/systems/{id}/simulate first.",
        )
    mapping = _proj_cohort_mappings(project).get(body.mfa_system_id)
    if mapping is None or not mapping.mappings:
        raise HTTPException(
            status_code=400,
            detail="No cohort mappings set. POST /mfa/systems/{id}/cohort-mappings first.",
        )
    if not body.methods:
        raise HTTPException(status_code=400, detail="At least one method is required.")
    if body.year_start is not None and body.year_end is not None and body.year_start > body.year_end:
        raise HTTPException(status_code=400, detail="year_start must be ≤ year_end.")

    archetypes = _proj_archetypes(project)
    cohort_to_archetype: dict[str, tuple[str, float]] = {}
    for entry in mapping.mappings:
        arc = archetypes.get(entry.archetype_id)
        if arc is None:
            raise HTTPException(
                status_code=400,
                detail=f"Archetype '{entry.archetype_id}' (mapped to {entry.cohort_key}) was deleted.",
            )
        unlinked = sum(1 for m in iter_all_materials(arc.bom) if m.ecoinvent_activity is None)
        if unlinked:
            raise HTTPException(
                status_code=400,
                detail=f"Archetype '{arc.name}' has {unlinked} unlinked material(s).",
            )
        cohort_to_archetype[entry.cohort_key] = (entry.archetype_id, entry.scaling_factor)

    method_tuples = [tuple(m) for m in body.methods if m]
    if not method_tuples:
        raise HTTPException(status_code=400, detail="At least one method is required.")

    prospective_dbs: list[tuple[str, int]] = []
    year_to_db: dict[int, str] = {}
    if mode == "projected":
        if body.scenario is None:
            raise HTTPException(status_code=400, detail="Projected mode requires a scenario (base_db, iam, ssp).")
        prospective_dbs = _resolve_prospective_dbs(project, body.scenario)
        if not prospective_dbs:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"No prospective databases found for scenario "
                    f"{body.scenario.base_db} / {body.scenario.iam} / {body.scenario.ssp}. "
                    "Generate them via /plca/generate first."
                ),
            )
        sim_years = [yr.year for yr in sim.years]
        year_to_db = _year_to_database_map(sim_years, prospective_dbs, body.year_start, body.year_end)

    task_id = uuid.uuid4().hex
    task = _TaskState()
    with _TASK_LOCK:
        _TASKS[task_id] = task

    loop = asyncio.get_running_loop()

    def _publish(stage: str, pct: float) -> None:
        task.stage = stage
        task.pct = pct
        loop.call_soon_threadsafe(
            _notify_all, task, {"type": "progress", "stage": stage, "pct": pct}
        )

    def _run() -> None:
        t0 = time.perf_counter()
        try:
            _publish("preparing", 0.02)
            in_range_years = [
                yr.year for yr in sim.years
                if (body.year_start is None or yr.year >= body.year_start)
                and (body.year_end is None or yr.year <= body.year_end)
            ]
            total_years = max(len(in_range_years), 1)
            # Create a persistent runner that factorizes the technosphere
            # matrix ONCE and reuses it across all years via redo_lci().
            persistent = PersistentLCARunner()
            # scope="all" runs three sub-scopes (inflows → stock → outflows);
            # each iterates all years. Labels match the user-facing stage names.
            if body.scope == "all":
                scope_labels = ["Manufacturing", "Operation", "End of Life"]
            else:
                scope_labels = [_SCOPE_LABELS.get(body.scope, body.scope)]
            runner = _progress_runner(
                _publish, in_range_years, scope_labels, persistent
            )

            if mode == "projected":
                pipeline = ProjectedMFALCAPipeline(
                    simulation_result=sim,
                    archetypes=archetypes,
                    cohort_mappings=cohort_to_archetype,
                    methods=method_tuples,
                    lca_runner=runner,
                    year_start=body.year_start,
                    year_end=body.year_end,
                    prospective_dbs=prospective_dbs,
                    fallback_base_db=body.base_db,
                )
                _publish(f"running projected LCA ({total_years} years × {len(method_tuples)} method(s))", 0.1)
            else:
                pipeline = MFALCAPipeline(
                    simulation_result=sim,
                    archetypes=archetypes,
                    cohort_mappings=cohort_to_archetype,
                    methods=method_tuples,
                    lca_runner=runner,
                    year_start=body.year_start,
                    year_end=body.year_end,
                )
                _publish(f"running static LCA ({len(method_tuples)} method(s))", 0.1)

            results = pipeline.calculate(body.scope)
            elapsed = round(time.perf_counter() - t0, 2)
            logging.getLogger(__name__).info(
                "LCA complete in %.1fs  (factorizations=%d, redo_lci=%d, "
                "method_switches=%d)",
                elapsed,
                persistent.factorizations,
                persistent.redo_calls,
                persistent.method_switches,
            )

            meta = ImpactAssessmentMeta(
                mode=mode,
                mfa_system_id=body.mfa_system_id,
                scope=body.scope,
                year_start=body.year_start,
                year_end=body.year_end,
                base_db=body.base_db,
                scenario=body.scenario,
                year_to_database=year_to_db,
            )
            out = ImpactAssessmentResult(
                task_id=task_id, meta=meta, results=results,
                elapsed_seconds=elapsed,
            )
            task.result = out
            task.stage = "done"
            task.pct = 1.0
            task.done = True
            loop.call_soon_threadsafe(
                _notify_all,
                task,
                {
                    "type": "done",
                    "methods_calculated": len(results),
                    "year_to_database": year_to_db,
                    "elapsed_seconds": elapsed,
                },
            )
        except Exception as exc:  # pragma: no cover
            task.error = str(exc)
            task.done = True
            loop.call_soon_threadsafe(
                _notify_all, task, {"type": "error", "error": str(exc)}
            )

    threading.Thread(target=_run, daemon=True).start()
    return {"task_id": task_id}


_SCOPE_LABELS = {
    "inflows": "Manufacturing",
    "stock": "Operation",
    "outflows": "End of Life",
    "all": "Full lifecycle",
}


def _progress_runner(
    publish,
    years: list[int],
    scope_labels: list[str],
    persistent: PersistentLCARunner | None = None,
):
    """Wrap a ``PersistentLCARunner`` (or fall back to ``run_lca_multi_method``)
    and emit a progress tick per (scope, year) pair.

    When *persistent* is provided, the runner reuses a single LU
    factorization of the technosphere matrix across all years — turning
    ~0.5 s per year into ~1 ms back-substitution.

    The pipeline iterates scopes sequentially (``_ATOMIC_SCOPES`` order:
    inflows → stock → outflows), each looping over all in-range years,
    so the (scope, year) pair can be derived from the call counter.
    """
    lca_fn = persistent or run_lca_multi_method
    counter = {"n": 0}
    total_years = max(len(years), 1)
    total = total_years * max(len(scope_labels), 1)

    def runner(demand, method_tuples):
        counter["n"] += 1
        n = counter["n"]
        pct = 0.1 + 0.85 * min(1.0, n / total)
        idx = n - 1
        scope_idx = min(idx // total_years, len(scope_labels) - 1)
        year_idx = idx % total_years
        year = years[year_idx] if years else None
        scope_label = scope_labels[scope_idx] if scope_labels else None
        if year is not None and scope_label and len(scope_labels) > 1:
            stage = f"{year} · {scope_label} ({n}/{total})"
        elif year is not None and scope_label:
            stage = f"year {year} · {scope_label} ({n}/{total})"
        elif year is not None:
            stage = f"year {year} ({n}/{total})"
        else:
            stage = f"{n}/{total}"
        publish(stage, pct)
        return lca_fn(demand, method_tuples)

    return runner


@router.get("/results/{task_id}", response_model=ImpactAssessmentResult)
async def get_results(task_id: str) -> ImpactAssessmentResult:
    with _TASK_LOCK:
        task = _TASKS.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Unknown task id")
    if task.error:
        raise HTTPException(status_code=500, detail=task.error)
    if not task.done or task.result is None:
        raise HTTPException(status_code=425, detail="Task not finished yet")
    return task.result


@router.post("/compare", response_model=ImpactCompareResult)
async def post_compare(body: ImpactCompareRequest) -> ImpactCompareResult:
    with _TASK_LOCK:
        t_static = _TASKS.get(body.static_task_id)
        t_proj = _TASKS.get(body.projected_task_id)
    if t_static is None or t_static.result is None:
        raise HTTPException(status_code=404, detail="Static task not found or not finished.")
    if t_proj is None or t_proj.result is None:
        raise HTTPException(status_code=404, detail="Projected task not found or not finished.")
    static = t_static.result
    proj = t_proj.result

    if static.meta.mfa_system_id != proj.meta.mfa_system_id:
        raise HTTPException(status_code=400, detail="Comparison requires both runs on the same MFA system.")
    if static.meta.scope != proj.meta.scope:
        raise HTTPException(status_code=400, detail="Comparison requires both runs in the same scope.")

    static_by_method: dict[tuple, MFALCAResult] = {tuple(r.method): r for r in static.results}
    proj_by_method: dict[tuple, MFALCAResult] = {tuple(r.method): r for r in proj.results}

    methods_out: list[ImpactCompareMethodResult] = []
    for mkey, s_res in static_by_method.items():
        p_res = proj_by_method.get(mkey)
        if p_res is None:
            continue
        s_years = {y.year: y.total_impact for y in s_res.years}
        p_years = {y.year: y.total_impact for y in p_res.years}
        all_years = sorted(set(s_years) | set(p_years))
        points: list[ImpactComparePoint] = []
        total_s = 0.0
        total_p = 0.0
        for y in all_years:
            sv = s_years.get(y, 0.0)
            pv = p_years.get(y, 0.0)
            delta = pv - sv
            dpct = (delta / sv * 100.0) if sv else None
            points.append(ImpactComparePoint(
                year=y, static_impact=sv, projected_impact=pv, delta=delta, delta_pct=dpct,
            ))
            total_s += sv
            total_p += pv
        total_delta = total_p - total_s
        methods_out.append(ImpactCompareMethodResult(
            method=list(mkey),
            method_label=s_res.method_label or " › ".join(mkey),
            unit=p_res.unit or s_res.unit,
            points=points,
            total_static=total_s,
            total_projected=total_p,
            total_delta=total_delta,
            total_delta_pct=(total_delta / total_s * 100.0) if total_s else None,
        ))

    return ImpactCompareResult(
        mfa_system_id=static.meta.mfa_system_id,
        scope=static.meta.scope,
        methods=methods_out,
    )


def _resolve_export_result(
    task_id: str | None, inline: ImpactAssessmentResult | None
) -> ImpactAssessmentResult:
    if inline is not None:
        return inline
    if task_id is None:
        raise HTTPException(status_code=400, detail="Either task_id or inline result is required.")
    with _TASK_LOCK:
        task = _TASKS.get(task_id)
    if task is None or task.result is None:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found or not finished.")
    return task.result


def _append_compare_sheet(
    wb,
    static: ImpactAssessmentResult,
    projected: ImpactAssessmentResult,
) -> None:
    if static.meta.mfa_system_id != projected.meta.mfa_system_id:
        return
    if static.meta.scope != projected.meta.scope:
        return

    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill("solid", fgColor="374151")
    num_fmt = "0.00E+00"

    ws = wb.create_sheet("Static vs Projected")
    ws.append([f"Scope: {static.meta.scope}   ·   Static task: {static.task_id}   ·   Projected task: {projected.task_id}"])
    ws["A1"].font = Font(italic=True, color="6B7280")

    static_by_method: dict[tuple, MFALCAResult] = {tuple(r.method): r for r in static.results}
    first_method_block = True

    for p_res in projected.results:
        mkey = tuple(p_res.method)
        s_res = static_by_method.get(mkey)
        if s_res is None:
            continue

        if not first_method_block:
            ws.append([])
        first_method_block = False

        ws.append([f"Method: {' › '.join(mkey)}   Unit: {p_res.unit or s_res.unit}"])
        ws[ws.max_row][0].font = Font(bold=True)

        header = ["Year", f"Static ({s_res.unit})", f"Projected ({p_res.unit})", "Δ", "Δ %"]
        ws.append(header)
        for cell in ws[ws.max_row]:
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal="center")

        s_years = {y.year: y.total_impact for y in s_res.years}
        p_years = {y.year: y.total_impact for y in p_res.years}
        years = sorted(set(s_years) | set(p_years))
        total_s = 0.0
        total_p = 0.0
        data_start = ws.max_row + 1
        for y in years:
            sv = s_years.get(y, 0.0)
            pv = p_years.get(y, 0.0)
            delta = pv - sv
            dpct = (delta / abs(sv) * 100.0) if sv else None
            ws.append([y, sv, pv, delta, dpct if dpct is not None else ""])
            total_s += sv
            total_p += pv
        total_delta = total_p - total_s
        total_pct = (total_delta / abs(total_s) * 100.0) if total_s else None
        ws.append(["Total", total_s, total_p, total_delta, total_pct if total_pct is not None else ""])
        ws[ws.max_row][0].font = Font(bold=True)

        for row in ws.iter_rows(min_row=data_start, max_row=ws.max_row, min_col=2, max_col=4):
            for cell in row:
                cell.number_format = num_fmt
        for row in ws.iter_rows(min_row=data_start, max_row=ws.max_row, min_col=5, max_col=5):
            for cell in row:
                cell.number_format = "0.00"


@router.post("/export")
async def post_export(body: ImpactExportRequest) -> Response:
    result = _resolve_export_result(body.task_id, body.result)
    compare_partner: ImpactAssessmentResult | None = None
    if body.compare_task_id is not None or body.compare_result is not None:
        compare_partner = _resolve_export_result(body.compare_task_id, body.compare_result)

    project = _current_project()
    sys_def = _get_system(result.meta.mfa_system_id)
    mapping = _proj_cohort_mappings(project).get(result.meta.mfa_system_id)
    archetypes = _proj_archetypes(project)

    sim = _proj_results(project).get(result.meta.mfa_system_id)
    sim_counts: dict[int, dict[str, float]] = {}
    if sim is not None:
        scope = result.meta.scope
        for yr in sim.years:
            if scope == "inflows":
                sim_counts[yr.year] = dict(yr.inflow)
            elif scope == "outflows":
                sim_counts[yr.year] = dict(yr.outflow)
            else:
                sim_counts[yr.year] = dict(yr.stock)

    wb = _build_mfa_lca_workbook(
        system_name=sys_def.name,
        results=result.results,
        scope=result.meta.scope,
        selected_year=body.year,
        cohort_mapping=mapping,
        archetypes=archetypes,
        sim_counts=sim_counts,
        dims=list(sys_def.dimensions),
        elapsed_seconds=result.elapsed_seconds,
        sim_result=sim,
    )

    # Decide pairing for the Static-vs-Projected sheet.
    if compare_partner is not None:
        if result.meta.mode == "static":
            _append_compare_sheet(wb, static=result, projected=compare_partner)
        else:
            _append_compare_sheet(wb, static=compare_partner, projected=result)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    import datetime
    scope_labels = {"inflows": "Manufacturing", "stock": "Operation", "outflows": "End_of_Life", "all": "Full_lifecycle"}
    scope_tag = scope_labels.get(result.meta.scope, result.meta.scope)
    date_tag = datetime.date.today().isoformat()
    filename = f"MApper_Impact_{_sanitize_filename(sys_def.name, 'system')}_{scope_tag}_{date_tag}.xlsx"
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.websocket("/ws/{task_id}")
async def ws_progress(websocket: WebSocket, task_id: str) -> None:
    await websocket.accept()
    with _TASK_LOCK:
        task = _TASKS.get(task_id)
    if task is None:
        await websocket.send_json({"type": "error", "error": "Unknown task id"})
        await websocket.close()
        return

    queue: asyncio.Queue = asyncio.Queue(maxsize=256)
    task.subscribers.append(queue)

    await websocket.send_json({"type": "progress", "stage": task.stage, "pct": task.pct})
    if task.done:
        if task.error:
            await websocket.send_json({"type": "error", "error": task.error})
        else:
            await websocket.send_json({
                "type": "done",
                "methods_calculated": len(task.result.results) if task.result else 0,
                "year_to_database": task.result.meta.year_to_database if task.result else {},
            })
        await websocket.close()
        return

    try:
        while True:
            payload = await queue.get()
            await websocket.send_json(payload)
            if payload.get("type") in ("done", "error"):
                break
    except WebSocketDisconnect:
        pass
    finally:
        try:
            task.subscribers.remove(queue)
        except ValueError:
            pass
        try:
            await websocket.close()
        except Exception:
            pass
