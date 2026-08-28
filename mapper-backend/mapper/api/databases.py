# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

import bw2data
import logging

from mapper.core import project_storage
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import Response

from mapper.core.bw2_wrapper import (
    create_project,
    delete_project,
    duplicate_project,
    export_project,
    get_current_project,
    import_project,
    list_databases,
    list_projects,
    rename_project,
    switch_project,
)
from mapper.models.schemas import (
    CreateProjectRequest,
    DatabaseResponse,
    DeleteProjectResponse,
    DuplicateProjectRequest,
    ExportProjectRequest,
    HealthResponse,
    ProjectResponse,
    RenameProjectRequest,
    SwitchProjectRequest,
)

logger = logging.getLogger("mapper.api.databases")

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    try:
        current = get_current_project()
    except Exception:
        current = "(none)"
    return HealthResponse(
        status="ok",
        brightway2_version=".".join(str(v) for v in bw2data.__version__),
        current_project=current,
    )


@router.get("/projects", response_model=list[ProjectResponse])
async def get_projects() -> list[ProjectResponse]:
    return [ProjectResponse(**p) for p in list_projects()]


def _rehydrate_after_storage_write() -> None:
    """Make storage written for a NEW project visible without a restart.

    ``duplicate_project`` and ``import_project`` now write MApper's own
    per-project storage (DSM systems, archetypes, cohort mappings, AESA
    configurations, parameter tables, the pLCA registry). Those files land on
    disk under a project key this process has never loaded, and
    ``hydrate_from_disk()`` otherwise runs only from the FastAPI startup hook,
    so the copy stayed invisible until the app restarted -- the copy looked
    like it had silently failed.

    This is the same defect ``POST /demo/load`` had, and the same fix. The rule
    it enforces: ANY route that writes MApper storage for a project the process
    has not already loaded must rehydrate before returning. Route-level
    visibility assertions in ``test_project_copy_roundtrip.py`` hold both
    routes to it, so the rule is enforced rather than remembered -- the earlier
    sweep concluded these routes had "no gap", which was true until they
    started writing storage.

    Safe mid-session on the two counts measured when demo/load adopted it:
    ~40-100 ms against a real store, and it merges with ``.update()`` over
    registries every writer persists eagerly, so it installs identical content
    rather than rolling anything back.
    """
    from mapper.api import dsm as _dsm
    from mapper.api import parameters as _parameters
    from mapper.core import parameter_storage

    _dsm.hydrate_from_disk()
    # `hydrate_from_disk` covers the DSM/BOM/subsystem registries but NOT the
    # parameter table, which main.py hydrates separately at startup. Without
    # this second call a copied project's parameter table stays on disk and
    # invisible, because `parameters._table_for` does
    # `_tables.setdefault(project, ParameterTable())` -- it does not read the
    # file, it inserts an EMPTY table, and the next parameter write persists
    # that empty table over the real one. `install_parameters` clears before
    # it updates, so this is a full reload: it both adds keys and drops stale
    # ones, which is what a rename needs.
    _parameters.install_parameters(parameter_storage.load_all())
    # Same class again: project settings live in a per-project registry, so a
    # duplicated or renamed project's setting is invisible until restart unless
    # this reloads it. `install_project_settings` clears before it updates, so
    # it both adds keys and drops stale ones.
    from mapper.api import project_settings as _project_settings
    from mapper.core import project_settings_storage as _ps_storage
    _project_settings.install_project_settings(_ps_storage.load_all())


@router.post("/projects/switch", response_model=ProjectResponse)
async def post_switch_project(body: SwitchProjectRequest) -> ProjectResponse:
    try:
        switch_project(body.name)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return ProjectResponse(name=body.name, is_current=True)


@router.post("/projects/create", response_model=ProjectResponse)
async def post_create_project(body: CreateProjectRequest) -> ProjectResponse:
    try:
        name = create_project(body.name)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    # A NEW project gets "life_cycle" written explicitly. Existing projects have
    # no file and resolve to the legacy "one_year", so the difference between
    # them is a stored fact rather than a guess at read time.
    from mapper.api import project_settings as _project_settings
    _project_settings.initialise_for_new_project(name)
    return ProjectResponse(name=name, is_current=True)


@router.post("/projects/duplicate", response_model=ProjectResponse)
async def post_duplicate_project(body: DuplicateProjectRequest) -> ProjectResponse:
    try:
        name = duplicate_project(body.source_name, body.new_name)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    _rehydrate_after_storage_write()
    return ProjectResponse(name=name, is_current=True)


def _prune_registries(project: str) -> None:
    """Drop every in-memory entry keyed by ``project``.

    The counterpart to ``_rehydrate_after_storage_write``. ``hydrate_from_disk``
    merges with ``.update()`` and never prunes, so a project whose storage has
    been MOVED stays in the registries under its old key until a restart. For a
    duplicate or an import that is harmless -- nothing was removed. For a rename
    it is the whole defect: the old name would keep answering with live data,
    and a rename that silently leaves the old project working is worse than one
    that fails.

    Verified rather than assumed: ``test_project_rename.py`` asserts the old key
    is gone from each registry immediately after the route returns, and that a
    bare ``hydrate_from_disk()`` does NOT achieve it.

    ``parameters._tables`` is deliberately absent here -- the rehydrate reloads
    it with a clear-then-update, which prunes it as a side effect.
    """
    from mapper.api import bom as _bom
    from mapper.api import dsm as _dsm
    from mapper.api import subsystems as _subs

    registries = (
        _bom._archetypes,
        _bom._cohort_mappings,
        _bom._dsm_lca_results,
        _dsm._systems,
        _dsm._states,
        _dsm._results,
        _dsm._multi_results,
        _subs._subsystems,
        _subs._subsystem_results,
    )
    for reg in registries:
        reg.pop(project, None)

    # Project settings too -- the rehydrate above reloads with a clear, which
    # prunes it, but doing it here keeps the prune complete on its own terms.
    from mapper.api import project_settings as _project_settings
    _project_settings._settings.pop(project, None)


@router.post("/projects/rename", response_model=ProjectResponse)
async def post_rename_project(body: RenameProjectRequest) -> ProjectResponse:
    try:
        name = rename_project(body.name, body.new_name)
    except project_storage.ProjectStorageCollision as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    # Order matters: prune the OLD key first, then reload, or the reload's
    # merge would just sit alongside the stale entries.
    _prune_registries(body.name)
    _rehydrate_after_storage_write()
    return ProjectResponse(name=name, is_current=True)


@router.delete("/projects/{name}", response_model=DeleteProjectResponse)
async def delete_project_endpoint(name: str) -> DeleteProjectResponse:
    # Which projects will still exist afterwards. Captured BEFORE the delete so
    # the storage guard can tell whether a survivor shares this project's
    # storage directory (`My/Project` and `My_Project` sanitise to one).
    try:
        import bw2data

        survivors = [p.name for p in bw2data.projects if p.name != name]
    except Exception:
        survivors = []

    try:
        current = delete_project(name)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    # The mirror of the copy gap: bw2 drops its project directory and MApper's
    # storage was left orphaned on disk, where a later project whose name
    # sanitised the same way would silently adopt it. Refuses rather than
    # deleting when a surviving project shares the directory.
    try:
        project_storage.delete_project_storage(name, survivors)
    except project_storage.ProjectStorageCollision as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception:
        # The bw2 project is already gone; a storage-cleanup failure must not
        # turn a completed delete into an error the caller can act on.
        logger.exception("project delete: storage cleanup failed for %r", name)

    # Same reason as the rename: the storage is gone but the registries still
    # hold the deleted project's key, and nothing prunes them. Harmless while
    # the bw2 project is also gone -- no route can reach it -- but it leaves a
    # deleted project's systems resident, and it becomes live data the moment a
    # new project is created under the same name.
    _prune_registries(name)
    _rehydrate_after_storage_write()
    return DeleteProjectResponse(deleted=True, current_project=current)


@router.post("/projects/export")
async def post_export_project(body: ExportProjectRequest) -> Response:
    try:
        data = export_project(body.name)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    safe = "".join(c if c.isalnum() or c in "._-" else "_" for c in body.name) or "project"
    return Response(
        content=data,
        media_type="application/gzip",
        headers={"Content-Disposition": f'attachment; filename="{safe}.mapperproj.tar.gz"'},
    )


@router.post("/projects/import", response_model=ProjectResponse)
async def post_import_project(file: UploadFile = File(...)) -> ProjectResponse:
    data = await file.read()
    try:
        name = import_project(data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    _rehydrate_after_storage_write()
    return ProjectResponse(name=name, is_current=True)


@router.get("/databases", response_model=list[DatabaseResponse])
async def get_databases() -> list[DatabaseResponse]:
    return [DatabaseResponse(**db) for db in list_databases()]
