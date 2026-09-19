# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Bare `pytest` must import `mapper`, not only `python -m pytest`.

The backend is not pip-installed. Before `pythonpath = ["."]` in
pyproject.toml, `import mapper` resolved only because `python -m` puts the
working directory on sys.path; bare `pytest` failed every file at collection
(127 ImportErrors), which reads as a broken branch rather than an invocation
detail.

This reproduces the bare condition: a fresh interpreter started OUTSIDE the
backend, so neither the cwd nor `-m` puts it on sys.path, running pytest on a
test file that imports `mapper`.
"""
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]


def test_pytest_collects_from_outside_the_backend(tmp_path):
    target = BACKEND / "tests" / "test_version_single_source.py"
    code = ("import sys, pytest; "
            f"sys.exit(pytest.main([{str(target)!r}, '-q', '-p', 'no:cacheprovider']))")
    r = subprocess.run([sys.executable, "-c", code], cwd=tmp_path,
                       capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stdout[-2000:] + r.stderr[-2000:]
    assert "ModuleNotFoundError" not in r.stdout
