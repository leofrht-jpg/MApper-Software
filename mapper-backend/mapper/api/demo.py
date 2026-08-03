# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Demo-project endpoints — the licence-free path into MApper.

``POST /api/demo/load`` builds the synthetic demo project (see
``mapper.core.demo_project``) and switches to it. ``GET /api/demo/status``
tells the frontend whether the active project is the demo, which is what
drives the persistent "synthetic data" banner.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from mapper.core.demo_project import (
    DEMO_DB_NAME,
    DEMO_PROJECT_NAME,
    build_demo_project,
    is_demo_project,
)

router = APIRouter(prefix="/demo", tags=["demo"])
logger = logging.getLogger("mapper.api.demo")


@router.get("/status")
async def demo_status() -> dict:
    """Is the active Brightway2 project the synthetic demo?

    Cheap enough for the frontend to poll on project change. Never raises —
    a broken bw2 state should not stop the UI rendering.
    """
    try:
        import bw2data as bd
        current = bd.projects.current
    except Exception:
        current = None

    return {
        "demo_project_name": DEMO_PROJECT_NAME,
        "demo_database": DEMO_DB_NAME,
        "current_project": current,
        "is_demo_active": is_demo_project(current),
    }


@router.post("/load")
async def load_demo(rebuild: bool = False) -> dict:
    """Build the demo project and make it active.

    Idempotent. Only ever writes inside the demo project, so a user's real
    projects are untouched. ``rebuild=true`` forces the synthetic technosphere
    and DSM inputs to be regenerated.
    """
    try:
        report = build_demo_project(rebuild=rebuild)
    except Exception as e:
        logger.exception("demo: build failed")
        raise HTTPException(status_code=500, detail=f"Demo build failed: {e}")

    # build_demo_project restores the previous project on exit; loading the
    # demo from the UI is an explicit request to switch to it.
    try:
        import bw2data as bd
        bd.projects.set_current(DEMO_PROJECT_NAME)
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Demo built but could not activate: {e}"
        )

    payload = report.as_dict()
    payload["is_demo_active"] = True
    return payload
