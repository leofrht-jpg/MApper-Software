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


def _activity(flows, scope, name="boiler"):
    note = {"scope_note": "CO2 only; NOx and particulates not measured"} if scope == "partial" else {}
    return eng.build_activity(act([ex(f) for f in flows], scope=scope, name=name, **note),
                              FakeBackend(), eng.new_code())


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


def test_a_partial_activity_gaps_every_indicator_it_does_not_characterise():
    boiler = _activity([CO2], "partial")
    partial = cov.partial_activities(_defs(boiler))
    gaps = cov.gaps({("mine", boiler.code)}, [GW, AC, PM], partial, CF_INDEX)
    assert [tuple(g.method) for g in gaps] == [AC, PM]
    assert {g.activity_name for g in gaps} == {"boiler"}
    assert gaps[0].scope_note.startswith("CO2 only")


def test_a_complete_activity_never_gaps():
    """Declared complete: a missing flow is a true zero, so nothing is marked."""
    boiler = _activity([CO2], "complete")
    partial = cov.partial_activities(_defs(boiler))
    assert partial == {}
    assert cov.gaps({("mine", boiler.code)}, [GW, AC, PM], partial, CF_INDEX) == []


def test_any_flow_with_a_factor_covers_the_indicator():
    both = _activity([CO2, NOX], "partial")
    gaps = cov.gaps({("mine", both.code)}, [GW, AC, PM], cov.partial_activities(_defs(both)), CF_INDEX)
    assert gaps == []


def test_a_factor_of_zero_still_covers():
    """The method has spoken for the flow; that is a zero, not an unknown."""
    boiler = _activity([CO2], "partial")
    idx = {("biosphere3", "co2"): [(GW, 1.0), (AC, 0.0)]}
    gaps = cov.gaps({("mine", boiler.code)}, [GW, AC], cov.partial_activities(_defs(boiler)), idx)
    assert gaps == []


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
    boiler = _activity([CO2], "partial")
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
