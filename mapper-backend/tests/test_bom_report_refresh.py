# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""The stored validation report follows the edits that can change it.

The banner "This archetype has N validation warning(s)", the "View report" panel and the report
counts read ``Archetype.validation_report``, which only the IMPORT wrote. #212 made the row's own
status (the tree icon) follow an edit, so after fixing a waste-sign quantity the icon vanished and
the banner stayed. The edit routes now patch the stored report too, re-validating only the edited
rows with the existing validator (no rule changed) and keeping every other finding, with its sheet
row, exactly as the import wrote it.

Synthetic activities only: a normal process and a waste treatment (production amount -1).
"""
from __future__ import annotations

import asyncio
import gc
import shutil
import uuid

import bw2data
import pytest

from mapper.api import bom as bom_api
from mapper.core.bom_validator import BOMValidationRow, validate_bom
from mapper.models.bom_schemas import Archetype, BOMNode, BOMNodeCreate, BOMNodeUpdate, EcoinventLink

NORMAL = "1" * 32
WASTE = "2" * 32
WASTE2 = "3" * 32


@pytest.fixture()
def project(monkeypatch):
    projects = bw2data.projects
    original = projects.current
    tmp = projects._use_temp_directory()
    name = f"pytest-bomrefresh-{uuid.uuid4().hex[:8]}"
    projects.set_current(name)

    def proc(code, label, prod):
        return {("fg", code): {"name": label, "code": code, "unit": "kilogram", "location": "GLO", "type": "process",
                               "reference product": "x", "exchanges": [
            {"input": ("fg", code), "output": ("fg", code), "amount": prod, "type": "production", "unit": "kilogram"}]}}

    bw2data.Database("fg").write({**proc(NORMAL, "normal process", 1.0),
                                  **proc(WASTE, "treatment of waste, incineration", -1.0),
                                  **proc(WASTE2, "treatment of scrap, landfill", -1.0)})
    monkeypatch.setattr(bom_api, "_current_project", lambda: name)
    bom_api._archetypes[name] = {}
    monkeypatch.setattr(bom_api.dsm_storage, "save_archetype", lambda *a, **k: None)
    try:
        yield name
    finally:
        bom_api._archetypes.pop(name, None)
        projects._restore_orig_directory()
        projects.set_current(original, update=False)
        gc.collect()
        shutil.rmtree(tmp, ignore_errors=True)


def _link(code: str, label: str) -> EcoinventLink:
    return EcoinventLink(database="fg", code=code, name=label, location="GLO", unit="kilogram")


def _mat(nid: str, name: str, qty: float, code: str = WASTE, label: str = "treatment of waste, incineration") -> BOMNode:
    return BOMNode(id=nid, name=name, node_type="material", quantity=qty, unit="kg",
                   ecoinvent_activity=_link(code, label))


def _install(project: str, mats: list[BOMNode], rows: dict[str, int] | None = None, *, imported: bool = True) -> Archetype:
    """An archetype as the import leaves it: stage root, materials, report and per-row status."""
    arc = Archetype(id="A1", name="Pack", bom=[
        BOMNode(id="s1", name="Manufacturing", node_type="component", quantity=1.0, scope="inflows", children=mats)])
    bom_api._archetypes[project]["A1"] = arc
    if imported:
        vrows = [BOMValidationRow(archetype="Pack", stage="Manufacturing", row_idx=(rows or {}).get(m.name, 2 + i),
                                  name=m.name, database="fg", code=m.ecoinvent_activity.code,
                                  ecoinvent_name=m.ecoinvent_activity.name, ecoinvent_location="GLO", unit=m.unit,
                                  quantity=m.quantity, quantity_is_expression=False, stage_scope="inflows")
                 for i, m in enumerate(mats)]
        bom_api._apply_validation_to_archetype(arc, validate_bom(vrows, project_name=project))
    return arc


def _put(nid: str, **fields) -> None:
    asyncio.run(bom_api.update_bom_node("A1", nid, BOMNodeUpdate(**fields)))


def _counts(arc: Archetype) -> tuple[int, int, int, int]:
    r = arc.validation_report
    return (r.total_rows, r.valid_rows, r.error_rows, r.warning_rows)


# ── the reported case ───────────────────────────────────────────────────────

def test_the_import_leaves_a_waste_sign_warning_in_the_report(project):
    arc = _install(project, [_mat("m1", "Scrap", 0.5)], {"Scrap": 4})
    assert _counts(arc) == (1, 0, 0, 1)
    assert [(i.error_type, i.row_idx) for i in arc.validation_report.issues] == [("waste_sign", 4)]


def test_an_edit_that_clears_the_warning_clears_the_banner_the_report_and_the_icon(project):
    arc = _install(project, [_mat("m1", "Scrap", 0.5)], {"Scrap": 4})
    _put("m1", quantity=-0.5)
    node = arc.bom[0].children[0]
    assert node.validation_status == "ok"                                   # the icon (already did, since #212)
    assert _counts(arc) == (1, 1, 0, 0)                                     # the banner reads warning_rows
    assert arc.validation_report.issues == [] and arc.validation_report.groups == []
    # and the route the panel uses returns the same refreshed report
    served = asyncio.run(bom_api.get_archetype_validation_report("A1"))
    assert served.warning_rows == 0 and served.groups == []


def test_the_banner_stays_when_the_warning_still_applies(project):
    arc = _install(project, [_mat("m1", "Scrap", 0.5)], {"Scrap": 4})
    _put("m1", quantity=0.7)                                                # still positive on a waste treatment
    assert _counts(arc) == (1, 0, 0, 1)
    (issue,) = arc.validation_report.issues
    assert issue.error_type == "waste_sign" and issue.row_idx == 4          # the sheet row survives the edit
    assert "0.7" in issue.message and "Row 4" in issue.message             # the content follows the new value
    assert arc.validation_report.groups[0].bad_value == "0.7"


def test_an_edit_that_introduces_a_warning_makes_the_banner_appear(project):
    arc = _install(project, [_mat("m1", "Scrap", -0.5)], {"Scrap": 4})
    assert _counts(arc) == (1, 1, 0, 0)
    _put("m1", quantity=0.5)
    assert _counts(arc) == (1, 0, 0, 1)
    assert arc.bom[0].children[0].validation_status == "warning"
    assert [i.error_type for i in arc.validation_report.issues] == ["waste_sign"]


def test_an_archetype_with_no_report_gets_one_when_an_edit_introduces_a_warning(project):
    """Made in the app, never imported: nothing stored, so nothing to show, until an edit finds something."""
    arc = _install(project, [_mat("m1", "Scrap", -0.5)], imported=False)
    assert arc.validation_report is None
    _put("m1", quantity=-0.4)                                               # still fine: no report invented
    assert arc.validation_report is None
    _put("m1", quantity=0.4)
    assert arc.validation_report is not None and arc.validation_report.warning_rows == 1
    assert arc.validation_report.valid_rows == 0                            # only the row seen so far is known


# ── only the edited rows change ─────────────────────────────────────────────

def test_other_rows_keep_their_findings_and_their_sheet_rows(project):
    arc = _install(project, [_mat("m1", "Scrap", 0.5), _mat("m2", "Ash", 0.9, WASTE2, "treatment of scrap, landfill")],
                   {"Scrap": 4, "Ash": 9})
    assert _counts(arc) == (2, 0, 0, 2)
    before = {i.name: (i.row_idx, i.message) for i in arc.validation_report.issues}
    _put("m1", quantity=-0.5)
    assert _counts(arc) == (2, 1, 0, 1)
    (left,) = arc.validation_report.issues
    assert left.name == "Ash" and (left.row_idx, left.message) == before["Ash"]       # untouched, row 9 intact


def test_a_unit_edit_is_validated_too(project):
    arc = _install(project, [_mat("m1", "Steel", 3.0, NORMAL, "normal process")], {"Steel": 5})
    assert _counts(arc) == (1, 1, 0, 0)
    _put("m1", unit="piece")                                                # a different QUANTITY KIND
    assert [i.error_type for i in arc.validation_report.issues] == ["unit_mismatch"]
    assert arc.validation_report.warning_rows == 1
    _put("m1", unit="kg")
    assert _counts(arc) == (1, 1, 0, 0)


def test_renaming_a_row_moves_its_finding_instead_of_duplicating_it(project):
    arc = _install(project, [_mat("m1", "Scrap", 0.5)], {"Scrap": 4})
    _put("m1", name="Scrap metal")
    (issue,) = arc.validation_report.issues
    assert issue.name == "Scrap metal" and issue.row_idx == 4
    assert _counts(arc) == (1, 0, 0, 1)


def test_deleting_a_warned_row_removes_its_finding(project):
    arc = _install(project, [_mat("m1", "Scrap", 0.5), _mat("m2", "Steel", 3.0, NORMAL, "normal process")],
                   {"Scrap": 4, "Steel": 5})
    assert _counts(arc) == (2, 1, 0, 1)
    asyncio.run(bom_api.delete_bom_node("A1", "m1"))
    assert _counts(arc) == (1, 1, 0, 0)
    assert arc.validation_report.issues == []


def test_adding_a_warned_row_adds_its_finding(project):
    arc = _install(project, [_mat("m2", "Steel", 3.0, NORMAL, "normal process")], {"Steel": 5})
    assert _counts(arc) == (1, 1, 0, 0)
    asyncio.run(bom_api.add_bom_node("A1", BOMNodeCreate(parent_node_id="s1", node=_mat("", "Scrap", 0.5))))
    assert _counts(arc) == (2, 1, 0, 1)
    assert [i.error_type for i in arc.validation_report.issues] == ["waste_sign"]


# ── what is deliberately left alone ─────────────────────────────────────────

def test_the_stage_advisory_is_not_recomputed_or_lost(project):
    arc = Archetype(id="A1", name="Pack", bom=[BOMNode(
        id="s1", name="Zorp", node_type="component", quantity=1.0, children=[_mat("m1", "Scrap", 0.5)])])
    bom_api._archetypes[project]["A1"] = arc
    vrows = [BOMValidationRow(archetype="Pack", stage="Zorp", row_idx=3, name="Scrap", database="fg", code=WASTE,
                              ecoinvent_name="treatment of waste, incineration", ecoinvent_location="GLO", unit="kg",
                              quantity=0.5, quantity_is_expression=False)]
    bom_api._apply_validation_to_archetype(arc, validate_bom(vrows, project_name=project))
    kinds = sorted(i.error_type for i in arc.validation_report.issues)
    assert kinds == ["stage_scope_defaulted", "waste_sign"]
    _put("m1", quantity=-0.5)
    assert [i.error_type for i in arc.validation_report.issues] == ["stage_scope_defaulted"]   # kept
    assert arc.validation_report.warning_rows == 0                          # an advisory is not a warning ROW


def test_an_unreachable_database_leaves_the_stored_report_untouched(project):
    arc = _install(project, [_mat("m1", "Scrap", 0.5)], {"Scrap": 4})
    before = arc.validation_report.model_dump()
    node = arc.bom[0].children[0]
    node.ecoinvent_activity = EcoinventLink(database="not-installed", code=WASTE, name="x", location="GLO", unit="kg")
    _put("m1", quantity=-0.5)
    assert arc.validation_report.model_dump() == before


def test_the_edit_route_still_returns_the_node_and_persists_the_archetype(project, monkeypatch):
    saved: list[Archetype] = []
    monkeypatch.setattr(bom_api, "_persist_archetype", lambda p, a: saved.append(a))
    _install(project, [_mat("m1", "Scrap", 0.5)], {"Scrap": 4})
    node = asyncio.run(bom_api.update_bom_node("A1", "m1", BOMNodeUpdate(quantity=-0.5)))
    assert node.quantity == -0.5 and node.validation_status == "ok"
    assert saved and saved[-1].validation_report.warning_rows == 0          # saved WITH the refreshed report
