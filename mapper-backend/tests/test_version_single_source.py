# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Backend version is single-sourced from pyproject.toml.

`mapper.__version__` must equal pyproject's version — no stale literal (it was
"0.1.0" in __init__.py and "1.0" hardcoded in the Excel export). Bumping
pyproject propagates everywhere the version is served.
"""
import tomllib
from pathlib import Path

import mapper


def _pyproject_version() -> str:
    pp = Path(mapper.__file__).resolve().parent.parent / "pyproject.toml"
    with pp.open("rb") as f:
        return tomllib.load(f)["project"]["version"]


def test_version_matches_pyproject():
    assert mapper.__version__ == _pyproject_version()


def test_version_is_not_a_stale_literal():
    assert mapper.__version__ not in ("0.1.0", "1.0", "0.1.0-alpha")


def test_export_summary_uses_the_detected_version():
    # The Excel export "MApper version" cell must read mapper.__version__, not
    # the old hardcoded "1.0".
    import inspect

    from mapper.api import bom

    src = inspect.getsource(bom)
    assert '("MApper version", "1.0")' not in src
    assert "__version__ as _mapper_version" in src
