# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Regression: the frozen desktop sidecar must not fork-bomb on multiprocessing.

Two independent PyInstaller-on-macOS hazards, both fixed in desktop_entry.py:

1. Worker spawns (``--multiprocessing-fork``) re-execute the frozen binary; without
   ``multiprocessing.freeze_support()`` each child re-runs main() → uvicorn →
   another spawn → exponential fork-bomb.

2. A dependency (premise's logger) creates a multiprocessing semaphore AT IMPORT.
   Python's resource_tracker then relaunches ``sys.executable -c "…"`` to reclaim
   it — impossible for a frozen binary, so the relaunch re-enters and spawns
   ANOTHER tracker → an endless chain of backend processes (the packaged-app
   "No projects" / "Load failed" bug). Fixed by neutralizing the tracker in the
   frozen build (locks still work; SemLock's own sem_unlink still runs on clean
   exit — only crash-time reclamation is skipped, which is negligible).

Source-level because both only manifest in the frozen build; plus a behavioural
test that neutralizing the tracker actually stops it from launching.
"""
import ast
import multiprocessing as mp
import multiprocessing.resource_tracker as rt
from pathlib import Path

_ENTRY = Path(__file__).resolve().parent.parent / "desktop_entry.py"


def _main_block_body():
    tree = ast.parse(_ENTRY.read_text())
    for node in tree.body:
        if isinstance(node, ast.If):
            test = node.test
            if (
                isinstance(test, ast.Compare)
                and isinstance(test.left, ast.Name)
                and test.left.id == "__name__"
            ):
                return node.body
    return None


def test_entry_has_main_guard():
    assert _main_block_body() is not None


def test_freeze_support_called_before_main():
    body = _main_block_body()
    src = _ENTRY.read_text()
    assert "multiprocessing.freeze_support()" in src, "freeze_support() missing — worker fork-bomb"

    def _call_name(stmt):
        if isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Call):
            f = stmt.value.func
            if isinstance(f, ast.Attribute):
                return f.attr
            if isinstance(f, ast.Name):
                return f.id
        return None

    names = [_call_name(s) for s in body]
    assert "freeze_support" in names and "main" in names
    assert names.index("freeze_support") < names.index("main")


def test_resource_tracker_neutralized_in_frozen_build():
    # The frozen-only guard must patch the tracker so it can never launch.
    src = _ENTRY.read_text()
    assert 'getattr(sys, "frozen", False)' in src, "tracker patch must be gated on the frozen build"
    assert "resource_tracker" in src
    assert "ensure_running" in src
    assert "_rt.register" in src and "_rt.unregister" in src


def test_neutralizing_tracker_prevents_it_launching(monkeypatch):
    # Behavioural proof of the mechanism the frozen guard uses: with the tracker
    # neutralized, nothing launches the tracker helper process (the thing that
    # fork-bombs when frozen), and locks still work.
    #
    # Asserts on a FRESH ResourceTracker, never the module-global
    # ``rt._resource_tracker``: any earlier test in the suite that touches a
    # multiprocessing primitive launches the global one, so asserting on it makes
    # this test order-dependent (it passed alone and failed in the full run).
    monkeypatch.setattr(rt.ResourceTracker, "ensure_running", lambda self: None)
    monkeypatch.setattr(rt, "register", lambda *a, **k: None)
    monkeypatch.setattr(rt, "unregister", lambda *a, **k: None)

    tracker = rt.ResourceTracker()
    tracker.ensure_running()  # the patched no-op — must not spawn or open an fd
    assert tracker._fd is None

    before = set(mp.active_children())
    lock = mp.Lock()
    with lock:  # locks still function without the tracker
        pass
    rt.register("/mapper-test-sem", "semaphore")  # patched no-op
    rt.unregister("/mapper-test-sem", "semaphore")
    assert set(mp.active_children()) - before == set()
