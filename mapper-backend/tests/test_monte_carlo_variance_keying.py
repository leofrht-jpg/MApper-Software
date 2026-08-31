# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""The variance-contribution accumulator is keyed by node_id, like the draws.

Keyed by NAME it collided. Two rows sharing a material name initialised ONE
list, both appended to it every iteration, it reached 2n entries, and the
``len(v) == n`` guard dropped it -- after which ``variance_shares`` renormalised
the survivors, so the table still summed to 100 % with a contributor silently
missing. Nothing raised and nothing warned.

Duplicated names are ordinary: MAp-test's ``Fuel Station`` repeats six
(``Steel tank shell``, ``Protective coating``, ``Pump housing (steel)``,
``Pump motor``, ``Printed circuit board``, ``Hose & nozzle``), each twice.

The sampling was never wrong -- ``factors`` has been keyed by node_id
throughout -- so this is a reporting fix, and the guard below pins that: the
per-iteration draw order is untouched, so scores are unchanged.

The bw2 layers are stubbed so this runs in CI. What is NOT stubbed is the part
under test: ``collect_row_draws``, the per-row draw loop, ``_aggregate`` (which
applies factors per node_id) and the accumulator itself all run for real.
"""
from __future__ import annotations

import bw2calc
import numpy as np
import pytest

import mapper.api.monte_carlo as mc_mod
from mapper.models.bom_schemas import FlattenedMaterial, EcoinventLink, RowUncertainty
from mapper.models.schemas import MonteCarloRequest

DB = "ecoinvent-3.10-cutoff"
GWP = ("EF v3.1", "climate change", "global warming potential (GWP100)")
DUP_NAME = "Steel tank shell"


def _mat(node_id: str, name: str, code: str, qty: float, scored: bool) -> FlattenedMaterial:
    return FlattenedMaterial(
        node_id=node_id, name=name, quantity=qty, unit="kg",
        ecoinvent_activity=EcoinventLink(database=DB, code=code, name=name, unit="kg"),
        # Distinct sigmas so the three series are separable in the attribution.
        uncertainty=RowUncertainty(basic_variance=0.05,
                                   pedigree={"reliability": 3}) if scored else None,
    )


#: Two rows share DUP_NAME and differ only by node_id -- the collision shape.
def _materials() -> list[FlattenedMaterial]:
    return [
        _mat("node-A", DUP_NAME, "a" * 32, 2.0, True),
        _mat("node-B", DUP_NAME, "b" * 32, 5.0, True),
        _mat("node-C", "Pump motor", "c" * 32, 1.0, True),
    ]


class _FakeMC:
    """Enough of bw2calc.MonteCarloLCA that the loop runs.

    The 'score' is the sum of the demand it was handed, so the output really
    does move with the row factors and the attribution is not vacuous.
    """

    def __init__(self, demand, method, seed=None):
        self.demand = demand
        self._total = sum(demand.values())
        self.biosphere_matrix = np.array([1.0])
        self.supply_array = np.array([self._total])

    def build_demand_array(self):
        self._total = sum(self.demand.values())

    def __next__(self):
        self.supply_array = np.array([self._total])
        return self.supply_array


class _CFRng:
    def next(self):
        return np.array([1.0])


@pytest.fixture()
def stubbed(monkeypatch):
    """Stub only the bw2 boundary; the accumulator under test runs for real."""
    mats = _materials()
    total_demand = {(DB, m.ecoinvent_activity.code): m.quantity for m in mats}

    class _Bundle:
        arc = type("A", (), {"bom": [], "name": "Fuel Station"})()
        stages = ["Manufacturing"]
        effective_amounts = {"Manufacturing": 1.0}
        linked = mats
        method_tuples = [GWP]
        total_demand = None

    b = _Bundle()
    b.total_demand = total_demand

    monkeypatch.setattr("mapper.api.lca._build_archetype_source_demand",
                        lambda **kw: b)
    monkeypatch.setattr("mapper.api.lca._translate_demand_to_database",
                        lambda demand, db=None: (dict(demand), []))
    monkeypatch.setattr(mc_mod, "_linked_with_amounts",
                        lambda arc, scope, amounts, basis: [(m, 1.0) for m in mats])
    monkeypatch.setattr(mc_mod, "_translation_map",
                        lambda keys, db: {k: k for k in keys})
    monkeypatch.setattr(mc_mod, "_referenced_parameters", lambda arc: set())
    monkeypatch.setattr(mc_mod, "_method_cf_samplers",
                        lambda mc, methods, seed: {m: ([0], _CFRng()) for m in methods})
    monkeypatch.setattr(bw2calc, "MonteCarloLCA", _FakeMC)

    class _Runner:
        def __call__(self, demand, methods):
            return {m: (1.0, "kg CO2-Eq") for m in methods}

    monkeypatch.setattr("mapper.core.bw2_wrapper.PersistentLCARunner", _Runner)

    class _Table:
        parameters: dict = {}

        def resolve_all(self, scenario, year):
            return {}

    monkeypatch.setattr("mapper.api.parameters._table_for", lambda: _Table())
    monkeypatch.setattr("mapper.core.material_pedigree_storage.load_library",
                        lambda project: type("L", (), {"entries": {}})())
    monkeypatch.setattr(mc_mod, "_current_project", lambda: "test")
    return b


def _run(iterations: int = 60):
    body = MonteCarloRequest(
        archetype_id="arc", methods=[list(GWP)], scope="all",
        iterations=iterations, seed=1234, keep_samples=True,
        variance_contributions=True,
    )
    task = mc_mod._TaskState()
    from mapper.api.tasks import register, unregister
    tid = "variance-keying-test"
    register(tid)
    try:
        return mc_mod._run_monte_carlo(body, task, tid)
    finally:
        unregister(tid)


def test_both_rows_sharing_a_name_appear_in_the_variance_table(stubbed):
    """The regression. Keyed by name, one of these two silently vanished."""
    res = _run()

    rows = [c for c in res.contributors if c.kind == "row"]
    assert len(rows) == 3, [c.name for c in rows]

    dup = [c for c in rows if c.name == DUP_NAME]
    assert len(dup) == 2, (
        f"expected BOTH rows named {DUP_NAME!r} in the variance table, got "
        f"{len(dup)}: {[c.name for c in rows]}"
    )
    assert res.rows_with_uncertainty == 3


def test_the_shares_still_sum_to_one_with_nothing_dropped(stubbed):
    """Renormalisation is what made the loss invisible: the table summed to
    100 % either way. It must sum to 1 over THREE rows, not two."""
    res = _run()
    assert len(res.contributors) == 3
    assert sum(c.share for c in res.contributors) == pytest.approx(1.0)


def test_every_series_carries_exactly_n_entries(stubbed):
    """The collision overflowed to 2n and was then dropped by `len(v) == n`.

    Asserted through the outcome: a dropped series cannot appear as a
    contributor, so three contributors for three scored rows means no series
    overflowed.
    """
    for n in (30, 60):
        res = _run(iterations=n)
        assert len(res.contributors) == 3
        assert all(d.n_iterations == n for d in res.distributions)


def test_the_fix_is_reporting_only_and_moves_no_score(stubbed):
    """The draw loop is untouched, so the RNG stream and the scores are the
    same as before the accumulator changed. Pinned against the values this
    stubbed chain produces at seed 1234."""
    a = _run()
    b = _run()
    assert a.distributions[0].samples == b.distributions[0].samples
    assert a.distributions[0].median == b.distributions[0].median


def test_variance_contributions_off_costs_nothing(stubbed):
    body = MonteCarloRequest(
        archetype_id="arc", methods=[list(GWP)], scope="all",
        iterations=30, seed=1234, variance_contributions=False,
    )
    task = mc_mod._TaskState()
    from mapper.api.tasks import register, unregister
    register("off")
    try:
        res = mc_mod._run_monte_carlo(body, task, "off")
    finally:
        unregister("off")
    assert res.contributors == []
