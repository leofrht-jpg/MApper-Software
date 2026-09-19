# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""The compartment picker's backend.

Numbers mirror MAp-test's real EF v3.1 data for Nitrogen oxides, measured when
the picker was built: particulate-matter formation is 1.6e-6 in urban air and
2.1e-7 from high stacks; acidification (0.74) is identical in every
compartment. The "no LT" family variants characterise nothing in the
long-term compartment, which is the coverage gap the picker must surface.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from mapper.core import flow_characterisation as fc

BIO = "biosphere3"
URBAN = fc.Flow(BIO, "u", "Nitrogen oxides", ("air", "urban air close to ground"), "kilogram", "emission")
STACK = fc.Flow(BIO, "s", "Nitrogen oxides", ("air", "non-urban air or from high stacks"), "kilogram", "emission")
LONG = fc.Flow(BIO, "l", "Nitrogen oxides", ("air", "low population density, long-term"), "kilogram", "emission")
CO2 = fc.Flow(BIO, "c", "Carbon dioxide, fossil", ("air",), "kilogram", "emission")

PM = ("EF v3.1", "particulate matter formation", "impact on human health")
AC = ("EF v3.1", "acidification", "accumulated exceedance (AE)")
GW = ("EF v3.1", "climate change", "global warming potential (GWP100)")
AC_NOLT = ("EF v3.1 no LT", "acidification no LT", "accumulated exceedance (AE) no LT")
EF = [PM, AC, GW]

INDEX = {
    (BIO, "u"): [(PM, 1.6e-6), (AC, 0.74), (AC_NOLT, 0.74)],
    (BIO, "s"): [(PM, 2.1e-7), (AC, 0.74), (AC_NOLT, 0.74)],
    (BIO, "l"): [(PM, 1.6e-6), (AC, 0.74)],          # no LT variant: absent
    (BIO, "c"): [(GW, 1.0)],
}
FLOWS = [URBAN, STACK, LONG, CO2]


def _nox(family="EF v3.1", methods=EF, **kw):
    groups, _ = fc.search_groups(FLOWS, INDEX, family, methods, "nitrogen", **kw)
    (g,) = groups
    return g


def test_only_the_factor_that_differs_is_varying():
    g = _nox()
    assert [m.label for m in g.varying_methods] == ["particulate matter formation"]
    assert [m.label for m in g.uniform_methods] == ["acidification"]


def test_a_factor_missing_for_one_compartment_counts_as_differing():
    """The long-term compartment has no 'no LT' factor: that is a difference."""
    g = _nox("EF v3.1 no LT", [AC_NOLT])
    assert [m.label for m in g.varying_methods] == ["acidification no LT"]
    by = {c.categories[1]: c.characterised for c in g.candidates}
    assert by == {"low population density, long-term": 0,
                  "non-urban air or from high stacks": 1,
                  "urban air close to ground": 1}


def test_candidates_are_alphabetical_by_compartment_never_by_usage():
    usage = {(BIO, "u"): 5, (BIO, "s"): 1, (BIO, "l"): 999}
    g = _nox(usage=usage)
    assert [c.categories[1] for c in g.candidates] == [
        "low population density, long-term",
        "non-urban air or from high stacks",
        "urban air close to ground",
    ]
    assert [c.ecoinvent_exchanges for c in g.candidates] == [999, 1, 5]


def test_only_the_selected_family_is_reported():
    g = _nox()
    for c in g.candidates:
        assert set(c.factors) <= {"particulate matter formation", "acidification", "climate change"}
    assert g.family_indicator_count == 3


def test_a_method_characterising_no_candidate_is_neither_varying_nor_uniform():
    g = _nox()
    labels = {m.label for m in g.varying_methods + g.uniform_methods}
    assert "climate change" not in labels


def test_floor_availability_is_per_compartment():
    g = _nox(floors={(BIO, "s"): (2422, 1.93)})
    by = {c.categories[1]: (c.floor_available, c.floor_gsd2, c.floor_n) for c in g.candidates}
    assert by["non-urban air or from high stacks"] == (True, 1.93, 2422)
    assert by["urban air close to ground"] == (False, None, 0)


def test_a_short_query_returns_nothing_and_a_long_list_is_truncated():
    assert fc.search_groups(FLOWS, INDEX, "EF v3.1", EF, "n")[0] == []
    many = [fc.Flow(BIO, f"x{i}", f"Substance {i:03d}", ("air",), "kilogram", "emission") for i in range(40)]
    groups, truncated = fc.search_groups(many, {}, "EF v3.1", EF, "substance", limit=30)
    assert len(groups) == 30 and truncated


@pytest.mark.parametrize("requested, available, expected", [
    ("ReCiPe", ["EF v3.1", "ReCiPe"], "ReCiPe"),
    (None, ["CML", "EF v3.1"], "EF v3.1"),
    (None, ["CML", "ReCiPe"], "CML"),
    ("missing", ["CML", "EF v3.1"], "EF v3.1"),
])
def test_family_fallback_matches_the_method_picker(requested, available, expected):
    assert fc.pick_family(requested, available) == expected


# ── The index rebuilds when the installed methods change ────────────────────

class _Methods(dict):
    pass


class _BD:
    def __init__(self, methods):
        self.methods = _Methods(methods)
        self.projects = type("P", (), {"current": "P"})()

    def Method(self, m):  # noqa: N802 - mirrors bw2data
        data = self.methods[m]["_data"]
        return type("M", (), {"load": lambda self_: data})()


def test_the_index_is_rebuilt_when_a_method_is_installed():
    fc._index_cache.clear()
    bd = _BD({PM: {"num_cfs": 1, "abbreviation": "a", "_data": [[(BIO, "u"), 1.6e-6]]}})
    first = fc.characterisation_index(bd)
    assert fc.characterisation_index(bd) is first, "unchanged method set must reuse the index"
    bd.methods[AC] = {"num_cfs": 1, "abbreviation": "b", "_data": [[(BIO, "u"), {"amount": 0.74}]]}
    second = fc.characterisation_index(bd)
    assert second is not first
    assert sorted(second[(BIO, "u")]) == sorted([(PM, 1.6e-6), (AC, 0.74)])


# ── Route ──────────────────────────────────────────────────────────────────

@pytest.fixture()
def client(monkeypatch):
    from mapper.api import biosphere_flows as api

    class _DBs(dict):
        pass

    bd = _BD({m: {"num_cfs": 1, "abbreviation": str(i), "_data": [[k, cf] for k, rows in INDEX.items()
                                                                  for mm, cf in rows if mm == m]}
              for i, m in enumerate(EF + [AC_NOLT])})
    bd.databases = _DBs({BIO: {"modified": "t"}, "ecoinvent-3.10-cutoff": {"modified": "t"}})
    monkeypatch.setattr(api, "_bw2", lambda: bd)
    monkeypatch.setattr(api, "_statistics", lambda: ({(BIO, "s"): 2793}, {(BIO, "s"): (2422, 1.93)}))
    monkeypatch.setattr(api.fc, "biosphere_flows", lambda bd_, db: FLOWS)
    fc._index_cache.clear()
    from mapper.main import app

    return TestClient(app)


def test_the_route_returns_groups_for_the_default_family(client):
    r = client.get("/api/biosphere-flows/search", params={"q": "nitrogen"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["family"] == "EF v3.1" and body["database"] == BIO
    assert "EF v3.1 no LT" in body["families"]
    (g,) = body["groups"]
    stack = next(c for c in g["candidates"] if c["code"] == "s")
    assert stack["ecoinvent_exchanges"] == 2793 and stack["floor_gsd2"] == 1.93


def test_the_route_refuses_a_database_that_is_not_biosphere(client):
    r = client.get("/api/biosphere-flows/search", params={"q": "nitrogen", "database": "ecoinvent-3.10-cutoff"})
    assert r.status_code == 404
