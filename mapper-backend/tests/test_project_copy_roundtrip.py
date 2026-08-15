# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""A copied project must carry the modelling, not just the databases.

Duplicate / Export / Import used to move only ``bw2data.projects.dir``. The
severe case was Export: a ``.mapperproj.tar.gz`` is the reproducibility
artifact, and it round-tripped cleanly while dropping every DSM system, BOM,
sharing configuration and parameter table, with nothing to signal the loss.

The acceptance criterion here is a real round trip against a populated store,
compared BY ID -- not a unit test of the helper. The check that actually
matters is the last one in each direction: a cohort mapping in the copy must
still RESOLVE against the copied archetypes. Id equality alone would pass while
every pointer dangled, which is precisely how the WP5 mapping broke.

bw2 itself is stubbed. What is under test is which files move, and real bw2
project copying needs ``bw2setup()`` (~1 min, ~150 MB).
"""
from __future__ import annotations

import io
import json
import tarfile
from pathlib import Path

import pytest

from mapper.core import project_storage as ps

SRC = "SourceProj"
SYS_ID = "sys-aaaa"
ARC_IDS = ["arc-1111", "arc-2222"]
CFG_ID = "cfg-9999"


@pytest.fixture()
def store(tmp_path, monkeypatch):
    """Five isolated roots, populated for SRC the way a real project is."""
    roots = {k: tmp_path / k for k in ("dsm", "aesa", "parameters", "plca", "mfa")}
    monkeypatch.setattr(ps, "storage_roots", lambda: dict(roots))

    d = roots["dsm"] / SRC
    (d / SYS_ID).mkdir(parents=True)
    # Real models, not shape-only JSON: `dsm_storage.load_all()` parses these
    # into pydantic and silently skips anything that will not validate, so a
    # stub would make the visibility test pass or fail for the wrong reason.
    from mapper.models.dsm_schemas import DimensionDef, DSMSystemState, SystemDefinition, TimeHorizon
    system = SystemDefinition(
        id=SYS_ID, name="Fleet",
        dimensions=[DimensionDef(name="fuel", display_name="Fuel", values=["BEV", "ICEV"])],
        time_horizon=TimeHorizon(start_year=2025, end_year=2030),
    )
    (d / SYS_ID / "system.json").write_text(system.model_dump_json())
    (d / SYS_ID / "state.json").write_text(DSMSystemState(system_id=SYS_ID).model_dump_json())
    (d / SYS_ID / "cohort_mappings.json").write_text(json.dumps({
        "mfa_system_id": SYS_ID,
        "mappings": [{"cohort_key": "BEV|Small", "archetype_id": ARC_IDS[0], "scaling_factor": 1.0},
                     {"cohort_key": "ICEV|Small", "archetype_id": ARC_IDS[1], "scaling_factor": 1.3}],
        "row_colors": {"BEV|Small": "#123456"},
    }))
    (d / "archetypes").mkdir()
    from mapper.models.bom_schemas import Archetype
    for a in ARC_IDS:
        arc = Archetype(id=a, name=f"Arch {a}", bom=[],
                        created_at="2026-01-01T00:00:00", updated_at="2026-01-01T00:00:00")
        from mapper.models.bom_schemas import ValidationReport
        arc = arc.model_copy(update={"validation_report": ValidationReport(
            total_rows=1, valid_rows=1, error_rows=0, warning_rows=0, project_name=SRC)})
        (d / "archetypes" / f"{a}.json").write_text(arc.model_dump_json())
    (roots["aesa"] / SRC / "sessions").mkdir(parents=True)
    (roots["aesa"] / SRC / f"{CFG_ID}.json").write_text(
        json.dumps({"id": CFG_ID, "name": "cfg", "mfa_system_id": SYS_ID}))
    (roots["aesa"] / SRC / "sessions" / "sess-1.json").write_text(json.dumps({"id": "sess-1"}))
    (roots["parameters"] / SRC / "parameters").mkdir(parents=True)
    (roots["parameters"] / SRC / "parameters" / "table.json").write_text(
        json.dumps({"parameters": {"w_bp": {"name": "w_bp", "base_value": 1.0}}}))
    (roots["plca"] / SRC).mkdir(parents=True)
    (roots["plca"] / SRC / "databases.json").write_text(json.dumps([{"name": "ei-premise-2030"}]))
    return roots


def _snapshot(roots, project):
    """Everything that must survive a copy, by id."""
    d = roots["dsm"] / project
    cm = json.loads((d / SYS_ID / "cohort_mappings.json").read_text())
    return {
        "systems": sorted(p.name for p in d.iterdir() if p.is_dir() and p.name != "archetypes"),
        "archetypes": sorted(p.stem for p in (d / "archetypes").glob("*.json")),
        "cohort_rows": [(m["cohort_key"], m["archetype_id"], m["scaling_factor"])
                        for m in cm["mappings"]],
        "row_colors": cm["row_colors"],
        "aesa_configs": sorted(p.stem for p in (roots["aesa"] / project).glob("*.json")),
        "aesa_sessions": sorted(p.stem for p in (roots["aesa"] / project / "sessions").glob("*.json")),
        "params": json.loads((roots["parameters"] / project / "parameters" / "table.json").read_text()),
        "plca": json.loads((roots["plca"] / project / "databases.json").read_text()),
    }


def _assert_mapping_resolves(roots, project):
    """The failure mode that matters: every pointer must land on a real file.

    Id equality alone passes even when every archetype the mapping references
    is missing, which is exactly how the WP5 mapping broke.
    """
    d = roots["dsm"] / project
    cm = json.loads((d / SYS_ID / "cohort_mappings.json").read_text())
    present = {p.stem for p in (d / "archetypes").glob("*.json")}
    referenced = {m["archetype_id"] for m in cm["mappings"]}
    assert referenced, "no mapping rows to resolve"
    orphans = referenced - present
    assert not orphans, f"cohort mapping in {project!r} points at missing archetypes: {orphans}"


# ── Duplicate ───────────────────────────────────────────────────────────────

def test_duplicate_carries_every_root_by_id(store):
    ps.copy_project_storage(SRC, "Copy")
    before, after = _snapshot(store, SRC), _snapshot(store, "Copy")
    for key in before:
        assert after[key] == before[key], f"{key} differs after duplicate"


def test_duplicate_keeps_the_cohort_mapping_resolvable(store):
    ps.copy_project_storage(SRC, "Copy")
    _assert_mapping_resolves(store, "Copy")


def test_duplicate_restamps_the_validation_report_project_name(store):
    ps.copy_project_storage(SRC, "Copy")
    for a in ARC_IDS:
        payload = json.loads((store["dsm"] / "Copy" / "archetypes" / f"{a}.json").read_text())
        assert payload["validation_report"]["project_name"] == "Copy"
    # the source is untouched
    payload = json.loads((store["dsm"] / SRC / "archetypes" / f"{ARC_IDS[0]}.json").read_text())
    assert payload["validation_report"]["project_name"] == SRC


# ── Export -> Import ────────────────────────────────────────────────────────

def _export_to_tar(project: str) -> tuple[bytes, dict]:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        info = tarfile.TarInfo(f"{project}/lci.db")
        blob = b"fake bw2 database"
        info.size = len(blob)
        tf.addfile(info, io.BytesIO(blob))
        manifest = ps.write_archive_storage(tf, project, project)
    return buf.getvalue(), manifest


def test_export_then_import_carries_every_root_by_id(store, tmp_path):
    blob, manifest = _export_to_tar(SRC)
    assert manifest["format"] == ps.ARCHIVE_FORMAT
    assert set(manifest["roots"]) == {"dsm", "aesa", "parameters", "plca"}

    ex = tmp_path / "ex"
    ex.mkdir()
    with tarfile.open(fileobj=io.BytesIO(blob)) as tf:
        tf.extractall(ex)
    installed = ps.install_archive_storage(ex / SRC, "Imported")
    assert installed, "nothing installed from the archive"

    before, after = _snapshot(store, SRC), _snapshot(store, "Imported")
    for key in before:
        assert after[key] == before[key], f"{key} differs after export/import"


def test_imported_cohort_mapping_still_resolves(store, tmp_path):
    blob, _ = _export_to_tar(SRC)
    ex = tmp_path / "ex"; ex.mkdir()
    with tarfile.open(fileobj=io.BytesIO(blob)) as tf:
        tf.extractall(ex)
    ps.install_archive_storage(ex / SRC, "Imported")
    _assert_mapping_resolves(store, "Imported")


def test_the_manifest_distinguishes_empty_from_unsupported(store, tmp_path):
    """A project with no modelling exports a manifest with no roots -- which is
    how a reader tells that apart from an archive written before the format."""
    (store["dsm"] / "Bare").mkdir(parents=True)
    blob, manifest = _export_to_tar("Bare")
    assert manifest["roots"] == {} and manifest["total_files"] == 0
    ex = tmp_path / "ex"; ex.mkdir()
    with tarfile.open(fileobj=io.BytesIO(blob)) as tf:
        tf.extractall(ex)
    assert ps.read_archive_manifest(ex / "Bare") is not None   # supported, just empty


# ── Compatibility, both directions ──────────────────────────────────────────

def test_an_old_archive_still_imports(store, tmp_path):
    """No `__mapper__` tree at all: install is a silent no-op, as before."""
    ex = tmp_path / "old" / SRC
    ex.mkdir(parents=True)
    (ex / "lci.db").write_text("bw2 only")
    assert ps.read_archive_manifest(ex) is None
    assert ps.install_archive_storage(ex, "FromOld") == {}


def test_a_new_archive_does_not_confuse_the_old_importer(store, tmp_path):
    """The reason the tree is nested rather than a sibling.

    The importer shipped before this feature picks `roots[0]` from the
    archive's top level. With the storage tree nested inside the project
    directory there is exactly one top-level entry, so that code cannot pick
    the wrong one; a sibling would make the choice order-dependent.
    """
    blob, _ = _export_to_tar(SRC)
    ex = tmp_path / "ex"; ex.mkdir()
    with tarfile.open(fileobj=io.BytesIO(blob)) as tf:
        tf.extractall(ex)

    top = [p for p in ex.iterdir() if p.is_dir()]
    assert len(top) == 1 and top[0].name == SRC, (
        f"archive must have exactly one top-level directory, got {[p.name for p in top]}")
    assert (top[0] / ps.ARCHIVE_DIR).is_dir(), "storage tree is not nested inside the project dir"


# ── The sanitiser collision ─────────────────────────────────────────────────

def test_a_storage_directory_collision_fails_loudly(store):
    """`My/Project` and `My_Project` share a directory. Copying is where that
    would overwrite an unrelated project, so it refuses instead of writing."""
    with pytest.raises(ps.ProjectStorageCollision):
        ps.copy_project_storage("My/Project", "My_Project")


def test_a_normal_rename_is_not_treated_as_a_collision(store):
    ps.copy_project_storage(SRC, "Perfectly Fine Name")
    assert (store["dsm"] / "Perfectly Fine Name").exists()


# ── Route-level visibility ──────────────────────────────────────────────────
#
# The copy landing on disk is only half the contract. A project the process has
# never loaded is not in the in-memory registries, and `hydrate_from_disk()`
# otherwise runs only at startup -- so without a rehydrate the copy reads EMPTY
# through the API until the app restarts, which looks exactly like a failed
# copy.
#
# These are deliberately route-level rather than helper-level. The tests above
# assert what reaches the disk; only these assert what a client can see, and
# that is the property that regressed: an earlier sweep concluded these two
# routes had "no gap", which was true right up until they started writing
# MApper storage.

def _visible_projects_registry():
    from mapper.api import bom as _bom
    from mapper.api import dsm as _dsm
    return _dsm._systems, _bom._archetypes


@pytest.fixture()
def registries(monkeypatch):
    """Registries with the copy's project absent, as a fresh process would be."""
    systems, archetypes = _visible_projects_registry()
    for reg in (systems, archetypes):
        reg.pop("Copy", None)
    yield systems, archetypes
    for reg in (systems, archetypes):
        reg.pop("Copy", None)


def test_a_copy_is_visible_without_a_restart(store, registries, monkeypatch):
    """The acceptance shape: copy, then read through the registry the API uses.

    Asserted via `hydrate_from_disk()` rather than the HTTP route so the test
    stays hermetic -- the route also does bw2 work. What is pinned is that the
    copy is READABLE in-process after the rehydrate the routes perform.
    """
    from mapper.api import dsm as _dsm

    systems, archetypes = registries
    monkeypatch.setattr("mapper.core.dsm_storage.STORAGE_DIR", store["dsm"])

    ps.copy_project_storage(SRC, "Copy")
    assert not systems.get("Copy"), "precondition: the copy must start invisible"

    _dsm.hydrate_from_disk()

    assert systems.get("Copy"), "DSM systems invisible after a copy + rehydrate"
    assert SYS_ID in systems["Copy"]
    assert archetypes.get("Copy"), "archetypes invisible after a copy + rehydrate"
    assert set(ARC_IDS) <= set(archetypes["Copy"])


def test_both_copy_routes_call_the_rehydrate(monkeypatch):
    """Enforce the rule structurally, not by memory.

    Any route that writes MApper storage for a project this process has not
    loaded must rehydrate before returning. If a third copy-shaped route is
    added later, this is what says it has to do the same.
    """
    import inspect

    from mapper.api import databases as _db

    for fn in (_db.post_duplicate_project, _db.post_import_project):
        src = inspect.getsource(fn)
        assert "_rehydrate_after_storage_write()" in src, (
            f"{fn.__name__} writes MApper storage but never rehydrates, so its "
            f"result is invisible until the app restarts")


# ── Delete ──────────────────────────────────────────────────────────────────
#
# The mirror of the copy gap. `delete_project` dropped the Brightway project
# and left MApper's storage on disk, where a later project whose name sanitised
# to the same directory would silently adopt a dead project's modelling.

def test_delete_removes_every_root(store):
    ps.copy_project_storage(SRC, "Doomed")
    assert (store["dsm"] / "Doomed").exists()

    removed = ps.delete_project_storage("Doomed", other_projects=[SRC])

    assert removed, "delete reported nothing removed"
    for label in ("dsm", "aesa", "parameters", "plca"):
        assert not (store[label] / "Doomed").exists(), f"{label} survived the delete"
    # the source is untouched
    assert (store["dsm"] / SRC).exists()
    assert (store["aesa"] / SRC).exists()


def test_delete_refuses_when_a_survivor_shares_the_storage_directory(store):
    """`My/Project` and `My_Project` are one directory. Deleting either would
    destroy the other's modelling, so it refuses instead."""
    with pytest.raises(ps.ProjectStorageCollision):
        ps.delete_project_storage("My/Project", other_projects=["My_Project", SRC])


def test_delete_of_a_project_with_no_storage_is_a_quiet_noop(store):
    assert ps.delete_project_storage("NeverExisted", other_projects=[SRC]) == {}
    assert (store["dsm"] / SRC).exists()


def test_the_delete_route_cleans_up_storage(monkeypatch):
    """Structural, like the copy routes: deleting a project must not leave its
    modelling orphaned on disk."""
    import inspect

    from mapper.api import databases as _db

    src = inspect.getsource(_db.delete_project_endpoint)
    assert "delete_project_storage" in src, (
        "delete_project_endpoint drops the bw2 project but leaves MApper "
        "storage orphaned")
