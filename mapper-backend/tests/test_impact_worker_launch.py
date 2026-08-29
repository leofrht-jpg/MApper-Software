# SPDX-License-Identifier: MPL-2.0
"""``POST /impact/calculate`` reaches its worker launch.

The system-level Impact Assessment worker: every Sustainability Ratio in the
paper comes through here. It is structurally identical to
``POST /lca/monte-carlo``, which shipped 500-ing on every call because its
launch line was never executed by a test -- all of that route's coverage
returned at a 4xx gate first.

This drives the route PAST every validation gate and asserts a task id comes
back. The worker then fails inside on the fake ecoinvent links, which is fine
and is the point: what must not happen is the POST itself throwing.

Deliberately needs no bw2 technosphere. The LCA happens inside the worker, so
the gates -- system, simulation, cohort mapping, methods, archetype validation,
unlinked materials -- can all be satisfied in memory. A test that needed real
databases would SKIP in CI, which is exactly the hole that let
``lca.py:start_multi_year_contribution`` read as covered locally and uncovered
in the environment that gates merges.
"""

from __future__ import annotations

import threading

import pytest
from fastapi.testclient import TestClient

from mapper.main import app
from mapper.models.bom_schemas import (
    Archetype, BOMNode, CohortMapping, CohortMappingEntry, EcoinventLink,
)
from mapper.models.dsm_schemas import DimensionDef, SystemDefinition, TimeHorizon

client = TestClient(app)

SYS_ID = "sys-impact-launch"
ARC_ID = "arc-impact-launch"
COHORT = "BEV|Small|2025"


def _archetype() -> Archetype:
    """One stage, one linked material, no validation errors and nothing unlinked."""
    return Archetype(
        id=ARC_ID,
        name="Launch probe archetype",
        bom=[
            BOMNode(
                id="stage-1", name="Manufacturing", node_type="component",
                quantity=1.0, unit="piece", scope="inflows",
                children=[
                    BOMNode(
                        id="mat-1", name="Steel", node_type="material",
                        quantity=100.0, unit="kg",
                        ecoinvent_activity=EcoinventLink(
                            database="fake-db", code="fake-code", name="steel"
                        ),
                    )
                ],
            )
        ],
    )


@pytest.fixture
def wired(monkeypatch):
    """Satisfy every gate in post_calculate, in memory."""
    from mapper.api import bom as bom_api
    from mapper.api import dsm as dsm_api
    from mapper.api import impact as impact_api

    # Seed under the ACTUAL current project rather than a fake name: dsm,
    # bom and impact each resolve the project through their own helper, so a
    # name patched into only one of them leaves _get_system looking elsewhere
    # and the route 404s before it reaches anything worth testing.
    project = impact_api._current_project()

    system = SystemDefinition(
        id=SYS_ID, name="Launch probe system",
        time_horizon=TimeHorizon(start_year=2025, end_year=2030),
        dimensions=[DimensionDef(name="fuel_type", display_name="Fuel", values=["BEV"])],
    )
    monkeypatch.setitem(dsm_api._systems.setdefault(project, {}), SYS_ID, system)

    # A simulation result must merely be PRESENT; its contents are the worker's
    # problem, and the worker is expected to fail.
    class _Sim:
        years: list = []
        summary = None
    monkeypatch.setitem(dsm_api._results.setdefault(project, {}), SYS_ID, _Sim())

    monkeypatch.setitem(
        bom_api._cohort_mappings.setdefault(project, {}),
        SYS_ID,
        CohortMapping(
            mfa_system_id=SYS_ID,
            mappings=[CohortMappingEntry(cohort_key=COHORT, archetype_id=ARC_ID)],
        ),
    )
    monkeypatch.setitem(bom_api._archetypes.setdefault(project, {}), ARC_ID, _archetype())
    return project


def _body(**over) -> dict:
    b = {
        "mfa_system_id": SYS_ID,
        "mode": "static",
        "methods": [["EF v3.1", "climate change", "global warming potential (GWP100)"]],
    }
    b.update(over)
    return b


def _spy_on_thread_start(monkeypatch) -> list:
    """Record thread starts, CALLING THROUGH.

    Not a stub. ``TestClient`` runs the ASGI app on its own portal thread, so
    replacing ``Thread.start`` with something that does not start deadlocks
    ``client.post`` -- it waits forever for a portal that never ran. Calling
    through is also safe here: the impact worker catches every exception and
    marks the task errored, so it fails fast on the fake ecoinvent links rather
    than hanging.
    """
    started: list = []
    orig = threading.Thread.start

    def _spy(self):
        started.append(getattr(self, "_target", None) or getattr(self, "name", "?"))
        return orig(self)

    monkeypatch.setattr(threading.Thread, "start", _spy)
    return started


def test_the_route_reaches_its_worker_launch(wired, monkeypatch):
    """The load-bearing one. Records whether the launch line executes."""
    started = _spy_on_thread_start(monkeypatch)

    r = client.post("/api/impact/calculate", json=_body())
    assert r.status_code == 200, f"expected a task id, got {r.status_code}: {r.text}"
    assert "task_id" in r.json()

    launched = [t for t in started if getattr(t, "__name__", "") == "_run"]
    assert launched, (
        "the route returned 200 but never started its worker thread -- the "
        "launch line was not reached, which is the gap this test closes. "
        f"threads started: {started}"
    )


def test_the_gates_still_reject_before_the_launch(wired, monkeypatch):
    """The 4xx paths still return early, so the test above is testing something
    the others do not."""
    started = _spy_on_thread_start(monkeypatch)

    assert client.post("/api/impact/calculate", json=_body(mode="nonsense")).status_code == 400
    assert client.post("/api/impact/calculate", json=_body(methods=[])).status_code == 400
    assert client.post(
        "/api/impact/calculate", json=_body(year_start=2050, year_end=2020)
    ).status_code == 400
    assert not [t for t in started if getattr(t, "__name__", "") == "_run"], (
        "a rejected request must not launch a worker"
    )


def test_a_missing_simulation_is_a_400_not_a_500(wired, monkeypatch):
    """The gate immediately before the launch, which is where the Monte Carlo
    route's coverage stopped."""
    from mapper.api import dsm as dsm_api

    dsm_api._results.get(wired, {}).pop(SYS_ID, None)
    r = client.post("/api/impact/calculate", json=_body())
    assert r.status_code == 400
    assert "simulate" in r.json()["detail"].lower()
