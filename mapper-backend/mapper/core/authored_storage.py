# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""The authored-database definition file, stored INSIDE the existing dsm root.

``dsm/{project}/authored_databases.json`` -- the same placement as
``project_settings.json`` and for the same reason: duplicate, rename, export
(including modelling-only) and import are whole-tree operations on
``root/{safe_project}``, so this file travels with the project with **zero
changes to project_storage.py**, and an older build cannot drop it from an
archive the way it would drop an unknown root.

The Brightway database is a materialisation of this file, never the other way
round. That is what lets an authored database survive a modelling-only export:
the bw2 payload is not carried, but this file is, and the recipient rebuilds.

Two deliberate differences from ``project_settings_storage``:

* A CORRUPT file raises rather than reading as empty. Reading it as "no
  authored databases" and then saving after the next edit would silently
  delete every authored activity. Absent is empty; unreadable is an error.
* Writes are atomic (temp file + ``os.replace``) so a crash mid-write leaves
  the previous definition, not a truncated one.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from mapper.models.authored_schemas import AuthoredDefinitions

DEFINITIONS_FILENAME = "authored_databases.json"


class AuthoredStorageError(RuntimeError):
    """The definition file exists but cannot be read as a valid definition."""


def _project_dir(project: str) -> Path:
    # Resolved at call time so a test redirecting dsm_storage.STORAGE_DIR is
    # honoured -- the same reason project_settings_storage does it.
    from mapper.core import dsm_storage

    return Path(dsm_storage.STORAGE_DIR) / dsm_storage._safe_project(project)


def definitions_path(project: str) -> Path:
    return _project_dir(project) / DEFINITIONS_FILENAME


def load_definitions(project: str) -> AuthoredDefinitions:
    """The project's definitions. A missing file is an empty definition."""
    f = definitions_path(project)
    if not f.exists():
        return AuthoredDefinitions()
    try:
        return AuthoredDefinitions(**json.loads(f.read_text(encoding="utf-8")))
    except Exception as exc:  # malformed JSON or a failed validation
        raise AuthoredStorageError(
            f"The authored-database definition file for project {project!r} "
            f"could not be read ({f}): {exc}. It has been left untouched; fix or "
            "restore it before editing authored databases, because saving over it "
            "would discard every authored activity it holds."
        ) from exc


def save_definitions(project: str, defs: AuthoredDefinitions) -> None:
    d = _project_dir(project)
    d.mkdir(parents=True, exist_ok=True)
    target = definitions_path(project)
    tmp = target.with_suffix(target.suffix + ".tmp")
    tmp.write_text(defs.model_dump_json(indent=2), encoding="utf-8")
    os.replace(tmp, target)


def authored_names(project: str) -> list[str]:
    """Database names this project defines. Empty if the file is unreadable.

    Used only for CLASSIFICATION (export manifest, excluding authored databases
    from the ecoinvent statistics). A reader that needs the definitions
    themselves must call ``load_definitions`` and let the error surface.
    """
    try:
        return sorted(d.name for d in load_definitions(project).databases)
    except AuthoredStorageError:
        return []
