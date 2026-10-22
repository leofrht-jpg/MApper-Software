# SPDX-License-Identifier: MPL-2.0
"""A dependent subsystem's view asks for its result on mount, before any
Compute. That ordinary state answered 404 and every visit put an ERROR in
Settings › Logs. It now answers 200 null; an unknown subsystem is still 404.
"""
from __future__ import annotations

from fastapi.testclient import TestClient


def test_not_computed_is_null_and_unknown_is_404(monkeypatch):
    from mapper.api import subsystems
    from mapper.main import app
    from mapper.models.subsystem_schemas import Subsystem  # noqa: F401  (shape check below)

    proj = subsystems._current_project() if hasattr(subsystems, "_current_project") else None
    subs = subsystems._sys_subs("sys-x", proj)
    sub = Subsystem.model_validate({"id": "sub-1", "name": "Chargers", "type": "dependent"})
    subs["sub-1"] = sub
    try:
        c = TestClient(app)
        r = c.get("/api/dsm/systems/sys-x/subsystems/sub-1/results")
        assert r.status_code == 200 and r.json() is None
        assert c.get("/api/dsm/systems/sys-x/subsystems/nope/results").status_code == 404
    finally:
        subs.pop("sub-1", None)
