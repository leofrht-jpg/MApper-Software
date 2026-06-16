"""Universal cancellation registry for long-running async tasks.

A single in-process registry of ``threading.Event`` objects keyed by
``task_id``. Each cancellable endpoint (multi-year LCA contribution, pLCA
generate, Impact Assessment, LCIA install, legacy single-year LCA) registers
an event when its background worker starts and polls ``is_cancelled(task_id)``
at natural iteration boundaries (per-year, per-stage, per-method-component).
On cancel, the worker raises ``CancelledOperation`` which propagates to the
task's wrapper layer; the wrapper emits a ``{"type": "cancelled"}`` frame to
WebSocket subscribers, skips the result-cache write, marks the task done, and
unregisters the entry.

Two cancellation triggers
-------------------------
1. Explicit ``POST /api/tasks/{task_id}/cancel`` from the client (e.g. user
   clicks Stop). Returns 200 with ``{"cancelled": true, "task_id": ...}``,
   404 if the task_id is unknown. Idempotent — calling twice is harmless.
2. WebSocket subscriber count dropping to zero on a still-running task.
   Browser tab close / refresh / network drop → the WS handler observes
   ``WebSocketDisconnect``, removes the subscriber, and if no other
   subscribers remain the task is cancelled. Each per-feature WS handler is
   responsible for invoking ``cancel(task_id)`` in this case; this module
   provides only the primitive.

   A small grace window (``GRACE_SECONDS``) is honoured after task start to
   handle the race where the POST returns and the client has not yet opened
   its WS connection — during the grace window, zero subscribers does NOT
   trigger cancellation. After the grace window, zero subscribers with a
   still-running task is treated as a disconnect cancel.

HTTP semantics
--------------
We use HTTP 200 with a body discriminator (``cancelled: true``) for the
result-fetch endpoints when a task ended via cancellation, NOT HTTP 499.
Cancellation is a documented expected outcome of a long-running task, not a
server error; 499 is non-standard (nginx-only) and complicates frontend
error handling. The convention matches our existing WebSocket frame pattern
where ``type ∈ {progress, done, error}`` already discriminates outcomes via
the body — adding a ``"cancelled"`` frame and ``cancelled: true`` to the
result GET keeps the protocol consistent.

Process scope
-------------
The registry is in-process (a module-level dict) — there is no Redis or DB
backing. MApper is a desktop application running a single uvicorn worker; a
multi-worker deployment would need to migrate this to a shared store.
"""
from __future__ import annotations

import threading
import time
from typing import Iterable

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

# Grace window after task registration before zero-subscriber disconnect
# triggers an automatic cancel. Covers the POST-returns → client-opens-WS
# race. Set generously: a slow frontend opening the WS at 250ms shouldn't
# get its task killed.
GRACE_SECONDS: float = 1.0


class CancelledOperation(Exception):
    """Raised at a worker checkpoint when a task has been cancelled. Workers
    let this propagate; the task wrapper is responsible for emitting the
    ``"cancelled"`` frame, skipping cache writes, and unregistering."""

    def __init__(self, task_id: str) -> None:
        super().__init__(f"task {task_id} cancelled")
        self.task_id = task_id


_lock = threading.Lock()
_events: dict[str, threading.Event] = {}
_started_at: dict[str, float] = {}


def register(task_id: str) -> threading.Event:
    """Register a fresh cancellation event. Called once before the worker
    starts. Returns the event so the caller can pass it to the worker if
    cheaper than re-looking-up via ``is_cancelled``. Replaces any existing
    entry under the same task_id (a rare race; last writer wins)."""
    ev = threading.Event()
    with _lock:
        _events[task_id] = ev
        _started_at[task_id] = time.monotonic()
    return ev


def is_cancelled(task_id: str) -> bool:
    """O(1) check at worker checkpoints. Cheap enough to call between every
    iteration (per-year, per-stage). Unknown task_id returns False — the
    worker will never see a cancel for an unregistered task, which is
    correct (cancel happens via this module's set; nothing else can flip
    the flag)."""
    with _lock:
        ev = _events.get(task_id)
    return ev.is_set() if ev is not None else False


def cancel(task_id: str) -> bool:
    """Set the cancel flag. Returns True if the task was registered, False
    if unknown. Idempotent — second call is a no-op. Workers see the new
    state at their next ``is_cancelled`` poll (or immediately if they hold
    a reference to the Event and call ``ev.is_set()``)."""
    with _lock:
        ev = _events.get(task_id)
    if ev is None:
        return False
    ev.set()
    return True


def unregister(task_id: str) -> None:
    """Remove the entry from the registry. Called by the task wrapper on
    every terminal state (success, error, cancel) to keep the registry
    bounded. Idempotent."""
    with _lock:
        _events.pop(task_id, None)
        _started_at.pop(task_id, None)


def in_grace_period(task_id: str) -> bool:
    """True if the task started within ``GRACE_SECONDS``. Used by per-
    feature WS handlers to suppress disconnect-triggered cancel during the
    POST-returns → client-opens-WS race window. Unknown task_id returns
    False (no grace for tasks we never knew)."""
    with _lock:
        t0 = _started_at.get(task_id)
    if t0 is None:
        return False
    return (time.monotonic() - t0) < GRACE_SECONDS


def maybe_cancel_on_last_subscriber_leave(
    task_id: str,
    *,
    remaining_subscribers: int,
    task_done: bool,
) -> bool:
    """Per-feature WS handlers call this after removing a disconnected
    subscriber. Returns True if cancellation was triggered. The combined
    rule keeps cancellation logic consistent across endpoints:

      cancel iff: remaining_subscribers == 0
                  AND not task_done
                  AND past grace window
    """
    if remaining_subscribers > 0:
        return False
    if task_done:
        return False
    if in_grace_period(task_id):
        return False
    return cancel(task_id)


def active_task_ids() -> Iterable[str]:
    """Snapshot of currently registered task ids. Used by tests and the
    health endpoint; not part of the worker hot path."""
    with _lock:
        return list(_events.keys())


@router.post("/{task_id}/cancel", status_code=200)
def cancel_task(task_id: str) -> dict:
    """Set the cancel flag on a registered task. The worker observes the
    flag at its next checkpoint and exits cleanly; the task's WebSocket
    will then emit a ``"cancelled"`` frame and the result-fetch endpoint
    will return ``{cancelled: true, task_id}``.

    Returns 200 with ``{cancelled: true, task_id}`` on success, 404 if the
    task_id is unknown (already finished, never existed, or was cleaned up).
    Idempotent: calling twice on the same task returns 200 both times.

    The 404 path is intentionally distinct from "task already finished" —
    once a task completes its wrapper unregisters the entry, so a cancel
    arriving after completion gets 404 rather than a misleading 200. The
    frontend treats 404 as "the task already finished; refresh state".
    """
    if not cancel(task_id):
        raise HTTPException(
            status_code=404,
            detail=f"unknown task_id: {task_id}",
        )
    return {"cancelled": True, "task_id": task_id}
