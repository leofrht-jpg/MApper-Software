# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Per-project settings, stored INSIDE the existing dsm root.

``dsm/{project}/project_settings.json`` -- deliberately a file inside a root
that already exists, not a sixth storage root. All three carry paths are
whole-tree operations on ``root/{safe_project}``
(``copy_project_storage`` -> ``shutil.copytree``, ``write_archive_storage`` ->
``tf.add`` recursive, ``install_archive_storage`` -> ``_copy_tree``), so a new
FILE there is carried by duplicate, rename, export and import, and removed by
delete, with **zero changes to project_storage.py**.

A new root would be the opposite: ``storage_roots()`` would need a sixth entry,
the archive manifest a new label, and -- the real hazard -- an archive written
by this build would be silently dropped by an older one, because
``install_archive_storage`` does ``root = roots.get(label); if root is None:
continue``.

Safe against the existing loader: ``dsm_storage._load_project`` iterates
``project_dir.iterdir()`` and skips non-directories, so this file is invisible
to it.
"""
from __future__ import annotations

import json
from pathlib import Path

from mapper.models.project_settings import ProjectSettings

SETTINGS_FILENAME = "project_settings.json"


def _project_dir(project: str) -> Path:
    # Imported at call time so a test monkeypatching dsm_storage.STORAGE_DIR is
    # honoured here too -- the same reason storage_roots() resolves lazily.
    from mapper.core import dsm_storage

    return Path(dsm_storage.STORAGE_DIR) / dsm_storage._safe_project(project)


def settings_path(project: str) -> Path:
    return _project_dir(project) / SETTINGS_FILENAME


def load_settings(project: str) -> ProjectSettings | None:
    """Return the stored settings, or ``None`` when the project has none.

    ``None`` is meaningful: it distinguishes a project that predates this
    feature (which must keep computing exactly as it did) from one that has
    explicitly chosen. See ``resolve_settings``.
    """
    f = settings_path(project)
    if not f.exists():
        return None
    try:
        return ProjectSettings(**json.loads(f.read_text(encoding="utf-8")))
    except Exception:
        return None


def save_settings(project: str, settings: ProjectSettings) -> None:
    d = _project_dir(project)
    d.mkdir(parents=True, exist_ok=True)
    settings_path(project).write_text(
        settings.model_dump_json(indent=2), encoding="utf-8")


def load_all() -> dict[str, ProjectSettings]:
    """``{project -> settings}`` for every project that has a file."""
    from mapper.core import dsm_storage

    root = Path(dsm_storage.STORAGE_DIR)
    out: dict[str, ProjectSettings] = {}
    if not root.exists():
        return out
    for proj_dir in root.iterdir():
        if not proj_dir.is_dir():
            continue
        s = load_settings(proj_dir.name)
        if s is not None:
            out[proj_dir.name] = s
    return out
