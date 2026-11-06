# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Authored databases: routes.

Every mutation follows one order: load the definition, apply the change to a
copy, validate, WRITE BRIGHTWAY, then save the definition. If the Brightway
write fails nothing is saved, so the definition file never describes a
database that was not written. ``Database.write()`` replaces the whole
database, so every edit rewrites it from the definition.

Deleting a database or an activity that any archetype links to is refused
and the links are named: a dangling link would make every run of that
archetype refuse to compute, far from the action that caused it.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel

from mapper.api.cohort_export import excel_response_from_bytes
from mapper.api.heavy import run_heavy
from mapper.api.project_guard import verify_project_state
from mapper.core import authored_excel as xl
from mapper.core import authored_engine as eng
from mapper.core import authored_storage as store
from mapper.core.method_labels import display_method
from mapper.core.bw2_wrapper import get_current_project
from mapper.models.authored_schemas import (
    ActivityInput,
    AuthoredActivity,
    AuthoredDatabase,
    AuthoredDatabaseView,
    DatabaseCreate,
    ExchangeInput,
    ExchangePreview,
    MaterialisationStatus,
    ReachedIndicator,
    ReachedIndicatorsRequest,
    ReachedIndicatorsResponse,
)

router = APIRouter(prefix="/authored-databases", tags=["authored-databases"])


def get_backend(project: str) -> eng.Backend:
    """Overridden in tests. Real use: Brightway for the current project."""
    return eng.Bw2Backend(authored=store.authored_names(project))


def _project() -> str:
    return get_current_project()


def _load(project: str):
    try:
        return store.load_definitions(project)
    except store.AuthoredStorageError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


def _db_or_404(defs, name: str) -> AuthoredDatabase:
    db = defs.get(name)
    if db is None:
        raise HTTPException(status_code=404, detail=f"No authored database named {name!r}")
    return db


def _invalid(err: eng.AuthoredError) -> HTTPException:
    return HTTPException(status_code=422, detail={
        "error": "authored_validation_failed",
        "message": "The authored activity could not be written.",
        "problems": err.problems,
        "codes": err.codes,
    })


def _archetypes(project: str) -> dict:
    from mapper.api import bom

    return bom._proj_archetypes(project)


def _commit(project: str, defs, db: AuthoredDatabase, backend: eng.Backend) -> None:
    """Brightway first, then the definition file."""
    try:
        eng.materialize(db, backend)
    except eng.AuthoredError as err:
        raise _invalid(err) from err
    store.save_definitions(project, defs)


# ── Excel: template, validate, import, export ────────────────────────────────
#
# The workbook hands the SAME inputs to the SAME engine (`core/authored_excel.py`): nothing is
# written around `build_activity` / `materialize`. The import is all or nothing, and an existing
# database name is refused (there is no replace path in the engine, and none is invented here).


class ExcelErrorItem(BaseModel):
    sheet: str
    row: int | None = None
    column: str | None = None
    code: str
    message: str


class ExcelValidateResponse(BaseModel):
    ok: bool
    errors: list[ExcelErrorItem]
    warnings: list[str]
    preview: dict


class ExcelImportResponse(BaseModel):
    database: AuthoredDatabase
    preview: dict
    warnings: list[str]


async def _read_upload(file: UploadFile) -> bytes:
    data = await file.read(xl.MAX_BYTES + 1)
    if len(data) > xl.MAX_BYTES:
        raise HTTPException(status_code=413, detail={
            "error": "authored_excel_rejected",
            "message": f"The file is larger than the {xl.MAX_BYTES // (1024 * 1024)} MB limit.",
        })
    return data


def _rejected(exc: xl.WorkbookRejected) -> HTTPException:
    return HTTPException(status_code=exc.status, detail={"error": "authored_excel_rejected", "message": str(exc)})


def _plan_sync(project: str, data: bytes, name: str | None):
    defs = _load(project)
    try:
        plan = xl.validate_workbook(data, get_backend(project), defs, name_override=name)
    except xl.WorkbookRejected as exc:
        raise _rejected(exc) from exc
    return defs, plan


def _import_sync(project: str, data: bytes, name: str | None) -> ExcelImportResponse:
    """Re-validate the uploaded file (never trusting an earlier dry run), then write through the
    engine in the same order the create route uses: Brightway first, then the definition."""
    defs, plan = _plan_sync(project, data, name)
    if not plan.ok:
        raise HTTPException(status_code=422, detail={
            "error": "authored_excel_invalid",
            "message": f"The workbook has {len(plan.errors)} error(s), so nothing was imported.",
            "errors": [e.as_dict() for e in plan.errors],
            "warnings": plan.warnings,
        })
    assert plan.database is not None
    defs.databases.append(plan.database)
    _commit(project, defs, plan.database, get_backend(project))
    return ExcelImportResponse(database=plan.database, preview=plan.preview, warnings=plan.warnings)


@router.get("/excel/template")
async def download_excel_template():
    data = xl.workbook_bytes(xl.build_template())
    return excel_response_from_bytes(data, "mapper_authored_database_template.xlsx", kind="round_trip")


@router.post("/excel/validate", response_model=ExcelValidateResponse)
async def validate_excel(file: UploadFile = File(...), name: str | None = Query(None)) -> ExcelValidateResponse:
    """Dry run: parse and validate the whole workbook and return every error plus a preview.
    Writes nothing."""
    data = await _read_upload(file)
    _defs, plan = await run_heavy(_plan_sync, _project(), data, name)
    return ExcelValidateResponse(
        ok=plan.ok, errors=[ExcelErrorItem(**e.as_dict()) for e in plan.errors],
        warnings=plan.warnings, preview=plan.preview,
    )


@router.post("/excel/import", response_model=ExcelImportResponse, dependencies=[Depends(verify_project_state)])
async def import_excel(file: UploadFile = File(...), name: str | None = Query(None)) -> ExcelImportResponse:
    data = await _read_upload(file)
    return await run_heavy(_import_sync, _project(), data, name)


@router.get("/{name}/export")
async def export_authored_excel(name: str):
    from mapper.api.bom import sanitize_filename_part

    db = _db_or_404(_load(_project()), name)
    data = xl.workbook_bytes(xl.export_database(db))
    return excel_response_from_bytes(data, f"{sanitize_filename_part(db.name, 'authored')}_authored.xlsx", kind="round_trip")


@router.get("", response_model=list[AuthoredDatabaseView])
async def list_authored() -> list[AuthoredDatabaseView]:
    project = _project()
    defs = _load(project)
    backend = get_backend(project)
    return [AuthoredDatabaseView(database=d, status=eng.status_of(d, backend)) for d in defs.databases]


@router.get("/{name}", response_model=AuthoredDatabaseView)
async def get_authored(name: str) -> AuthoredDatabaseView:
    project = _project()
    db = _db_or_404(_load(project), name)
    return AuthoredDatabaseView(database=db, status=eng.status_of(db, get_backend(project)))


@router.post("/preview-exchange", response_model=ExchangePreview)
async def preview_exchange(body: ExchangeInput) -> ExchangePreview:
    """Dry run of one exchange. Writes nothing.

    Calls ``resolve_exchange`` -- the SAME function saving calls through
    ``build_activity`` -- so the editor shows the verdict saving will give,
    not a second implementation of the floor and variance rules.
    ``tests/test_authored_preview.py`` asserts the two agree input for input.
    """
    project = _project()
    try:
        return ExchangePreview(ok=True, exchange=eng.resolve_exchange(body, get_backend(project)))
    except eng.AuthoredError as err:
        return ExchangePreview(ok=False, problems=err.problems, codes=err.codes)


@router.post("/reached-indicators", response_model=ReachedIndicatorsResponse)
async def reached_indicators(body: ReachedIndicatorsRequest) -> ReachedIndicatorsResponse:
    """The indicators the listed flows reach: the only ones a PARTIAL activity
    can be declared complete for. Uses the backend's ``reached_methods`` -- the
    same function the save-time floor calls -- so the editor cannot offer a
    tick that saving would refuse. Writes nothing."""
    from mapper.core.flow_characterisation import pick_family

    reached = get_backend(_project()).reached_methods((f.database, f.code) for f in body.flows)
    items = sorted((m for m in reached if m), key=lambda m: (m[0], m[1:]))
    families = sorted({m[0] for m in items})
    return ReachedIndicatorsResponse(
        families=families,
        default_family=pick_family(None, families) if families else None,
        indicators=[ReachedIndicator(method=list(m), family=m[0], label=" › ".join(display_method(m)[1:])) for m in items],
    )


@router.post("", response_model=AuthoredDatabase, dependencies=[Depends(verify_project_state)])
async def create_authored(body: DatabaseCreate) -> AuthoredDatabase:
    project = _project()
    defs = _load(project)
    backend = get_backend(project)
    try:
        name = eng.validate_database_name(body.name, backend.installed(), defs)
    except eng.AuthoredError as err:
        raise _invalid(err) from err
    ts = eng.now_iso()
    db = AuthoredDatabase(name=name, description=body.description, created_at=ts, updated_at=ts)
    defs.databases.append(db)
    _commit(project, defs, db, backend)
    return db


@router.post("/{name}/activities", response_model=AuthoredActivity,
             dependencies=[Depends(verify_project_state)])
async def add_activity(name: str, body: ActivityInput) -> AuthoredActivity:
    project = _project()
    defs = _load(project)
    db = _db_or_404(defs, name)
    backend = get_backend(project)
    try:
        act = eng.build_activity(body, backend, eng.new_code())
        updated = AuthoredDatabase(**{**db.model_dump(exclude={"activities"}),
                                      "activities": [*db.activities, act],
                                      "updated_at": eng.now_iso()})
    except eng.AuthoredError as err:
        raise _invalid(err) from err
    except ValueError as err:  # e.g. duplicate name+location
        raise _invalid(eng.AuthoredError([str(err)])) from err
    defs.databases[defs.databases.index(db)] = updated
    _commit(project, defs, updated, backend)
    return act


@router.put("/{name}/activities/{code}", response_model=AuthoredActivity,
            dependencies=[Depends(verify_project_state)])
async def update_activity(name: str, code: str, body: ActivityInput) -> AuthoredActivity:
    """Replace an activity's content. The code is kept, so BOM links survive."""
    project = _project()
    defs = _load(project)
    db = _db_or_404(defs, name)
    idx = next((i for i, a in enumerate(db.activities) if a.code == code), None)
    if idx is None:
        raise HTTPException(status_code=404, detail=f"No activity {code!r} in {name!r}")
    backend = get_backend(project)
    try:
        act = eng.build_activity(body, backend, code)
        acts = list(db.activities)
        acts[idx] = act
        updated = AuthoredDatabase(**{**db.model_dump(exclude={"activities"}),
                                      "activities": acts, "updated_at": eng.now_iso()})
    except eng.AuthoredError as err:
        raise _invalid(err) from err
    except ValueError as err:
        raise _invalid(eng.AuthoredError([str(err)])) from err
    defs.databases[defs.databases.index(db)] = updated
    _commit(project, defs, updated, backend)
    return act


@router.delete("/{name}/activities/{code}", dependencies=[Depends(verify_project_state)])
async def delete_activity(name: str, code: str) -> dict:
    project = _project()
    defs = _load(project)
    db = _db_or_404(defs, name)
    if all(a.code != code for a in db.activities):
        raise HTTPException(status_code=404, detail=f"No activity {code!r} in {name!r}")
    links = eng.links_into(_archetypes(project), name, {code})
    if links:
        raise HTTPException(status_code=409, detail={
            "error": "authored_activity_linked",
            "message": "This activity is linked from BOM rows; relink or remove them first.",
            "links": links,
        })
    updated = AuthoredDatabase(**{**db.model_dump(exclude={"activities"}),
                                  "activities": [a for a in db.activities if a.code != code],
                                  "updated_at": eng.now_iso()})
    defs.databases[defs.databases.index(db)] = updated
    _commit(project, defs, updated, get_backend(project))
    return {"deleted": code}


@router.delete("/{name}", dependencies=[Depends(verify_project_state)])
async def delete_authored(name: str) -> dict:
    project = _project()
    defs = _load(project)
    db = _db_or_404(defs, name)
    links = eng.links_into(_archetypes(project), name)
    if links:
        raise HTTPException(status_code=409, detail={
            "error": "authored_database_linked",
            "message": "Activities in this database are linked from BOM rows; relink or remove them first.",
            "links": links,
        })
    get_backend(project).delete(name)
    defs.databases.remove(db)
    store.save_definitions(project, defs)
    return {"deleted": name}


@router.post("/reconcile", response_model=list[MaterialisationStatus],
             dependencies=[Depends(verify_project_state)])
async def post_reconcile() -> list[MaterialisationStatus]:
    project = _project()
    return eng.reconcile(_load(project), get_backend(project))


def reconcile_current_project() -> list[MaterialisationStatus]:
    """Best-effort rebuild for hooks (project import, ecoinvent import).

    Never raises: a hook must not fail the import that called it.
    """
    try:
        project = _project()
        return eng.reconcile(store.load_definitions(project), get_backend(project))
    except Exception:
        import logging

        logging.getLogger(__name__).exception("authored-database reconcile failed")
        return []
