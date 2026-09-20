# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""An archetype whose stage roots have no id must not make a project unusable.

`assign_ids_to_roots` ran on the create and import routes but not on load, and
an archetype can reach disk without passing either -- the demo project builds
its two and calls `save_archetype` directly. `ArchetypeSummary.stage_ids` is
`dict[str, str]`, so one `id: None` root makes `GET /bom/archetypes` return 500
and the ENTIRE list unreachable for that project, not just that archetype.

Shipped in 0.2.x and 0.3.0: the demo project that every install gets could not
show its Archetypes page. Fixed on load, so every project already on disk is
repaired rather than only the one seeded today.
"""
from __future__ import annotations

import json

import pytest

from mapper.core import dsm_storage
from mapper.models.bom_schemas import Archetype, BOMNode


def _only_archetype():
    """load_all()[4] is keyed by project, then by archetype id."""
    (by_id,) = dsm_storage.load_all()[4].values()
    return tuple(by_id.values())


def _arc(**kw) -> Archetype:
    return Archetype(
        id="seeded-arc", name="Seeded", category="DEMO",
        bom=[
            BOMNode(name="Manufacturing", node_type="component", quantity=1.0, unit="unit",
                    children=[BOMNode(name="Steel", node_type="material", quantity=2.0, unit="kg")]),
            BOMNode(name="Use Phase", node_type="component", quantity=1.0, unit="unit"),
        ],
        **kw,
    )


@pytest.fixture()
def seeded(tmp_path, monkeypatch):
    """A project on disk whose archetype has no ids anywhere -- what the demo
    builder wrote, byte for byte: save_archetype with un-assigned nodes."""
    monkeypatch.setattr(dsm_storage, "STORAGE_DIR", tmp_path)
    dsm_storage.save_archetype("demo", _arc())
    path = tmp_path / "demo" / "archetypes" / "seeded-arc.json"
    on_disk = json.loads(path.read_text(encoding="utf-8"))
    assert [r["id"] for r in on_disk["bom"]] == [None, None], "fixture must start broken"
    assert on_disk["bom"][0]["children"][0]["id"] is None
    return path


def test_the_loader_gives_every_node_an_id(seeded):
    (arc,) = _only_archetype()
    assert all(r.id for r in arc.bom), "a root without an id fails ArchetypeSummary"
    assert all(c.id for r in arc.bom for c in (r.children or [])), "children too"


def test_the_backfill_is_persisted_not_only_held(seeded):
    """A regenerated id would differ between restarts, and the UI PUTs a stage
    basis BY that id."""
    (first,) = _only_archetype()
    ids = [r.id for r in first.bom]
    assert [r["id"] for r in json.loads(seeded.read_text(encoding="utf-8"))["bom"]] == ids

    (second,) = _only_archetype()
    assert [r.id for r in second.bom] == ids, "the ids moved between loads"


def test_a_healthy_archetype_is_not_rewritten(seeded, monkeypatch):
    """Idempotent: the repair runs once. A load that rewrites every archetype
    every time would touch mtimes on every startup."""
    dsm_storage.load_all()                      # the one repairing load
    before = seeded.stat().st_mtime_ns
    written = []
    monkeypatch.setattr(dsm_storage, "save_archetype",
                        lambda *a, **k: written.append(a))
    dsm_storage.load_all()
    assert written == [], "a second load rewrote an archetype that was already whole"
    assert seeded.stat().st_mtime_ns == before


def test_a_failed_write_still_loads(seeded, monkeypatch):
    """Read-only or full disk: the ids must still be usable in memory. An
    annotation must not be the reason a project cannot open."""
    def boom(*_a, **_k):
        raise OSError("read-only file system")

    monkeypatch.setattr(dsm_storage, "save_archetype", boom)
    (arc,) = _only_archetype()
    assert all(r.id for r in arc.bom)


def test_the_summary_that_was_500ing(seeded):
    """The actual failure: ArchetypeSummary over a loaded archetype."""
    from mapper.core.bom_engine import summarize_archetype
    from mapper.models.bom_schemas import ArchetypeSummary

    (arc,) = _only_archetype()
    summary = ArchetypeSummary(**summarize_archetype(arc))
    assert set(summary.stage_ids) == {"Manufacturing", "Use Phase"}
    assert all(isinstance(v, str) and v for v in summary.stage_ids.values())


def test_the_demo_builder_assigns_ids_itself(monkeypatch, tmp_path):
    """The loader repairs old data; the seeder must stop writing new.

    Reads the source rather than building a demo project (that needs bw2io and
    minutes): the call has to be there, before the save, in that loop.
    """
    import inspect

    from mapper.core import demo_project

    src = inspect.getsource(demo_project.build_demo_project)
    i = src.index("assign_ids_to_roots(arc.bom)")
    j = src.index("dsm_storage.save_archetype(DEMO_PROJECT_NAME, arc)")
    assert i < j, "ids must be assigned BEFORE the archetype is saved"


def test_a_child_only_gap_is_persisted_too(tmp_path, monkeypatch):
    """Roots with ids, one child without -- what a hand-edited or partially
    migrated file looks like.

    `assign_ids_to_roots` fills children as well, so a check that asks only
    "does a ROOT lack an id?" assigns the child in memory and never writes it:
    the child gets a different id on every load, and a node id is what the BOM
    routes address a row by.
    """
    monkeypatch.setattr(dsm_storage, "STORAGE_DIR", tmp_path)
    arc = _arc()
    for r in arc.bom:
        r.id = f"root-{r.name}"
    dsm_storage.save_archetype("demo", arc)
    path = tmp_path / "demo" / "archetypes" / "seeded-arc.json"
    on_disk = json.loads(path.read_text(encoding="utf-8"))
    assert all(r["id"] for r in on_disk["bom"]), "fixture: roots must be whole"
    assert on_disk["bom"][0]["children"][0]["id"] is None, "fixture: the child must not be"

    (first,) = _only_archetype()
    child_id = first.bom[0].children[0].id
    assert child_id, "the child was not given an id"
    written = json.loads(path.read_text(encoding="utf-8"))["bom"][0]["children"][0]["id"]
    assert written == child_id, "assigned in memory but never persisted"

    (second,) = _only_archetype()
    assert second.bom[0].children[0].id == child_id, "the child id moved between loads"
