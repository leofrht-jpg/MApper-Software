import datetime
import io
import time

import bw2data
from fastapi import APIRouter, HTTPException, WebSocket
from fastapi.responses import Response

from mapper.core.bw2_wrapper import (
    PersistentLCARunner,
    get_contributions,
    get_supply_chain,
    parse_activity_key,
    run_lca,
)
from mapper.core.bom_engine import (
    filter_roots_by_scope,
    flatten_roots,
    flatten_roots_for_scope,
    stage_to_scope,
    stages_in_scope,
)
from mapper.core.tasks import Task, create_task, get_task, run_in_thread
from mapper.models.schemas import (
    ActivityContribution,
    ActivityDemandItem,
    ActivityLCAMethodResult,
    ActivityLCARequest,
    ActivityLCAResult,
    ArchetypeLCACalculateRequest,
    ArchetypeLCACalculateResult,
    ArchetypeLCAExportRequest,
    ArchetypeLCAMethodResult,
    ContributionsResponse,
    LCACalculateRequest,
    LCAResult,
    MaterialContribution,
    SankeyData,
    TaskStartedResponse,
)
from mapper.ws.progress import stream_task_progress

router = APIRouter()

# In-memory store for LCA results keyed by task_id
_lca_results: dict[str, dict] = {}


def _lca_worker(
    task: Task,
    functional_unit_key: str,
    amount: float,
    method_tuple: list[str],
) -> None:
    task.update("building_matrix", 0.1, "Building technosphere matrix…")
    result = run_lca(functional_unit_key, amount, method_tuple)

    task.update("solving", 0.4, "Solving linear system…")
    # LCI already done inside run_lca

    task.update("characterizing", 0.6, "Characterizing impacts…")
    # LCIA already done inside run_lca

    task.update("analyzing", 0.8, "Analyzing contributions…")
    lca_obj = result.pop("lca_object")
    activity_key = result.pop("activity_key")

    # Contribution analysis can fail for certain activities (biosphere flows,
    # zero-score results, etc.).  Return the score even if analysis fails.
    try:
        contributions = get_contributions(lca_obj, result["score"])
    except Exception:
        contributions = {"items": [], "rest_amount": result["score"], "rest_percentage": 100.0}
    try:
        supply_chain = get_supply_chain(lca_obj, depth=3)
    except Exception:
        supply_chain = {"nodes": [], "links": []}

    _lca_results[task.task_id] = {
        "result": {
            "task_id": task.task_id,
            "method": method_tuple,
            "functional_unit_name": result["functional_unit_name"],
            "functional_unit_amount": amount,
            "score": result["score"],
            "unit": result["unit"],
            "calculated_at": datetime.datetime.now().isoformat(),
        },
        "contributions": contributions,
        "supply_chain": supply_chain,
    }

    task.update("done", 1.0, "Calculation complete.")


@router.post("/lca/calculate", response_model=TaskStartedResponse)
async def calculate_lca(body: LCACalculateRequest) -> TaskStartedResponse:
    try:
        # Validate key exists
        key = parse_activity_key(body.functional_unit.key)
        act = bw2data.get_activity(key)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid functional unit: {e}")

    # Biosphere flows cannot be used as functional units
    if "biosphere" in str(key[0]).lower():
        raise HTTPException(
            status_code=400,
            detail="Biosphere flows cannot be used as functional units. Select a technosphere activity from ecoinvent.",
        )

    task = create_task()
    run_in_thread(
        task,
        _lca_worker,
        body.functional_unit.key,
        body.functional_unit.amount,
        body.method,
    )
    return TaskStartedResponse(task_id=task.task_id, status="started")


@router.websocket("/ws/lca/{task_id}")
async def ws_lca_progress(websocket: WebSocket, task_id: str) -> None:
    await stream_task_progress(websocket, task_id)


@router.get("/lca/results/{task_id}", response_model=LCAResult)
async def get_lca_result(task_id: str) -> LCAResult:
    data = _lca_results.get(task_id)
    if not data:
        task = get_task(task_id)
        if task and task.status == "error":
            raise HTTPException(status_code=500, detail=task.error)
        raise HTTPException(status_code=404, detail="Result not ready or not found")
    return LCAResult(**data["result"])


@router.get("/lca/results/{task_id}/contributions", response_model=ContributionsResponse)
async def get_lca_contributions(task_id: str, limit: int = 10) -> ContributionsResponse:
    data = _lca_results.get(task_id)
    if not data:
        raise HTTPException(status_code=404, detail="Result not found")
    contrib = data["contributions"]
    return ContributionsResponse(**contrib)


@router.get("/lca/results/{task_id}/supply-chain", response_model=SankeyData)
async def get_supply_chain_data(task_id: str) -> SankeyData:
    data = _lca_results.get(task_id)
    if not data:
        raise HTTPException(status_code=404, detail="Result not found")
    return SankeyData(**data["supply_chain"])


# ── Multi-Activity LCA Calculator ──────────────────────────────────────────────


@router.post("/lca/calculate-activities", response_model=ActivityLCAResult)
async def calculate_activity_lca(body: ActivityLCARequest) -> ActivityLCAResult:
    """LCA for one or more technosphere activities with per-activity contribution."""
    t0 = time.perf_counter()

    if not body.activities:
        raise HTTPException(status_code=400, detail="At least one activity is required")
    if not body.methods:
        raise HTTPException(status_code=400, detail="At least one method is required")

    # Validate all activities exist and are technosphere
    activity_meta: dict[tuple[str, str], dict] = {}
    for item in body.activities:
        if "biosphere" in item.database.lower():
            raise HTTPException(
                status_code=400,
                detail=f"Biosphere flows cannot be used as functional units. "
                       f"Remove '{item.code}' from the list.",
            )
        key = (item.database, item.code)
        try:
            act = bw2data.get_activity(key)
        except Exception:
            raise HTTPException(status_code=400, detail=f"Activity not found: {key}")
        activity_meta[key] = {
            "name": act.get("reference product", act.get("name", "")),
            "location": str(act.get("location", "")),
            "unit": act.get("unit", ""),
        }

    method_tuples = [tuple(ml) for ml in body.methods]

    # Build total demand
    total_demand: dict[tuple[str, str], float] = {}
    for item in body.activities:
        key = (item.database, item.code)
        total_demand[key] = total_demand.get(key, 0.0) + item.amount

    runner = PersistentLCARunner()

    try:
        # Total scores — 1 factorization + method switches
        total_scores = runner(total_demand, method_tuples)

        # Per-activity scores — reuses UMFPACK factorization
        activity_scores: dict[tuple[str, str], dict[tuple, float]] = {}
        for act_key, act_amount in total_demand.items():
            single = {act_key: act_amount}
            scores = runner(single, method_tuples)
            activity_scores[act_key] = {mt: sc for mt, (sc, _u) in scores.items()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LCA calculation failed: {e}")

    results: list[ActivityLCAMethodResult] = []
    for method_list, mt in zip(body.methods, method_tuples):
        total_score, unit = total_scores[mt]

        contribs: list[ActivityContribution] = []
        for act_key, act_amount in total_demand.items():
            impact = activity_scores.get(act_key, {}).get(mt, 0.0)
            if abs(impact) < 1e-20:
                continue
            meta = activity_meta[act_key]
            contribs.append(ActivityContribution(
                name=meta["name"],
                location=meta["location"],
                database=act_key[0],
                code=act_key[1],
                demand_amount=act_amount,
                demand_unit=meta["unit"],
                impact=impact,
                percentage=(abs(impact) / abs(total_score) * 100) if total_score else 0.0,
            ))

        contribs.sort(key=lambda c: abs(c.impact), reverse=True)
        label = method_list[-1] if method_list else ""

        results.append(ActivityLCAMethodResult(
            method=method_list,
            method_label=label,
            score=total_score,
            unit=unit,
            contributions=contribs,
        ))

    elapsed = round(time.perf_counter() - t0, 2)
    return ActivityLCAResult(results=results, elapsed_seconds=elapsed)


# ── Archetype LCA Calculator ────────────────────────────────────────────────


@router.post("/lca/calculate-archetype", response_model=ArchetypeLCACalculateResult)
async def calculate_archetype_lca(body: ArchetypeLCACalculateRequest) -> ArchetypeLCACalculateResult:
    from mapper.api.bom import _get_archetype

    t0 = time.perf_counter()

    arc = _get_archetype(body.archetype_id)  # raises 404 if not found

    if not body.methods or len(body.methods) == 0:
        raise HTTPException(status_code=400, detail="At least one method is required")

    if body.scope not in ("inflows", "stock", "outflows", "all"):
        raise HTTPException(status_code=400, detail=f"Invalid scope: {body.scope}")

    # Filter roots by scope
    scope_roots = filter_roots_by_scope(arc.bom, body.scope)
    stages = [r.name for r in scope_roots]

    # Resolve per-stage amounts.  When stage_amounts is provided, each stage
    # gets its own multiplier (e.g. Manufacturing=1, Use Phase=15).
    # Falls back to the flat `amount` field for backward compatibility.
    effective_amounts: dict[str, float] = {}
    if body.stage_amounts:
        for r in scope_roots:
            effective_amounts[r.name] = body.stage_amounts.get(r.name, 1.0)
    else:
        for r in scope_roots:
            effective_amounts[r.name] = body.amount

    # Flatten each stage separately and apply its amount multiplier
    from mapper.core.bom_engine import flatten_bom

    all_materials = []
    for root in scope_roots:
        flat = flatten_bom(root)
        stage_amt = effective_amounts.get(root.name, 1.0)
        for m in flat:
            m._stage_amount = stage_amt  # type: ignore[attr-defined]
            all_materials.append(m)

    # Collect linked materials
    linked = [m for m in all_materials if m.ecoinvent_activity is not None]
    if not linked:
        raise HTTPException(
            status_code=400,
            detail="No linked materials in this scope. Link ecoinvent activities to materials first.",
        )

    method_tuples = [tuple(ml) for ml in body.methods]

    # Build total demand: (db, code) → amount, applying per-stage multipliers
    total_demand: dict[tuple[str, str], float] = {}
    for m in linked:
        key = (m.ecoinvent_activity.database, m.ecoinvent_activity.code)  # type: ignore[union-attr]
        stage_amt = m._stage_amount  # type: ignore[attr-defined]
        total_demand[key] = total_demand.get(key, 0.0) + m.quantity * stage_amt

    runner = PersistentLCARunner()

    try:
        total_scores = runner(total_demand, method_tuples)

        activity_scores: dict[tuple[str, str], dict[tuple, float]] = {}
        for act_key, act_amount in total_demand.items():
            single = {act_key: act_amount}
            scores = runner(single, method_tuples)
            activity_scores[act_key] = {mt: sc for mt, (sc, _u) in scores.items()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LCA calculation failed: {e}")

    # Assemble results per method
    results: list[ArchetypeLCAMethodResult] = []
    for method_list, mt in zip(body.methods, method_tuples):
        total_score, unit = total_scores[mt]

        contribs: list[MaterialContribution] = []
        for m in linked:
            key = (m.ecoinvent_activity.database, m.ecoinvent_activity.code)  # type: ignore[union-attr]
            stage_amt = m._stage_amount  # type: ignore[attr-defined]
            act_score = activity_scores.get(key, {}).get(mt, 0.0)
            # Share proportionally among materials sharing same activity
            same_act_qty = sum(
                x.quantity * x._stage_amount  # type: ignore[attr-defined]
                for x in linked
                if (x.ecoinvent_activity.database, x.ecoinvent_activity.code) == key  # type: ignore[union-attr]
            )
            share = (m.quantity * stage_amt / same_act_qty) if same_act_qty > 0 else 0.0
            impact = act_score * share
            if abs(impact) < 1e-20:
                continue
            contribs.append(MaterialContribution(
                name=m.name,
                stage=m.path[0] if m.path else "",
                component=m.path[1] if len(m.path) > 2 else "",
                quantity=m.quantity * stage_amt,
                unit=m.unit,
                impact=impact,
                percentage=(abs(impact) / abs(total_score) * 100) if total_score else 0.0,
            ))

        contribs.sort(key=lambda c: abs(c.impact), reverse=True)
        label = method_list[-1] if method_list else ""

        results.append(ArchetypeLCAMethodResult(
            method=method_list,
            method_label=label,
            score=total_score,
            unit=unit,
            contributions=contribs,
        ))

    elapsed = round(time.perf_counter() - t0, 2)

    return ArchetypeLCACalculateResult(
        archetype_id=body.archetype_id,
        archetype_name=arc.name,
        scope=body.scope,
        amount=body.amount,
        stage_amounts=effective_amounts,
        stages_included=stages,
        results=results,
        elapsed_seconds=elapsed,
    )


# ── Export archetype LCA results to XLSX ──────────────────────────────────────


def _build_lca_export_workbook(data: list[ArchetypeLCACalculateResult]):  # noqa: C901
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    header_font = Font(bold=True, color="FFFFFF", size=10)
    header_fill = PatternFill("solid", fgColor="3ECFCF")
    header_align = Alignment(horizontal="center", vertical="center", wrap_text=True)
    num_fmt = '#,##0.0000'
    pct_fmt = '0.0"%"'

    def _style_header(ws, ncols: int) -> None:
        for c in range(1, ncols + 1):
            cell = ws.cell(row=1, column=c)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = header_align
        ws.freeze_panes = "A2"

    def _auto_width(ws) -> None:
        for col in ws.columns:
            mx = 0
            letter = get_column_letter(col[0].column)
            for cell in col:
                val = str(cell.value or "")
                mx = max(mx, len(val))
            ws.column_dimensions[letter].width = min(mx + 3, 40)

    # ── Sheet 1: Summary ──
    ws = wb.active
    ws.title = "Summary"
    rows = [
        ("Generated", datetime.datetime.now().strftime("%Y-%m-%d %H:%M")),
    ]
    for d in data:
        rows.append(("", ""))
        rows.append(("Archetype", d.archetype_name))
        rows.append(("Scope", d.scope))
        rows.append(("Amount", d.amount))
        rows.append(("Stages", ", ".join(d.stages_included)))
        rows.append(("Elapsed (s)", d.elapsed_seconds))
        rows.append(("Indicators", len(d.results)))
        for r in d.results:
            rows.append(("  Method", " › ".join(r.method)))
    for row in rows:
        ws.append(row)
    _auto_width(ws)

    # ── Sheet 2: Results ──
    ws2 = wb.create_sheet("Results")
    ws2.append(["Archetype", "Method", "Category", "Indicator", "Score", "Unit"])
    _style_header(ws2, 6)
    for d in data:
        for r in d.results:
            ws2.append([
                d.archetype_name,
                r.method[0] if r.method else "",
                r.method[1] if len(r.method) > 1 else "",
                r.method[-1] if r.method else "",
                r.score,
                r.unit,
            ])
            ws2.cell(row=ws2.max_row, column=5).number_format = num_fmt
    _auto_width(ws2)

    # ── Sheet 3: Contributions by material ──
    ws3 = wb.create_sheet("Contributions by material")
    # Build headers: Material | Stage | Component | then per-indicator: Qty | Unit | Impact | %
    indicators = data[0].results if data else []
    headers = ["Archetype", "Material", "Stage", "Component"]
    for r in indicators:
        label = r.method[-1] if r.method else "?"
        headers += [f"{label} Qty", f"{label} Unit", f"{label} Impact ({r.unit})", f"{label} %"]
    ws3.append(headers)
    _style_header(ws3, len(headers))

    for d in data:
        # Collect all material names across indicators
        all_names: list[str] = []
        seen: set[str] = set()
        for r in d.results:
            for c in r.contributions:
                if c.name not in seen:
                    seen.add(c.name)
                    all_names.append(c.name)
        # Build lookup: indicator_idx → {material_name → contribution}
        lookup: dict[int, dict[str, MaterialContribution]] = {}
        for idx, r in enumerate(d.results):
            lookup[idx] = {c.name: c for c in r.contributions}
        for mat_name in all_names:
            row_data: list = [d.archetype_name, mat_name, "", ""]
            first_contrib = None
            for idx in range(len(d.results)):
                c = lookup.get(idx, {}).get(mat_name)
                if c:
                    if not first_contrib:
                        first_contrib = c
                    row_data += [c.quantity, c.unit, c.impact, c.percentage]
                else:
                    row_data += ["", "", 0, 0]
            if first_contrib:
                row_data[2] = first_contrib.stage
                row_data[3] = first_contrib.component
            ws3.append(row_data)
    _auto_width(ws3)

    # ── Sheet 4: Contributions by stage ──
    ws4 = wb.create_sheet("Contributions by stage")
    headers4 = ["Archetype", "Stage"]
    for r in (data[0].results if data else []):
        label = r.method[-1] if r.method else "?"
        headers4.append(f"{label} ({r.unit})")
    ws4.append(headers4)
    _style_header(ws4, len(headers4))

    for d in data:
        stage_sums: dict[str, list[float]] = {}
        for idx, r in enumerate(d.results):
            for c in r.contributions:
                stage = c.stage or "(unknown)"
                if stage not in stage_sums:
                    stage_sums[stage] = [0.0] * len(d.results)
                stage_sums[stage][idx] += c.impact
        for stage_name, values in stage_sums.items():
            ws4.append([d.archetype_name, stage_name] + values)
    _auto_width(ws4)

    return wb


@router.post("/lca/export-archetype")
async def export_archetype_lca(body: ArchetypeLCAExportRequest) -> Response:
    wb = _build_lca_export_workbook(body.results)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    names = [d.archetype_name for d in body.results]
    safe = "_".join(n.replace(" ", "-") for n in names[:3]) or "archetype"
    scope = body.results[0].scope if body.results else "all"
    date_tag = datetime.date.today().isoformat()
    filename = f"MApper_LCA_{safe}_{scope}_{date_tag}.xlsx"
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
