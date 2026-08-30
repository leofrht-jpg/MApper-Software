# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Desktop sidecar entrypoint for MApper.

Runs the FastAPI app under uvicorn on a fixed localhost port (no --reload), so
it can be frozen by PyInstaller into a single binary that the Tauri shell spawns
as a sidecar. The standalone web workflow is unchanged — it still launches the
backend via ``uvicorn mapper.main:app --reload --port 8000`` (see start.sh);
this entrypoint is purely additive and used only by the packaged desktop app.

Port: defaults to 8765 (a fixed, uncommon localhost port chosen for the desktop
MVP so it doesn't collide with a developer's standalone :8000). Override with the
MAPPER_PORT env var. A dynamic free-port handshake is a later hardening step
(see DESKTOP.md).
"""
from __future__ import annotations

import sys

# ── Neutralize the multiprocessing resource_tracker in the frozen build ──────
# A dependency (premise's logger, at import time) creates a multiprocessing
# semaphore. Python's resource_tracker then tries to launch a helper process via
# ``sys.executable -c "…"`` — but in a PyInstaller-frozen build sys.executable is
# THIS binary, which can't run ``-c``; the launch re-enters and re-creates a
# semaphore, spawning ANOTHER tracker → an endless chain of backend processes
# that swamp the machine (the packaged-app "No projects" / "Load failed" bug).
#
# The tracker only exists to reclaim shared resources if a process dies
# ABNORMALLY. The semaphores themselves work without it, and SemLock's normal
# finalizer still ``sem_unlink``s them on clean exit — so disabling the tracker
# leaks a handful of named semaphores only on a hard crash (negligible; the OS
# reclaims them), while removing the fork-bomb entirely. Must run BEFORE anything
# that could create a multiprocessing primitive (i.e. before importing the app).
if getattr(sys, "frozen", False):
    try:
        import multiprocessing.resource_tracker as _rt

        _rt.ResourceTracker.ensure_running = lambda self: None  # type: ignore[method-assign]

        def _rt_noop(*_a: object, **_k: object) -> None:
            return None

        _rt.register = _rt_noop  # type: ignore[assignment]
        _rt.unregister = _rt_noop  # type: ignore[assignment]
    except Exception:
        pass

import os
import tempfile
from pathlib import Path


def _anchor_writable_cwd() -> None:
    """Move the process to a writable working directory BEFORE importing the app.

    Why this is load-bearing: some dependencies create relative-path directories
    at IMPORT time. In particular ``premise/logger.py`` runs
    ``(Path.cwd() / "export" / "logs").mkdir(parents=True, exist_ok=True)`` at
    module top level. When the packaged app is launched the normal way on macOS —
    via LaunchServices (double-click / ``open``) — the process inherits CWD ``/``
    (read-only), so that mkdir becomes ``/export/logs`` and raises
    ``OSError: [Errno 30] Read-only file system: '/export'``, which aborts the
    whole import chain and kills the sidecar before it can serve a single request
    (the frontend then sees every call fail with a network-level "Load failed").
    Launching the inner binary directly from a shell hides this, because the CWD
    is then a writable directory.

    Anchoring CWD to a per-user writable workspace fixes premise and every other
    relative-path writer (``export/``, ``unlinked.log``, …) regardless of how the
    app is launched. The standalone web workflow is unaffected — it runs uvicorn
    from the writable ``mapper-backend/`` directory and never executes this file.
    """
    candidates = []
    try:
        from platformdirs import user_data_dir

        # Returns the platform-correct directory:
        #   macOS   → ~/Library/Application Support/mapper
        #   Windows → %APPDATA%\mapper  (C:\Users\<user>\AppData\Roaming\mapper)
        #   Linux   → ~/.local/share/mapper
        candidates.append(Path(user_data_dir("mapper", appauthor=False)) / "workspace")
    except Exception:
        pass
    # Explicit platform fallbacks in case platformdirs is not available in the
    # frozen environment (belt-and-suspenders; platformdirs is in the spec).
    if os.name == "nt":
        appdata = os.environ.get("APPDATA")
        if appdata:
            candidates.append(Path(appdata) / "MApper" / "workspace")
    else:
        candidates.append(Path.home() / "Library" / "Application Support" / "MApper" / "workspace")
    candidates.append(Path(tempfile.gettempdir()) / "mapper-workspace")

    for base in candidates:
        try:
            base.mkdir(parents=True, exist_ok=True)
            os.chdir(base)
            return
        except OSError:
            continue


# MUST run before importing mapper.main (which transitively imports premise).
_anchor_writable_cwd()

import uvicorn  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

# Import the app object directly (not the "mapper.main:app" import string) so the
# frozen binary doesn't depend on uvicorn re-importing by name at runtime.
from mapper.main import app  # noqa: E402

DEFAULT_PORT = 8765


class _SPAStaticFiles(StaticFiles):
    """StaticFiles that forces revalidation of ``index.html`` -- and ONLY it.

    Vite content-hashes every asset (``index-DRjrvAU9.js`` ->
    ``index-vbhBHsde.js``), so a new build changes their URLs and a cached
    asset can never be served in place of a new one. Those files are exactly
    what an HTTP cache is for, and they keep their default cacheability.

    ``index.html`` is the one fixed URL, and it is the one that can go stale.
    Starlette sends ``etag`` + ``last-modified`` but no ``Cache-Control``,
    which leaves WebKit free to apply HEURISTIC freshness and serve a stored
    copy without asking. A stale ``index.html`` then references asset hashes
    the new bundle does not contain; every one 404s and the app comes up
    blank. That was the "clear the caches before every launch" ritual, and
    this header is what removes the need for it.

    ``no-cache`` -- not ``no-store``. The response may still be stored; it
    just may not be reused without revalidating. Paired with the etag
    Starlette already sends, the common case is a 304 with no body, so this
    costs one conditional request per launch rather than a re-download.

    Keyed on the file actually served rather than on the request path, so it
    covers both a direct ``/index.html`` and the ``html=True`` directory
    fallback, and cannot accidentally match an asset that merely has
    "index" in its name.
    """

    def file_response(self, full_path, stat_result, scope, status_code=200):  # type: ignore[override]
        response = super().file_response(full_path, stat_result, scope, status_code)
        if os.path.basename(os.fspath(full_path)) == "index.html":
            response.headers["Cache-Control"] = "no-cache"
        return response


def _mount_frontend() -> None:
    """Serve the built frontend from the backend, so the desktop webview can load
    the UI over http://localhost:PORT (same origin as the API).

    Why this is required: on macOS the Tauri webview serves bundled assets from
    the secure ``tauri://localhost`` scheme, and WKWebView blocks that secure
    context from making cleartext-HTTP fetch/WebSocket calls to the backend (mixed
    content — rejected before any socket, surfacing as "Load failed"). Serving the
    SPA from the backend makes the page same-origin with the API, which is always
    allowed (and also fixes the progress WebSockets). The Tauri shell navigates to
    http://localhost:PORT once the backend is healthy (see mapper-tauri/src/main.rs).

    Mounted at "/" AFTER the ``/api`` router is already included, so API routes win
    and everything else falls through to the static SPA. Desktop-only — the
    standalone web workflow serves the frontend from Vite and never calls this.
    """
    import sys

    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:  # frozen: dist is bundled next to the binary (see the .spec datas)
        dist = Path(meipass) / "frontend"
    else:  # running from source (e.g. `python desktop_entry.py` in dev)
        dist = Path(__file__).resolve().parent.parent / "mapper-frontend" / "dist"

    if (dist / "index.html").is_file():
        app.mount("/", _SPAStaticFiles(directory=str(dist), html=True), name="frontend")


def main() -> None:
    _mount_frontend()
    port = int(os.environ.get("MAPPER_PORT", str(DEFAULT_PORT)))
    host = os.environ.get("MAPPER_HOST", "127.0.0.1")
    uvicorn.run(app, host=host, port=port, log_level="info", reload=False)


if __name__ == "__main__":
    # CRITICAL for the frozen (PyInstaller) build: on macOS multiprocessing uses
    # the "spawn" start method, which RE-EXECUTES this frozen binary for every
    # child process. Without freeze_support() each spawned child re-runs main()
    # → uvicorn.run() → another spawn → an exponential fork-bomb of backend
    # processes all fighting over the port (the first binds and serves, so the
    # app looks healthy at first, then the machine is swamped and the port owner
    # churns → "Load failed" everywhere). freeze_support() makes a spawned child
    # run its worker bootstrap and exit instead of re-running main(). Must be the
    # first thing in __main__, before main() and its heavy imports.
    import multiprocessing

    multiprocessing.freeze_support()
    main()
