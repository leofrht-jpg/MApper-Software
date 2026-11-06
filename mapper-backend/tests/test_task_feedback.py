# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Background tasks must report progress and failures honestly.

A failed task used to send only its last progress line, ``run_in_thread`` never
logged the exception, and a ``BaseException`` left the task "running" for ever.
The credentials import also ran a multiprocessing pool with no heartbeat. No
real ecoinvent download happens here: the library is faked and the release is a
tiny synthetic one.
"""
from __future__ import annotations

import gc
import logging
import shutil
import time
import uuid

import bw2data
import pytest
from fastapi.testclient import TestClient

from mapper.api import ecoinvent as ei_api
from mapper.core.tasks import Task, create_task, run_in_thread

from ecoinvent_release_fixture import write_release


def _wait(task: Task, timeout: float = 5.0) -> None:
    deadline = time.monotonic() + timeout
    while task.status in ("pending", "running") and time.monotonic() < deadline:
        time.sleep(0.01)


def _frames(task: Task) -> list[dict]:
    seen: list[dict] = []
    task.subscribe(seen.append)
    return seen


# ── the payload ──────────────────────────────────────────────────────────────


def test_a_failure_payload_carries_the_error_and_keeps_the_message():
    task = Task(task_id="t")
    seen = _frames(task)
    task.update("writing", 0.9, "Writing database…")
    task.fail("disk is full")

    assert seen[-1] == {"step": "error", "progress": 0.9, "message": "Writing database…", "error": "disk is full"}
    assert task.current_payload()["error"] == "disk is full"


def test_payloads_of_a_running_or_finished_task_keep_their_old_shape():
    task = Task(task_id="t")
    seen = _frames(task)
    task.update("importing", 0.5, "Reading…")
    task.finish({"x": 1})
    for payload in seen:
        assert set(payload) == {"step", "progress", "message"}, payload
    assert set(task.current_payload()) == {"step", "progress", "message"}


def test_a_cancelled_task_is_not_reported_as_an_error():
    task = Task(task_id="t")
    task.mark_cancelled()
    assert "error" not in task.current_payload() and task.current_payload()["step"] == "cancelled"


def test_the_poll_state_has_status_and_error():
    task = Task(task_id="abc")
    task.update("importing", 0.4, "Reading…")
    task.status = "running"
    assert task.state() == {"task_id": "abc", "status": "running", "step": "importing", "progress": 0.4, "message": "Reading…"}
    task.fail("boom")
    assert task.state()["status"] == "error" and task.state()["error"] == "boom"


# ── run_in_thread ────────────────────────────────────────────────────────────


def test_an_exception_fails_the_task_and_is_logged_with_its_traceback(caplog):
    def worker(task):
        task.update("importing", 0.5, "Reading…")
        raise ValueError("the spold is broken")

    task = create_task()
    with caplog.at_level(logging.ERROR, logger="mapper.core.tasks"):
        run_in_thread(task, worker)
        _wait(task)

    assert task.status == "error" and task.error == "the spold is broken"
    record = next(r for r in caplog.records if r.name == "mapper.core.tasks")
    assert task.task_id in record.getMessage() and "ValueError" in record.getMessage()
    assert record.exc_info and record.exc_info[0] is ValueError, "the traceback was not logged"


@pytest.mark.parametrize("exc", [KeyboardInterrupt("stop"), SystemExit(3), GeneratorExit()])
def test_a_base_exception_ends_in_a_failed_state_not_running_forever(exc, caplog):
    def worker(task):
        raise exc

    task = create_task()
    seen = _frames(task)
    with caplog.at_level(logging.ERROR, logger="mapper.core.tasks"):
        run_in_thread(task, worker)
        _wait(task)

    assert task.status == "error", "a BaseException left the task running"
    assert task.error  # never empty: GeneratorExit() has no text, so the type name is used
    assert seen[-1]["error"] == task.error and seen[-1]["step"] == "error"
    assert any(r.exc_info and r.exc_info[0] is type(exc) for r in caplog.records)


def test_an_exception_without_text_still_gives_an_error_text():
    def worker(task):
        raise RuntimeError()

    task = create_task()
    run_in_thread(task, worker)
    _wait(task)
    assert task.error == "RuntimeError"


def test_a_cancelled_operation_is_still_a_cancel_not_a_failure():
    class CancelledOperation(Exception):
        pass

    def worker(task):
        raise CancelledOperation()

    task = create_task()
    run_in_thread(task, worker)
    _wait(task)
    assert task.status == "cancelled" and task.error == ""


# ── the polling route and the socket ─────────────────────────────────────────


def test_get_task_state_route():
    from mapper.main import app

    task = create_task()
    task.status = "running"
    task.update("downloading", 0.1, "Downloading…")
    with TestClient(app) as client:
        running = client.get(f"/api/tasks/{task.task_id}")
        task.fail("no network")
        failed = client.get(f"/api/tasks/{task.task_id}")
        unknown = client.get("/api/tasks/does-not-exist")

    assert running.status_code == 200
    assert running.json() == {"task_id": task.task_id, "status": "running", "step": "downloading",
                              "progress": 0.1, "message": "Downloading…"}
    assert failed.json()["status"] == "error" and failed.json()["error"] == "no network"
    assert failed.json()["message"] == "Downloading…"
    assert unknown.status_code == 404


def test_the_progress_socket_sends_the_error_text():
    from mapper.main import app

    task = create_task()
    task.status = "running"
    task.update("writing", 0.9, "Writing database…")
    with TestClient(app) as client:
        with client.websocket_connect(f"/api/ws/import/{task.task_id}") as ws:
            assert ws.receive_json() == {"step": "writing", "progress": 0.9, "message": "Writing database…"}
            task.fail("sqlite is locked")
            last = ws.receive_json()
    assert last["step"] == "error" and last["error"] == "sqlite is locked"
    assert last["message"] == "Writing database…"


# ── the credentials import ───────────────────────────────────────────────────


@pytest.fixture()
def bw_project():
    projects = bw2data.projects
    original = projects.current
    temp_dir = projects._use_temp_directory()
    try:
        projects.set_current(f"pytest-taskfb-{uuid.uuid4().hex[:8]}")
        yield projects
    finally:
        projects._restore_orig_directory()
        projects.set_current(original, update=False)
        gc.collect()
        shutil.rmtree(temp_dir, ignore_errors=True)


class _FakeRelease:
    """Stands in for ecoinvent_interface.EcoinventRelease: no network, no credentials."""

    path = None
    delay = 0.0

    def __init__(self, settings):
        pass

    def login(self):
        pass

    def get_release(self, **kw):
        time.sleep(self.delay)
        return _FakeRelease.path


@pytest.fixture()
def credentials_import(monkeypatch, tmp_path, bw_project):
    """The credentials worker on a synthetic release, every slow step slowed down a little."""
    import bw2io

    release = write_release(tmp_path / "release")
    _FakeRelease.path, _FakeRelease.delay = release.parent, 0.25
    monkeypatch.setattr(ei_api.ei, "Settings", lambda **kw: object())
    monkeypatch.setattr(ei_api.ei, "EcoinventRelease", _FakeRelease)
    monkeypatch.setattr(ei_api, "HEARTBEAT_SECONDS", 0.05)

    calls: dict = {}
    real = bw2io.SingleOutputEcospold2Importer

    class Spy(real):
        def __init__(self, *a, **kw):
            calls["kwargs"] = kw
            time.sleep(0.25)
            super().__init__(*a, **kw)

    monkeypatch.setattr(bw2io, "SingleOutputEcospold2Importer", Spy)
    return calls


def _run_credentials(task=None):
    task = task or Task(task_id="t")
    seen = _frames(task)
    result = ei_api._import_worker(task, "user", "not-a-real-password", "fixture", "cutoff")
    return task, seen, result


def test_the_credentials_worker_does_not_use_a_multiprocessing_pool(credentials_import):
    _run_credentials()
    assert credentials_import["kwargs"].get("use_mp") is False


def test_the_credentials_worker_sends_a_heartbeat_with_elapsed_time(credentials_import):
    _, seen, result = _run_credentials()
    assert result["exchanges_found"] == 7  # the import itself still ran to the end

    def beats(step):
        return [p for p in seen if p["step"] == step and "s elapsed)" in p["message"]]

    assert len(beats("downloading")) >= 2, "no heartbeat during the download/extract"
    assert len(beats("importing")) >= 2, "no heartbeat while the importer reads the .spold files"
    # progress does not move during a heartbeat, only the message does
    assert {p["progress"] for p in beats("importing")} == {0.45}


def test_every_stage_reports_a_message(credentials_import):
    _, seen, _ = _run_credentials()
    steps = []
    for p in seen:
        if p["step"] not in steps:
            steps.append(p["step"])
    assert steps == ["connecting", "downloading", "biosphere", "importing", "strategies", "matching", "writing", "done"]
    assert all(p["message"] for p in seen), "a stage sent an empty message"
    assert "3 .spold files" in next(p["message"] for p in seen if p["step"] == "importing")


def test_a_step_with_no_progress_for_minutes_is_warned_about_not_killed(credentials_import, monkeypatch, caplog):
    monkeypatch.setattr(ei_api, "STALL_WARNING_SECONDS", 0.1)
    with caplog.at_level(logging.WARNING, logger="mapper.api.ecoinvent"):
        _, seen, result = _run_credentials()

    warned = [p for p in seen if "no progress for" in p["message"]]
    assert warned and "still running" in warned[0]["message"]
    assert warned[0]["step"] in ("downloading", "importing")
    assert len([r for r in caplog.records if "no progress" in r.getMessage()]) >= 1
    assert result["exchanges_found"] == 7, "the work was interrupted instead of left to finish"


def test_a_failing_import_reaches_the_task_as_an_error(credentials_import, monkeypatch):
    def boom(self, **kw):
        raise RuntimeError("401 Unauthorized: wrong ecoinvent password")

    monkeypatch.setattr(_FakeRelease, "get_release", boom)
    task = create_task()
    run_in_thread(task, ei_api._import_worker, "u", "p", "fixture", "cutoff")
    _wait(task)
    assert task.status == "error" and "401 Unauthorized" in task.current_payload()["error"]
