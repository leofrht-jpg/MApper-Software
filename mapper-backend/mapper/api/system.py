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

    The packaged app's Logs "Export" (an ``<a download>`` on a ``blob:`` URL)
    was a silent no-op. It was attributed to the webview lacking a download
    handler, but blob downloads of other workbooks work in the installed app,
    so the cause is unconfirmed. Writing the file here, and telling the UI
    where, works in both environments and shows the user the path.

    Rather than grant the Tauri IPC bridge to the page's http origin just to
    reach the dialog/fs plugins, the backend writes the file itself. It already owns the
    log and already runs as the user, and this works identically in the browser
    and in the packaged app.

    Written to ~/Downloads when that exists, else the log's own directory, so
    the path is always one the user can open.
    """
    if not LOG_FILE.is_file():
        raise HTTPException(status_code=404, detail="Log file does not exist yet.")
    stamp = datetime.now().strftime("%Y-%m-%d")
    try:
        data = LOG_FILE.read_bytes()
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Could not read {LOG_FILE}: {e}") from e
    target = save_to_downloads(
        data, f"mapper_logs_{stamp}.txt", fallback_dir=LOG_FILE.parent, overwrite=True,
    )
    return LogSaveResponse(path=str(target), bytes=len(data))


def unused_name(target: Path) -> Path:
    """``target`` if it does not exist, else ``stem (1).ext``, ``stem (2).ext`` …

    The same numbering a browser uses for a repeated download, so a second
    export of the same result never replaces the first.
    """
    if not target.exists():
        return target
    n = 1
    while True:
        candidate = target.with_name(f"{target.stem} ({n}){target.suffix}")
        if not candidate.exists():
            return candidate
        n += 1


def save_to_downloads(
    data: bytes, filename: str, *, fallback_dir: Path, overwrite: bool = False,
) -> Path:
    """Write ``data`` to ~/Downloads (else ``fallback_dir``) and return the path.

    The server-side save used by Settings › Logs and the AESA export in the
    packaged app (every other export uses a blob download, which works there
    too). An existing file of that name is kept and the new one gets
    " (1)", " (2)" … before the extension, unless ``overwrite`` (the Logs save,
    whose name is already the day's stamp). The returned path is the name
    actually written, which is what the UI shows. A write failure is raised as
    a 500 naming the path, never swallowed: a read-only or full disk must say so.
    """
    downloads = Path.home() / "Downloads"
    target_dir = downloads if downloads.is_dir() else fallback_dir
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / filename
    if not overwrite:
        target = unused_name(target)
    try:
        target.write_bytes(data)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Could not write {target}: {e}") from e
    return target


class RevealRequest(BaseModel):
    path: str


def _reveal_roots() -> list[Path]:
    """Where ``save_to_downloads`` writes: ~/Downloads, else the log directory
    (Logs and AESA both fall back there). Only files under these are revealed."""
    return [(Path.home() / "Downloads").resolve(), LOG_FILE.parent.resolve()]


def _reveal_command(target: Path) -> list[str]:
    import sys

    if sys.platform == "darwin":
        return ["open", "-R", str(target)]
    if sys.platform.startswith("win"):
        return ["explorer", f"/select,{target}"]
    return ["xdg-open", str(target.parent)]


@router.post("/reveal")
async def reveal_saved_file(body: RevealRequest) -> dict:
    """Show a file this app saved in Finder (Explorer on Windows).

    The packaged app is a remote http origin with no Tauri IPC, so the page
    cannot ask the OS itself; the backend, which wrote the file and runs as the
    user, does. Restricted to the folders ``save_to_downloads`` writes to, so a
    request cannot open an arbitrary path.
    """
    import subprocess

    try:
        target = Path(body.path).expanduser().resolve(strict=True)
    except (OSError, RuntimeError):
        raise HTTPException(status_code=404, detail=f"{body.path} no longer exists.")
    if not target.is_file() or not any(root == target.parent or root in target.parents for root in _reveal_roots()):
        raise HTTPException(status_code=400, detail="Only a file this app saved can be revealed.")
    try:
        subprocess.Popen(_reveal_command(target))  # noqa: S603 -- fixed argv, checked path
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Could not open the folder: {e}") from e
    return {"revealed": str(target)}


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
