# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Phase 3 — global battery lever ``p_bp`` composed with per-material learning
rates via ``BOMNode.global_levers``.

Composition:  Q_eff(year) = Q_base × p_bp(year) × LR_factor(material, year)

Constraints proven here:
* p_bp=1.0 (explicit) == p_bp absent == pre-lever engine (three-way identity).
* An untagged node is unaffected by p_bp regardless of its value.
* A tagged node composes p_bp AFTER the LR factor (not instead of it).
* Time-varying p_bp (keyframes) + tagged node → different Q_eff per year
  (Phase 2 per-year resolution).
* p_bp absent from the parameter table + tagged node → defaults to 1.0, no KeyError.

Mostly pure-function tests on ``resolve_quantity`` + one end-to-end fleet
pipeline test proving the lever is wired through the per-year flatten.
"""
from __future__ import annotations

import pytest

from mapper.core.bom_engine import (
    flatten_bom_for_year,
    has_global_levers,
    resolve_quantity,
)
from mapper.core.dsm_lca_engine import DSMLCAPipeline
from mapper.models.bom_schemas import (
    Archetype,
    BOMNode,
    EcoinventLink,
    MaterialEvolution,
)
from mapper.models.dsm_schemas import SimulationResult, SimulationSummary, YearResult
from mapper.models.parameter_schemas import Parameter, ParameterKeyframe, ParameterTable

METHOD = ("EF v3.1", "climate change", "GWP100")


def _node(quantity=100.0, levers=None, evolution=None) -> BOMNode:
    return BOMNode(
        id="n1", name="cells", node_type="material", quantity=quantity, unit="kg",
        global_levers=levers, evolution=evolution,
        ecoinvent_activity=EcoinventLink(database="base", code="c1", name="cell act"),
    )


def _lr(rate=-0.02, base_year=2025) -> MaterialEvolution:
    return MaterialEvolution(method="learning_rate", learning_rate=rate, base_year=base_year)


# ── Three-way identity: p_bp=1.0 == absent == pre-lever ─────────────────────


def test_p_bp_one_explicit_equals_absent_equals_untagged():
    tagged = _node(levers=["p_bp"])
    untagged = _node(levers=None)
    # Explicit p_bp=1.0 on the tagged node.
    q_explicit_one = resolve_quantity(tagged, 2030, {"p_bp": 1.0})
    # p_bp absent from the values dict → defaults to 1.0.
    q_absent = resolve_quantity(tagged, 2030, {})
    # lever_values None entirely.
    q_none = resolve_quantity(tagged, 2030, None)
    # The untagged node = pre-lever engine result.
    q_untagged = resolve_quantity(untagged, 2030)
    assert q_explicit_one == q_absent == q_none == q_untagged == 100.0


# ── Untagged node is inert to p_bp ──────────────────────────────────────────


def test_untagged_node_ignores_p_bp():
    untagged = _node(levers=None, quantity=250.0)
    # Even a strong lever value must not touch an untagged node.
    assert resolve_quantity(untagged, 2035, {"p_bp": 0.5}) == 250.0
    # A node tagged with a DIFFERENT lever is also unaffected by p_bp.
    other = _node(levers=["p_other"], quantity=250.0)
    assert resolve_quantity(other, 2035, {"p_bp": 0.5}) == 250.0


# ── Composition after the LR factor ─────────────────────────────────────────


def test_p_bp_composes_after_learning_rate():
    tagged = _node(quantity=100.0, levers=["p_bp"], evolution=_lr(rate=-0.02, base_year=2025))
    lr_factor = (1.0 - 0.02) ** (2030 - 2025)  # 0.98**5
    # Q_base × LR × p_bp — the full composition.
    got = resolve_quantity(tagged, 2030, {"p_bp": 0.9})
    assert got == pytest.approx(100.0 * lr_factor * 0.9)
    # NOT Q_base × p_bp alone…
    assert got != pytest.approx(100.0 * 0.9)
    # …and NOT Q_base × LR alone.
    assert got != pytest.approx(100.0 * lr_factor)


def test_multiple_levers_multiply():
    tagged = _node(quantity=10.0, levers=["p_bp", "p_x"])
    got = resolve_quantity(tagged, 2030, {"p_bp": 0.9, "p_x": 0.5})
    assert got == pytest.approx(10.0 * 0.9 * 0.5)


# ── p_bp absent from the table → identity, no KeyError ──────────────────────


def test_tagged_node_with_p_bp_absent_defaults_to_one():
    tagged = _node(quantity=42.0, levers=["p_bp"])
    # Empty dict AND None must both be safe (no KeyError) and neutral.
    assert resolve_quantity(tagged, 2040, {}) == 42.0
    assert resolve_quantity(tagged, 2040, None) == 42.0
    # A dict that has OTHER params but not p_bp.
    assert resolve_quantity(tagged, 2040, {"battery_mass": 250.0}) == 42.0


# ── Time-varying p_bp via Phase 2 resolution ────────────────────────────────


def test_time_varying_p_bp_differs_per_year():
    table = ParameterTable(parameters={
        "p_bp": Parameter(name="p_bp", base_value=1.0,
                          keyframes=[ParameterKeyframe(year=2025, value=1.0),
                                     ParameterKeyframe(year=2040, value=0.8)]),
    })
    tagged = _node(quantity=100.0, levers=["p_bp"])
    v2025 = table.resolve_all(None, 2025)
    v2040 = table.resolve_all(None, 2040)
    q2025 = resolve_quantity(tagged, 2025, v2025)
    q2040 = resolve_quantity(tagged, 2040, v2040)
    assert q2025 == pytest.approx(100.0)   # p_bp(2025)=1.0
    assert q2040 == pytest.approx(80.0)    # p_bp(2040)=0.8
    assert q2025 != q2040


# ── Cascade: a lever on a component propagates to descendants ───────────────


def test_lever_on_component_cascades_to_children():
    child = _node(quantity=2.0, levers=None)
    parent = BOMNode(
        id="c1", name="pack", node_type="component", quantity=3.0,
        global_levers=["p_bp"], children=[child],
    )
    flat = flatten_bom_for_year(parent, 2030, lever_values={"p_bp": 0.5})
    # parent effective = 3.0 × p_bp(0.5) = 1.5; child = 1.5 × 2.0 = 3.0.
    assert len(flat) == 1
    assert flat[0].quantity == pytest.approx(3.0 * 0.5 * 2.0)


def test_has_global_levers_detects_tagged_nodes():
    assert has_global_levers([_node(levers=["p_bp"])]) is True
    assert has_global_levers([_node(levers=None)]) is False
    assert has_global_levers([_node(levers=[])]) is False


# ── End-to-end: p_bp wired through the fleet pipeline ────────────────────────


def _sim(years):
    yrs = [
        YearResult(year=y, stock={"arc1": 1.0}, stock_by_age={},
                   inflow={"arc1": 1.0}, outflow={}, outflow_by_age={})
        for y in years
    ]
    return SimulationResult(
        system_id="sys1", years=yrs,
        summary=SimulationSummary(total_stock_start=1.0, total_stock_end=1.0,
                                  total_inflows=float(len(years)), total_outflows=0.0),
    )


class _SumRunner:
    def __call__(self, demand, methods):
        total = sum(float(v) for v in demand.values())
        return {tuple(m): (total, "kg") for m in methods}


def _fleet_scores(archetype, table):
    pipe = DSMLCAPipeline(
        simulation_result=_sim([2025, 2040]),
        archetypes={"arc1": archetype},
        cohort_mappings={"arc1": ("arc1", 1.0)},
        methods=[METHOD],
        lca_runner=_SumRunner(),
        parameter_table=table,
    )
    res = pipe.calculate("inflows")
    return {y.year: y.total_impact for y in res[0].years}


def test_fleet_pipeline_applies_time_varying_p_bp_on_tagged_node():
    table = ParameterTable(parameters={
        "p_bp": Parameter(name="p_bp", base_value=1.0,
                          keyframes=[ParameterKeyframe(year=2025, value=1.0),
                                     ParameterKeyframe(year=2040, value=0.5)]),
    })
    tagged = Archetype(id="arc1", name="Battery", bom=[_node(quantity=100.0, levers=["p_bp"])])
    sc = _fleet_scores(tagged, table)
    assert sc[2025] == pytest.approx(100.0)   # count 1 × 100 × p_bp(1.0)
    assert sc[2040] == pytest.approx(50.0)    # count 1 × 100 × p_bp(0.5)


def test_fleet_pipeline_untagged_node_unaffected_by_p_bp():
    # Same p_bp trajectory, but the node is NOT tagged → impact is flat.
    table = ParameterTable(parameters={
        "p_bp": Parameter(name="p_bp", base_value=1.0,
                          keyframes=[ParameterKeyframe(year=2025, value=1.0),
                                     ParameterKeyframe(year=2040, value=0.5)]),
    })
    untagged = Archetype(id="arc1", name="Battery", bom=[_node(quantity=100.0, levers=None)])
    sc = _fleet_scores(untagged, table)
    assert sc[2025] == pytest.approx(100.0)
    assert sc[2040] == pytest.approx(100.0)   # p_bp never applied
