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
    (d / SYS_ID / "system.json").write_text(json.dumps({"id": SYS_ID, "name": "Fleet"}))
    (d / SYS_ID / "state.json").write_text(json.dumps({"system_id": SYS_ID}))
    (d / SYS_ID / "cohort_mappings.json").write_text(json.dumps({
        "mfa_system_id": SYS_ID,
        "mappings": [{"cohort_key": "BEV|Small", "archetype_id": ARC_IDS[0], "scaling_factor": 1.0},
                     {"cohort_key": "ICEV|Small", "archetype_id": ARC_IDS[1], "scaling_factor": 1.3}],
        "row_colors": {"BEV|Small": "#123456"},
    }))
    (d / "archetypes").mkdir()
    for a in ARC_IDS:
        (d / "archetypes" / f"{a}.json").write_text(json.dumps({
            "id": a, "name": f"Arch {a}",
            "validation_report": {"project_name": SRC, "valid_rows": 1,
                                  "error_rows": 0, "warning_rows": 0},
        }))
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
