# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Long compute routes must not run on the event loop.

A route declared ``async def`` that never ``await``s runs ON the loop, so one
20-second LCA freezes every other request for 20 seconds -- the Log panel,
the project list, the progress sockets. The routes below keep their
``async def`` signature (other routes ``await`` them and tests
``asyncio.run`` them) and hand their body to the threadpool through
``mapper.api.heavy.run_heavy``, one at a time.

The timing test uses a deliberately slow body and ordering assertions with a
wide margin (2.5 s of sleep, judged against 1.25 s) so it is not a race on a
loaded Windows runner: before this change the concurrent ``/system/logs``
request could not even START until the slow route finished.
"""
from __future__ import annotations

import ast
import asyncio
import pathlib
import threading
import time

import httpx
import pytest
from fastapi import HTTPException

API = pathlib.Path(__file__).resolve().parent.parent / "mapper" / "api"

#: (module file, route function). Each is a long synchronous compute route: an
#: LCA, a contribution analysis, a DSM simulation, a subsystem compute.
HEAVY_ROUTES = [
    ("lca.py", "calculate_activity_lca"),
    ("lca.py", "calculate_archetype_lca"),
    ("lca.py", "calculate_archetype_trajectory"),
    ("lca.py", "calculate_contribution_analysis"),
    ("bom.py", "standalone_lca"),
    ("bom.py", "run_dsm_lca"),
    ("bom.py", "material_flows"),
    ("dsm.py", "simulate"),
    ("dsm.py", "simulate_scenarios"),
    ("subsystems.py", "compute_subsystem"),
    ("subsystems.py", "compute_all_subsystems"),
    ("monte_carlo.py", "get_pedigree_coverage"),
]


def _module_functions(fname: str) -> dict[str, ast.AST]:
    tree = ast.parse((API / fname).read_text(encoding="utf-8"))
    return {n.name: n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}


# ── structure: nothing heavy runs inline in an async route ───────────────────


@pytest.mark.parametrize("fname,name", HEAVY_ROUTES)
def test_the_route_only_hands_off_to_run_heavy(fname, name):
    fns = _module_functions(fname)
    route = fns[name]
    assert isinstance(route, ast.AsyncFunctionDef), f"{name} must stay async def (callers await it)"
    assert any(ast.unparse(d).startswith("router.") for d in route.decorator_list)

    body = [s for s in route.body
            if not (isinstance(s, ast.Expr) and isinstance(s.value, ast.Constant) and isinstance(s.value.value, str))]
    assert len(body) == 1, f"{name}: the body must be the single hand-off, found {len(body)} statements"
    stmt = body[0]
    assert isinstance(stmt, ast.Return) and isinstance(stmt.value, ast.Await)
    call = stmt.value.value
    assert isinstance(call, ast.Call) and ast.unparse(call.func) == "run_heavy"
    assert ast.unparse(call.args[0]) == f"_{name}_sync"

    sync = fns[f"_{name}_sync"]
    assert isinstance(sync, ast.FunctionDef), "the body must be a plain def, run on a worker thread"
    assert not sync.decorator_list
    assert not any(isinstance(x, ast.Await) for x in ast.walk(sync)), "an await cannot run on a worker thread"


# ── behaviour: the loop stays free, and heavy routes stay one at a time ───────

SLOW = 2.5


def _route_for(app, endpoint_name):
    for r in app.routes:
        ep = getattr(r, "endpoint", None)
        if ep is not None and ep.__name__ == endpoint_name:
            return r
    raise AssertionError(f"no route named {endpoint_name}")


def _call(app, endpoint_name):
    """(method, path, kwargs) for a request that reaches the route's body."""
    r = _route_for(app, endpoint_name)
    method = sorted(r.methods - {"HEAD", "OPTIONS"})[0]
    path = r.path
    kwargs: dict = {}
    if endpoint_name == "calculate_contribution_analysis":
        kwargs["json"] = {"target_type": "activity", "database": "x", "code": "y", "method": ["a", "b"]}
    elif endpoint_name == "get_pedigree_coverage":
        kwargs["params"] = {"archetype_id": "a", "method": "x|y"}
    path = path.replace("{system_id}", "s1").replace("{subsystem_id}", "sub1")
    return method, path, kwargs


SLOW_CASES = [
    ("calculate_contribution_analysis", "lca", "_calculate_contribution_analysis_sync"),
    ("get_pedigree_coverage", "monte_carlo", "_get_pedigree_coverage_sync"),
    ("simulate", "dsm", "_simulate_sync"),
    ("compute_all_subsystems", "subsystems", "_compute_all_subsystems_sync"),
]


@pytest.mark.parametrize("endpoint,module,sync_name", SLOW_CASES)
def test_a_slow_route_does_not_delay_a_concurrent_logs_request(monkeypatch, endpoint, module, sync_name):
    import importlib

    from mapper.main import app

    mod = importlib.import_module(f"mapper.api.{module}")

    def slow(*a, **k):
        time.sleep(SLOW)
        raise HTTPException(status_code=418, detail="slow body finished")

    monkeypatch.setattr(mod, sync_name, slow)
    method, path, kwargs = _call(app, endpoint)

    async def scenario():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            t0 = time.perf_counter()
            slow_task = asyncio.create_task(c.request(method, path, **kwargs))
            await asyncio.sleep(0.4)  # the slow body is running now
            t1 = time.perf_counter()
            logs = await c.get("/api/system/logs?lines=5")
            logs_elapsed = time.perf_counter() - t1
            logs_returned_while_slow_ran = not slow_task.done()
            slow_resp = await slow_task
            return logs, logs_elapsed, logs_returned_while_slow_ran, slow_resp, time.perf_counter() - t0

    logs, logs_elapsed, in_flight, slow_resp, slow_total = asyncio.run(scenario())

    assert slow_resp.status_code == 418, slow_resp.text  # it really ran the slow body
    assert slow_total >= SLOW * 0.9
    assert logs.status_code == 200, logs.text
    assert in_flight, "/system/logs only returned after the slow route finished: the loop was blocked"
    assert logs_elapsed < SLOW / 2, f"/system/logs took {logs_elapsed:.2f}s behind a {SLOW}s route"


def test_heavy_routes_still_run_one_at_a_time(monkeypatch):
    """On the loop they were serialised by accident; the lock keeps that."""
    from mapper.api import dsm, monte_carlo
    from mapper.main import app

    state = {"active": 0, "peak": 0}
    guard = threading.Lock()

    def probe(*a, **k):
        with guard:
            state["active"] += 1
            state["peak"] = max(state["peak"], state["active"])
        time.sleep(0.4)
        with guard:
            state["active"] -= 1
        raise HTTPException(status_code=418, detail="probe")

    monkeypatch.setattr(dsm, "_simulate_sync", probe)
    monkeypatch.setattr(monte_carlo, "_get_pedigree_coverage_sync", probe)
    calls = [_call(app, "simulate"), _call(app, "get_pedigree_coverage"), _call(app, "simulate")]

    async def scenario():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            return await asyncio.gather(*(c.request(m, p, **kw) for m, p, kw in calls))

    responses = asyncio.run(scenario())
    assert [r.status_code for r in responses] == [418, 418, 418]
    assert state["peak"] == 1, f"{state['peak']} heavy routes ran at once"


def test_a_heavy_route_can_still_be_awaited_and_asyncio_run(monkeypatch):
    """Other routes ``await`` these and tests ``asyncio.run`` them: both must keep working."""
    from mapper.api import dsm

    monkeypatch.setattr(dsm, "_simulate_sync", lambda system_id, scenario_id=None, case=None: ("ran", system_id))
    assert asyncio.run(dsm.simulate("sys-1")) == ("ran", "sys-1")


def test_the_lock_is_reentrant():
    from mapper.api.heavy import _locked

    assert _locked(lambda: _locked(lambda: "inner")) == "inner"
