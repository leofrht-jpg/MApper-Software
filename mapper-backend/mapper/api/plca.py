"""Prospective LCA endpoints — scenario listing, generation, progress streaming."""
from __future__ import annotations

import asyncio
import threading
import uuid
from datetime import datetime, timezone
from typing import Any, Literal

import bw2data
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from mapper.api import tasks as task_registry
from mapper.api.tasks import CancelledOperation
from mapper.core import plca_storage
from mapper.core.bw2_wrapper import get_current_project
from mapper.core.premise_engine import (
    AVAILABLE_IAMS,
    AVAILABLE_SSPS,
    AVAILABLE_YEARS,
    PREMISE_KEY_FILE,
    SSPS_BY_IAM,
    PremiseKeyMissingError,
    ProspectiveDBGenerator,
    premise_key_available,
    prospective_db_name,
    superstructure_db_name,
)


router = APIRouter(prefix="/plca", tags=["plca"])


# ── Schemas ───────────────────────────────────────────────────────────────────


class PLCAScenarios(BaseModel):
    iams: list[str]
    ssps: list[str]
    ssps_by_iam: dict[str, list[str]]
    years: list[int]
    key_configured: bool


class ProspectiveDB(BaseModel):
    name: str
    base_db: str
    iam: str
    ssp: str
    # In separate mode this is the single target year; in superstructure mode it
    # is None (see ``years``).
    year: int | None = None
    years: list[int] = []
    mode: Literal["separate", "superstructure"] = "separate"
    sdf_path: str | None = None
    created_at: str


class GenerateRequest(BaseModel):
    base_db: str
    iam: str
    ssp: str
    years: list[int]
    source_version: str = "3.10"
    system_model: str = "cutoff"
    mode: Literal["separate", "superstructure"] = "superstructure"


class GenerateResponse(BaseModel):
    task_id: str
    planned_names: list[str]
    mode: Literal["separate", "superstructure"]


class PremiseKeyRequest(BaseModel):
    key: str


class PremiseKeyStatus(BaseModel):
    configured: bool
    path: str


# ── Task registry (in-memory, process-local) ──────────────────────────────────


class _TaskState:
    def __init__(self) -> None:
        self.stage: str = "queued"
        self.pct: float = 0.0
        self.done: bool = False
        self.error: str | None = None
        self.written: list[str] = []
        self.subscribers: list[asyncio.Queue] = []
        self.fallback_warning: str | None = None
        self.effective_mode: str | None = None
        self.cancelled: bool = False


_TASKS: dict[str, _TaskState] = {}
_TASK_LOCK = threading.Lock()


def _notify_all(task: _TaskState, payload: dict[str, Any]) -> None:
    for q in list(task.subscribers):
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            pass


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.get("/scenarios", response_model=PLCAScenarios)
async def get_scenarios() -> PLCAScenarios:
    return PLCAScenarios(
        iams=AVAILABLE_IAMS, ssps=AVAILABLE_SSPS,
        ssps_by_iam=SSPS_BY_IAM, years=AVAILABLE_YEARS,
        key_configured=premise_key_available(),
    )


def _home_relative_path(p) -> str:
    try:
        from pathlib import Path
        return "~/" + str(p.relative_to(Path.home()))
    except Exception:
        return str(p)


@router.get("/key/status", response_model=PremiseKeyStatus)
async def get_key_status() -> PremiseKeyStatus:
    return PremiseKeyStatus(
        configured=premise_key_available(),
        path=_home_relative_path(PREMISE_KEY_FILE),
    )


@router.post("/key")
async def post_key(body: PremiseKeyRequest) -> dict:
    key = body.key.strip()
    if not key:
        raise HTTPException(status_code=400, detail="Key is empty.")
    try:
        from cryptography.fernet import Fernet
        Fernet(key.encode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid Fernet key: {exc}")
    try:
        PREMISE_KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
        PREMISE_KEY_FILE.write_text(key + "\n", encoding="utf-8")
        try:
            PREMISE_KEY_FILE.chmod(0o600)
        except OSError:
            pass
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not write key file: {exc}")
    return {"status": "ok", "message": "Premise key saved"}


@router.delete("/key")
async def delete_key() -> dict:
    if PREMISE_KEY_FILE.is_file():
        try:
            PREMISE_KEY_FILE.unlink()
        except OSError as exc:
            raise HTTPException(status_code=500, detail=f"Could not remove key file: {exc}")
    return {"status": "ok", "message": "Premise key removed"}


@router.get("/databases", response_model=list[ProspectiveDB])
async def get_databases() -> list[ProspectiveDB]:
    project = get_current_project()
    existing = set(bw2data.databases)
    out: list[ProspectiveDB] = []
    for e in plca_storage.load_registry(project):
        if e.get("name") not in existing:
            continue
        # Old (pre-superstructure) entries lack mode/years; infer them from year.
        entry = dict(e)
        if "mode" not in entry:
            entry["mode"] = "separate"
        if "years" not in entry:
            y = entry.get("year")
            entry["years"] = [int(y)] if y is not None else []
        try:
            out.append(ProspectiveDB(**entry))
        except Exception:
            continue
    out.sort(key=lambda d: (d.base_db, d.iam, d.ssp, (d.year if d.year is not None else (d.years[0] if d.years else 0))))
    return out


@router.post("/generate", response_model=GenerateResponse)
async def post_generate(body: GenerateRequest) -> GenerateResponse:
    project = get_current_project()
    if body.base_db not in bw2data.databases:
        raise HTTPException(status_code=400, detail=f"Base database {body.base_db!r} not found in project")

    if not premise_key_available():
        raise HTTPException(
            status_code=400,
            detail=(
                "Premise key not configured. Get one from romain.sacchi@psi.ch, then "
                "set the PREMISE_KEY environment variable or write the key to "
                "~/.premise/premise_key."
            ),
        )

    try:
        generator = ProspectiveDBGenerator(
            base_db=body.base_db,
            iam=body.iam,
            ssp=body.ssp,
            years=body.years,
            source_version=body.source_version,
            system_model=body.system_model,
            mode=body.mode,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    sorted_years = sorted(set(body.years))
    if body.mode == "superstructure":
        planned = [superstructure_db_name(body.base_db, body.iam, body.ssp, sorted_years)]
    else:
        planned = [prospective_db_name(body.base_db, body.iam, body.ssp, y) for y in sorted_years]

    task_id = uuid.uuid4().hex
    task = _TaskState()
    with _TASK_LOCK:
        _TASKS[task_id] = task
    task_registry.register(task_id)

    loop = asyncio.get_running_loop()

    def on_progress(stage: str, pct: float) -> None:
        # Cancellation checkpoint: premise's _emit() re-raises
        # CancelledOperation specifically (other callback errors stay
        # swallowed). The granularity is whatever stages premise itself
        # emits — best-effort within a 30-min run.
        if task_registry.is_cancelled(task_id):
            raise CancelledOperation(task_id)
        task.stage = stage
        task.pct = pct
        loop.call_soon_threadsafe(
            _notify_all, task, {"type": "progress", "stage": stage, "pct": pct}
        )

    generator._cb = on_progress  # inject thread-safe callback

    def _run() -> None:
        try:
            result = generator.generate()
            now = datetime.now(timezone.utc).isoformat()
            if result.mode == "superstructure":
                # One registry entry covering every year in the superstructure.
                plca_storage.register(
                    project,
                    {
                        "name": result.names[0],
                        "base_db": body.base_db,
                        "iam": body.iam.lower(),
                        "ssp": body.ssp,
                        "mode": "superstructure",
                        "years": sorted_years,
                        "year": None,
                        "sdf_path": result.sdf_path,
                        "created_at": now,
                    },
                )
            else:
                for name in result.names:
                    plca_storage.register(
                        project,
                        {
                            "name": name,
                            "base_db": body.base_db,
                            "iam": body.iam.lower(),
                            "ssp": body.ssp,
                            "mode": "separate",
                            "year": int(name.rsplit("_", 1)[-1]),
                            "years": [int(name.rsplit("_", 1)[-1])],
                            "created_at": now,
                        },
                    )
            task.written = list(result.names)
            task.effective_mode = result.mode
            task.fallback_warning = result.fallback_warning
            task.done = True
            payload: dict[str, Any] = {
                "type": "done",
                "written": task.written,
                "mode": result.mode,
            }
            if result.fallback_warning:
                payload["warning"] = result.fallback_warning
            loop.call_soon_threadsafe(_notify_all, task, payload)
        except CancelledOperation:
            # Cancellation skips the registry write — incomplete prospective
            # databases must not appear in the UI. The bw2 db itself may
            # have been partially committed by premise; a follow-up cleanup
            # pass would need to reconcile bw2data.databases vs the
            # registry, but for now the user can delete stragglers via the
            # existing DELETE /databases/{name} endpoint.
            task.cancelled = True
            task.done = True
            task.stage = "cancelled"
            loop.call_soon_threadsafe(
                _notify_all, task, {"type": "cancelled", "task_id": task_id}
            )
        except Exception as exc:
            task.error = str(exc)
            task.done = True
            loop.call_soon_threadsafe(
                _notify_all, task, {"type": "error", "error": str(exc)}
            )
        finally:
            task_registry.unregister(task_id)

    threading.Thread(target=_run, daemon=True).start()
    return GenerateResponse(task_id=task_id, planned_names=planned, mode=body.mode)


@router.delete("/databases/{name}")
async def delete_database(name: str) -> dict:
    project = get_current_project()
    if name in bw2data.databases:
        try:
            del bw2data.databases[name]
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Failed to delete database: {exc}")
    plca_storage.unregister(project, name)
    return {"deleted": True, "name": name}


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

    # Send current snapshot immediately.
    await websocket.send_json({"type": "progress", "stage": task.stage, "pct": task.pct})
    if task.done:
        if task.cancelled:
            await websocket.send_json({"type": "cancelled", "task_id": task_id})
        elif task.error:
            await websocket.send_json({"type": "error", "error": task.error})
        else:
            done_payload: dict[str, Any] = {
                "type": "done",
                "written": task.written,
                "mode": task.effective_mode,
            }
            if task.fallback_warning:
                done_payload["warning"] = task.fallback_warning
            await websocket.send_json(done_payload)
        await websocket.close()
        return

    try:
        while True:
            payload = await queue.get()
            await websocket.send_json(payload)
            if payload.get("type") in ("done", "error", "cancelled"):
                break
    except WebSocketDisconnect:
        pass
    finally:
        try:
            task.subscribers.remove(queue)
        except ValueError:
            pass
        task_registry.maybe_cancel_on_last_subscriber_leave(
            task_id,
            remaining_subscribers=len(task.subscribers),
            task_done=task.done,
        )
        try:
            await websocket.close()
        except Exception:
            pass
