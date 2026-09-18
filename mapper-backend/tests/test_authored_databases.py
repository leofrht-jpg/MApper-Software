# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Authored databases (step 2: backend, no UI).

Driven through a fake Brightway backend so they run in CI, which has no
ecoinvent and no biosphere. The live end-to-end check -- an authored activity
linked from a BOM row, computed and Monte-Carlo-sampled -- was run against a
throwaway Brightway project and is recorded in the PR, not repeated here.

Numbers used below are ecoinvent 3.10 cutoff's own, measured when the step was
scoped: NOx to non-urban air / high stacks has a median GSD2 of 1.93 over 2,422
lognormal exchanges and a median basic variance of 0.08.
"""
from __future__ import annotations

import io
import json
import math
import tarfile

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from mapper.api import authored as api
from mapper.core import authored_engine as eng
from mapper.core import authored_storage as store
from mapper.core import project_storage as ps
from mapper.core.pedigree import gsd2_from_sigma, total_sigma
from mapper.models.authored_schemas import (
    ActivityInput,
    AuthoredActivity,
    AuthoredDefinitions,
    AuthoredExchange,
    ExchangeInput,
)
from mapper.models.bom_schemas import Archetype, BOMNode, EcoinventLink

BIO = "biosphere3"
PED_LOW = {"reliability": 1, "completeness": 1, "temporal correlation": 1,
           "geographical correlation": 1, "further technological correlation": 1}
PED_HIGH = {"reliability": 4, "completeness": 4, "temporal correlation": 4,
            "geographical correlation": 4, "further technological correlation": 4}

NOX = eng.FlowInfo(BIO, "nox-stack", "Nitrogen oxides",
                   ("air", "non-urban air or from high stacks"), "kilogram", "emission")
CO2 = eng.FlowInfo(BIO, "co2", "Carbon dioxide, fossil",
                   ("air", "urban air close to ground"), "kilogram", "emission")
RARE = eng.FlowInfo(BIO, "rare", "Some rare emission", ("air",), "kilogram", "emission")
FEW = eng.FlowInfo(BIO, "few", "Thinly sampled emission", ("air",), "kilogram", "emission")
NOBV = eng.FlowInfo(BIO, "nobv", "Emission without basic variance", ("air",), "kilogram", "emission")
IND = eng.FlowInfo(BIO, "ind", "An indicator", (), "kilogram", "inventory indicator")

STATS = {
    (BIO, "nox-stack"): eng.FlowStats(2422, 1.93, 0.08, 2000, ("ecoinvent-3.10-cutoff",)),
    (BIO, "co2"): eng.FlowStats(4940, 1.573, 0.0006, 4000, ("ecoinvent-3.10-cutoff",)),
    (BIO, "few"): eng.FlowStats(3, 1.196, 0.05, 3, ("ecoinvent-3.10-cutoff",)),
    (BIO, "nobv"): eng.FlowStats(50, 1.6, None, 0, ("ecoinvent-3.10-cutoff",)),
}


class FakeBackend:
    def __init__(self, flows=(NOX, CO2, RARE, FEW, NOBV, IND), stats=None, installed=()):
        self.flows = {(f.database, f.code): f for f in flows}
        self.stats = STATS if stats is None else stats
        self.dbs: dict[str, tuple[dict, str]] = {}
        self._installed = list(installed)
        self.fail_write = False

    def flow(self, database, code):
        return self.flows.get((database, code))

    def flow_stats(self, database, code):
        return self.stats.get((database, code))

    def installed(self):
        return [*self._installed, *self.dbs]

    def fingerprint_of(self, name):
        entry = self.dbs.get(name)
        return None if entry is None else entry[1]

    def write(self, name, data, fp):
        if self.fail_write:
            raise RuntimeError("simulated Brightway failure")
        self.dbs[name] = (data, fp)

    def delete(self, name):
        self.dbs.pop(name, None)


def ex(flow=NOX, amount=0.01, pedigree=None, **kw) -> ExchangeInput:
    return ExchangeInput(flow_database=flow.database, flow_code=flow.code, amount=amount,
                         pedigree=pedigree or PED_HIGH, **kw)


def act(exchanges, scope="complete", **kw) -> ActivityInput:
    return ActivityInput(name=kw.pop("name", "boiler"), unit="kilogram", scope=scope,
                         exchanges=exchanges, **kw)


# ── Coverage declaration: required from the first write ────────────────────

def test_scope_is_required_with_no_default():
    with pytest.raises(ValidationError, match="scope"):
        ActivityInput(name="a", unit="kilogram", exchanges=[ex()])


def test_partial_scope_requires_a_note():
    with pytest.raises(ValidationError, match="scope_note"):
        act([ex()], scope="partial")
    act([ex()], scope="partial", scope_note="CO2 only; other flows not known")


def test_complete_scope_needs_no_note():
    assert act([ex()], scope="complete").scope_note is None


# ── Pedigree: all five, always ─────────────────────────────────────────────

def test_a_partial_pedigree_is_refused():
    partial = {"reliability": 2}
    with pytest.raises(ValidationError, match="all five"):
        ExchangeInput(flow_code="x", amount=1.0, pedigree=partial)


# ── Amounts ────────────────────────────────────────────────────────────────

def test_negative_amounts_are_refused_with_a_reason():
    with pytest.raises(eng.AuthoredError, match="not supported in this version"):
        eng.resolve_exchange(ex(amount=-1.0), FakeBackend())


def test_only_biosphere_exchanges_can_be_authored():
    bad = ExchangeInput(flow_database="ecoinvent-3.10-cutoff", flow_code="x",
                        amount=1.0, pedigree=PED_HIGH)
    with pytest.raises(eng.AuthoredError, match="biosphere exchanges only"):
        eng.resolve_exchange(bad, FakeBackend())


def test_non_emission_flow_types_are_refused():
    with pytest.raises(eng.AuthoredError, match="cannot be authored"):
        eng.resolve_exchange(ex(IND), FakeBackend())


# ── Basic variance comes from ecoinvent, per flow ──────────────────────────

def test_basic_variance_is_ecoinvents_median_for_that_flow():
    r = eng.resolve_exchange(ex(NOX), FakeBackend())
    assert r.basic_variance == 0.08
    assert r.basic_variance_source == "ecoinvent_median"
    assert "2000 exchanges" in r.basic_variance_detail
    assert r.sigma == pytest.approx(total_sigma(PED_HIGH, 0.08))


def test_basic_variance_cannot_be_overridden_where_ecoinvent_has_one():
    """Otherwise a user could lower it and slip under the floor unnoticed."""
    with pytest.raises(eng.AuthoredError, match="not user-settable"):
        eng.resolve_exchange(ex(NOX, basic_variance=0.0001, basic_variance_reason="x"),
                             FakeBackend())


def test_every_exchange_is_lognormal_never_fixed():
    data = eng.to_bw2(_db([_act_obj()]))
    bio = [e for a in data.values() for e in a["exchanges"] if e["type"] == "biosphere"]
    assert bio and all(e["uncertainty type"] == 2 for e in bio)
    assert all(e["scale"] > 0 for e in bio)


# ── The floor ──────────────────────────────────────────────────────────────

def test_above_the_floor_is_floored():
    r = eng.resolve_exchange(ex(NOX, pedigree=PED_HIGH), FakeBackend())
    assert r.gsd2 >= 1.93 and r.floor_status == "floored" and r.floor_gsd2 == 1.93


def test_below_the_floor_without_a_reason_is_refused():
    with pytest.raises(eng.AuthoredError, match="below ecoinvent's median"):
        eng.resolve_exchange(ex(NOX, pedigree=PED_LOW), FakeBackend())


def test_below_the_floor_with_a_reason_is_stored_on_the_exchange():
    r = eng.resolve_exchange(ex(NOX, pedigree=PED_LOW, floor_reason="Measured at stack, n=40"),
                             FakeBackend())
    assert r.floor_status == "below_floor_with_reason"
    assert r.floor_reason == "Measured at stack, n=40"
    assert r.gsd2 < r.floor_gsd2 == 1.93


# ── Where no floor can be applied, it says so ──────────────────────────────

def test_a_flow_ecoinvent_never_scores_needs_a_user_variance_and_reason():
    with pytest.raises(eng.AuthoredError) as err:
        eng.resolve_exchange(ex(RARE), FakeBackend())
    text = " ".join(err.value.problems)
    assert "basic_variance must be entered" in text and "basic_variance_reason is required" in text


def test_a_user_entered_variance_is_stored_with_its_reason_and_marked_unfloored():
    r = eng.resolve_exchange(
        ex(RARE, basic_variance=0.2, basic_variance_reason="Supplier range, factor 2"),
        FakeBackend())
    assert r.basic_variance == 0.2
    assert r.basic_variance_source == "user_entered"
    assert r.basic_variance_detail == "Supplier range, factor 2"
    assert r.floor_status == "unfloored" and r.floor_gsd2 is None
    assert "no floor applied" in r.floor_detail


def test_too_few_ecoinvent_exchanges_means_no_floor_and_no_derived_variance():
    """A median over three exchanges is not a statement about the flow."""
    assert STATS[(BIO, "few")].n_lognormal < eng.MIN_FLOOR_SAMPLES
    r = eng.resolve_exchange(
        ex(FEW, basic_variance=0.1, basic_variance_reason="assumed"), FakeBackend())
    assert r.floor_status == "unfloored" and r.basic_variance_source == "user_entered"
    assert "3 lognormal" in r.floor_detail


def test_a_floor_still_applies_when_only_the_basic_variance_is_missing():
    with pytest.raises(eng.AuthoredError, match="below ecoinvent's median"):
        eng.resolve_exchange(
            ex(NOBV, pedigree=PED_LOW, basic_variance=0.0, basic_variance_reason="assumed"),
            FakeBackend())


def test_the_activity_flags_an_unfloored_exchange_and_the_file_says_so():
    a = eng.build_activity(
        act([ex(NOX), ex(RARE, basic_variance=0.2, basic_variance_reason="range")]),
        FakeBackend(), eng.new_code())
    assert a.has_unfloored_exchange is True
    dumped = json.loads(a.model_dump_json())
    assert dumped["has_unfloored_exchange"] is True
    statuses = {e["flow"]["code"]: e["floor_status"] for e in dumped["exchanges"]}
    assert statuses == {"nox-stack": "floored", "rare": "unfloored"}


def test_every_problem_is_reported_at_once():
    with pytest.raises(eng.AuthoredError) as err:
        eng.build_activity(act([ex(amount=-1), ex(RARE)]), FakeBackend(), eng.new_code())
    assert len(err.value.problems) >= 3


# ── A hand-edited file cannot carry inconsistent numbers ───────────────────

def test_a_stored_sigma_that_disagrees_with_its_scores_is_refused():
    good = eng.resolve_exchange(ex(NOX), FakeBackend()).model_dump()
    good["sigma"] = good["sigma"] / 2
    good["gsd2"] = gsd2_from_sigma(good["sigma"])
    with pytest.raises(ValidationError, match="does not match"):
        AuthoredExchange(**good)


def test_a_stored_unfloored_exchange_cannot_carry_a_floor():
    r = eng.resolve_exchange(ex(RARE, basic_variance=0.2, basic_variance_reason="r"), FakeBackend())
    d = r.model_dump()
    d["floor_gsd2"] = 1.5
    with pytest.raises(ValidationError, match="unfloored"):
        AuthoredExchange(**d)


# ── What gets written to Brightway ─────────────────────────────────────────

def _act_obj(**kw):
    return eng.build_activity(act([ex(NOX), ex(CO2, amount=3.0)], **kw), FakeBackend(), eng.new_code())


def _db(acts, name="my-authored"):
    from mapper.models.authored_schemas import AuthoredDatabase

    return AuthoredDatabase(name=name, created_at="t", updated_at="t", activities=acts)


def test_the_written_activity_has_the_mandatory_structure():
    a = _act_obj()
    data = eng.to_bw2(_db([a]))
    (key, d), = data.items()
    assert key == ("my-authored", a.code) and len(a.code) == 32
    assert d["type"] == "process" and d["production amount"] == 1.0
    prod = [e for e in d["exchanges"] if e["type"] == "production"]
    assert prod == [{"input": key, "output": key, "amount": 1.0, "type": "production",
                     "unit": "kilogram", "uncertainty type": 0}]
    types = {e["type"] for e in d["exchanges"]}
    assert types == {"production", "biosphere"}, "no technosphere exchange may be written"
    nox = next(e for e in d["exchanges"] if e["input"] == (BIO, "nox-stack"))
    assert nox["loc"] == pytest.approx(math.log(0.01))
    assert nox["scale"] == pytest.approx(total_sigma(PED_HIGH, 0.08))
    assert nox["scale without pedigree"] == pytest.approx(math.sqrt(0.08))


def test_codes_are_minted_not_derived_from_the_name():
    assert eng.new_code() != eng.new_code()


# ── Names ──────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("bad, why", [
    ("my biosphere data", "biosphere"),
    ("x_premise_y", "premise"),
    ("mapper-tailpipe", "reserved"),
    ("ecoinvent-3.10-cutoff", "already installed"),
    ("", "required"),
])
def test_database_names_that_would_break_are_refused(bad, why):
    with pytest.raises(eng.AuthoredError, match=why):
        eng.validate_database_name(bad, ["ecoinvent-3.10-cutoff"], AuthoredDefinitions())


# ── Routes ─────────────────────────────────────────────────────────────────

@pytest.fixture()
def client(monkeypatch):
    backend = FakeBackend(installed=["biosphere3", "ecoinvent-3.10-cutoff"])
    monkeypatch.setattr(api, "_project", lambda: "P")
    monkeypatch.setattr(api, "get_backend", lambda project: backend)
    from mapper.api import bom

    monkeypatch.setattr(bom, "_archetypes", {"P": {}})
    from mapper.main import app

    c = TestClient(app)
    c.backend = backend
    return c


def _payload(**kw):
    body = {"name": "boiler", "unit": "kilogram", "scope": "complete",
            "exchanges": [{"flow_code": "nox-stack", "amount": 0.01, "pedigree": PED_HIGH}]}
    body.update(kw)
    return body


def test_create_add_and_the_file_records_scope_and_floor(client):
    assert client.post("/api/authored-databases", json={"name": "mine"}).status_code == 200
    r = client.post("/api/authored-databases/mine/activities", json=_payload())
    assert r.status_code == 200, r.text
    code = r.json()["code"]
    on_disk = json.loads(store.definitions_path("P").read_text())
    stored = on_disk["databases"][0]["activities"][0]
    assert stored["code"] == code and stored["scope"] == "complete"
    assert stored["exchanges"][0]["floor_status"] == "floored"
    assert "has_unfloored_exchange" in stored
    data, _ = client.backend.dbs["mine"]
    assert ("mine", code) in data


def test_a_validation_failure_names_every_problem(client):
    client.post("/api/authored-databases", json={"name": "mine"})
    r = client.post("/api/authored-databases/mine/activities", json=_payload(
        exchanges=[{"flow_code": "nox-stack", "amount": 0.01, "pedigree": PED_LOW}]))
    assert r.status_code == 422
    assert r.json()["detail"]["error"] == "authored_validation_failed"
    assert any("floor_reason" in p for p in r.json()["detail"]["problems"])


def test_an_update_keeps_the_code_so_links_survive(client):
    client.post("/api/authored-databases", json={"name": "mine"})
    code = client.post("/api/authored-databases/mine/activities", json=_payload()).json()["code"]
    r = client.put(f"/api/authored-databases/mine/activities/{code}",
                   json=_payload(name="boiler, renamed"))
    assert r.status_code == 200 and r.json()["code"] == code


def test_nothing_is_saved_when_the_brightway_write_fails(client):
    client.post("/api/authored-databases", json={"name": "mine"})
    before = store.definitions_path("P").read_text()
    client.backend.fail_write = True
    with pytest.raises(RuntimeError):
        client.post("/api/authored-databases/mine/activities", json=_payload())
    assert store.definitions_path("P").read_text() == before


def _linked(code):
    row = BOMNode(id="r1", name="Heat", node_type="material", quantity=1.0, unit="kg",
                  ecoinvent_activity=EcoinventLink(database="mine", code=code,
                                                   name="boiler", unit="kg"))
    return {"a1": Archetype(id="a1", name="House", bom=[
        BOMNode(id="s1", name="Use Phase", node_type="component", children=[row])])}


def test_a_linked_activity_cannot_be_deleted(client, monkeypatch):
    client.post("/api/authored-databases", json={"name": "mine"})
    code = client.post("/api/authored-databases/mine/activities", json=_payload()).json()["code"]
    from mapper.api import bom

    monkeypatch.setattr(bom, "_archetypes", {"P": _linked(code)})
    r = client.delete(f"/api/authored-databases/mine/activities/{code}")
    assert r.status_code == 409 and r.json()["detail"]["links"] == ["House > Heat"]
    r = client.delete("/api/authored-databases/mine")
    assert r.status_code == 409


def test_an_unlinked_activity_can_be_deleted(client):
    client.post("/api/authored-databases", json={"name": "mine"})
    code = client.post("/api/authored-databases/mine/activities", json=_payload()).json()["code"]
    assert client.delete(f"/api/authored-databases/mine/activities/{code}").status_code == 200
    assert client.delete("/api/authored-databases/mine").status_code == 200
    assert "mine" not in client.backend.dbs


def test_a_corrupt_definition_file_is_refused_and_left_untouched(client):
    f = store.definitions_path("P")
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text("{not json")
    r = client.post("/api/authored-databases", json={"name": "mine"})
    assert r.status_code == 409 and "left untouched" in r.json()["detail"]
    assert f.read_text() == "{not json"


# ── Rebuilding after import ────────────────────────────────────────────────

def _defs_with_one(backend):
    defs = AuthoredDefinitions(databases=[_db([_act_obj()])])
    return defs


def test_reconcile_reports_in_sync_then_pending_then_rebuilt():
    b = FakeBackend()
    defs = _defs_with_one(b)
    first = eng.reconcile(defs, b)
    assert [s.state for s in first] == ["rebuilt"]
    assert [s.state for s in eng.reconcile(defs, b)] == ["in_sync"]

    fresh = FakeBackend(flows=())  # e.g. a modelling-only import, no biosphere yet
    pending = eng.reconcile(defs, fresh)
    assert pending[0].state == "pending" and "is not installed" in pending[0].detail
    assert "my-authored" not in fresh.dbs


def test_a_key_that_means_a_different_flow_here_is_not_rebuilt():
    b = FakeBackend()
    defs = _defs_with_one(b)
    moved = eng.FlowInfo(BIO, "nox-stack", "Nitrogen oxides", ("air",), "kilogram", "emission")
    other = FakeBackend(flows=(moved, CO2))
    s = eng.reconcile(defs, other)[0]
    assert s.state == "pending" and "authored as Nitrogen oxides" in s.detail


def test_a_modelling_only_export_carries_the_definition_and_rebuilds_identically(tmp_path):
    b = FakeBackend()
    defs = _defs_with_one(b)
    store.save_definitions("Src", defs)
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        ps.write_archive_storage(tf, "Src", "Src", mode="modelling")
    ex_dir = tmp_path / "ex"
    ex_dir.mkdir()
    with tarfile.open(fileobj=io.BytesIO(buf.getvalue())) as tf:
        tf.extractall(ex_dir)
    ps.install_archive_storage(ex_dir / "Src", "Dst")

    imported = store.load_definitions("Dst")
    assert imported.model_dump() == defs.model_dump()

    src_b, dst_b = FakeBackend(), FakeBackend()
    eng.reconcile(defs, src_b)
    eng.reconcile(imported, dst_b)
    assert dst_b.dbs == src_b.dbs, "the rebuilt database differs from the original"


# ── Export manifest ────────────────────────────────────────────────────────

def test_authored_databases_are_not_listed_as_licensed_base(monkeypatch):
    store.save_definitions("P", _defs_with_one(FakeBackend()))

    class _DBs:
        def __iter__(self):
            return iter(["biosphere3", "ecoinvent-3.10-cutoff", "my-authored"])

    import bw2data

    monkeypatch.setattr(bw2data, "databases", _DBs())
    inv = ps.database_inventory("P", {})
    assert inv["authored"] == ["my-authored"]
    assert "my-authored" not in inv["installed_base"]
    assert "rebuilt automatically" in inv["authored_rebuild"].lower()
