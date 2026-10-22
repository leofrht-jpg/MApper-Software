# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""The suite must not write the user's real log or real Brightway projects.

Both happened: ~2,400 test lines (fake requests, planted "a real error"
lines) in ~/Library/Logs/mapper/mapper.log, and an empty ``guard-db`` in three
real projects. The guards live in ``conftest.py``; these tests pin that they
are installed and that they fire. Nothing here touches real data: the log
guard raises BEFORE a file is opened, and the Brightway check is exercised on
synthetic registries.
"""
from __future__ import annotations

import logging
import logging.handlers
import os
from pathlib import Path

import platformdirs
import pytest

import conftest


def test_the_app_logs_into_the_test_directory():
    from mapper.core import log_config

    assert os.environ["MAPPER_LOG_DIR"] == str(conftest._TEST_LOG_DIR)
    assert log_config.LOG_DIR == conftest._TEST_LOG_DIR
    real = Path(platformdirs.user_log_dir("mapper")).resolve()
    assert real not in log_config.LOG_FILE.resolve().parents


def test_the_system_route_reads_the_test_log_not_the_real_one():
    # api/system.py binds LOG_FILE by value at import: proof the redirect was in
    # place before the first `import mapper`.
    from mapper.api import system

    assert Path(system.LOG_FILE).parent == conftest._TEST_LOG_DIR


def test_a_handler_on_the_real_log_is_refused_before_it_opens():
    real_log = Path(platformdirs.user_log_dir("mapper")) / "mapper.log"
    size = real_log.stat().st_size if real_log.exists() else None
    with pytest.raises(conftest.RealLogWriteError):
        logging.FileHandler(real_log)
    with pytest.raises(conftest.RealLogWriteError):
        logging.handlers.RotatingFileHandler(real_log)
    after = real_log.stat().st_size if real_log.exists() else None
    assert size == after or size is None


def test_a_handler_elsewhere_still_works(tmp_path):
    h = logging.FileHandler(tmp_path / "x.log")
    h.close()


def _reg(dbs: dict[str, str], methods: int = 10) -> dict:
    return {"databases": dbs, "methods": methods}


def test_the_bw2_check_names_an_added_database():
    before = {"default.abc": _reg({"biosphere3": "t0"})}
    after = {"default.abc": _reg({"biosphere3": "t0", "guard-db": "t1"})}
    assert conftest._bw2_changes(before, after) == ["  default.abc: database ADDED 'guard-db'"]


def test_the_bw2_check_sees_rewrites_removals_methods_and_new_projects():
    before = {"P.1": _reg({"a": "t0", "b": "t0"}, 5)}
    after = {
        "P.1": _reg({"a": "t9"}, 6),
        "tmp-project.2": _reg({}),
    }
    got = conftest._bw2_changes(before, after)
    assert "  P.1: database REWRITTEN 'a'" in got
    assert "  P.1: database REMOVED 'b'" in got
    assert "  P.1: LCIA methods 5 -> 6" in got
    assert "  tmp-project.2: new project directory left behind" in got


def test_an_unchanged_registry_is_silent():
    reg = {"P.1": _reg({"a": "t0"})}
    assert conftest._bw2_changes(reg, dict(reg)) == []


def test_the_bw2_check_runs_at_session_end():
    assert callable(getattr(conftest, "pytest_sessionfinish", None))
    # A snapshot was taken at import (empty only when BRIGHTWAY2_DIR points at
    # a scratch directory, as in CI).
    if not os.environ.get("BRIGHTWAY2_DIR"):
        assert conftest._BW2_AT_START, "no real Brightway projects were snapshotted"
