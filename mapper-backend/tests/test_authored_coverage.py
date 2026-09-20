# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""'Not specified' gaps: which indicators a partial authored activity cannot speak for.

A CO2-only boiler declared PARTIAL covers climate change and nothing else; its
acidification contribution is unknown, not zero. The same boiler declared
COMPLETE produces no gap -- there a missing flow really is zero.
"""
from __future__ import annotations

import pytest

from mapper.core import authored_coverage as cov
from mapper.core import authored_engine as eng
from mapper.models.authored_schemas import AuthoredDatabase, AuthoredDefinitions
from mapper.models.bom_schemas import Archetype, BOMNode, EcoinventLink

from tests.test_authored_databases import CO2, NOX, FakeBackend, act, ex

GW = ("EF v3.1", "climate change", "global warming potential (GWP100)")
AC = ("EF v3.1", "acidification", "accumulated exceedance (AE)")
PM = ("EF v3.1", "particulate matter formation", "impact on human health")
CF_INDEX = {
    ("biosphere3", "co2"): [(GW, 1.0)],
    ("biosphere3", "nox-stack"): [(AC, 0.74), (PM, 2.1e-7)],
}


def _activity(flows, scope, name="boiler", ticks=()):
    note = {"scope_note": "CO2 only; NOx and particulates not measured"} if scope == "partial" else {}
    return eng.build_activity(
        act([ex(f) for f in flows], scope=scope, name=name,
            complete_indicators=[list(t) for t in ticks], **note),
        FakeBackend(cf_index=CF_INDEX), eng.new_code())


def _defs(*acts, name="mine"):
    return AuthoredDefinitions(databases=[AuthoredDatabase(name=name, created_at="t", updated_at="t",
                                                           activities=list(acts))])


def _arc(*links, nested=False):
    leaves = [BOMNode(name=f"m{i}", node_type="material", quantity=1.0, unit="kilogram",
                      ecoinvent_activity=EcoinventLink(database=db, code=code, name="x"))
              for i, (db, code) in enumerate(links)]
    if nested:
        leaves = [BOMNode(name="sub", node_type="component", quantity=1.0, unit="unit", children=leaves)]
    return Archetype(id="a", name="A", bom=[BOMNode(name="Manufacturing", node_type="component",
                                                    quantity=1.0, unit="unit", children=leaves)])


def test_nothing_ticked_means_every_indicator_is_marked():
    """The honest reading of an unfinished declaration: nothing is complete."""
    boiler = _activity([CO2], "partial")
    gaps = cov.gaps({("mine", boiler.code)}, [GW, AC, PM], cov.partial_activities(_defs(boiler)), CF_INDEX)
    assert [(tuple(g.method), g.kind) for g in gaps] == [
        (GW, "not_declared"),   # CO2 contributes -- but that is not "suffices"
        (AC, "not_reached"),
        (PM, "not_reached"),
    ]
    assert {g.activity_name for g in gaps} == {"boiler"}
    assert gaps[0].scope_note.startswith("CO2 only")


def test_a_ticked_reached_indicator_is_specified():
    boiler = _activity([CO2], "partial", ticks=[GW])
    gaps = cov.gaps({("mine", boiler.code)}, [GW, AC, PM], cov.partial_activities(_defs(boiler)), CF_INDEX)
    assert [tuple(g.method) for g in gaps] == [AC, PM]


def test_a_factor_is_not_sufficiency():
    """The flare case: CH4-like flow reaches AC, author did not tick it -> still marked."""
    both = _activity([CO2, NOX], "partial", ticks=[GW])
    gaps = cov.gaps({("mine", both.code)}, [GW, AC, PM], cov.partial_activities(_defs(both)), CF_INDEX)
    assert [(tuple(g.method), g.kind) for g in gaps] == [(AC, "not_declared"), (PM, "not_declared")]


def test_a_factor_of_zero_still_counts_as_reached():
    """A zero factor is the method speaking: tickable, and specified once ticked."""
    idx = {("biosphere3", "co2"): [(GW, 1.0), (AC, 0.0)]}
    boiler = eng.build_activity(
        act([ex(CO2)], scope="partial", scope_note="CO2 only", complete_indicators=[list(AC), list(GW)]),
        FakeBackend(cf_index=idx), eng.new_code())
    assert cov.gaps({("mine", boiler.code)}, [GW, AC], cov.partial_activities(_defs(boiler)), idx) == []


def test_the_floor_refuses_a_tick_no_flow_reaches_at_save():
    with pytest.raises(eng.AuthoredError) as e:
        _activity([CO2], "partial", ticks=[GW, AC])
    assert e.value.codes == ["indicator_not_reached"]
    assert "acidification" in e.value.problems[0]


def test_the_floor_is_reapplied_at_compute():
    """A tick whose reach was lost since saving (method reinstalled) stays marked."""
    boiler = _activity([CO2], "partial", ticks=[GW])
    gaps = cov.gaps({("mine", boiler.code)}, [GW], cov.partial_activities(_defs(boiler)), {})
    assert [(tuple(g.method), g.kind) for g in gaps] == [(GW, "not_reached")]


def test_a_complete_activity_carries_no_ticks():
    from pydantic import ValidationError

    with pytest.raises(ValidationError, match="only for a PARTIAL"):
        act([ex(CO2)], scope="complete", complete_indicators=[list(GW)])


def test_ticks_are_deduplicated_and_ordered():
    boiler = _activity([CO2, NOX], "partial", ticks=[PM, GW, PM, AC])
    assert boiler.complete_indicators == sorted([list(AC), list(GW), list(PM)])


def test_unlinked_partial_activities_do_not_mark_a_result():
    linked = _activity([CO2], "partial", name="linked")
    other = _activity([CO2], "partial", name="unlinked")
    gaps = cov.gaps({("mine", linked.code)}, [AC], cov.partial_activities(_defs(linked, other)), CF_INDEX)
    assert [g.activity_name for g in gaps] == ["linked"]


def test_gaps_follow_the_run_method_order_then_activity():
    a = _activity([CO2], "partial", name="a")
    b = _activity([CO2], "partial", name="b")
    partial = cov.partial_activities(_defs(a, b))
    gaps = cov.gaps({("mine", a.code), ("mine", b.code)}, [PM, AC], partial, CF_INDEX)
    assert [tuple(g.method) for g in gaps][:2] == [PM, PM]
    assert [tuple(g.method) for g in gaps][2:] == [AC, AC]


def test_link_keys_walk_nested_components():
    keys = cov.link_keys([_arc(("mine", "abc"), ("ecoinvent-3.10-cutoff", "x"), nested=True)])
    assert keys == {("mine", "abc"), ("ecoinvent-3.10-cutoff", "x")}


# ── The loader ──────────────────────────────────────────────────────────────

def test_no_partial_activity_means_the_index_is_never_built(monkeypatch):
    from mapper.core import flow_characterisation as fc

    monkeypatch.setattr(fc, "characterisation_index", lambda bd: pytest.fail("index built"))
    boiler = _activity([CO2], "complete")
    from mapper.core import authored_storage

    authored_storage.save_definitions("P", _defs(boiler))
    assert cov.coverage_gaps({("mine", boiler.code)}, [GW, AC], "P") == ([], None)


def test_a_partial_activity_not_linked_by_the_run_skips_the_index(monkeypatch):
    from mapper.core import authored_storage
    from mapper.core import flow_characterisation as fc

    monkeypatch.setattr(fc, "characterisation_index", lambda bd: pytest.fail("index built"))
    authored_storage.save_definitions("P", _defs(_activity([CO2], "partial")))
    assert cov.coverage_gaps({("ecoinvent-3.10-cutoff", "x")}, [GW, AC], "P") == ([], None)


def test_the_loader_returns_gaps_for_a_linked_partial_activity(monkeypatch):
    from mapper.core import authored_storage
    from mapper.core import flow_characterisation as fc

    monkeypatch.setattr(fc, "characterisation_index", lambda bd: CF_INDEX)
    boiler = _activity([CO2], "partial", ticks=[GW])
    authored_storage.save_definitions("P", _defs(boiler))
    gaps, warning = cov.coverage_gaps({("mine", boiler.code)}, [GW, AC], "P")
    assert warning is None and [tuple(g.method) for g in gaps] == [AC]


def test_a_failure_becomes_a_warning_not_a_silent_no_gaps(monkeypatch):
    from mapper.core import authored_storage
    from mapper.core import flow_characterisation as fc

    def boom(bd):
        raise RuntimeError("index exploded")

    monkeypatch.setattr(fc, "characterisation_index", boom)
    boiler = _activity([CO2], "partial")
    authored_storage.save_definitions("P", _defs(boiler))
    gaps, warning = cov.coverage_gaps({("mine", boiler.code)}, [GW, AC], "P")
    assert gaps == [] and "NOT marked" in warning and "index exploded" in warning


# ── Migration of activities written before the declaration existed ─────────

def test_an_old_activity_loads_with_nothing_declared_complete():
    """Step-2 files have no complete_indicators: they load, and every indicator
    of a partial activity is then marked -- strictly more markers, never fewer."""
    from mapper.models.authored_schemas import AuthoredActivity

    boiler = _activity([CO2], "partial", ticks=[GW])
    legacy = boiler.model_dump(mode="json", exclude={"complete_indicators", "has_unfloored_exchange"})
    loaded = AuthoredActivity(**legacy)
    assert loaded.complete_indicators == []
    gaps = cov.gaps({("mine", loaded.code)}, [GW, AC], cov.partial_activities(_defs(loaded)), CF_INDEX)
    assert [tuple(g.method) for g in gaps] == [GW, AC]


def test_the_fingerprint_ignores_the_declaration_and_matches_the_old_formula():
    """Adding the field must not mark existing authored databases stale."""
    import hashlib
    import json

    boiler = _activity([CO2], "partial")
    ticked = boiler.model_copy(update={"complete_indicators": [list(GW)]})
    db0, db1 = _defs(boiler).databases[0], _defs(ticked).databases[0]
    assert eng.fingerprint(db0) == eng.fingerprint(db1)
    # the pre-declaration formula, applied to a dump without the field
    legacy = db0.model_dump(mode="json", exclude={"created_at", "updated_at"})
    for a in legacy["activities"]:
        a.pop("complete_indicators")          # the per-indicator declaration
        for e in a["exchanges"]:
            e.pop("uncertainty_basis")        # and the uncertainty basis
    blob = json.dumps(legacy, sort_keys=True, separators=(",", ":"))
    assert eng.fingerprint(db0) == hashlib.sha256(blob.encode("utf-8")).hexdigest()


def test_the_declaration_never_reaches_brightway():
    ticked = _activity([CO2], "partial", ticks=[GW])
    written = json_dump = str(eng.to_bw2(_defs(ticked).databases[0]))
    assert "complete_indicators" not in written and json_dump


# ── Routes ──────────────────────────────────────────────────────────────────

@pytest.fixture()
def client(monkeypatch):
    from fastapi.testclient import TestClient

    from mapper.api import authored as api
    from mapper.api import bom

    backend = FakeBackend(installed=["biosphere3"], cf_index=CF_INDEX)
    monkeypatch.setattr(api, "_project", lambda: "P")
    monkeypatch.setattr(api, "get_backend", lambda project: backend)
    monkeypatch.setattr(bom, "_archetypes", {"P": {}})
    from mapper.main import app

    c = TestClient(app)
    assert c.post("/api/authored-databases", json={"name": "mine"}).status_code == 200
    return c


def _body(**kw):
    return {"name": "boiler", "unit": "kilogram", "scope": "partial", "scope_note": "CO2 and NOx only",
            "exchanges": [ex(CO2).model_dump(), ex(NOX).model_dump()], **kw}


def test_reached_indicators_lists_only_what_the_flows_reach_and_ticks_nothing(client):
    r = client.post("/api/authored-databases/reached-indicators", json={
        "flows": [{"database": "biosphere3", "code": "co2"}]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert [i["method"] for i in body["indicators"]] == [list(GW)]
    assert body["families"] == ["EF v3.1"] and body["default_family"] == "EF v3.1"
    assert body["indicators"][0]["label"] == "climate change › global warming potential (GWP100)"


def test_ticks_round_trip_through_save_and_update(client):
    saved = client.post("/api/authored-databases/mine/activities", json=_body(complete_indicators=[list(GW)]))
    assert saved.status_code == 200, saved.text
    assert saved.json()["complete_indicators"] == [list(GW)]
    code = saved.json()["code"]
    upd = client.put(f"/api/authored-databases/mine/activities/{code}",
                     json=_body(complete_indicators=[list(GW), list(AC)]))
    assert upd.status_code == 200 and upd.json()["complete_indicators"] == sorted([list(AC), list(GW)])


def test_the_route_refuses_an_unreached_tick_with_its_code(client):
    r = client.post("/api/authored-databases/mine/activities", json={
        **_body(complete_indicators=[list(GW), ["EF v3.1", "water use", "x"]]),
        "exchanges": [ex(CO2).model_dump()]})
    assert r.status_code == 422
    assert r.json()["detail"]["codes"] == ["indicator_not_reached"]


def test_a_complete_activity_with_ticks_is_refused_at_the_route(client):
    r = client.post("/api/authored-databases/mine/activities",
                    json=_body(scope="complete", scope_note=None, complete_indicators=[list(GW)]))
    assert r.status_code == 422
