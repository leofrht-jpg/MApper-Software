# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Tests for Patch 1 — universal task cancellation.

Covers:
  • Registry primitives: register / is_cancelled / cancel / unregister
  • Grace period: in_grace_period transitions; maybe_cancel_on_last_subscriber_leave
    rule matrix (subscribers > 0, task_done, in-grace, post-grace)
  • HTTP endpoint: POST /api/tasks/{task_id}/cancel returns 200 with
    {cancelled: true, task_id} on success, 404 on unknown, idempotent
  • run_in_thread: CancelledOperation raised by the worker routes to
    Task.mark_cancelled (status="cancelled"), NOT Task.fail. Verifies the
    class-name match used to avoid a core→api import dependency.

Out of scope (deferred): real bw2 + premise mid-run cancel — those rely on
external databases / network. The registry-level tests above validate
Patch 1's invariants; the per-endpoint integration is exercised manually
in dev (StopButton click during a run) and end-to-end via the existing
contribution / pLCA tests once they're parameterised over cancellation.
"""
from __future__ import annotations

import threading
import time

import pytest


# ── Registry primitives ──────────────────────────────────────────────────


def test_register_is_cancelled_cancel_unregister_lifecycle():
    """Round-trip: a registered task starts not cancelled, flips to cancelled
    after cancel(), and disappears after unregister()."""
    from mapper.api import tasks as registry

    tid = "test-lifecycle-1"
    registry.register(tid)
    try:
        assert registry.is_cancelled(tid) is False
        assert registry.cancel(tid) is True
        assert registry.is_cancelled(tid) is True
        # Idempotent: second cancel still returns True (registered) and
        # leaves the flag set.
        assert registry.cancel(tid) is True
        assert registry.is_cancelled(tid) is True
    finally:
        registry.unregister(tid)
    # Post-unregister: lookups return False rather than raising.
    assert registry.is_cancelled(tid) is False
    assert registry.cancel(tid) is False


def test_unregister_unknown_task_id_is_noop():
    """unregister() must not raise on unknown ids — task wrappers call it
    in a finally block and shouldn't have to guard."""
    from mapper.api import tasks as registry
    # Should not raise.
    registry.unregister("does-not-exist")


def test_active_task_ids_snapshot():
    from mapper.api import tasks as registry

    a, b = "active-a", "active-b"
    registry.register(a)
    registry.register(b)
    try:
        ids = list(registry.active_task_ids())
        assert a in ids and b in ids
    finally:
        registry.unregister(a)
        registry.unregister(b)


# ── Grace window + disconnect cancel rule ────────────────────────────────


def test_in_grace_period_true_immediately_after_register(monkeypatch):
    from mapper.api import tasks as registry

    tid = "grace-1"
    registry.register(tid)
    try:
        assert registry.in_grace_period(tid) is True
    finally:
        registry.unregister(tid)


def test_in_grace_period_false_after_grace_seconds(monkeypatch):
    """Patch GRACE_SECONDS to 0 to avoid sleeping in the test suite."""
    from mapper.api import tasks as registry

    monkeypatch.setattr(registry, "GRACE_SECONDS", 0.0)
    tid = "grace-2"
    registry.register(tid)
    try:
        # Even immediately after register, with GRACE_SECONDS=0 the window
        # has elapsed.
        assert registry.in_grace_period(tid) is False
    finally:
        registry.unregister(tid)


def test_in_grace_period_unknown_task_returns_false():
    from mapper.api import tasks as registry
    assert registry.in_grace_period("never-registered") is False


@pytest.mark.parametrize(
    "remaining,task_done,in_grace,expected",
    [
        # subscribers > 0 → no cancel regardless of state
        (1, False, False, False),
        (5, False, False, False),
        # task already done → no cancel regardless of subscribers/grace
        (0, True, False, False),
        (0, True, True, False),
        # in grace → no cancel even if zero subscribers and not done
        (0, False, True, False),
        # zero subscribers, not done, past grace → CANCEL
        (0, False, False, True),
    ],
)
def test_maybe_cancel_on_last_subscriber_leave_rule_matrix(
    monkeypatch, remaining, task_done, in_grace, expected,
):
    """The disconnect-cancel rule:

        cancel iff (remaining_subscribers == 0 AND not task_done AND past grace)

    Verified across the 6 boundary combinations."""
    from mapper.api import tasks as registry

    tid = "matrix-1"
    # GRACE_SECONDS=0 means in_grace=False after register; for the in-grace
    # branches we set GRACE_SECONDS large enough to remain in grace.
    monkeypatch.setattr(registry, "GRACE_SECONDS", 60.0 if in_grace else 0.0)
    registry.register(tid)
    try:
        triggered = registry.maybe_cancel_on_last_subscriber_leave(
            tid, remaining_subscribers=remaining, task_done=task_done,
        )
        assert triggered is expected
        # If we triggered, the flag is set; otherwise still clear.
        assert registry.is_cancelled(tid) is expected
    finally:
        registry.unregister(tid)


def test_maybe_cancel_on_unknown_task_returns_false():
    """Unknown task id: returns False (cancel() returns False, the rule
    forwards it). Important for shared WS handlers (e.g. ecoinvent imports)
    that aren't part of the cancel registry — they shouldn't get false
    positives."""
    from mapper.api import tasks as registry

    triggered = registry.maybe_cancel_on_last_subscriber_leave(
        "unknown-id", remaining_subscribers=0, task_done=False,
    )
    assert triggered is False


# ── POST /api/tasks/{task_id}/cancel ─────────────────────────────────────
#
# The endpoint is exercised by invoking the route handler function directly
# (matching the convention in test_contribution_analysis.py / test_dsm_
# scenarios.py — no TestClient / httpx dependency, and we sidestep loading
# mapper.main which eagerly imports bw2).


def test_cancel_endpoint_returns_200_with_discriminator():
    from fastapi import HTTPException
    from mapper.api import tasks as registry

    tid = "http-cancel-1"
    registry.register(tid)
    try:
        body = registry.cancel_task(tid)
        assert body == {"cancelled": True, "task_id": tid}
        assert registry.is_cancelled(tid) is True
    finally:
        registry.unregister(tid)
    # Confirm HTTPException is what would be raised for a missing id, so
    # FastAPI translates it to 404 (verified separately).
    _ = HTTPException  # noqa: F841


def test_cancel_endpoint_idempotent():
    """Two cancels on the same registered task: both succeed, both leave the
    flag set. Matches frontend useCancellableTask which may double-fire if
    the user clicks Stop twice quickly."""
    from mapper.api import tasks as registry

    tid = "http-cancel-idem"
    registry.register(tid)
    try:
        b1 = registry.cancel_task(tid)
        b2 = registry.cancel_task(tid)
        assert b1["cancelled"] is True
        assert b2["cancelled"] is True
        assert registry.is_cancelled(tid) is True
    finally:
        registry.unregister(tid)


def test_cancel_endpoint_404_for_unknown_task():
    """Unknown task_id (already finished, or never registered) → HTTP 404.
    The frontend treats 404 as 'the worker beat the cancel POST' and
    reverts the StopButton state to idle."""
    from fastapi import HTTPException
    from mapper.api import tasks as registry

    with pytest.raises(HTTPException) as exc:
        registry.cancel_task("never-existed")
    assert exc.value.status_code == 404
    assert "unknown task_id" in exc.value.detail


def test_cancel_endpoint_404_after_unregister():
    """A task that completed and was unregistered must yield 404 on cancel,
    NOT a misleading 200. The 'already finished' path is what unregister()
    + 404 captures."""
    from fastapi import HTTPException
    from mapper.api import tasks as registry

    tid = "http-cancel-finished"
    registry.register(tid)
    registry.unregister(tid)  # simulate the task wrapper's finally block
    with pytest.raises(HTTPException) as exc:
        registry.cancel_task(tid)
    assert exc.value.status_code == 404


# ── run_in_thread + CancelledOperation routing ──────────────────────────


def _wait_for_status(task, target: str, timeout: float = 2.0) -> None:
    """Poll until the daemon worker reaches the target terminal status,
    or raise. Daemon threads finish fast; 2s is generous."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if task.status == target:
            return
        time.sleep(0.01)
    raise AssertionError(
        f"task did not reach status={target!r} within {timeout}s; "
        f"current status={task.status!r}, error={task.error!r}"
    )


def test_run_in_thread_routes_cancelled_operation_to_mark_cancelled():
    """A worker that raises CancelledOperation must end up in status
    'cancelled' (not 'error'). This validates the class-name match used in
    core/tasks.py to dispatch without importing from mapper.api."""
    from mapper.api.tasks import CancelledOperation
    from mapper.core.tasks import create_task, run_in_thread

    task = create_task()
    started = threading.Event()

    def worker(t):
        started.set()
        raise CancelledOperation(t.task_id)

    run_in_thread(task, worker)
    assert started.wait(1.0), "worker did not start"
    _wait_for_status(task, "cancelled")
    assert task.error == "", "cancelled tasks should not have an error message"


def test_run_in_thread_routes_other_exceptions_to_fail():
    """Non-CancelledOperation exceptions still end up in status 'error'.
    Regression guard: the class-name match must NOT swallow real failures."""
    from mapper.core.tasks import create_task, run_in_thread

    task = create_task()

    def worker(_t):
        raise ValueError("boom")

    run_in_thread(task, worker)
    _wait_for_status(task, "error")
    assert "boom" in task.error


def test_run_in_thread_completes_normal_workers():
    """Sanity: workers that return normally finish with status 'done'."""
    from mapper.core.tasks import create_task, run_in_thread

    task = create_task()

    def worker(_t):
        return {"ok": True}

    run_in_thread(task, worker)
    _wait_for_status(task, "done")
    assert task.result == {"ok": True}


def test_cancelled_operation_class_name_match_is_module_independent():
    """The dispatcher in core/tasks.py uses ``type(exc).__name__ ==
    'CancelledOperation'`` to avoid importing mapper.api from mapper.core.
    This test recreates a same-named class in a fresh module and verifies
    the dispatcher routes it to mark_cancelled too — proving the contract
    is class-name-based, not import-identity-based.

    This is what lets premise_engine.py and lcia_method_engine.py (both in
    mapper.core) re-raise CancelledOperation across the engine/api seam
    without an import cycle."""
    from mapper.core.tasks import create_task, run_in_thread

    # Fabricate a class with the magic name, NOT the same identity as
    # mapper.api.tasks.CancelledOperation.
    LocalCancelled = type("CancelledOperation", (Exception,), {})

    task = create_task()

    def worker(_t):
        raise LocalCancelled("synthetic")

    run_in_thread(task, worker)
    _wait_for_status(task, "cancelled")
