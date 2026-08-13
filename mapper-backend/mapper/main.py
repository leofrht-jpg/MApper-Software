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

# `version` is load-bearing for release verification, not decoration: it makes
# /openapi.json echo the version the RUNNING process was built from. Without it
# FastAPI reports its own default ("0.1.0") and the only way to check a frozen
# desktop build is to read the pyproject.toml bundled beside it — which is
# inference from a file on disk, not an answer from the process. Sourced from
# `mapper.__version__`, so it stays on the single version source.
from mapper import __version__  # noqa: E402

app = FastAPI(title="MApper API", version=__version__)


@app.on_event("startup")
async def _hydrate() -> None:
    _dsm.hydrate_from_disk()
    _parameters.install_parameters(parameter_storage.load_all())
    # Sparse-solver readiness — load-bearing for prospective-LCA speed. In the
    # frozen desktop sidecar this confirms the bundled scikits.umfpack extension
    # + SuiteSparse dylibs actually import at runtime (not just on disk); False
    # means the spsolve fallback, which degrades a prospective run to tens of
    # minutes. Logged to mapper.log so a frozen build is verifiable post-launch.
    from mapper.core.bw2_wrapper import _UMFPACK_OK
    logging.getLogger("mapper").info(
        "UMFPACK solver: %s", "OK" if _UMFPACK_OK else "UNAVAILABLE (spsolve fallback)"
    )

app.add_middleware(
    CORSMiddleware,
    # Standalone web dev (Vite) + the Tauri desktop webview origins. In the
    # packaged app the frontend is served by the webview from a custom protocol
    # (``tauri://localhost`` on macOS, ``http://tauri.localhost`` on Windows) and
    # calls this backend on 127.0.0.1; those origins must be allowed. Additive —
    # the existing localhost:5173 web workflow is unchanged.
    allow_origins=[
        "tauri://localhost",
        "http://tauri.localhost",
    ],
    # Any LOCAL dev-server port, not just 5173. Vite auto-increments when 5173
    # is taken, and the resulting failure is a bare ERR_FAILED in the console
    # with nothing pointing at CORS — the app simply renders empty. Restricted
    # to loopback hosts over plain http, so no remote origin is granted access.
    #
    # This does not loosen the packaged app: there the frontend is served BY
    # this backend on :8765, so requests are same-origin and CORS is never
    # consulted. It only affects `npm run dev` against a separate backend.
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # CORS hides ALL response headers from JS by default (only a safelist is
    # readable). The Excel-export surfaces (Impact/AESA/DSM/MFA) read the
    # server-built ``Content-Disposition`` filename — which names contributing
    # subsystems the client can't always compute (e.g. AESA passes ``[]``) — so
    # it MUST be explicitly exposed. Without this, cross-origin dev (Vite :5173
    # → backend :8000) silently drops the header and downloads fall back to the
    # client name, showing the old scheme (Car_Fleet_AESA.xlsx). Same-origin in
    # the packaged app masked it; this makes dev match prod.
    expose_headers=["Content-Disposition"],
)

@app.middleware("http")
async def _no_store_api(request: Request, call_next):
    """Declare every /api response uncacheable.

    The API serves dynamic, mutation-driven data. Without a cache directive a
    browser/webview may serve a GET from its HTTP cache after a mutation on a
    SIBLING url (e.g. POST …/cohort-mappings/upload, then GET …/cohort-mappings —
    a POST only invalidates its own uri), freezing the UI on stale data. This is
    the server-side half of the fix; the frontend client also sends
    ``cache: 'no-store'``. Static SPA assets (served at ``/`` in the desktop
    build) are intentionally left cacheable — they're content-hashed.
    """
    response = await call_next(request)
    if request.url.path.startswith("/api"):
        response.headers["Cache-Control"] = "no-store"
    return response


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
