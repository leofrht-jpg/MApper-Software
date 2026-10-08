# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""System-level endpoints: log viewer, grid intensities."""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel

from mapper.core.log_config import LOG_FILE, read_log_lines


router = APIRouter(prefix="/system", tags=["system"])

_GRID_INTENSITY_PATH = Path(__file__).parent.parent / "data" / "grid_intensity.json"
_grid_cache: dict[str, Any] | None = None


def _load_grid() -> dict[str, Any]:
    global _grid_cache
    if _grid_cache is None:
        with _GRID_INTENSITY_PATH.open("r", encoding="utf-8") as fh:
            _grid_cache = json.load(fh)
    return _grid_cache


class LogsResponse(BaseModel):
    lines: list[str]
    total: int
    log_path: str


@router.get("/logs", response_model=LogsResponse)
async def get_logs(
    lines: int = Query(200, ge=1, le=5000),
    level: str | None = Query(None, description="Filter to entries at or above this level"),
) -> LogsResponse:
    entries, total = read_log_lines(max_lines=lines, level=level)
    return LogsResponse(lines=entries, total=total, log_path=str(LOG_FILE))


class GridCountry(BaseModel):
    code: str
    name: str
    intensity: float
    year: int
    source: str


class GridIntensityResponse(BaseModel):
    countries: list[GridCountry]
    eu_average: GridCountry
    world_average: GridCountry
    notes: str


@router.get("/grid-intensities", response_model=GridIntensityResponse)
async def get_grid_intensities() -> GridIntensityResponse:
    data = _load_grid()
    return GridIntensityResponse(
        countries=[GridCountry(**c) for c in data["countries"]],
        eu_average=GridCountry(**data["eu_average"]),
        world_average=GridCountry(**data["world_average"]),
        notes=data.get("notes", ""),
    )


class LogSaveResponse(BaseModel):
    """Where the log file was written, for the UI to show the user."""

    path: str
    bytes: int


@router.post("/logs/save", response_model=LogSaveResponse)
async def save_logs() -> LogSaveResponse:
    """Write the log file somewhere the user can find it, and say where.

    The desktop app's webview is navigated to ``http://localhost:8765`` and has
    no download handler, so the browser trick the UI used -- an ``<a download>``
    pointing at a ``blob:`` URL -- silently does nothing there: no file, no
    error, no event. WKWebView needs a download delegate, which a page on a
    remote http origin does not get.

    Rather than grant the Tauri IPC bridge to that origin just to reach the
    dialog/fs plugins, the backend writes the file itself. It already owns the
    log and already runs as the user, and this works identically in the browser
    and in the packaged app.

    Written to ~/Downloads when that exists, else the log's own directory, so
    the path is always one the user can open.
    """
    if not LOG_FILE.is_file():
        raise HTTPException(status_code=404, detail="Log file does not exist yet.")
    stamp = datetime.now().strftime("%Y-%m-%d")
    downloads = Path.home() / "Downloads"
    target_dir = downloads if downloads.is_dir() else LOG_FILE.parent
    target = target_dir / f"mapper_logs_{stamp}.txt"
    try:
        data = LOG_FILE.read_bytes()
        target.write_bytes(data)
    except OSError as e:
        # Surfaced, never swallowed: a read-only or full disk must say so.
        raise HTTPException(status_code=500, detail=f"Could not write {target}: {e}") from e
    return LogSaveResponse(path=str(target), bytes=len(data))


@router.get("/logs/export")
async def export_logs() -> FileResponse:
    if not LOG_FILE.is_file():
        raise HTTPException(status_code=404, detail="Log file does not exist yet.")
    stamp = datetime.now().strftime("%Y-%m-%d")
    return FileResponse(
        path=LOG_FILE,
        media_type="text/plain",
        filename=f"mapper_logs_{stamp}.txt",
    )
