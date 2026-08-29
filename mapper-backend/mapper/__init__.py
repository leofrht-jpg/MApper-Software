# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati


def _detect_version() -> str:
    """Single source of truth for the backend version: pyproject.toml.

    Resolution order so the same value is served everywhere:
    1. installed package metadata (if ``mapper-backend`` is ever pip-installed);
    2. ``pyproject.toml`` on disk — from source (dev/tests, next to the package)
       or bundled next to the frozen sidecar (``sys._MEIPASS``, see the .spec);
    3. a literal fallback, kept in sync as a last resort.

    No hardcoded version string is served in a normal run — bump
    ``pyproject.toml`` and it propagates (the frontend does the same via
    ``package.json``).
    """
    try:
        from importlib.metadata import PackageNotFoundError, version

        try:
            return version("mapper-backend")
        except PackageNotFoundError:
            pass
    except Exception:
        pass

    try:
        import sys
        import tomllib
        from pathlib import Path

        candidates = [Path(__file__).resolve().parent.parent]  # dev: mapper-backend/
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            candidates.append(Path(meipass))  # frozen: bundled alongside the sidecar
        for base in candidates:
            pp = base / "pyproject.toml"
            if pp.is_file():
                with pp.open("rb") as f:
                    return str(tomllib.load(f)["project"]["version"])
    except Exception:
        pass

    return "0.2.0"


__version__ = _detect_version()
