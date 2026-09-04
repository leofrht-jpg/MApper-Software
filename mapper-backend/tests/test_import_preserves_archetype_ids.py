# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""A replace-mode import must not orphan the references it never mentions.

Replace mode re-minted every archetype id, and an archetype id is referenced
from THREE places. It orphaned all of them, twice, on the same real project --
51 cohort-mapping rows pointing at ids that no longer existed anywhere.

The three surfaces, and they are the complete set:

    1. CohortMapping.mappings[].archetype_id          system-level
    2. Subsystem.cohort_mappings[].archetype_id       subsystem-level
    3. Archetype.includes[].archetype_id              composition

`DependencyRule.dependent_archetype_id` looks like a fourth and is not -- it
holds a dependent COHORT KEY ("Fuel Station|Large"), a different namespace.
Checked against the live project: 0 of its 6 values resolve as BOM archetype
ids, while all 21 SubsystemCohortMapping ones do.

Composition is the one that matters most and the one nobody would have noticed:
a cohort mapping can be rebuilt by hand from the UI, and a workbook re-import
repairs a subsystem mapping. `includes` has no repair path -- and it was being
destroyed by BOTH modes for a second reason, because `_upsert` never carried
the field at all.
"""
from __future__ import annotations

import asyncio
import io

import pytest
from openpyxl import Workbook

from mapper.api import bom as bom_api
from mapper.models.bom_schemas import Archetype, ArchetypeInclude, BOMNode


# ── fixtures ────────────────────────────────────────────────────────────────

def _arc(name: str, arc_id: str) -> Archetype:
    """A minimal but REAL archetype: a stage root with one material under it.

    Not a bare material at the root -- production never produces that shape and
    a fixture that leans on the stage fall-through reads as canonical when it
    is not.
    """
    return Archetype(
        id=arc_id,
        name=name,
        bom=[
            BOMNode(
                id=f"{arc_id}-stage",
                name="Manufacturing",
                node_type="component",
                quantity=1.0,
                children=[
                    BOMNode(
                        id=f"{arc_id}-mat",
                        name="Steel frame",
                        node_type="material",
                        quantity=100.0,
                        unit="kg",
                    )
                ],
            )
        ],
    )


def _workbook_bytes(names: list[str]) -> bytes:
    """A workbook naming `names`. It carries NO composition, because the format
    cannot express it -- `_assert_exportable` refuses to write a composed
    archetype at all. So a blank `includes` on import means "not expressible
    here", never "the user removed it"."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Archetypes"
    ws.append(["archetype_name", "folder", "description"])
    for n in names:
        ws.append([n, "", ""])
    bom = wb.create_sheet("BOM")
    bom.append(["archetype_name", "Stage", "Parent", "Name", "Type", "Quantity", "Unit"])
    for n in names:
        bom.append([n, "Manufacturing", "", "Manufacturing", "component", 1.0, ""])
        bom.append([n, "Manufacturing", "Manufacturing", "Steel frame", "material", 100.0, "kg"])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


class _Upload:
    """Stands in for fastapi's UploadFile — the route only awaits `.read()`."""

    def __init__(self, data: bytes) -> None:
        self._data = data

    async def read(self) -> bytes:
        return self._data


@pytest.fixture
def project(monkeypatch):
    """An isolated in-memory project across all three stores."""
    name = "test-import-ids"
    monkeypatch.setattr(bom_api, "_current_project", lambda: name)
    bom_api._archetypes[name] = {}
    bom_api._cohort_mappings[name] = {}
    monkeypatch.setattr(bom_api.dsm_storage, "save_archetype", lambda *a, **k: None)
    monkeypatch.setattr(
        bom_api.dsm_storage, "delete_archetype_file", lambda *a, **k: None
    )
    yield name
    bom_api._archetypes.pop(name, None)
    bom_api._cohort_mappings.pop(name, None)


def _import(data: bytes, mode: str):
    """Drive the route directly. The suite has no pytest-asyncio; every other
    async-route test here uses asyncio.run, so this follows that."""
    return asyncio.run(
        bom_api.import_archetype(file=_Upload(data), mode=mode)  # type: ignore[arg-type]
    )


# ── the three consumers ─────────────────────────────────────────────────────

def test_replace_preserves_ids_so_a_cohort_mapping_still_resolves(project):
    from mapper.models.bom_schemas import CohortMapping, CohortMappingEntry

    bom_api._archetypes[project]["id-a"] = _arc("BEV-LFP", "id-a")
    bom_api._cohort_mappings[project]["sys1"] = CohortMapping(
        mfa_system_id="sys1",
        mappings=[CohortMappingEntry(cohort_key="BEV-LFP|Small", archetype_id="id-a")],
    )

    _import(_workbook_bytes(["BEV-LFP"]), "replace")

    live = set(bom_api._archetypes[project])
    assert live == {"id-a"}, "replace re-minted the id"
    row = bom_api._cohort_mappings[project]["sys1"].mappings[0]
    assert row.archetype_id in live


def test_replace_preserves_ids_so_a_subsystem_mapping_still_resolves(project):
    from mapper.api import subsystems as sub_api
    from mapper.models.subsystem_schemas import Subsystem, SubsystemCohortMapping

    bom_api._archetypes[project]["id-a"] = _arc("Public DC Charger", "id-a")
    sub = Subsystem(
        id="sub1",
        name="Charging Infrastructure",
        type="dependent",
        depends_on="sys1",
        cohort_mappings={
            "Public DC Charger|Large": SubsystemCohortMapping(archetype_id="id-a")
        },
    )
    sub_api._subsystems[project] = {"sys1": {"sub1": sub}}
    try:
        _import(_workbook_bytes(["Public DC Charger"]), "replace")
        live = set(bom_api._archetypes[project])
        assert live == {"id-a"}
        scm = sub_api._subsystems[project]["sys1"]["sub1"].cohort_mappings[
            "Public DC Charger|Large"
        ]
        assert scm.archetype_id in live
    finally:
        sub_api._subsystems.pop(project, None)


def test_replace_preserves_composition(project):
    """The one with no manual repair path.

    Two ways this used to break: the id was re-minted, AND `_upsert` never
    carried `includes`, so even a preserved id came back with an empty list.
    """
    bom_api._archetypes[project]["id-pack"] = _arc("Battery Pack", "id-pack")
    vehicle = _arc("BEV-LFP", "id-veh")
    vehicle.includes = [ArchetypeInclude(archetype_id="id-pack", quantity=1.0)]
    bom_api._archetypes[project]["id-veh"] = vehicle

    _import(_workbook_bytes(["Battery Pack", "BEV-LFP"]), "replace")

    live = bom_api._archetypes[project]
    assert set(live) == {"id-pack", "id-veh"}
    inc = live["id-veh"].includes
    assert inc, "composition was dropped -- the workbook cannot express it, so it must be carried"
    assert inc[0].archetype_id in live, "composition reference is orphaned"
    assert inc[0].archetype_id == "id-pack"


def test_merge_also_preserves_composition(project):
    """Merge dropped `includes` too. It was never mode-specific."""
    bom_api._archetypes[project]["id-pack"] = _arc("Battery Pack", "id-pack")
    v = _arc("BEV-LFP", "id-veh")
    v.includes = [ArchetypeInclude(archetype_id="id-pack", quantity=2.0)]
    bom_api._archetypes[project]["id-veh"] = v

    _import(_workbook_bytes(["BEV-LFP"]), "merge")

    inc = bom_api._archetypes[project]["id-veh"].includes
    assert inc and inc[0].archetype_id == "id-pack"
    assert inc[0].quantity == 2.0, "the include's scaling was lost"


# ── what replace still does ─────────────────────────────────────────────────

def test_replace_still_deletes_archetypes_absent_from_the_workbook(project):
    """The mode's actual job, and the ONLY thing left that separates it from
    merge. If this ever stops holding, the two modes are the same thing."""
    bom_api._archetypes[project]["id-a"] = _arc("Keep", "id-a")
    bom_api._archetypes[project]["id-b"] = _arc("Drop", "id-b")

    _import(_workbook_bytes(["Keep"]), "replace")

    live = bom_api._archetypes[project]
    assert set(live) == {"id-a"}
    assert live["id-a"].name == "Keep"


def test_merge_keeps_what_replace_would_delete(project):
    """The mirror of the above — together they state the whole difference."""
    bom_api._archetypes[project]["id-a"] = _arc("Keep", "id-a")
    bom_api._archetypes[project]["id-b"] = _arc("Untouched", "id-b")

    _import(_workbook_bytes(["Keep"]), "merge")

    assert set(bom_api._archetypes[project]) == {"id-a", "id-b"}


# ── a NEW name, and the id-stability assumption ─────────────────────────────

def test_a_new_name_gets_a_fresh_id_and_survivors_keep_theirs(project):
    """Ids are stable PER SURVIVING NAME, never across the whole set.

    A name not previously present has no id to preserve, so it gets a new one.
    Nothing may assume the set of ids is unchanged — only that an id belonging
    to a surviving name is unchanged.
    """
    bom_api._archetypes[project]["id-a"] = _arc("Existing", "id-a")

    _import(_workbook_bytes(["Existing", "Brand New"]), "replace")

    live = bom_api._archetypes[project]
    by_name = {a.name: aid for aid, a in live.items()}
    assert by_name["Existing"] == "id-a", "a surviving name must keep its id"
    assert by_name["Brand New"] != "id-a"
    assert by_name["Brand New"] not in {"id-a"}
    assert len(live) == 2


def test_a_renamed_archetype_warns_and_names_where_it_was_referenced(project):
    """Never refuse — a rename-and-replace is legitimate. But it is the one
    case an id cannot survive, so it must not pass in silence."""
    from mapper.models.bom_schemas import CohortMapping, CohortMappingEntry

    bom_api._archetypes[project]["id-old"] = _arc("Old Name", "id-old")
    bom_api._cohort_mappings[project]["sys1"] = CohortMapping(
        mfa_system_id="sys1",
        mappings=[CohortMappingEntry(cohort_key="Old Name|Small", archetype_id="id-old")],
    )

    res = _import(_workbook_bytes(["New Name"]), "replace")

    assert res.created == 1  # not refused
    blob = " ".join(res.warnings)
    assert "Old Name" in blob, f"the deleted archetype is not named: {res.warnings}"
    assert "cohort mapping" in blob, f"the orphaned reference is not named: {res.warnings}"


def test_no_warning_when_nothing_referenced_the_deleted_archetype(project):
    """An unreferenced archetype disappearing is ordinary. Warning on it would
    train people to ignore the warning that matters."""
    bom_api._archetypes[project]["id-a"] = _arc("Keep", "id-a")
    bom_api._archetypes[project]["id-b"] = _arc("Unreferenced", "id-b")

    res = _import(_workbook_bytes(["Keep"]), "replace")

    assert not [w for w in res.warnings if "Unreferenced" in w]


# ── the consequence of preserving an id ─────────────────────────────────────

def test_import_invalidates_the_contribution_cache_for_touched_archetypes(project):
    """Preserving ids re-opens a staleness window that re-minting had closed.

    `_contribution_cache` is keyed by ("archetype", archetype_id, …) and is
    never cleared anywhere. While replace re-minted ids, a stale entry was
    unreachable because its key changed — accidental, but it was the one thing
    re-minting did right. Now the id survives and the BOM does not, so the
    entry has to go.

    Merge has ALWAYS preserved ids, so merge has always been exposed to this;
    it is fixed for both modes here.
    """
    from mapper.api import lca as lca_api

    bom_api._archetypes[project]["id-a"] = _arc("BEV-LFP", "id-a")
    stale = (("archetype", "id-a", "all", "sa"), ("EF v3.1", "x"), "all", None, None)
    other = (("archetype", "id-untouched", "all", "sa"), ("EF v3.1", "x"), "all", None, None)
    activity = (("activity", "db", "code", 1.0), ("EF v3.1", "x"), "all", None, None)
    lca_api._contribution_cache[stale] = {"score": 1.0}
    lca_api._contribution_cache[other] = {"score": 2.0}
    lca_api._contribution_cache[activity] = {"score": 3.0}
    try:
        _import(_workbook_bytes(["BEV-LFP"]), "replace")
        assert stale not in lca_api._contribution_cache, (
            "a contribution result computed from the pre-import BOM would be "
            "served for the new one"
        )
        assert other in lca_api._contribution_cache, "untouched archetype evicted"
        assert activity in lca_api._contribution_cache, "activity entry evicted"
    finally:
        for k in (stale, other, activity):
            lca_api._contribution_cache.pop(k, None)


def test_merge_invalidates_it_too(project):
    from mapper.api import lca as lca_api

    bom_api._archetypes[project]["id-a"] = _arc("BEV-LFP", "id-a")
    stale = (("archetype", "id-a", "all", "sa"), ("EF v3.1", "x"), "all", None, None)
    lca_api._contribution_cache[stale] = {"score": 1.0}
    try:
        _import(_workbook_bytes(["BEV-LFP"]), "merge")
        assert stale not in lca_api._contribution_cache
    finally:
        lca_api._contribution_cache.pop(stale, None)
