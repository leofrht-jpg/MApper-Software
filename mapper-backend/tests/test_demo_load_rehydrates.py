# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""``POST /demo/load`` must leave the demo visible WITHOUT an app restart.

The defect this locks: ``build_demo_project`` writes the DSM system, its state,
its results and the archetypes straight to ``dsm_storage`` and never touches the
in-memory registries -- it cannot, it does not import ``mapper.api`` at all.
``hydrate_from_disk()`` ran only from the FastAPI startup hook, so everything
the builder wrote stayed invisible until the process was restarted. Databases
appeared immediately (they go through bw2data, a different path), so the load
looked like it had worked while Stock Modeller and LCA Architect were empty.

The builder is stubbed here on purpose. Building the real demo needs
``bw2setup()`` (~1 min, ~150 MB) and is covered by the documented walkthrough;
what CI can protect is the ROUTE's contract -- whatever the builder persisted is
readable through the API on the next request, in the same process.

The assertion that matters is the one AFTER the POST with no restart in
between. A test that only passes once the process is recycled proves nothing.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from mapper.api import bom as _bom
from mapper.api import dsm as _dsm
from mapper.core import dsm_storage
from mapper.core.demo_project import DEMO_PROJECT_NAME
from mapper.main import app
from mapper.models.bom_schemas import Archetype
from mapper.models.dsm_schemas import DimensionDef, DSMSystemState, SystemDefinition, TimeHorizon

client = TestClient(app)

SYS_ID = "demo-sys-1"
ARC_ID = "demo-arc-1"


def _write_demo_to_disk() -> None:
    """What the real builder does to storage, minus the bw2 work."""
    system = SystemDefinition(
        id=SYS_ID, name="DEMO Fleet (fictional)",
        dimensions=[DimensionDef(name="fuel", display_name="Fuel", values=["BEV", "ICEV"])],
        time_horizon=TimeHorizon(start_year=2025, end_year=2030),
    )
    dsm_storage.save_system(DEMO_PROJECT_NAME, system)
    dsm_storage.save_state(DEMO_PROJECT_NAME, SYS_ID, DSMSystemState(system_id=SYS_ID))
    dsm_storage.save_archetype(
        DEMO_PROJECT_NAME,
        Archetype(id=ARC_ID, name="DEMO BEV (fictional)", bom=[],
                  created_at="2026-01-01T00:00:00", updated_at="2026-01-01T00:00:00"),
    )


@pytest.fixture()
def demo_env(tmp_path, monkeypatch):
    """Isolated storage + a stubbed builder and project switch."""
    monkeypatch.setattr(dsm_storage, "STORAGE_DIR", tmp_path)

    class _Report:
        def as_dict(self) -> dict:
            return {"project": DEMO_PROJECT_NAME, "stub": True}

    def _fake_build(rebuild: bool = False):
        _write_demo_to_disk()
        return _Report()

    monkeypatch.setattr("mapper.api.demo.build_demo_project", _fake_build)

    class _Projects:
        current = DEMO_PROJECT_NAME
        def set_current(self, name):  # noqa: D401 - the route calls this
            type(self).current = name

    import bw2data as bd
    monkeypatch.setattr(bd, "projects", _Projects(), raising=False)

    # Start from empty registries for the demo project, as a fresh process would
    # be for a project that did not exist at startup.
    _dsm._systems.pop(DEMO_PROJECT_NAME, None)
    _dsm._states.pop(DEMO_PROJECT_NAME, None)
    _bom._archetypes.pop(DEMO_PROJECT_NAME, None)
    monkeypatch.setattr(_bom, "_current_project", lambda: DEMO_PROJECT_NAME)
    monkeypatch.setattr(_dsm, "_current_project", lambda: DEMO_PROJECT_NAME)
    yield
    for reg in (_dsm._systems, _dsm._states, _dsm._results):
        reg.pop(DEMO_PROJECT_NAME, None)
    _bom._archetypes.pop(DEMO_PROJECT_NAME, None)


def test_demo_load_makes_the_data_visible_without_a_restart(demo_env):
    # BEFORE: nothing in memory for the demo project.
    assert client.get("/api/dsm/systems").json() == []
    assert client.get("/api/bom/archetypes").json() == []

    r = client.post("/api/demo/load")
    assert r.status_code == 200, r.text

    # AFTER, same process, no restart. This is the acceptance test.
    systems = client.get("/api/dsm/systems").json()
    archetypes = client.get("/api/bom/archetypes").json()
    assert len(systems) == 1, f"DSM system invisible after demo load: {systems}"
    assert len(archetypes) == 1, f"archetype invisible after demo load: {archetypes}"
    assert systems[0]["id"] == SYS_ID
    assert archetypes[0]["id"] == ARC_ID


def test_the_route_reads_what_the_builder_persisted(demo_env):
    """The state the builder wrote must come back too, not just the system."""
    client.post("/api/demo/load")
    state = client.get(f"/api/dsm/systems/{SYS_ID}/state")
    assert state.status_code == 200, state.text


def test_rehydration_does_not_drop_another_project_held_in_memory(demo_env):
    """`hydrate_from_disk` merges with `.update()`, so a project that exists
    only in memory (never persisted) must survive the call. If this ever fails,
    the demo load is eating unsaved work elsewhere in the session."""
    other = SystemDefinition(
        id="mem-only", name="In-memory only",
        dimensions=[DimensionDef(name="f", display_name="F", values=["a"])],
        time_horizon=TimeHorizon(start_year=2025, end_year=2026),
    )
    _dsm._systems.setdefault("SomeOtherProject", {})["mem-only"] = other

    client.post("/api/demo/load")

    assert "mem-only" in _dsm._systems.get("SomeOtherProject", {}), (
        "demo load dropped an in-memory-only project")
