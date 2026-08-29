# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Per-project material pedigree library, stored INSIDE the existing dsm root.

``dsm/{project}/material_pedigree.json`` — a FILE in a root that already
exists, not a sixth storage root, for the reasons spelled out in
``project_settings_storage``: all three carry paths are whole-tree operations
on ``root/{safe_project}``, so a new file is carried by duplicate, rename,
export and import with zero changes to ``project_storage.py``, whereas a new
root would need a ``storage_roots()`` entry and an archive label — and an
archive written by this build would be silently DROPPED by an older one.

``dsm_storage._load_project`` skips non-directories, so this file is invisible
to the existing loader.
"""
from __future__ import annotations

import json
from pathlib import Path

from mapper.models.bom_schemas import MaterialPedigreeLibrary

LIBRARY_FILENAME = "material_pedigree.json"


def _project_dir(project: str) -> Path:
    # Imported at call time so a test monkeypatching dsm_storage.STORAGE_DIR is
    # honoured here too.
    from mapper.core import dsm_storage

    return Path(dsm_storage.STORAGE_DIR) / dsm_storage._safe_project(project)


def library_path(project: str) -> Path:
    return _project_dir(project) / LIBRARY_FILENAME


def load_library(project: str) -> MaterialPedigreeLibrary:
    """The project's library, or an EMPTY one.

    Empty rather than ``None``: a project that has never scored anything and a
    project whose file is missing are the same state, and every caller wants to
    look names up either way. An empty library scores nothing, so every row
    stays unscored and contributes no foreground variance.
    """
    f = library_path(project)
    if not f.exists():
        return MaterialPedigreeLibrary()
    try:
        return MaterialPedigreeLibrary(**json.loads(f.read_text(encoding="utf-8")))
    except Exception:
        # A corrupt file must not take the project down. Unscored is the safe
        # reading: it changes no number.
        return MaterialPedigreeLibrary()


def save_library(project: str, library: MaterialPedigreeLibrary) -> None:
    d = _project_dir(project)
    d.mkdir(parents=True, exist_ok=True)
    (d / LIBRARY_FILENAME).write_text(
        library.model_dump_json(indent=2), encoding="utf-8"
    )
