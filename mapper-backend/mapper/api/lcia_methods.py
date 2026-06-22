# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""LCIA Method Library endpoints.

Provides:
  - ``GET  /impact/methods/library``                 list bundled + available + installed
  - ``POST /impact/methods/install``                 start a download/import task
  - ``POST /impact/methods/install-custom``          xlsx upload
  - ``DELETE /impact/methods/{method_id}``           uninstall
  - ``WebSocket /impact/methods/ws/{task_id}``       progress stream (same pattern as plca)
"""
from __future__ import annotations

import asyncio
import json
import logging
import tempfile
import threading
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from mapper.api import tasks as task_registry
from mapper.api.tasks import CancelledOperation
from mapper.core import lcia_method_engine as lme
from mapper.core.lcia_method_engine import (
    InstallError,
    SUPPORTED_EI_VERSIONS,
    detect_ecoinvent_version,
    install_excel,
    install_method,
    list_library,
    uninstall,
)


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/impact/methods", tags=["lcia-methods"])


# ── Schemas ──────────────────────────────────────────────────────────────────


class LCIAMethodInfo(BaseModel):
    id: str
    name: str
    description: str = ""
    long_description: str | None = None
    source: str                    # "bundled" | "downloadable" | "custom"
    installed: bool
    category_count: int | None = None
    size_mb: float | None = None
    source_url: str | None = None
    citation: str | None = None
    installer: str | None = None
    notes: str | None = None
    detected_ei_version: str | None = None
    available_variants: list[str] | None = None
    unit: str | None = None


class LibraryResponse(BaseModel):
    detected_ecoinvent_version: str | None
    supported_ecoinvent_versions: list[str]
    methods: list[LCIAMethodInfo]


class InstallRequest(BaseModel):
    method_id: str
    ecoinvent_version: str | None = None  # override auto-detect


class InstallTaskResponse(BaseModel):
    task_id: str
    method_id: str


# ── Task registry ────────────────────────────────────────────────────────────


class _TaskState:
    def __init__(self) -> None:
        self.stage: str = "queued"
        self.pct: float = 0.0
        self.done: bool = False
        self.error: str | None = None
        self.method_tuples: list[list[str]] = []
        self.warnings: list[str] = []
        self.subscribers: list[asyncio.Queue] = []
        self.cancelled: bool = False


_TASKS: dict[str, _TaskState] = {}
_TASK_LOCK = threading.Lock()


def _notify(task: _TaskState, payload: dict[str, Any]) -> None:
    for q in list(task.subscribers):
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            pass


# ── Endpoints ────────────────────────────────────────────────────────────────


@router.get("/library", response_model=LibraryResponse)
async def get_library() -> LibraryResponse:
    items = list_library()
    return LibraryResponse(
        detected_ecoinvent_version=detect_ecoinvent_version(),
        supported_ecoinvent_versions=list(SUPPORTED_EI_VERSIONS),
        methods=[LCIAMethodInfo(**it) for it in items],
    )


@router.post("/install", response_model=InstallTaskResponse)
async def post_install(body: InstallRequest) -> InstallTaskResponse:
    # Validate up-front so the client sees errors immediately rather than via WS.
    entry = lme._registry_entry(body.method_id)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"Unknown method: {body.method_id}")
    if lme.is_installed(body.method_id):
        raise HTTPException(status_code=409, detail=f"{entry['name']} is already installed")

    task_id = uuid.uuid4().hex
    task = _TaskState()
    with _TASK_LOCK:
        _TASKS[task_id] = task
    task_registry.register(task_id)
    loop = asyncio.get_running_loop()

    def on_progress(stage: str, pct: float) -> None:
        if task_registry.is_cancelled(task_id):
            raise CancelledOperation(task_id)
        task.stage = stage
        task.pct = pct
        loop.call_soon_threadsafe(
            _notify, task, {"type": "progress", "stage": stage, "pct": pct}
        )

    def _run() -> None:
        try:
            result = install_method(
                body.method_id,
                ecoinvent_version=body.ecoinvent_version,
                on_progress=on_progress,
            )
            task.method_tuples = [list(t) for t in result.method_tuples]
            task.warnings = list(result.warnings)
            task.done = True
            loop.call_soon_threadsafe(_notify, task, {
                "type": "done",
                "method_tuples": task.method_tuples,
                "warnings": task.warnings,
            })
        except CancelledOperation:
            task.cancelled = True
            task.done = True
            task.stage = "cancelled"
            loop.call_soon_threadsafe(
                _notify, task, {"type": "cancelled", "task_id": task_id}
            )
        except InstallError as exc:
            task.error = str(exc)
            task.done = True
            loop.call_soon_threadsafe(_notify, task, {"type": "error", "error": str(exc)})
        except Exception as exc:  # noqa: BLE001
            logger.exception("LCIA install crashed")
            task.error = f"Unexpected error: {exc}"
            task.done = True
            loop.call_soon_threadsafe(_notify, task, {"type": "error", "error": task.error})
        finally:
            task_registry.unregister(task_id)

    threading.Thread(target=_run, daemon=True).start()
    return InstallTaskResponse(task_id=task_id, method_id=body.method_id)


@router.post("/install-custom", response_model=InstallTaskResponse)
async def post_install_custom(
    file: UploadFile = File(...),
    # bw2io.ExcelLCIAImporter requires name (as a tuple), description, unit.
    name_tuple: str = Form(...),   # JSON-encoded list, e.g. ["MyLab", "climate change"]
    description: str = Form(""),
    unit: str = Form(""),
) -> InstallTaskResponse:
    # Parse the tuple.
    try:
        parsed = json.loads(name_tuple)
        if not isinstance(parsed, list) or not parsed or not all(isinstance(x, str) for x in parsed):
            raise ValueError("must be a non-empty list of strings")
        parts = tuple(parsed)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid name_tuple: {exc}")

    # Save the upload to a temp file — the importer reads by path.
    suffix = Path(file.filename or "method.xlsx").suffix or ".xlsx"
    if suffix.lower() not in (".xlsx", ".xls"):
        raise HTTPException(status_code=400, detail="Only .xlsx/.xls files are accepted.")
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="File is empty.")
    tmp = Path(tempfile.mkstemp(prefix="mapper_lcia_", suffix=suffix)[1])
    tmp.write_bytes(contents)

    task_id = uuid.uuid4().hex
    task = _TaskState()
    with _TASK_LOCK:
        _TASKS[task_id] = task
    task_registry.register(task_id)
    loop = asyncio.get_running_loop()

    def on_progress(stage: str, pct: float) -> None:
        if task_registry.is_cancelled(task_id):
            raise CancelledOperation(task_id)
        task.stage = stage
        task.pct = pct
        loop.call_soon_threadsafe(
            _notify, task, {"type": "progress", "stage": stage, "pct": pct}
        )

    def _run() -> None:
        try:
            result = install_excel(
                file_path=tmp,
                method_name_tuple=parts,
                description=description,
                unit=unit,
                on_progress=on_progress,
            )
            task.method_tuples = [list(t) for t in result.method_tuples]
            task.warnings = list(result.warnings)
            task.done = True
            loop.call_soon_threadsafe(_notify, task, {
                "type": "done",
                "method_tuples": task.method_tuples,
                "warnings": task.warnings,
            })
        except CancelledOperation:
            task.cancelled = True
            task.done = True
            task.stage = "cancelled"
            loop.call_soon_threadsafe(
                _notify, task, {"type": "cancelled", "task_id": task_id}
            )
        except InstallError as exc:
            task.error = str(exc)
            task.done = True
            loop.call_soon_threadsafe(_notify, task, {"type": "error", "error": str(exc)})
        except Exception as exc:  # noqa: BLE001
            logger.exception("Custom LCIA install crashed")
            task.error = f"Unexpected error: {exc}"
            task.done = True
            loop.call_soon_threadsafe(_notify, task, {"type": "error", "error": task.error})
        finally:
            task_registry.unregister(task_id)
            try:
                tmp.unlink(missing_ok=True)
            except Exception:
                pass

    threading.Thread(target=_run, daemon=True).start()
    return InstallTaskResponse(task_id=task_id, method_id="pending_custom")


@router.delete("/{method_id}")
async def delete_method(method_id: str) -> dict:
    removed = uninstall(method_id)
    return {"method_id": method_id, "tuples_removed": removed}


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

    # Snapshot first.
    await websocket.send_json({"type": "progress", "stage": task.stage, "pct": task.pct})
    if task.done:
        if task.cancelled:
            await websocket.send_json({"type": "cancelled", "task_id": task_id})
        elif task.error:
            await websocket.send_json({"type": "error", "error": task.error})
        else:
            await websocket.send_json({
                "type": "done",
                "method_tuples": task.method_tuples,
                "warnings": task.warnings,
            })
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
