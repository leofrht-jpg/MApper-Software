# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Project-level conventions: read, write, and the in-memory registry.

The registry follows ``parameters._tables`` exactly, INCLUDING its lesson: it
is reloaded by ``_rehydrate_after_storage_write`` and pruned by
``_prune_registries``, because ``hydrate_from_disk`` merges and never prunes.
Without that a duplicated or renamed project's setting is invisible until a
restart, which is the sixth appearance of that class in this codebase.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from mapper.core import project_settings_storage as storage
from mapper.models.project_settings import (
    LEGACY_DEFAULT,
    NEW_PROJECT_DEFAULT,
    ProjectSettings,
)

router = APIRouter()

# ``{project -> ProjectSettings}``. Absent means the project has no stored
# settings, which is NOT the same as having the defaults -- see resolve().
_settings: dict[str, ProjectSettings] = {}


def install_project_settings(data: dict[str, ProjectSettings]) -> None:
    """Replace the registry (startup, and after any storage write)."""
    _settings.clear()
    _settings.update(data)


def _current_project() -> str:
    from mapper.api.bom import _current_project as cp

    return cp()


def resolve(project: str | None = None) -> ProjectSettings:
    """Settings for ``project``, with the legacy default when it has none.

    An EXISTING project with no file predates the feature and must keep
    computing exactly as it did, so it resolves to ``one_year``. A project
    created after this feature gets ``life_cycle`` written explicitly at
    creation time -- the difference is a stored file, not a guess here.
    """
    p = project or _current_project()
    stored = _settings.get(p)
    if stored is not None:
        return stored
    return ProjectSettings(use_phase_basis=LEGACY_DEFAULT)


def initialise_for_new_project(project: str) -> ProjectSettings:
    """Write the new-project default. Called when a project is created."""
    s = ProjectSettings(use_phase_basis=NEW_PROJECT_DEFAULT)
    storage.save_settings(project, s)
    _settings[project] = s
    return s


@router.get("/project-settings", response_model=ProjectSettings)
async def get_project_settings() -> ProjectSettings:
    return resolve()


@router.put("/project-settings", response_model=ProjectSettings)
async def put_project_settings(body: ProjectSettings) -> ProjectSettings:
    project = _current_project()
    try:
        storage.save_settings(project, body)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    _settings[project] = body
    return body
