"""Project-state-desync guard.

Bug class: the backend's ``bw2data.projects.current`` and the frontend's
displayed project can drift out of sync (most commonly after a backend
restart resets bw2's active project to ``default``). Any write
endpoint that reads ``_current_project()`` / ``get_current_project()``
for storage scope is then vulnerable to **silent misrouting**: the user
thinks they're saving to project A, the data lands in project B with
no warning, and the original project's view appears to "lose" the
work.

Fix: include an ``X-Mapper-Project`` header on every request indicating
which project the client thinks it's on. This dependency validates the
header against the backend's actual ``bw2data.projects.current`` and
returns **409 Conflict** with a clear error on mismatch. The frontend
catches the 409 and triggers a project re-sync.

Apply via:

    @router.post("/foo", dependencies=[Depends(verify_project_state)])

Or, when the handler needs the project value, take it as a parameter:

    @router.post("/foo")
    async def post_foo(_: None = Depends(verify_project_state), ...):

The header is **optional** — when absent, no check is performed
(preserves backward compat with non-browser clients, tests, and curl
debugging). The frontend always sends it.
"""
from __future__ import annotations

from fastapi import Header, HTTPException

from mapper.core.bw2_wrapper import get_current_project


def verify_project_state(
    x_mapper_project: str | None = Header(default=None),
) -> str:
    """FastAPI dependency. 409 Conflict if the client's expected project
    doesn't match the backend's active bw2 project. Returns the current
    project name on success (header absent is treated as success).
    """
    current = get_current_project()
    if x_mapper_project is None or x_mapper_project.strip() == "":
        return current
    if x_mapper_project != current:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "project_state_mismatch",
                "message": (
                    f"Project state mismatch: client expects "
                    f"'{x_mapper_project}' but backend is on "
                    f"'{current}'. Refresh the page or switch "
                    f"projects."
                ),
                "expected_project": x_mapper_project,
                "current_project": current,
            },
        )
    return current
