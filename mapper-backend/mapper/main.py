# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse

from mapper.api import dsm as _dsm
from mapper.api import parameters as _parameters
from mapper.api.router import router
from mapper.core import parameter_storage
from mapper.core.log_config import configure_logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-5s %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
configure_logging()

app = FastAPI(title="MApper API")


@app.on_event("startup")
async def _hydrate() -> None:
    _dsm.hydrate_from_disk()
    _parameters.install_parameters(parameter_storage.load_all())

app.add_middleware(
    CORSMiddleware,
    # Standalone web dev (Vite) + the Tauri desktop webview origins. In the
    # packaged app the frontend is served by the webview from a custom protocol
    # (``tauri://localhost`` on macOS, ``http://tauri.localhost`` on Windows) and
    # calls this backend on 127.0.0.1; those origins must be allowed. Additive —
    # the existing localhost:5173 web workflow is unchanged.
    allow_origins=[
        "http://localhost:5173",
        "tauri://localhost",
        "http://tauri.localhost",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# REST + WebSocket routes all live under /api
# WebSocket routes defined in ecoinvent.py and lca.py are included via the router
app.include_router(router, prefix="/api")


@app.get("/api/health", include_in_schema=False)
async def health() -> dict[str, str]:
    """Lightweight readiness probe — the desktop (Tauri) shell polls this after
    spawning the backend sidecar before showing the webview. Does NOT touch
    Brightway2/ecoinvent, so it answers even before any LCA project exists."""
    return {"status": "ok"}


@app.exception_handler(Exception)
async def _log_unhandled(request: Request, exc: Exception) -> JSONResponse:
    logging.getLogger("mapper.api").exception(
        "Unhandled exception on %s %s", request.method, request.url.path
    )
    return JSONResponse(status_code=500, content={"detail": str(exc)})


@app.get("/", include_in_schema=False)
async def root():
    return RedirectResponse(url="/docs")
