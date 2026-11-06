# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Two BOM link problems that used to surface late or not at all.

1. A BOM row linked to a biosphere FLOW. Its 36-character uuid was reported as
   ``code_truncated`` ("likely a typo"), a 32-character one as ``code_not_found``, and one that
   got past validation reached the solver and came back as an HTTP 500 ("Can't find key
   'Carbon dioxide, fossil' ... in product dictionary"). Now: the import refuses the file with the
   real reason and the sheet, row and column, writing nothing; the validator reports
   ``biosphere_link`` before any code-shape check; and the compute path answers 422.

2. A POSITIVE quantity on a waste-treatment activity. ecoinvent writes the production amount of a
   treatment as NEGATIVE and every input pointing at one as negative too (in 3.11: 4,619 such
   activities, 45,778 of 45,778 inputs). MApper puts the quantity straight into the demand, so a
   positive quantity comes out as a credit (measured: +0.5 gave -0.15, -0.5 gave +0.15). Now a
   WARNING, never an error; a negative quantity on a normal activity is a legitimate credit and
   is not flagged.

Synthetic data in a throwaway Brightway directory only.
"""
from __future__ import annotations

import asyncio
import gc
import io
import shutil
import uuid

import bw2data
import pytest
from fastapi import HTTPException
from openpyxl import Workbook

from mapper.api import bom as bom_api
from mapper.api.lca import _calculate_archetype_lca_sync
from mapper.core.bom_validator import (
    BOMValidationRow, find_biosphere_link_rows, is_biosphere_link, refuse_on_biosphere_link,
    BiosphereLinkError, validate_bom, waste_sign_applies,
)
from mapper.models.bom_schemas import Archetype, BOMNode, EcoinventLink
from mapper.models.schemas import ArchetypeLCACalculateRequest

BIO = "biosphere3"
FLOW_UUID = "349b29d1-3e58-4c66-98b9-9d1a076efd2e"      # a real flow's shape: 36 characters
FLOW_HEX = "c" * 32                                      # a flow whose code happens to be 32 characters
NORMAL = "1" * 32
WASTE = "2" * 32
GWP = ("EF v3.1", "climate change", "global warming potential (GWP100)")


@pytest.fixture()
def bw_project():
    projects = bw2data.projects
    original = projects.current
    temp_dir = projects._use_temp_directory()
    try:
        projects.set_current(f"pytest-bomlink-{uuid.uuid4().hex[:8]}")
        bw2data.Database(BIO).write({
            (BIO, FLOW_UUID): {"name": "Carbon dioxide, fossil", "categories": ("air",), "unit": "kilogram",
                               "type": "emission", "code": FLOW_UUID},
            (BIO, FLOW_HEX): {"name": "Ammonia", "categories": ("air",), "unit": "kilogram",
                              "type": "emission", "code": FLOW_HEX},
        })
        meth = bw2data.Method(GWP)
        meth.register(unit="kg CO2-Eq")
        meth.write([((BIO, FLOW_UUID), 1.0)])
        bw2data.Database("fg").write({
            ("fg", NORMAL): {"name": "normal process", "code": NORMAL, "unit": "kilogram", "location": "GLO",
                             "type": "process", "reference product": "x", "exchanges": [
                {"input": ("fg", NORMAL), "output": ("fg", NORMAL), "amount": 1.0, "type": "production", "unit": "kilogram"},
                {"input": (BIO, FLOW_UUID), "output": ("fg", NORMAL), "amount": 0.5, "type": "biosphere", "unit": "kilogram"}]},
            # what ecoinvent writes for a treatment: production amount -1
            ("fg", WASTE): {"name": "treatment of waste, incineration", "code": WASTE, "unit": "kilogram",
                            "location": "GLO", "type": "process", "reference product": "waste", "exchanges": [
                {"input": ("fg", WASTE), "output": ("fg", WASTE), "amount": -1.0, "type": "production", "unit": "kilogram"},
                {"input": (BIO, FLOW_UUID), "output": ("fg", WASTE), "amount": 0.3, "type": "biosphere", "unit": "kilogram"}]},
        })
        yield projects
    finally:
        projects._restore_orig_directory()
        projects.set_current(original, update=False)
        gc.collect()
        shutil.rmtree(temp_dir, ignore_errors=True)


def row(db, code, qty=1.0, *, idx=3, name="row", unit="kg", expr=False, quantity=...):
    return BOMValidationRow(
        archetype="Pack", stage="Manufacturing", row_idx=idx, name=name, database=db, code=code, unit=unit,
        quantity=qty if quantity is ... else quantity, quantity_is_expression=expr,
    )


def kinds(report):
    return [(i.severity, i.error_type) for i in report.issues if i.error_type != "stage_scope_defaulted"]


# ── 1. a biosphere flow is not an activity ───────────────────────────────────


def test_a_flow_uuid_under_biosphere3_is_a_biosphere_link_not_a_truncated_code(bw_project):
    rep = validate_bom([row(BIO, FLOW_UUID)], "p")
    assert kinds(rep) == [("error", "biosphere_link")]
    msg = rep.issues[0].message
    assert "BOM sheet, row 3" in msg and "'Ecoinvent Database' / 'Ecoinvent Code'" in msg
    assert "cannot link a biosphere flow" in msg and "authored activity" in msg
    assert "truncated" not in msg
    assert rep.error_rows == 1


def test_a_32_character_flow_code_is_a_biosphere_link_not_code_not_found(bw_project):
    assert kinds(validate_bom([row(BIO, FLOW_HEX)], "p")) == [("error", "biosphere_link")]
    # the same flow code under a non-biosphere database name
    assert kinds(validate_bom([row("fg", FLOW_HEX)], "p")) == [("error", "biosphere_link")]


def test_a_flow_uuid_pasted_under_an_ordinary_database_name_is_still_found(bw_project):
    assert kinds(validate_bom([row("fg", FLOW_UUID)], "p")) == [("error", "biosphere_link")]


def test_the_check_comes_before_the_code_shape_checks(bw_project):
    # even when the database does not exist in the project, the biosphere NAME decides first
    assert kinds(validate_bom([row("my-biosphere-v2", "short")], "p")) == [("error", "biosphere_link")]


def test_ordinary_links_and_real_typos_keep_their_old_errors(bw_project):
    assert kinds(validate_bom([row("fg", NORMAL, 1.0)], "p")) == []
    assert kinds(validate_bom([row("fg", "abc")], "p")) == [("error", "code_truncated")]
    assert kinds(validate_bom([row("fg", "9" * 32)], "p")) == [("error", "code_not_found")]
    assert kinds(validate_bom([row("nope", NORMAL)], "p")) == [("error", "database_missing")]


def test_an_ordinary_row_costs_no_biosphere_lookup(bw_project):
    assert is_biosphere_link("fg", NORMAL) is False
    cache: dict = {}
    assert is_biosphere_link("fg", NORMAL, cache) is False
    assert cache == {}                       # 32-character code, ordinary database: nothing was queried


# ── 1b. at import: refuse the file, write nothing ────────────────────────────


class _Upload:
    def __init__(self, data: bytes) -> None:
        self._data = data

    async def read(self) -> bytes:
        return self._data


def _workbook(rows, multi=True) -> bytes:
    wb = Workbook()
    if multi:
        ws = wb.active
        ws.title = "Archetypes"
        ws.append(["archetype_name", "folder", "description"])
        ws.append(["Pack", "", ""])
        bom = wb.create_sheet("BOM")
        bom.append(["archetype_name", "Stage", "Parent", "Name", "Type", "Quantity", "Unit",
                    "Ecoinvent Database", "Ecoinvent Code"])
        bom.append(["Pack", "End of Life", "", "End of Life", "component", 1, "", "", ""])
        for name, q, db, code in rows:
            bom.append(["Pack", "End of Life", "End of Life", name, "material", q, "kg", db, code])
    else:
        bom = wb.active
        bom.title = "BOM"
        bom.append(["Stage", "Parent", "Name", "Type", "Quantity", "Unit", "Ecoinvent Database", "Ecoinvent Code"])
        bom.append(["End of Life", "", "End of Life", "component", 1, "", "", ""])
        for name, q, db, code in rows:
            bom.append(["End of Life", "End of Life", name, "material", q, "kg", db, code])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


@pytest.fixture()
def store(monkeypatch, bw_project):
    name = "test-bom-link-validation"
    saved: list = []
    monkeypatch.setattr(bom_api, "_current_project", lambda: name)
    bom_api._archetypes[name] = {}
    bom_api._cohort_mappings[name] = {}
    monkeypatch.setattr(bom_api.dsm_storage, "save_archetype", lambda *a, **k: saved.append(a))
    monkeypatch.setattr(bom_api.dsm_storage, "delete_archetype_file", lambda *a, **k: None)
    yield name, saved
    bom_api._archetypes.pop(name, None)
    bom_api._cohort_mappings.pop(name, None)


def _import(data: bytes, mode: str = "merge"):
    return asyncio.run(bom_api.import_archetype(file=_Upload(data), mode=mode))  # type: ignore[arg-type]


@pytest.mark.parametrize("multi", [True, False])
def test_import_refuses_a_biosphere_row_with_sheet_row_column_and_writes_nothing(store, multi):
    name, saved = store
    data = _workbook([("Steel", 5, "fg", NORMAL), ("CO2 to air", 0.8, BIO, FLOW_UUID)], multi=multi)
    with pytest.raises(HTTPException) as exc:
        _import(data)
    assert exc.value.status_code == 422
    d = exc.value.detail
    assert d["error"] == "bom_biosphere_link"
    assert "nothing was imported" in d["message"] and "authored activity" in d["message"]
    assert len(d["rows"]) == 1
    r = d["rows"][0]
    assert r["sheet"] == "BOM"
    assert r["row"] == (4 if multi else 4)            # header, stage root, Steel, then the CO2 row
    assert r["columns"] == ["Ecoinvent Database", "Ecoinvent Code"]
    assert r["name"] == "CO2 to air" and r["code"] == FLOW_UUID
    # nothing written: no archetype in memory, none persisted
    assert bom_api._archetypes[name] == {}
    assert saved == []


def test_a_refused_replace_import_does_not_wipe_the_library(store):
    name, saved = store
    bom_api._archetypes[name]["keep"] = Archetype(id="keep", name="Existing", bom=[
        BOMNode(id="s", name="Manufacturing", node_type="component", quantity=1.0)])
    with pytest.raises(HTTPException):
        _import(_workbook([("CO2", 1, BIO, FLOW_UUID)]), "replace")
    assert set(bom_api._archetypes[name]) == {"keep"}
    assert saved == []


def test_a_clean_import_is_unaffected(store):
    name, saved = store
    res = _import(_workbook([("Steel", 5, "fg", NORMAL)]))
    assert res.created == 1 and len(bom_api._archetypes[name]) == 1
    assert res.archetypes[0].validation_error_rows == 0


# ── 1c. the compute path: 422, never a 500, and no result moves ──────────────


def _archetype(rows) -> Archetype:
    kids = [BOMNode(id=f"m{i}", name=n, node_type="material", quantity=q, unit="kg",
                    ecoinvent_activity=EcoinventLink(database=db, code=code, name=n))
            for i, (n, q, db, code) in enumerate(rows)]
    return Archetype(id="arc", name="Pack", bom=[BOMNode(
        id="s", name="End of Life", node_type="component", quantity=1.0, scope="outflows", children=kids)])


def _calc(store, rows):
    name, _ = store
    bom_api._archetypes[name]["arc"] = _archetype(rows)
    return _calculate_archetype_lca_sync(ArchetypeLCACalculateRequest(
        archetype_id="arc", scope="all", methods=[list(GWP)]))


def test_a_biosphere_row_reaching_compute_answers_422_with_the_same_message(store):
    with pytest.raises(HTTPException) as exc:
        _calc(store, [("CO2 to air", 0.8, BIO, FLOW_UUID)])
    assert exc.value.status_code == 422                      # not the old 500
    d = exc.value.detail
    assert d["error"] == "biosphere_link"
    assert "cannot link a biosphere flow" in d["message"] and "authored activity" in d["message"]
    assert "product dictionary" not in d["message"]


def test_the_refusal_helper_only_looks_at_biosphere_rows():
    class M:
        def __init__(self, name, db, code):
            self.name, self.ecoinvent_activity = name, EcoinventLink(database=db, code=code, name=name)

    refuse_on_biosphere_link("ctx", [M("a", "ecoinvent-3.11-cutoff", NORMAL), M("b", "fg", "2" * 32)])   # no raise
    with pytest.raises(BiosphereLinkError):
        refuse_on_biosphere_link("ctx", [M("a", "fg", NORMAL), M("co2", BIO, FLOW_UUID)])


def test_a_successful_calculation_is_unchanged(store):
    # normal: 2 kg x 0.5 kg CO2/kg = 1.0; with a treatment row at the ecoinvent sign: -0.5 kg waste
    # x 0.3 = +0.15 burden. Pinned to the bit (bw2calc solves in float32, hence the tail): these are
    # the values origin/main gave for the same fixture, compared when the PR was made.
    res = _calc(store, [("steel", 2.0, "fg", NORMAL)])
    assert repr(res.results[0].score) == "1.0"
    res = _calc(store, [("steel", 2.0, "fg", NORMAL), ("waste", -0.5, "fg", WASTE)])
    assert repr(res.results[0].score) == "1.1500000059604645"
    # a POSITIVE waste row still computes (it is only warned about): the credit, unchanged
    res = _calc(store, [("waste", 0.5, "fg", WASTE)])
    assert repr(res.results[0].score) == "-0.15000000596046448"


# ── 2. the waste-treatment sign ──────────────────────────────────────────────


def test_a_positive_quantity_on_a_treatment_warns_but_the_row_is_not_an_error(bw_project):
    rep = validate_bom([row("fg", WASTE, 0.5)], "p")
    assert kinds(rep) == [("warning", "waste_sign")]
    assert rep.error_rows == 0 and rep.warning_rows == 1 and rep.valid_rows == 0
    msg = rep.issues[0].message
    assert "column 'Quantity' (0.5)" in msg and "waste treatment" in msg
    assert "NEGATIVE quantity" in msg and "credit, not a burden" in msg


@pytest.mark.parametrize("db,code,qty,expect", [
    ("fg", WASTE, 0.5, True),      # positive on negative production: the trap
    ("fg", WASTE, -0.5, False),    # negative on negative: the ecoinvent convention
    ("fg", NORMAL, 0.5, False),    # positive on positive: normal
    ("fg", NORMAL, -0.5, False),   # negative on positive: a legitimate avoided-burden entry
    ("fg", WASTE, 0.0, False),
])
def test_the_sign_matrix(bw_project, db, code, qty, expect):
    rep = validate_bom([row(db, code, qty)], "p")
    assert (("warning", "waste_sign") in kinds(rep)) is expect


def test_an_expression_row_is_skipped_and_so_is_a_row_with_no_quantity(bw_project):
    # An expression has no value until the parameters resolve, so it is not judged here.
    assert kinds(validate_bom([row("fg", WASTE, 1.0, expr=True)], "p")) == []
    assert kinds(validate_bom([row("fg", WASTE, quantity=None)], "p")) == []   # older callers


def test_the_production_amount_is_read_once_per_activity(bw_project):
    rows = [row("fg", WASTE, 0.5, idx=i) for i in range(3, 9)]
    rep = validate_bom(rows, "p")
    assert sum(1 for i in rep.issues if i.error_type == "waste_sign") == 6
    # one existence check + one resolve + ONE production read for six rows of the same link
    assert rep.bw2_lookups == 3 and rep.cache_hits >= 15


def test_waste_sign_applies_is_exactly_positive_on_negative():
    assert waste_sign_applies(1.0, -1.0) and not waste_sign_applies(-1.0, -1.0)
    assert not waste_sign_applies(1.0, 1.0) and not waste_sign_applies(-1.0, 1.0)
    assert not waste_sign_applies(None, -1.0) and not waste_sign_applies(1.0, None)


def test_a_positive_waste_row_imports_with_the_warning_on_the_report_and_the_row(store):
    name, saved = store
    res = _import(_workbook([("Steel", 5, "fg", NORMAL), ("Scrap treatment", 0.5, "fg", WASTE)]))
    assert res.created == 1 and res.archetypes[0].validation_error_rows == 0
    assert res.archetypes[0].validation_warning_rows == 1
    arc = next(iter(bom_api._archetypes[name].values()))
    report = res.validation_reports[arc.id]
    assert [i.error_type for i in report.issues if i.error_type == "waste_sign"] == ["waste_sign"]
    stage = arc.bom[0]
    rows = {n.name: n for n in stage.children}
    assert rows["Scrap treatment"].validation_status == "warning"
    assert "waste treatment" in (rows["Scrap treatment"].validation_message or "")
    assert rows["Steel"].validation_status == "ok"
    assert saved                                  # imported and persisted: a warning never blocks


def test_a_negative_waste_row_imports_clean(store):
    name, _ = store
    res = _import(_workbook([("Scrap treatment", -0.5, "fg", WASTE)]))
    assert res.archetypes[0].validation_warning_rows == 0


# ── 2b. the editor row: fixing the sign clears the warning ───────────────────


def _put(arc_id, node_id, **body):
    from mapper.models.bom_schemas import BOMNodeUpdate

    return asyncio.run(bom_api.update_bom_node(arc_id, node_id, BOMNodeUpdate(**body)))


def test_editing_the_quantity_re_checks_the_row(store, monkeypatch):
    name, _ = store
    monkeypatch.setattr(bom_api, "_persist_archetype", lambda *a, **k: None)
    _import(_workbook([("Scrap treatment", 0.5, "fg", WASTE)]))
    arc = next(iter(bom_api._archetypes[name].values()))
    node = arc.bom[0].children[0]
    assert node.validation_status == "warning"
    fixed = _put(arc.id, node.id, quantity=-0.5)
    assert fixed.validation_status == "ok" and fixed.validation_message is None
    flipped = _put(arc.id, node.id, quantity=0.25)
    assert flipped.validation_status == "warning" and "waste treatment" in flipped.validation_message


def test_an_edit_does_not_flip_a_row_to_error_when_its_database_is_absent(store, monkeypatch):
    name, _ = store
    monkeypatch.setattr(bom_api, "_persist_archetype", lambda *a, **k: None)
    bom_api._archetypes[name]["arc"] = _archetype([("ghost", 1.0, "not-installed", NORMAL)])
    node = bom_api._archetypes[name]["arc"].bom[0].children[0]
    node.validation_status, node.validation_message = "ok", None
    after = _put("arc", node.id, quantity=2.0)
    assert after.validation_status == "ok"        # an environment problem is not a finding about the row


# ── the workbook's own rules ─────────────────────────────────────────────────


def test_the_template_instructions_state_both_rules():
    from openpyxl import load_workbook

    resp = asyncio.run(bom_api.download_bom_template())
    wb = load_workbook(io.BytesIO(resp.body), data_only=True)
    text = " ".join(str(c) for r in wb["Instructions"].iter_rows(values_only=True) for c in r if c)
    assert "cannot link a biosphere flow" in text and "authored activity" in text
    assert "NEGATIVE quantity" in text and "credit, not a burden" in text
