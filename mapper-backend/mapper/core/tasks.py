# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Simple in-process task store for background jobs (import, LCA)."""
import logging
import threading
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable

logger = logging.getLogger(__name__)


@dataclass
class Task:
    task_id: str
    status: str = "pending"     # pending | running | done | error | cancelled
    progress: float = 0.0
    step: str = ""
    message: str = ""
    result: Any = None
    error: str = ""
    subscribers: list[Any] = field(default_factory=list)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def update(self, step: str, progress: float, message: str = "") -> None:
        with self._lock:
            self.step = step
            self.progress = progress
            self.message = message
        self._notify()

    def finish(self, result: Any = None) -> None:
        with self._lock:
            self.status = "done"
            self.progress = 1.0
            self.step = "done"
            self.result = result
        self._notify()

    def fail(self, error: str) -> None:
        with self._lock:
            self.status = "error"
            self.step = "error"
            self.error = error
        self._notify()

    def mark_cancelled(self) -> None:
        """Terminal state for tasks aborted via the cancellation registry.
        Distinct from ``fail`` so the WS frontend can render Stopped vs.
        Errored differently."""
        with self._lock:
            self.status = "cancelled"
            self.step = "cancelled"
        self._notify()

    def subscribe(self, cb: Callable[[dict], None]) -> None:
        with self._lock:
            self.subscribers.append(cb)

    def unsubscribe(self, cb: Callable[[dict], None]) -> None:
        with self._lock:
            try:
                self.subscribers.remove(cb)
            except ValueError:
                pass

    def _notify(self) -> None:
        payload = self.current_payload()
        subs = list(self.subscribers)
        for cb in subs:
            try:
                cb(payload)
            except Exception:
                pass

    def current_payload(self) -> dict:
        """What a subscriber is sent. ``message`` is always the last progress
        line (consumers that only read ``step``/``progress``/``message`` keep
        working); a failed task also carries the failure text in ``error``, so
        a client does not have to guess that the last progress line is the cause."""
        payload = {"step": self.step, "progress": self.progress, "message": self.message}
        if self.status == "error":
            payload["error"] = self.error
        return payload

    def state(self) -> dict:
        """The task as a poll sees it: the payload plus ``status``."""
        with self._lock:
            return {"task_id": self.task_id, "status": self.status, **self.current_payload()}


_tasks: dict[str, Task] = {}
_tasks_lock = threading.Lock()


def create_task() -> Task:
    task_id = str(uuid.uuid4())
    task = Task(task_id=task_id, status="pending")
    with _tasks_lock:
        _tasks[task_id] = task
    return task


def get_task(task_id: str) -> Task | None:
    with _tasks_lock:
        return _tasks.get(task_id)


def run_in_thread(task: Task, fn: Callable, *args, **kwargs) -> None:
    """Run fn(*args, **kwargs) in a daemon thread, updating task on completion/error.

    A ``CancelledOperation`` raised by ``fn`` (matched by class name to avoid a
    core → api dependency) routes to ``task.mark_cancelled`` instead of
    ``task.fail`` so cancellation is distinguishable from a real error on the
    progress WS."""
    def _run():
        task.status = "running"
        try:
            result = fn(task, *args, **kwargs)
            if task.status != "cancelled":
                task.finish(result)
        except BaseException as exc:  # noqa: BLE001
            if type(exc).__name__ == "CancelledOperation":
                task.mark_cancelled()
                return
            # Every other BaseException (KeyboardInterrupt, SystemExit, ...) is a
            # failure too: re-raising it in a daemon thread left the task
            # "running" forever and the client waiting.
            logger.error("Task %s failed: %s: %s", task.task_id, type(exc).__name__, exc, exc_info=exc)
            task.fail(str(exc) or type(exc).__name__)

    t = threading.Thread(target=_run, daemon=True)
    t.start()
