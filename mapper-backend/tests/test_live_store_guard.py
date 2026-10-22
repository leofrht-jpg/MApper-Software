# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""The guards that keep tests out of the real MApper project store.

`GuardlessProbe` DSM systems accumulated in real projects (Battery Circularity,
then EVS40): `test_project_guard_e2e.py` created one per run in whichever bw2
project was current. conftest now has two layers, and each is checked here so
neither can pass vacuously:

  - the per-write guard raises at the write, naming the test -- now also for
    ``open(..., "w")`` and ``os.replace``, which it used to miss;
  - the run-level fingerprint of the real store fails the session on ANY
    change, whatever wrote it (a subprocess server, a missing redirect).

The write-guard cases aim at a directory that does not exist inside the real
store, so if the guard were broken the call would fail with FileNotFoundError
rather than write anything -- the test can never itself pollute the store.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

import conftest as _cf


def _probe_path() -> Path:
    return _cf._live_roots()[0] / "__store_guard_probe_does_not_exist__" / "system.json"


def test_open_for_writing_into_the_live_store_is_refused():
    with pytest.raises(_cf.LiveStoreWriteError):
        open(_probe_path(), "w")  # noqa: SIM115 - the guard must raise first


def test_os_replace_into_the_live_store_is_refused(tmp_path):
    src = tmp_path / "tmp.json"
    src.write_text("{}")
    with pytest.raises(_cf.LiveStoreWriteError):
        os.replace(src, _probe_path())


def test_reading_the_live_store_is_still_allowed():
    # Read-only opens must pass: live_storage tests read real projects.
    with pytest.raises(FileNotFoundError):
        open(_probe_path(), "r")  # noqa: SIM115


def test_the_run_fingerprint_reports_a_new_dsm_system_by_name(tmp_path):
    base = tmp_path / "mapper"
    (base / "dsm" / "EVS40" / "keep").mkdir(parents=True)
    (base / "dsm" / "EVS40" / "keep" / "system.json").write_text(json.dumps({"name": "Fleet"}))
    before = _cf._store_fingerprint(base)

    sysdir = base / "dsm" / "EVS40" / "3f2b8c1e-0000-4000-8000-000000000001"
    sysdir.mkdir()
    (sysdir / "system.json").write_text(json.dumps({"name": "GuardlessProbe"}))
    after = _cf._store_fingerprint(base)

    lines = _cf._store_changes(before, after, base)
    assert len(lines) == 1
    assert "ADDED" in lines[0] and "'GuardlessProbe'" in lines[0]


def test_the_run_fingerprint_reports_rewrites_and_removals(tmp_path):
    base = tmp_path / "mapper"
    (base / "parameters" / "EVS40").mkdir(parents=True)
    f = base / "parameters" / "EVS40" / "table.json"
    f.write_text("{}")
    before = _cf._store_fingerprint(base)
    f.write_text('{"changed": true}')
    os.utime(f, ns=(before[f.relative_to(base).as_posix()][1] + 10**9,) * 2)
    rewritten = _cf._store_changes(before, _cf._store_fingerprint(base), base)
    assert any("REWRITTEN" in ln for ln in rewritten)
    f.unlink()
    removed = _cf._store_changes(before, _cf._store_fingerprint(base), base)
    assert any("REMOVED" in ln for ln in removed)


def test_the_fingerprint_ignores_files_outside_the_project_roots(tmp_path):
    # premise's `workspace` scratch dir is not project data.
    base = tmp_path / "mapper"
    (base / "workspace").mkdir(parents=True)
    before = _cf._store_fingerprint(base)
    (base / "workspace" / "scratch.bin").write_bytes(b"x")
    assert _cf._store_changes(before, _cf._store_fingerprint(base), base) == []
