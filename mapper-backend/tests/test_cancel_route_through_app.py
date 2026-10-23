# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Stop reaches a running task, through the REAL application.

The cancel router declared ``prefix="/api/tasks"`` and ``main.py`` mounts the
API router under ``/api`` again, so the route lived at
``/api/api/tasks/{id}/cancel``. The frontend posts ``/api/tasks/{id}/cancel``,
got a 404, and read it as "the task already finished": every Stop button sent
nothing. The existing tests called the handler function directly, which is
why it never showed.

These tests go through ``mapper.main.app``. The slow task is a Monte Carlo
run whose sampler is replaced by a loop with the SAME checkpoint the real
sampler has (``task_registry.is_cancelled`` -> ``CancelledOperation``), so the
route, the registry, the worker's except-branch and the result endpoint are
all the real ones.
"""
from __future__ import annotations

import threading
import time

import pytest
from fastapi.testclient import TestClient

from mapper.api import monte_carlo
from mapper.api import tasks as task_registry
from mapper.api.tasks import CancelledOperation

CANCEL = "/api/tasks/{}/cancel"


@pytest.fixture
def client():
    from mapper.main import app

    return TestClient(app)


@pytest.fixture
def slow_monte_carlo(monkeypatch):
    """Replace the sampler with a loop that only ends when cancelled (or 10 s)."""
    started = threading.Event()
    iterations = {"n": 0}

    def fake_run(body, task, task_id):
        started.set()
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if task_registry.is_cancelled(task_id):  # the real checkpoint
                raise CancelledOperation(task_id)
            iterations["n"] += 1
            time.sleep(0.01)
        raise AssertionError("the cancel never reached the running task")

    monkeypatch.setattr(monte_carlo, "_run_monte_carlo", fake_run)
    monkeypatch.setattr(monte_carlo, "_validate_methods_registered", lambda m: None)
    return started, iterations


def _start(client) -> str:
    r = client.post("/api/lca/monte-carlo", json={
        "archetype_id": "arc", "methods": [["EF v3.1", "climate change", "GWP100"]],
        "iterations": 10,
    })
    assert r.status_code == 200, r.text
    return r.json()["task_id"]


def _wait_for(client, task_id: str, timeout: float = 5.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        r = client.get(f"/api/lca/monte-carlo/{task_id}")
        if r.status_code == 200:
            return r.json()
        time.sleep(0.02)
    raise AssertionError("the task never reached a terminal state")


def test_cancel_stops_a_running_task(client, slow_monte_carlo):
    started, iterations = slow_monte_carlo
    task_id = _start(client)
    assert started.wait(5), "the slow task never started"

    r = client.post(CANCEL.format(task_id))
    assert r.status_code == 200, f"{CANCEL.format(task_id)} -> {r.status_code}: the Stop button's URL"
    assert r.json() == {"cancelled": True, "task_id": task_id}

    assert _wait_for(client, task_id) == {"cancelled": True, "task_id": task_id}
    # The computation stopped, not just the flag: the loop ran a bounded number
    # of times and is no longer advancing.
    n = iterations["n"]
    time.sleep(0.1)
    assert iterations["n"] == n


def test_cancel_of_an_unknown_task_is_404(client):
    assert client.post(CANCEL.format("no-such-task")).status_code == 404


def test_no_route_has_a_doubled_api_prefix():
    from mapper.main import app

    doubled = [getattr(r, "path", "") for r in app.routes if getattr(r, "path", "").startswith("/api/api")]
    assert doubled == [], f"routes mounted under /api twice: {doubled}"
