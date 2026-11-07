# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Authored databases through Excel: template, export, all-or-nothing import.

The workbook hands the SAME inputs to the SAME engine, so the engine's own rules must reach the
user through Excel with a sheet, row and column. Driven through the fake backend the authored
tests already use (synthetic ecoinvent statistics), plus a throwaway Brightway directory for the
real backend's name lookup. No project, database or user data is touched.
"""
from __future__ import annotations

import gc
import io
import random
import shutil
import uuid
import zipfile

import bw2data
import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook, load_workbook

from mapper.api import authored as api
from mapper.core import authored_engine as eng
from mapper.core import authored_excel as xl
from mapper.core import authored_storage as store
from mapper.models.authored_schemas import AuthoredDatabase

BIO = "biosphere3"
GWP = ("EF v3.1", "climate change", "global warming potential (GWP100)")
ACID = ("EF v3.1", "acidification", "accumulated exceedance (AE)")
PED = (4, 4, 4, 4, 4)
LOW = (1, 1, 1, 1, 1)

CO2 = eng.FlowInfo(BIO, "co2", "Carbon dioxide, fossil", ("air",), "kilogram", "emission")
NH3 = eng.FlowInfo(BIO, "nh3", "Ammonia", ("air",), "kilogram", "emission")
NOX_STACK = eng.FlowInfo(BIO, "nox-stack", "Nitrogen oxides", ("air", "non-urban air or from high stacks"), "kilogram", "emission")
NOX_URBAN = eng.FlowInfo(BIO, "nox-urban", "Nitrogen oxides", ("air", "urban air close to ground"), "kilogram", "emission")
RARE = eng.FlowInfo(BIO, "rare", "Some rare emission", ("air",), "kilogram", "emission")     # ecoinvent measures nothing for it
TWIN_A = eng.FlowInfo(BIO, "twin-a", "Twin", ("air",), "kilogram", "emission")
TWIN_B = eng.FlowInfo(BIO, "twin-b", "Twin", ("air",), "kilogram", "emission")
RADON = eng.FlowInfo(BIO, "rn", "Radon-222", ("air",), "kilo Becquerel", "emission")
FLOWS = (CO2, NH3, NOX_STACK, NOX_URBAN, RARE, TWIN_A, TWIN_B, RADON)

STATS = {
    (BIO, "co2"): eng.FlowStats(4940, 1.573, 0.0006, 4000, ("ecoinvent-3.10-cutoff",)),
    (BIO, "nh3"): eng.FlowStats(3100, 1.6, 0.002, 2500, ("ecoinvent-3.10-cutoff",)),
    (BIO, "nox-stack"): eng.FlowStats(2422, 1.93, 0.08, 2000, ("ecoinvent-3.10-cutoff",)),
    (BIO, "nox-urban"): eng.FlowStats(1800, 1.9, 0.07, 1500, ("ecoinvent-3.10-cutoff",)),
    (BIO, "twin-a"): eng.FlowStats(500, 1.5, 0.01, 400, ("ecoinvent-3.10-cutoff",)),
    (BIO, "twin-b"): eng.FlowStats(500, 1.5, 0.01, 400, ("ecoinvent-3.10-cutoff",)),
    (BIO, "rn"): eng.FlowStats(500, 1.5, 0.01, 400, ("ecoinvent-3.10-cutoff",)),
    # RARE has no statistics at all: the variance and its reason must be entered
}
CF = {(BIO, "co2"): [(GWP, 1.0), (ACID, 0.0)], (BIO, "nh3"): [(ACID, 3.02)]}


class XlBackend:
    """The authored tests' fake backend plus the read-only name lookup the import uses."""

    def __init__(self, installed=(), cf_index=None):
        self.flows = {(f.database, f.code): f for f in FLOWS}
        self.dbs: dict[str, tuple[dict, str]] = {}
        self._installed = list(installed)
        self.cf_index = cf_index or {}
        self.writes = 0

    def flow(self, database, code):
        return self.flows.get((database, code))

    def flow_stats(self, database, code):
        return STATS.get((database, code))

    def installed(self):
        return [*self._installed, *self.dbs]

    def fingerprint_of(self, name):
        e = self.dbs.get(name)
        return None if e is None else e[1]

    def write(self, name, data, fp):
        self.writes += 1
        self.dbs[name] = (data, fp)

    def delete(self, name):
        self.dbs.pop(name, None)

    def reached_methods(self, flow_keys):
        from mapper.core.authored_coverage import reached

        return reached(flow_keys, self.cf_index)

    def find_flows(self, database, name, compartment):
        hits = [f for f in self.flows.values() if f.database == database and f.name.casefold() == (name or "").strip().casefold()]
        if compartment:
            hits = [f for f in hits if " / ".join(f.categories).casefold() == compartment.strip().casefold()]
        return sorted(hits, key=lambda f: (f.categories, f.code))


@pytest.fixture()
def client(monkeypatch):
    backend = XlBackend(installed=[BIO, "ecoinvent-3.10-cutoff"], cf_index=CF)
    monkeypatch.setattr(api, "_project", lambda: "P")
    monkeypatch.setattr(api, "get_backend", lambda project: backend)
    from mapper.api import bom

    monkeypatch.setattr(bom, "_archetypes", {"P": {}})
    from mapper.main import app

    c = TestClient(app)
    c.backend = backend
    return c


# ── building workbooks ───────────────────────────────────────────────────────


def A(key="a1", name="cathode", loc="GLO", unit="kilogram", ref=None, scope="complete", note=None, inds=None, comment=None):
    return [key, name, loc, unit, ref, scope, note, inds, comment]


def E(key="a1", db=BIO, code="co2", name=None, comp=None, amount=0.8, unit=None, ped=PED, basis=None, bv=None, reason=None, floor=None):
    return [key, db, code, name, comp, amount, unit, *ped, basis, bv, reason, floor]


def book(acts=None, excs=None, db=("mydb", "a description")) -> bytes:
    wb = xl._skeleton()
    xl._put(wb[xl.SHEET_DB], 2, list(db))
    for r, vals in enumerate(acts if acts is not None else [A()], start=2):
        xl._put(wb[xl.SHEET_ACT], r, vals)
    for r, vals in enumerate(excs if excs is not None else [E()], start=2):
        xl._put(wb[xl.SHEET_EXC], r, vals)
    return xl.workbook_bytes(wb)


XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def up(client, path, data, **params):
    return client.post(f"/api/authored-databases/excel/{path}", files={"file": ("w.xlsx", data, XLSX)}, params=params)


def untouched(client):
    assert store.load_definitions("P").databases == []
    assert client.backend.dbs == {} and client.backend.writes == 0


def err(resp_json, code):
    errors = resp_json["errors"] if "errors" in resp_json else resp_json["detail"]["errors"]
    hits = [e for e in errors if e["code"] == code]
    assert hits, f"no {code!r} in {[(e['code'], e['sheet'], e['row'], e['column']) for e in errors]}"
    return hits[0]


# ── the template ─────────────────────────────────────────────────────────────


def test_the_template_downloads_and_is_a_valid_workbook(client):
    r = client.get("/api/authored-databases/excel/template")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith(XLSX)
    assert "mapper_authored_database_template.xlsx" in r.headers["content-disposition"]
    wb = load_workbook(io.BytesIO(r.content))
    assert wb.sheetnames == ["Read me", "Database", "Activities", "Exchanges", "Lists"]


def test_the_template_has_headers_frozen_dropdowns_and_one_marked_example_per_sheet(client):
    wb = load_workbook(io.BytesIO(client.get("/api/authored-databases/excel/template").content))
    for name, cols in (("Database", xl.DB_COLUMNS), ("Activities", xl.ACT_COLUMNS), ("Exchanges", xl.EXC_COLUMNS)):
        ws = wb[name]
        assert [c.value for c in ws[1]] == cols
        assert ws.freeze_panes == "A2"
        assert ws.max_row == (2 if name != "Exchanges" else 3)        # the example(s), nothing else
    # one example ACTIVITY and its two exchanges (CO2 and ammonia), clearly marked
    assert wb["Activities"]["A2"].value.startswith("EXAMPLE")
    assert {wb["Exchanges"].cell(row=r, column=4).value for r in (2, 3)} == {"Carbon dioxide, fossil", "Ammonia"}
    assert "EXAMPLE" in wb["Database"]["B2"].value
    assert wb["Activities"]["A2"].fill.fgColor.rgb.endswith("FFF2CC")
    # dropdowns: scope, units and the five pedigree scores + uncertainty basis
    lists = [dv.formula1 for ws in (wb["Activities"], wb["Exchanges"]) for dv in ws.data_validations.dataValidation]
    assert len(lists) == 9                                       # Scope + Unit on Activities; Unit, basis, 5 scores on Exchanges
    assert any("$A$2:$A$3" in f for f in lists) and any("$B$2:$B$6" in f for f in lists)
    assert [c.value for c in wb["Lists"][1]] == ["Scope", "Pedigree score", "Uncertainty basis", "Units"]


def test_the_readme_states_the_rules_plainly(client):
    wb = load_workbook(io.BytesIO(client.get("/api/authored-databases/excel/template").content))
    text = "\n".join(f"{a.value} {b.value}" for a, b in wb["Read me"].iter_rows(max_col=2))
    assert "Template version" in text and f"\n{'Template version'} {xl.TEMPLATE_VERSION}" in "\n" + text
    assert "bv_not_settable" in text and "ecoinvent does NOT measure" in text
    assert "Comment fields are NOT supported yet" in text and "follow-up" in text
    assert "database Description" in text
    assert "never overwritten" in text and "All or nothing" in text


def test_the_untouched_template_is_refused_for_its_example_rows(client):
    data = client.get("/api/authored-databases/excel/template").content
    r = up(client, "validate", data)
    assert r.status_code == 200 and r.json()["ok"] is False
    ex = [e for e in r.json()["errors"] if e["code"] == "example_row"]
    assert {e["sheet"] for e in ex} == {"Activities", "Exchanges"}
    assert all("Delete it" in e["message"] for e in ex)
    assert up(client, "import", data).status_code == 422
    untouched(client)


def test_the_template_example_imports_once_the_examples_are_replaced(client):
    wb = load_workbook(io.BytesIO(client.get("/api/authored-databases/excel/template").content))
    wb["Activities"]["A2"] = "a1"
    wb["Exchanges"]["A2"] = "a1"
    wb["Exchanges"]["A3"] = "a1"
    buf = io.BytesIO()
    wb.save(buf)
    r = up(client, "import", buf.getvalue())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["preview"]["activities"] == 1 and body["preview"]["exchanges"] == 2
    assert body["preview"]["flows_resolved_by_name"] == 2                   # looked up by name + compartment
    stored = store.load_definitions("P").get("My authored database")
    codes = {e.flow.code for e in stored.activities[0].exchanges}
    assert codes == {"co2", "nh3"}
    # ecoinvent measures both, so the variance came from ecoinvent and the cell was blank
    assert {e.basic_variance_source for e in stored.activities[0].exchanges} == {"ecoinvent_median"}


# ── dry run and preview ──────────────────────────────────────────────────────


def test_validate_only_writes_nothing_and_previews(client):
    data = book(acts=[A("a1", "cathode", scope="partial", note="CO2 and NH3 only"), A("a2", "electrolyte")],
                excs=[E("a1", code=None, name="Carbon dioxide, fossil", comp="air"), E("a1", code="nh3"), E("a2", code="co2")])
    r = up(client, "validate", data)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["ok"] is True and j["errors"] == []
    p = j["preview"]
    assert (p["activities"], p["exchanges"], p["partial"], p["flows_resolved_by_name"]) == (2, 3, 1, 1)
    assert p["resolved_by_name"][0]["code"] == "co2" and p["resolved_by_name"][0]["row"] == 2
    assert [a["name"] for a in p["activity_list"]] == ["cathode", "electrolyte"]
    untouched(client)


def test_the_import_writes_through_the_engine_and_only_the_engine(client, monkeypatch):
    calls = {"build": 0, "resolve": 0, "materialize": 0}
    for fn, key in ((eng.build_activity, "build"), (eng.resolve_exchange, "resolve"), (eng.materialize, "materialize")):
        def wrap(*a, _fn=fn, _k=key, **kw):
            calls[_k] += 1
            return _fn(*a, **kw)
        monkeypatch.setattr(eng, fn.__name__, wrap)
    r = up(client, "import", book(acts=[A("a1", "cathode"), A("a2", "electrolyte")], excs=[E("a1"), E("a1", code="nh3"), E("a2")]))
    assert r.status_code == 200, r.text
    assert calls["build"] == 2 and calls["materialize"] == 1 and calls["resolve"] >= 3
    assert client.backend.writes == 1                                      # one materialisation, through the engine
    db = store.load_definitions("P").get("mydb")
    data, fp = client.backend.dbs["mydb"]
    assert fp == eng.fingerprint(db)
    assert {k[1] for k in data} == {a.code for a in db.activities}


# ── every error class: right place, nothing written ──────────────────────────


@pytest.mark.parametrize("label,acts,excs,db,sheet,row,column,code", [
    ("unknown flow code", None, [E(code="nope")], ("mydb", ""), "Exchanges", 2, "Flow code", "unknown_flow"),
    ("name matches two flows", None, [E(code=None, name="Twin", comp="air")], ("mydb", ""), "Exchanges", 2, "Compartment", "flow_ambiguous"),
    ("name without compartment is ambiguous", None, [E(code=None, name="Nitrogen oxides")], ("mydb", ""), "Exchanges", 2, "Flow name", "flow_ambiguous"),
    ("no such name", None, [E(code=None, name="Unobtainium", comp="air")], ("mydb", ""), "Exchanges", 2, "Flow name", "flow_not_found"),
    ("name in the wrong compartment", None, [E(code=None, name="Ammonia", comp="water")], ("mydb", ""), "Exchanges", 2, "Flow name", "flow_not_found"),
    ("no code and no name", None, [E(code=None)], ("mydb", ""), "Exchanges", 2, "Flow code", "flow_required"),
    ("missing pedigree", None, [E(ped=(3, None, 3, 3, 3))], ("mydb", ""), "Exchanges", 2, "Pedigree completeness", "pedigree_missing"),
    ("pedigree out of range", None, [E(ped=(3, 3, 7, 3, 3))], ("mydb", ""), "Exchanges", 2, "Pedigree temporal correlation", "pedigree_invalid"),
    ("zero amount", None, [E(amount=0)], ("mydb", ""), "Exchanges", 2, "Amount", "amount_not_positive"),
    ("negative amount", None, [E(amount=-1)], ("mydb", ""), "Exchanges", 2, "Amount", "negative_amount"),
    ("amount not a number", None, [E(amount="a lot")], ("mydb", ""), "Exchanges", 2, "Amount", "amount_not_number"),
    ("missing amount", None, [E(amount=None)], ("mydb", ""), "Exchanges", 2, "Amount", "amount_required"),
    ("non-biosphere flow database", None, [E(db="ecoinvent-3.10-cutoff", code="x")], ("mydb", ""), "Exchanges", 2, "Flow database", "not_biosphere"),
    ("database name with 'biosphere'", None, None, ("my-biosphere-copy", ""), "Database", 2, "Name", "database_name"),
    ("database name already installed", None, None, ("ecoinvent-3.10-cutoff", ""), "Database", 2, "Name", "database_name_taken"),
    ("unit mismatch", None, [E(unit="megajoule")], ("mydb", ""), "Exchanges", 2, "Unit", "unit_mismatch"),
    ("duplicate activity key", [A("a1", "x"), A("a1", "y")], [E("a1")], ("mydb", ""), "Activities", 3, "Activity key", "duplicate_key"),
    ("exchange for an unknown activity", None, [E("zzz")], ("mydb", ""), "Exchanges", 2, "Activity key", "unknown_activity"),
    ("activity without exchanges", [A("a1"), A("a2", "lonely")], [E("a1")], ("mydb", ""), "Activities", 3, "Activity key", "no_exchanges"),
    ("partial without a scope note", [A(scope="partial")], None, ("mydb", ""), "Activities", 2, "Scope note", "scope_note_required"),
    ("scope not chosen", [A(scope=None)], None, ("mydb", ""), "Activities", 2, "Scope", "scope_invalid"),
    ("same name and location twice", [A("a1", "same"), A("a2", "same")], [E("a1"), E("a2")], ("mydb", ""), "Activities", 3, "Name", "duplicate_name"),
    ("the same flow twice in one activity", None, [E(), E()], ("mydb", ""), "Activities", 2, "Activity key", "invalid"),
    ("indicator the flows do not reach", [A(scope="partial", note="CO2 only", inds="EF v3.1 › acidification › accumulated exceedance (AE)")],
     [E(code="nox-stack")], ("mydb", ""), "Activities", 2, "Complete indicators", "indicator_not_reached"),
    ("variance entered where ecoinvent has one", None, [E(bv=0.0001, reason="mine")], ("mydb", ""), "Exchanges", 2, "Basic variance", "bv_not_settable"),
    ("flow ecoinvent does not measure: variance missing", None, [E(code="rare")], ("mydb", ""), "Exchanges", 2, "Basic variance", "bv_required"),
    ("flow ecoinvent does not measure: reason missing", None, [E(code="rare", bv=0.05)], ("mydb", ""), "Exchanges", 2, "Basic variance reason", "bv_reason_required"),
    ("tighter than ecoinvent without a reason", None, [E(ped=LOW)], ("mydb", ""), "Exchanges", 2, "Floor reason", "below_floor"),
    ("supplied basis without a variance", None, [E(basis="supplied")], ("mydb", ""), "Exchanges", 2, "Basic variance", "bv_required"),
    ("supplied basis with a floor reason", None, [E(basis="supplied", bv=0.05, reason="EPD", floor="x")], ("mydb", ""), "Exchanges", 2, "Floor reason", "floor_reason_not_applicable"),
    ("unknown uncertainty basis", None, [E(basis="guess")], ("mydb", ""), "Exchanges", 2, "Uncertainty basis", "basis_invalid"),
])
def test_each_error_class_names_sheet_row_column_and_writes_nothing(client, label, acts, excs, db, sheet, row, column, code):
    data = book(acts=acts, excs=excs, db=db)
    dry = up(client, "validate", data)
    assert dry.status_code == 200 and dry.json()["ok"] is False, label
    e = err(dry.json(), code)
    assert (e["sheet"], e["row"], e["column"]) == (sheet, row, column), (label, e)
    real = up(client, "import", data)
    assert real.status_code == 422, label
    assert real.json()["detail"]["error"] == "authored_excel_invalid"
    assert "nothing was imported" in real.json()["detail"]["message"]
    err(real.json(), code)
    untouched(client)


def test_every_error_is_reported_not_just_the_first(client):
    data = book(excs=[E(code="nope"), E(code="co2", amount=-1), E(code="nh3", ped=(3, 3, None, 3, 3))])
    errors = up(client, "validate", data).json()["errors"]
    assert {(e["row"], e["code"]) for e in errors} == {(2, "unknown_flow"), (3, "negative_amount"), (4, "pedigree_missing")}


def test_the_ambiguity_error_lists_the_candidates(client):
    e = err(up(client, "validate", book(excs=[E(code=None, name="Twin", comp="air")])).json(), "flow_ambiguous")
    assert "twin-a" in e["message"] and "twin-b" in e["message"] and "guess" in e["message"]
    e = err(up(client, "validate", book(excs=[E(code=None, name="Nitrogen oxides")])).json(), "flow_ambiguous")
    assert "non-urban air or from high stacks" in e["message"] and "urban air close to ground" in e["message"]
    e = err(up(client, "validate", book(excs=[E(code=None, name="Ammonia", comp="water")])).json(), "flow_not_found")
    assert "Flows with that name" in e["message"] and "nh3" in e["message"]


def test_a_compartment_picks_one_of_two_flows_that_share_a_name(client):
    r = up(client, "import", book(excs=[E(code=None, name="Nitrogen oxides", comp="air / non-urban air or from high stacks")]))
    assert r.status_code == 200, r.text
    ex = store.load_definitions("P").get("mydb").activities[0].exchanges[0]
    assert ex.flow.code == "nox-stack"


def test_a_code_that_contradicts_its_name_or_compartment_is_refused(client):
    e = err(up(client, "validate", book(excs=[E(code="nh3", name="Methane")])).json(), "flow_name_mismatch")
    assert e["column"] == "Flow name" and "Ammonia" in e["message"]
    e = err(up(client, "validate", book(excs=[E(code="nh3", comp="water")])).json(), "compartment_mismatch")
    assert e["column"] == "Compartment"
    # kg is the same unit as kilogram: spelling is not a mismatch
    assert up(client, "validate", book(excs=[E(code="nh3", name="Ammonia", comp="air", unit="kg")])).json()["ok"] is True


def test_the_engine_rules_apply_through_excel_for_a_flow_ecoinvent_does_not_measure(client):
    # with a value AND a reason it imports, recorded as the user's own number
    r = up(client, "import", book(excs=[E(code="rare", bv=0.05, reason="measured at the plant, 2025")]))
    assert r.status_code == 200, r.text
    ex = store.load_definitions("P").get("mydb").activities[0].exchanges[0]
    assert ex.basic_variance == 0.05 and ex.basic_variance_source == "user_entered"
    assert ex.basic_variance_detail == "measured at the plant, 2025"
    assert ex.floor_status == "unfloored"


def test_an_existing_database_name_is_refused_and_the_first_is_untouched(client):
    assert up(client, "import", book()).status_code == 200
    before = store.load_definitions("P").get("mydb").model_dump()
    r = up(client, "import", book(acts=[A("a1", "other")]))
    assert r.status_code == 422
    assert any("already" in e["message"] for e in r.json()["detail"]["errors"])
    assert store.load_definitions("P").get("mydb").model_dump() == before
    assert client.backend.writes == 1
    # there is no replace path: no route, and no parameter, offers one
    for route in api.router.routes:
        assert "replace" not in route.path.lower()
        assert all("replace" not in p.name.lower() for p in getattr(route, "dependant", None).query_params) if getattr(route, "dependant", None) else True


def test_a_taken_database_name_is_reported_once_with_a_clear_text(client):
    """An authored database is both an installed bw2 database and an authored definition, so the
    two name checks fired together and the same clash came back as two errors."""
    assert up(client, "import", book()).status_code == 200
    r = up(client, "validate", book(acts=[A("a1", "other")]))
    body = r.json()
    name_errors = [e for e in body["errors"] if e["sheet"] == "Database"]
    assert len(name_errors) == 1                                   # once, not twice
    e = name_errors[0]
    assert (e["row"], e["column"], e["code"]) == (2, "Name", "database_name_taken")
    assert e["message"] == "A database named 'mydb' already exists. Choose another name."
    # the name the file asked for is kept, so the dialog can prefill it
    assert body["preview"]["requested_name"] == "mydb" and body["preview"]["database"] is None


def test_a_name_installed_in_the_project_alone_is_also_one_error(client):
    r = up(client, "validate", book(db=("ecoinvent-3.10-cutoff", "")))
    name_errors = [e for e in r.json()["errors"] if e["sheet"] == "Database"]
    assert [e["code"] for e in name_errors] == ["database_name_taken"]
    assert r.json()["preview"]["requested_name"] == "ecoinvent-3.10-cutoff"


def test_other_name_problems_keep_their_own_code_and_still_come_once(client):
    r = up(client, "validate", book(db=("my-biosphere-copy", "")))
    name_errors = [e for e in r.json()["errors"] if e["sheet"] == "Database"]
    assert [e["code"] for e in name_errors] == ["database_name"]


def test_an_accepted_name_is_the_database_and_the_requested_name(client):
    body = up(client, "validate", book(db=("fresh", ""))).json()
    assert body["ok"] is True
    assert body["preview"]["database"] == "fresh" and body["preview"]["requested_name"] == "fresh"
    # an override is what was requested
    body = up(client, "validate", book(db=("fresh", "")), name="other").json()
    assert body["preview"]["requested_name"] == "other"


def test_the_import_name_can_be_overridden_and_is_still_checked(client):
    assert up(client, "import", book(db=("mydb", "")), name="renamed").status_code == 200
    assert store.load_definitions("P").get("renamed") is not None and store.load_definitions("P").get("mydb") is None
    assert up(client, "import", book(db=("x", "")), name="renamed").status_code == 422


def test_a_project_mismatch_header_stops_the_import(client):
    r = client.post("/api/authored-databases/excel/import", files={"file": ("w.xlsx", book(), XLSX)},
                    headers={"X-Mapper-Project": "some-other-project"})
    assert r.status_code == 409
    untouched(client)


def test_unsupported_columns_are_ignored_with_a_plain_warning(client):
    wb = load_workbook(io.BytesIO(book()))
    wb["Exchanges"]["Q1"] = "Comment"
    wb["Exchanges"]["Q2"] = "from the supplier"
    wb["Activities"]["J1"] = "Description"
    wb["Activities"]["J2"] = "long text"
    buf = io.BytesIO()
    wb.save(buf)
    j = up(client, "validate", buf.getvalue()).json()
    assert j["ok"] is True
    text = " ".join(j["warnings"])
    assert "'Comment' column is not supported yet" in text and "'Description' column is not supported yet" in text


# ── the file itself ──────────────────────────────────────────────────────────


def test_formula_cells_are_rejected_not_evaluated(client):
    wb = load_workbook(io.BytesIO(book()))
    wb["Exchanges"]["F2"] = "=0.4*2"                     # an amount that would evaluate to 0.8
    wb["Activities"]["B2"] = '=HYPERLINK("http://x","y")'
    buf = io.BytesIO()
    wb.save(buf)
    r = up(client, "validate", buf.getvalue())
    forms = [e for e in r.json()["errors"] if e["code"] == "formula"]
    assert {(e["sheet"], e["row"], e["column"]) for e in forms} == {("Exchanges", 2, "Amount"), ("Activities", 2, "Name")}
    assert all("Formulas are not accepted" in e["message"] for e in forms)
    assert up(client, "import", buf.getvalue()).status_code == 422
    untouched(client)


def test_a_file_that_is_not_xlsx_is_rejected(client):
    r = up(client, "validate", b"just some text, not a workbook")
    assert r.status_code == 400 and r.json()["detail"]["error"] == "authored_excel_rejected"
    assert "not a valid zip" in r.json()["detail"]["message"]
    r = up(client, "validate", b"")
    assert r.status_code == 400
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("hello.txt", "a zip, but not a workbook")
    r = up(client, "import", buf.getvalue())
    assert r.status_code == 400 and "workbook parts are missing" in r.json()["detail"]["message"]
    untouched(client)


def test_an_oversized_file_is_rejected_before_it_is_parsed(client, monkeypatch):
    monkeypatch.setattr(xl, "MAX_BYTES", 2000)
    r = up(client, "validate", book())
    assert r.status_code == 413 and "limit" in r.json()["detail"]["message"]


def test_a_zip_bomb_is_rejected(client):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("xl/workbook.xml", "<workbook/>")
        z.writestr("xl/worksheets/sheet1.xml", b"\0" * (3 * 1024 * 1024))     # ~3 KB compressed
    assert len(buf.getvalue()) < xl.MAX_BYTES
    r = up(client, "validate", buf.getvalue())
    assert r.status_code == 413 and "compression ratio" in r.json()["detail"]["message"]


def test_too_many_rows_are_rejected(client, monkeypatch):
    monkeypatch.setattr(xl, "MAX_ROWS", 3)
    r = up(client, "validate", book(acts=[A(f"a{i}", f"n{i}") for i in range(6)], excs=[E(f"a{i}") for i in range(6)]))
    assert r.status_code == 413 and "more than 3 rows" in r.json()["detail"]["message"]


def test_a_missing_sheet_or_column_is_named(client):
    wb = load_workbook(io.BytesIO(book()))
    del wb["Exchanges"]
    buf = io.BytesIO()
    wb.save(buf)
    e = err(up(client, "validate", buf.getvalue()).json(), "missing_sheet")
    assert e["sheet"] == "Exchanges"
    wb = load_workbook(io.BytesIO(book()))
    wb["Exchanges"]["F1"] = "Quantity"                    # the Amount header renamed
    buf = io.BytesIO()
    wb.save(buf)
    e = err(up(client, "validate", buf.getvalue()).json(), "missing_column")
    assert (e["sheet"], e["row"], e["column"]) == ("Exchanges", 1, "Amount")


def test_a_newer_template_version_is_refused(client):
    wb = load_workbook(io.BytesIO(book()))
    ws = wb["Read me"]
    for row in ws.iter_rows(max_col=2):
        if row[0].value == "Template version":
            row[1].value = "9"
    buf = io.BytesIO()
    wb.save(buf)
    assert err(up(client, "validate", buf.getvalue()).json(), "template_version")["sheet"] == "Read me"


# ── formula neutralisation ───────────────────────────────────────────────────


def test_neutralise_is_exactly_reversible_and_never_leaves_a_trigger_first():
    rng = random.Random(7)
    alphabet = "'=+-@ \tax"
    for _ in range(4000):
        s = "".join(rng.choice(alphabet) for _ in range(rng.randint(0, 8)))
        n = xl.neutralise(s)
        assert xl.restore(n) == s, repr(s)
        assert not n or n[0] not in "=+-@\t\r", repr(s)
    assert xl.neutralise("=cmd") == "'=cmd" and xl.neutralise("'=x") == "''=x" and xl.neutralise("'abc") == "'abc"
    assert xl.neutralise(3.5) == 3.5 and xl.neutralise(None) is None


def _make_db(client, **names):
    client.post("/api/authored-databases", json={"name": "src", "description": "=SUM(A1)"})
    payload = {"name": names.get("name", "plain"), "unit": "kilogram", "scope": "partial",
               "scope_note": names.get("note", "x"), "comment": names.get("comment", ""),
               "exchanges": [{"flow_code": "co2", "amount": 0.8, "pedigree": dict(zip(xl.INDICATORS, PED))}]}
    return client.post("/api/authored-databases/src/activities", json=payload)


def test_export_neutralises_formula_text_and_import_restores_it_exactly(client):
    hostile = {"name": "=cmd|' /C calc'!A0", "note": "@SUM(1+1)", "comment": "-2+3"}
    assert _make_db(client, **hostile).status_code == 200
    r = client.get("/api/authored-databases/src/export")
    assert r.status_code == 200
    wb = load_workbook(io.BytesIO(r.content))
    cells = [c for ws in wb.worksheets for row in ws.iter_rows() for c in row if isinstance(c.value, str)]
    for want in ("'=cmd|' /C calc'!A0", "'@SUM(1+1)", "'-2+3", "'=SUM(A1)"):
        hit = [c for c in cells if c.value == want]
        assert hit, want
        assert all(c.data_type == "s" for c in hit)                          # text, never a formula cell
    assert not any(c.data_type == "f" for c in cells)
    # and back: the same text, under a new name
    r2 = up(client, "import", r.content, name="copy")
    assert r2.status_code == 200, r2.text
    copy = store.load_definitions("P").get("copy")
    a = copy.activities[0]
    assert (a.name, a.scope_note, a.comment, copy.description) == (hostile["name"], hostile["note"], hostile["comment"], "=SUM(A1)")


def test_a_name_that_already_starts_with_an_apostrophe_survives(client):
    assert _make_db(client, name="'=odd", note="'quoted").status_code == 200
    xlsx = client.get("/api/authored-databases/src/export").content
    assert up(client, "import", xlsx, name="copy").status_code == 200
    a = store.load_definitions("P").get("copy").activities[0]
    assert (a.name, a.scope_note) == ("'=odd", "'quoted")


# ── round trip ───────────────────────────────────────────────────────────────


def _exchange_view(e):
    return (e.flow.database, e.flow.code, e.flow.name, tuple(e.flow.categories), e.flow.unit, e.amount,
            tuple(sorted(e.pedigree.items())), e.basic_variance, e.basic_variance_source, e.basic_variance_detail,
            e.uncertainty_basis, e.floor_status, e.floor_reason, e.sigma, e.gsd2)


def test_export_then_import_round_trips_every_field(client):
    client.post("/api/authored-databases", json={"name": "src", "description": "Cathode and electrolyte"})
    ped = lambda t: dict(zip(xl.INDICATORS, t))                              # noqa: E731
    acts = [
        {"name": "NaNFM442 cathode", "reference_product": "cathode", "unit": "kilogram", "location": "CN", "comment": "pilot line",
         "scope": "partial", "scope_note": "direct emissions only", "complete_indicators": [list(ACID)],
         "exchanges": [{"flow_code": "nh3", "amount": 0.02, "pedigree": ped(PED)},
                       {"flow_code": "co2", "amount": 0.8, "pedigree": ped(LOW), "floor_reason": "continuous stack measurement"},
                       {"flow_code": "rare", "amount": 1.5e-7, "pedigree": ped((2, 3, 4, 3, 2)), "basic_variance": 0.05,
                        "basic_variance_reason": "plant measurement, 2025"}]},
        {"name": "LATP electrolyte", "unit": "kilogram", "scope": "complete",
         "exchanges": [{"flow_code": "co2", "amount": 0.123456789012345, "pedigree": ped(PED)},
                       {"flow_code": "rn", "amount": 3.0, "pedigree": ped(PED), "uncertainty_basis": "supplied",
                        "basic_variance": 0.02, "basic_variance_reason": "supplier EPD 2025"}]},
    ]
    for a in acts:
        r = client.post("/api/authored-databases/src/activities", json=a)
        assert r.status_code == 200, r.text
    xlsx = client.get("/api/authored-databases/src/export").content
    wb = load_workbook(io.BytesIO(xlsx))
    assert [c.value for c in wb["Exchanges"][1]] == xl.EXC_COLUMNS
    r = up(client, "import", xlsx, name="copy")
    assert r.status_code == 200, r.text
    defs = store.load_definitions("P")
    src, cp = defs.get("src"), defs.get("copy")
    assert cp.description == src.description == "Cathode and electrolyte"
    assert len(cp.activities) == len(src.activities) == 2
    for a, b in zip(src.activities, cp.activities):
        assert (a.name, a.reference_product, a.unit, a.location, a.comment, a.scope, a.scope_note, a.complete_indicators) == \
               (b.name, b.reference_product, b.unit, b.location, b.comment, b.scope, b.scope_note, b.complete_indicators)
        assert a.code != b.code                                              # codes are minted new
        assert [_exchange_view(e) for e in a.exchanges] == [_exchange_view(e) for e in b.exchanges]
    # the variance is written only where the user supplied it
    ws = wb["Exchanges"]
    rows = {}
    for r_ in range(2, ws.max_row + 1):
        vals = [c.value for c in ws[r_]]
        rows.setdefault(vals[2], vals)                                       # first activity's row per flow code
    idx = {name: i for i, name in enumerate(xl.EXC_COLUMNS)}
    assert rows["nh3"][idx["Basic variance"]] is None and rows["nh3"][idx["Uncertainty basis"]] == "ecoinvent"
    assert rows["rare"][idx["Basic variance"]] == 0.05 and rows["rare"][idx["Basic variance reason"]] == "plant measurement, 2025"
    assert rows["rn"][idx["Uncertainty basis"]] == "supplied" and rows["rn"][idx["Basic variance reason"]] == "supplier EPD 2025"
    assert [r_ for k, r_ in rows.items() if k == "co2"][0][idx["Floor reason"]] == "continuous stack measurement"
    # a second round trip is stable too
    again = client.get("/api/authored-databases/copy/export").content
    assert up(client, "import", again, name="copy2").status_code == 200
    third = store.load_definitions("P").get("copy2")
    assert [_exchange_view(e) for a in third.activities for e in a.exchanges] == [_exchange_view(e) for a in src.activities for e in a.exchanges]


def test_export_of_an_unknown_database_is_a_404(client):
    assert client.get("/api/authored-databases/nope/export").status_code == 404


# ── the real backend's lookup by name (throwaway Brightway directory) ─────────


@pytest.fixture()
def bw_project():
    projects = bw2data.projects
    original = projects.current
    temp_dir = projects._use_temp_directory()
    try:
        projects.set_current(f"pytest-authxl-{uuid.uuid4().hex[:8]}")
        bw2data.Database(BIO).write({
            (BIO, "a"): {"name": "Ammonia", "categories": ("air",), "unit": "kilogram", "type": "emission", "code": "a"},
            (BIO, "b"): {"name": "Ammonia", "categories": ("air", "non-urban air or from high stacks"), "unit": "kilogram", "type": "emission", "code": "b"},
            (BIO, "c"): {"name": "Ammonia", "categories": ("water",), "unit": "kilogram", "type": "emission", "code": "c"},
            (BIO, "i"): {"name": "Ammonia", "categories": ("air",), "unit": "kilogram", "type": "inventory indicator", "code": "i"},
        })
        yield projects
    finally:
        projects._restore_orig_directory()
        projects.set_current(original, update=False)
        gc.collect()
        shutil.rmtree(temp_dir, ignore_errors=True)


def test_the_real_backend_finds_flows_by_exact_name_and_full_compartment(bw_project):
    b = eng.Bw2Backend()
    assert [f.code for f in b.find_flows(BIO, "ammonia", None)] == ["a", "b", "c"]               # case-insensitive, exact name, no indicator
    assert [f.code for f in b.find_flows(BIO, "Ammonia", "air")] == ["a"]                         # 'air' is not 'air / non-urban ...'
    assert [f.code for f in b.find_flows(BIO, "Ammonia", "air / non-urban air or from high stacks")] == ["b"]
    assert b.find_flows(BIO, "Ammon", None) == [] and b.find_flows("nope", "Ammonia", None) == []
    flows = b.find_flows(BIO, "Ammonia", "water")
    assert flows[0].unit == "kilogram" and flows[0].type == "emission"


def test_check_file_itself_enforces_the_size_limit(monkeypatch):
    monkeypatch.setattr(xl, "MAX_BYTES", 1000)
    with pytest.raises(xl.WorkbookRejected) as exc:
        xl.check_file(b"x" * 1001)
    assert exc.value.status == 413
