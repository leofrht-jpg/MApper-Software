import datetime

import bw2data
from fastapi import APIRouter, HTTPException, WebSocket

from mapper.core.bw2_wrapper import (
    get_contributions,
    get_supply_chain,
    parse_activity_key,
    run_lca,
)
from mapper.core.tasks import Task, create_task, get_task, run_in_thread
from mapper.models.schemas import (
    ContributionsResponse,
    LCACalculateRequest,
    LCAResult,
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

    contributions = get_contributions(lca_obj, result["score"])
    supply_chain = get_supply_chain(lca_obj, depth=3)

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
        bw2data.get_activity(key)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid functional unit: {e}")

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
