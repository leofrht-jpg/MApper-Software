# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

import logging
import os
import threading
import time
from contextlib import contextmanager
from pathlib import Path

from fastapi import APIRouter, HTTPException, WebSocket

import ecoinvent_interface as ei

from mapper.core.ecoinvent_biosphere import BiosphereAudit, BiosphereConflict, find_elementary_exchanges_xml
from mapper.core.tasks import Task, create_task, get_task, run_in_thread
from mapper.models.schemas import (
    BrowseFolderRequest,
    BrowseFolderResponse,
    ImportEcoinventRequest,
    ImportLocalEcoinventRequest,
    TaskStartedResponse,
    ValidateCredentialsRequest,
    ValidateCredentialsResponse,
)
from mapper.ws.progress import stream_task_progress

router = APIRouter()

logger = logging.getLogger(__name__)

#: Seconds between heartbeat updates of a long step.
HEARTBEAT_SECONDS = 5.0
#: A step that has run this long gets "no progress for N minutes" in its message
#: and in the log. The work is never killed: a big release legitimately takes a long time.
STALL_WARNING_SECONDS = 10 * 60.0


@contextmanager
def _heartbeat(task: Task, step: str, progress: float, text: str):
    """Refresh the task every ``HEARTBEAT_SECONDS`` while a long call that reports nothing
    runs (a download, a 7z extraction, reading the .spold files, a write), so the
    WebSocket stays alive and the wizard shows elapsed time. After
    ``STALL_WARNING_SECONDS`` the message says nothing has progressed for N minutes
    and a warning is logged; the call itself keeps running.
    """
    stop = threading.Event()
    started = time.monotonic()
    warned = False

    def _beat() -> None:
        nonlocal warned
        while not stop.wait(HEARTBEAT_SECONDS):
            elapsed = time.monotonic() - started
            message = f"{text} ({int(elapsed)}s elapsed)"
            if elapsed >= STALL_WARNING_SECONDS:
                message += (
                    f" - no progress for {int(elapsed // 60)} minutes. It may be stuck, "
                    "but it is still running; check Database Explorer before starting it again."
                )
                if not warned:
                    warned = True
                    logger.warning("Import step '%s' has shown no progress for %d minutes", step, int(elapsed // 60))
            task.update(step, progress, message)

    task.update(step, progress, text)
    thread = threading.Thread(target=_beat, daemon=True)
    thread.start()
    try:
        yield
    finally:
        stop.set()
        thread.join(timeout=1.0)


def _count_spold_files(path: Path) -> int:
    """Count .spold files directly in ``path`` (not recursive — ecospold datasets
    typically live flat in the 'datasets' folder)."""
    if not path.is_dir():
        return 0
    count = 0
    for name in os.listdir(path):
        if name.lower().endswith(".spold"):
            count += 1
    return count


def _do_validate(username: str, password: str) -> tuple[bool, list[str], str]:
    try:
        settings = ei.Settings(username=username, password=password)
        release = ei.EcoinventRelease(settings)
        release.login()
        versions = release.list_versions()
        return True, versions, "ok"
    except Exception as e:
        return False, [], str(e)


@router.post("/ecoinvent/validate", response_model=ValidateCredentialsResponse)
async def validate_credentials(body: ValidateCredentialsRequest) -> ValidateCredentialsResponse:
    valid, versions, message = _do_validate(body.username, body.password)
    return ValidateCredentialsResponse(valid=valid, versions=versions, message=message)


def _reconcile_biosphere(task: Task, audit: BiosphereAudit, xml_path: Path | None) -> None:
    """Add the release's flows that the project's biosphere3 lacks, or stop.

    Shared by both import routes. A conflict is put in the progress message
    before it is raised, because that message is what the wizard shows when the
    task then fails.
    """
    task.update("biosphere", 0.30, "Comparing the release's elementary flows with biosphere3…")
    try:
        audit.reconcile(xml_path)
    except BiosphereConflict as exc:
        task.update("biosphere", 0.30, str(exc))
        raise
    if audit.flows_added:
        task.update(
            "biosphere", 0.33,
            f"Added {audit.flows_added:,} flows from this release to '{audit.bio_db_name}' "
            f"(it had {audit.existing_flow_count:,}, the release lists {audit.release_flow_count:,}).",
        )


def _import_worker(task: Task, username: str, password: str, version: str, system_model: str) -> dict:
    import bw2data
    import bw2io

    task.update("connecting", 0.05, "Connecting to ecoinvent…")
    settings = ei.Settings(username=username, password=password)
    release = ei.EcoinventRelease(settings)
    release.login()

    # get_release downloads the archive and extracts it in one call and reports
    # neither: only the elapsed time is known.
    with _heartbeat(
        task, "downloading", 0.10,
        f"Downloading and extracting ecoinvent {version} {system_model} (several minutes; the size is not reported)…",
    ):
        lci_path = release.get_release(
            version=version,
            system_model=system_model,
            release_type=ei.ReleaseType.ecospold,
        )

    bio_db_name = "biosphere3"
    if bio_db_name not in bw2data.databases:
        with _heartbeat(task, "biosphere", 0.35, "Importing biosphere database…"):
            bio_import = bw2io.importers.ecospold2_biosphere.Ecospold2BiosphereImporter(
                name=bio_db_name,
                filepath=str(lci_path / "MasterData" / "ElementaryExchanges.xml"),
            )
            bio_import.apply_strategies()
            bio_import.write_database()
            bw2data.preferences["biosphere_database"] = bio_db_name
    else:
        task.update("biosphere", 0.35, "Biosphere database already exists, checking it covers this release…")

    audit = BiosphereAudit(bio_db_name)
    _reconcile_biosphere(task, audit, lci_path / "MasterData" / "ElementaryExchanges.xml")

    spold_count = _count_spold_files(lci_path / "datasets")
    db_name = f"ecoinvent-{version}-{system_model}"
    # use_mp=False, as in the local-folder import: a multiprocessing pool has no
    # timeout and crashes on macOS inside a FastAPI worker. Reading is sequential,
    # so it is slower, and the constructor is where the .spold files are read.
    with _heartbeat(
        task, "importing", 0.45,
        f"Reading {spold_count:,} .spold files of ecoinvent {version} {system_model}…",
    ):
        ei_import = bw2io.SingleOutputEcospold2Importer(
            dirpath=str(lci_path / "datasets"),
            db_name=db_name,
            biosphere_database_name=bio_db_name,
            use_mp=False,
        )
    audit.count_found(ei_import.data)

    with _heartbeat(task, "strategies", 0.60, "Applying strategies…"):
        ei_import.apply_strategies()
    audit.after_strategies(ei_import.data)

    with _heartbeat(task, "matching", 0.75, "Matching databases…"):
        ei_import.match_database(bio_db_name, fields=["name", "unit", "categories"])
    audit.drop_unlinked(ei_import.data)

    with _heartbeat(task, "writing", 0.90, "Writing database…"):
        ei_import.write_database()
    audit.after_write(db_name)

    # Biosphere flows now exist: rebuild any authored database that was
    # waiting for them (e.g. after a modelling-only project import).
    from mapper.api.authored import reconcile_current_project

    reconcile_current_project()
    return _finish(task, audit, f"ecoinvent {version} {system_model} imported successfully.")


def _finish(task: Task, audit: BiosphereAudit, headline: str) -> dict:
    """Publish the biosphere counts as the task result and in the final message.

    ``task.result`` is set before the ``done`` update: the wizard reads it as
    soon as it sees ``done``, and ``run_in_thread`` only assigns it after the
    worker returns.
    """
    summary = audit.summary()
    task.result = summary
    task.update("done", 1.0, f"{headline} {audit.message}")
    return summary


@router.get("/ecoinvent/import-summary/{task_id}")
async def import_summary(task_id: str) -> dict:
    """The biosphere counts of a finished import (``found``, ``linked``, ``dropped``, flows added, warning)."""
    task = get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Unknown import task")
    if not isinstance(task.result, dict):
        raise HTTPException(status_code=404, detail="This import has no summary (not finished, or it failed)")
    return task.result


@router.post("/ecoinvent/import", response_model=TaskStartedResponse)
async def start_import(body: ImportEcoinventRequest) -> TaskStartedResponse:
    task = create_task()
    run_in_thread(
        task,
        _import_worker,
        body.username,
        body.password,
        body.version,
        body.system_model,
    )
    return TaskStartedResponse(task_id=task.task_id, status="started")


@router.post("/ecoinvent/browse-folder", response_model=BrowseFolderResponse)
async def browse_folder(body: BrowseFolderRequest) -> BrowseFolderResponse:
    raw = (body.path or "").strip()
    if not raw:
        return BrowseFolderResponse(valid=False, spold_count=0, path="", message="No path provided")
    path = Path(raw).expanduser()
    if not path.exists():
        return BrowseFolderResponse(valid=False, spold_count=0, path=str(path), message="Path does not exist")
    if not path.is_dir():
        return BrowseFolderResponse(valid=False, spold_count=0, path=str(path), message="Path is not a directory")
    count = _count_spold_files(path)
    if count == 0:
        return BrowseFolderResponse(
            valid=False, spold_count=0, path=str(path),
            message="No .spold files found. Point to the 'datasets' folder inside the extracted ecospold archive.",
        )
    return BrowseFolderResponse(valid=True, spold_count=count, path=str(path), message="ok")


def _import_local_worker(task: Task, db_name: str, dirpath: str) -> dict:
    """Import ecospold2 activities from a local folder.

    Keeping ``use_mp=False`` is mandatory — multiprocessing crashes on macOS
    when spawned inside a FastAPI worker. We also drop any exchange that has
    no ``input`` key after applying strategies, so unresolved references don't
    block ``write_database()``.
    """
    import bw2data
    import bw2io

    path = Path(dirpath).expanduser()
    if not path.is_dir():
        raise RuntimeError(f"Folder '{dirpath}' does not exist or is not a directory.")
    spold_count = _count_spold_files(path)
    if spold_count == 0:
        raise RuntimeError(f"No .spold files found in '{dirpath}'.")

    task.update("biosphere", 0.05, "Checking biosphere database…")
    bio_db_name = "biosphere3"
    # Look for ElementaryExchanges.xml alongside or above the datasets folder.
    bio_xml = find_elementary_exchanges_xml(
        path.parent / "MasterData" / "ElementaryExchanges.xml",
        path.parent.parent / "MasterData" / "ElementaryExchanges.xml",
    )
    if bio_db_name not in bw2data.databases:
        if bio_xml is None:
            raise RuntimeError(
                "biosphere3 database missing and ElementaryExchanges.xml not found next to the datasets folder. "
                "Run bw2setup in the project, or include MasterData in the ecospold archive."
            )
        task.update("biosphere", 0.08, "Importing biosphere database…")
        bio_import = bw2io.importers.ecospold2_biosphere.Ecospold2BiosphereImporter(
            name=bio_db_name,
            filepath=str(bio_xml),
        )
        bio_import.apply_strategies()
        bio_import.write_database()
        bw2data.preferences["biosphere_database"] = bio_db_name

    audit = BiosphereAudit(bio_db_name)
    _reconcile_biosphere(task, audit, bio_xml)

    task.update("importing", 0.20, f"Reading {spold_count:,} .spold files…")
    ei_import = bw2io.SingleOutputEcospold2Importer(
        dirpath=str(path),
        db_name=db_name,
        biosphere_database_name=bio_db_name,
        use_mp=False,
    )
    audit.count_found(ei_import.data)

    task.update("strategies", 0.55, "Applying strategies…")
    ei_import.apply_strategies()
    audit.after_strategies(ei_import.data)

    # Drop exchanges that didn't resolve to any activity. Unlinked exchanges
    # cause write_database() to fail. Biosphere exchanges are left for
    # match_database and the audit below, which counts what is dropped there.
    dropped = 0
    for ds in ei_import.data:
        before = len(ds.get("exchanges", []))
        ds["exchanges"] = [
            exc for exc in ds.get("exchanges", []) if exc.get("input") or exc.get("type") == "biosphere"
        ]
        dropped += before - len(ds["exchanges"])

    task.update(
        "matching", 0.75,
        f"Matching databases… ({dropped:,} unlinked exchanges filtered)" if dropped else "Matching databases…",
    )
    ei_import.match_database(bio_db_name, fields=["name", "unit", "categories"])
    audit.drop_unlinked(ei_import.data)

    # Heartbeat during the long-running write step: update the task every 5s
    # with the same 0.90 progress but a refreshed message so the WebSocket
    # stays alive.
    stop = threading.Event()

    def _heartbeat() -> None:
        elapsed = 0
        while not stop.wait(5.0):
            elapsed += 5
            task.update("writing", 0.90, f"Writing database… ({elapsed}s elapsed)")

    hb = threading.Thread(target=_heartbeat, daemon=True)
    task.update("writing", 0.90, "Writing database…")
    hb.start()
    try:
        ei_import.write_database()
    finally:
        stop.set()
        hb.join(timeout=1.0)
    audit.after_write(db_name)

    # Biosphere flows now exist: rebuild any authored database that was
    # waiting for them (e.g. after a modelling-only project import).
    from mapper.api.authored import reconcile_current_project

    reconcile_current_project()
    return _finish(task, audit, f"ecoinvent '{db_name}' imported successfully ({spold_count:,} datasets).")


@router.post("/ecoinvent/import-local", response_model=TaskStartedResponse)
async def start_local_import(body: ImportLocalEcoinventRequest) -> TaskStartedResponse:
    raw = (body.dirpath or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="dirpath is required")
    path = Path(raw).expanduser()
    if not path.is_dir():
        raise HTTPException(status_code=400, detail=f"Folder '{raw}' does not exist or is not a directory")
    if _count_spold_files(path) == 0:
        raise HTTPException(status_code=400, detail=f"No .spold files found in '{raw}'")
    name = (body.db_name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="db_name is required")

    task = create_task()
    run_in_thread(task, _import_local_worker, name, str(path))
    return TaskStartedResponse(task_id=task.task_id, status="started")


@router.websocket("/ws/import/{task_id}")
async def ws_import_progress(websocket: WebSocket, task_id: str) -> None:
    await stream_task_progress(websocket, task_id)
