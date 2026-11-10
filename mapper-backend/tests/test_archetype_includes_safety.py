# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Archetype ``includes`` must survive an ordinary save and must not dangle.

Three holes, all on synthetic archetypes held in memory (nothing here opens a
Brightway project):

1. ``PUT /bom/archetypes/{id}`` built the archetype with ``includes=body.includes``,
   and the body defaulted that field to ``[]``. A client that does not send the
   field (the BOM editor did not) therefore wiped the references on every save.
   Absent is not empty: only an explicit list changes them.
2. Deleting an archetype that other archetypes include left them dangling; the
   next calculation failed. Single delete and folder delete now refuse with a 409
   that names the includers.
3. The same child included twice in one parent repeats every leaf ``node_id`` of
   that child, and the Monte Carlo draws are keyed by ``node_id``, so the two
   copies share one draw. Rejected at save time.

Excel merge/replace import keeping ``includes`` is covered by
``test_import_preserves_archetype_ids.py`` (both modes).
"""
from __future__ import annotations

import asyncio

import numpy as np
import pytest
from fastapi import HTTPException

from mapper.api import bom as bom_api
from mapper.core.bom_engine import (
    assign_ids_to_roots,
    flatten_root_with_amounts,
    splice_includes,
)
from mapper.core.monte_carlo_engine import collect_row_draws, lognormal_factor
from mapper.models.bom_schemas import (
    Archetype,
    ArchetypeCreate,
    ArchetypeInclude,
    BOMNode,
    EcoinventLink,
    RowUncertainty,
)


# ── fixtures ────────────────────────────────────────────────────────────────

def _leaf(nid: str, name: str, code: str, qty: float, unc=None) -> BOMNode:
    return BOMNode(
        id=nid, name=name, node_type="material", quantity=qty, unit="kg",
        ecoinvent_activity=EcoinventLink(
            database="db", code=code, name=name, unit="kg"),
        uncertainty=unc,
    )


def _arc(arc_id: str, name: str, leaves: list[BOMNode], folder=None, includes=None) -> Archetype:
    return Archetype(
        id=arc_id, name=name, folder=folder, includes=includes or [],
        bom=[BOMNode(id=f"{arc_id}-stage", name="Manufacturing", node_type="component",
                     scope="inflows", children=leaves)],
    )


@pytest.fixture
def project(monkeypatch):
    """An isolated in-memory project; storage writes are no-ops."""
    name = "test-includes-safety"
    monkeypatch.setattr(bom_api, "_current_project", lambda: name)
    bom_api._archetypes[name] = {}
    bom_api._cohort_mappings[name] = {}
    monkeypatch.setattr(bom_api.dsm_storage, "save_archetype", lambda *a, **k: None)
    monkeypatch.setattr(bom_api.dsm_storage, "delete_archetype_file", lambda *a, **k: None)
    monkeypatch.setattr(bom_api.dsm_storage, "load_folders", lambda *a, **k: [])
    monkeypatch.setattr(bom_api.dsm_storage, "save_folders", lambda *a, **k: None)
    yield name
    bom_api._archetypes.pop(name, None)
    bom_api._cohort_mappings.pop(name, None)


def _composed(project: str) -> tuple[Archetype, Archetype]:
    """A 1 kg battery and a vehicle that includes it 450 times."""
    batt = _arc("batt", "Battery 1kg", [_leaf("b1", "Cathode", "c" * 32, 1.0)], folder="Batteries")
    ev = _arc("ev", "EV A", [_leaf("g1", "Glider", "g" * 32, 900.0)], folder="Vehicles",
              includes=[ArchetypeInclude(archetype_id="batt", quantity=450.0)])
    bom_api._archetypes[project]["batt"] = batt
    bom_api._archetypes[project]["ev"] = ev
    return batt, ev


def _put(arc_id: str, payload: dict) -> Archetype:
    """Drive PUT with a body parsed from JSON, exactly as FastAPI builds it."""
    body = ArchetypeCreate.model_validate(payload)
    return asyncio.run(bom_api.update_archetype(arc_id, body))


def _ev_payload(ev: Archetype, **extra) -> dict:
    """What the BOM editor sends today: no `includes` key."""
    return {
        "name": ev.name, "description": None, "category": None,
        "folder": ev.folder, "bom": [n.model_dump() for n in ev.bom], **extra,
    }


# ── 1. PUT: absent is not empty ─────────────────────────────────────────────

def test_put_without_includes_keeps_them(project):
    _, ev = _composed(project)
    out = _put("ev", _ev_payload(ev))          # no `includes` key
    assert [(i.archetype_id, i.quantity) for i in out.includes] == [("batt", 450.0)]
    assert bom_api._archetypes[project]["ev"].includes[0].quantity == 450.0


def test_put_with_includes_replaces_them(project):
    _, ev = _composed(project)
    out = _put("ev", _ev_payload(ev, includes=[{"archetype_id": "batt", "quantity": 12.5}]))
    assert [(i.archetype_id, i.quantity) for i in out.includes] == [("batt", 12.5)]


def test_put_with_an_explicit_empty_list_clears_them(project):
    _, ev = _composed(project)
    out = _put("ev", _ev_payload(ev, includes=[]))
    assert out.includes == []
    assert bom_api._archetypes[project]["ev"].includes == []


def test_a_rename_save_keeps_includes(project):
    """The BOM editor's rename sends name, category, description, folder, bom."""
    _, ev = _composed(project)
    payload = _ev_payload(ev)
    payload["name"] = "EV A renamed"
    out = _put("ev", payload)
    assert out.name == "EV A renamed"
    assert len(out.includes) == 1


# ── 2. Delete guards ────────────────────────────────────────────────────────

def test_delete_of_an_included_archetype_is_refused_naming_the_includers(project):
    _composed(project)
    with pytest.raises(HTTPException) as e:
        asyncio.run(bom_api.delete_archetype("batt"))
    assert e.value.status_code == 409
    msg = str(e.value.detail)
    assert "Battery 1kg" in msg and "EV A" in msg and "folder Vehicles" in msg
    assert "batt" in bom_api._archetypes[project], "the refused delete still deleted it"


def test_delete_of_an_archetype_nobody_includes_still_works(project):
    _composed(project)
    asyncio.run(bom_api.delete_archetype("ev"))      # the includer, not the included
    assert "ev" not in bom_api._archetypes[project]
    asyncio.run(bom_api.delete_archetype("batt"))    # now nothing includes it
    assert "batt" not in bom_api._archetypes[project]


def test_includers_at_the_root_are_named_as_root(project):
    batt, ev = _composed(project)
    ev.folder = None
    with pytest.raises(HTTPException) as e:
        asyncio.run(bom_api.delete_archetype("batt"))
    assert "'EV A' (root)" in str(e.value.detail)


def test_folder_delete_with_contents_is_refused_when_an_outsider_includes_one(project):
    _composed(project)                               # Battery is in "Batteries", EV in "Vehicles"
    body = bom_api.FolderDeleteBody(path="Batteries", delete_archetypes=True)
    with pytest.raises(HTTPException) as e:
        asyncio.run(bom_api.delete_folder(body))
    assert e.value.status_code == 409
    assert "Battery 1kg" in str(e.value.detail) and "EV A" in str(e.value.detail)
    assert "batt" in bom_api._archetypes[project]


def test_folder_delete_is_allowed_when_includer_and_included_go_together(project):
    batt, ev = _composed(project)
    ev.folder = "Batteries"                          # same folder: both are deleted
    body = bom_api.FolderDeleteBody(path="Batteries", delete_archetypes=True)
    out = asyncio.run(bom_api.delete_folder(body))
    assert out["deleted_archetypes"] == 2
    assert bom_api._archetypes[project] == {}


def test_folder_delete_that_only_moves_to_root_is_not_guarded(project):
    _composed(project)
    body = bom_api.FolderDeleteBody(path="Batteries", delete_archetypes=False)
    out = asyncio.run(bom_api.delete_folder(body))
    assert out["moved_archetypes"] == 1
    assert bom_api._archetypes[project]["batt"].folder is None   # still there, still resolvable


# ── 3. The same child twice in one parent ───────────────────────────────────

def _parent_with_two_includes() -> tuple[Archetype, Archetype]:
    child = _arc("batt", "Battery 1kg",
                 [_leaf("leaf1", "Cathode", "c" * 32, 1.0, RowUncertainty(gsd2=1.5))])
    parent = _arc("ev", "EV A", [_leaf("g1", "Glider", "g" * 32, 900.0)],
                  includes=[ArchetypeInclude(archetype_id="batt", quantity=100.0),
                            ArchetypeInclude(archetype_id="batt", quantity=350.0)])
    return child, parent


def test_two_includes_of_one_child_repeat_leaf_ids_and_share_one_draw():
    """Documents WHY the save-time gate exists (measured, synthetic).

    Splice resets only the stage-root id, so both copies keep the child's leaf
    id. The Monte Carlo loop stores factors in a dict keyed by node_id, so the
    two row draws collapse to ONE factor and both copies are scaled by it.
    """
    child, parent = _parent_with_two_includes()
    out = splice_includes(parent, {"batt": child, "ev": parent})
    assign_ids_to_roots(out.bom)
    pairs = [p for r in out.bom for p in flatten_root_with_amounts(r, {}, None)]

    cathode_ids = [m.node_id for m, _ in pairs if m.name == "Cathode"]
    assert cathode_ids == ["leaf1", "leaf1"]                       # repeated

    draws = collect_row_draws([m for m, _ in pairs])
    assert [d.node_id for d in draws] == ["leaf1", "leaf1"]        # two draws wanted ...
    rng = np.random.default_rng(1)
    factors: dict[str, float] = {}
    for d in draws:                                                # ... the loop's own pattern
        factors[d.node_id] = lognormal_factor(rng, d.sigma)
    assert len(factors) == 1                                       # ... one factor kept


def test_save_rejects_the_same_child_twice_with_a_clear_message(project):
    child, parent = _parent_with_two_includes()
    bom_api._archetypes[project]["batt"] = child
    with pytest.raises(HTTPException) as e:
        bom_api._assert_includes_resolvable(parent)
    assert e.value.status_code == 400
    assert "more than once" in str(e.value.detail)
    assert "Battery 1kg" in str(e.value.detail)


def test_put_rejects_the_same_child_twice(project):
    _, ev = _composed(project)
    two = [{"archetype_id": "batt", "quantity": 1.0}, {"archetype_id": "batt", "quantity": 2.0}]
    with pytest.raises(HTTPException) as e:
        _put("ev", _ev_payload(ev, includes=two))
    assert e.value.status_code == 400
    assert len(bom_api._archetypes[project]["ev"].includes) == 1   # unchanged


def test_two_different_children_are_fine(project):
    _composed(project)
    other = _arc("batt2", "Battery 2", [_leaf("o1", "Anode", "a" * 32, 1.0)])
    bom_api._archetypes[project]["batt2"] = other
    ev = bom_api._archetypes[project]["ev"]
    out = _put("ev", _ev_payload(ev, includes=[
        {"archetype_id": "batt", "quantity": 1.0}, {"archetype_id": "batt2", "quantity": 2.0}]))
    assert len(out.includes) == 2
