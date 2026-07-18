# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Phase 2 — year-varying parameter resolution wired into the LCA pipeline.

Covers:

* Fleet compute with a time-varying (keyframe) parameter → the engine resolves
  DIFFERENT scalar values in different simulation years (2025 vs 2040).
* Scalar-only table → the resolve-once fast path is taken (``has_time_varying``
  False, per-year resolved-archetype cache never populated) → byte-identical.
* Scenario threading (the impact.py correctness fix, exercised at the pipeline
  level) → scenario overrides take effect via the ParameterTable + scenario.
* Single-product ``_build_archetype_source_demand`` resolves keyframe params at
  ``resolve_year`` (reference year), and is year-invariant for scalar params.

The fake runner scores a demand as Σ amount, so the per-year impact directly
reflects the resolved parameter value — isolating the resolution logic from bw2.
"""
from __future__ import annotations

import pytest

from mapper.core.dsm_lca_engine import DSMLCAPipeline
from mapper.models.bom_schemas import Archetype, BOMNode, EcoinventLink
from mapper.models.dsm_schemas import SimulationResult, SimulationSummary, YearResult
from mapper.models.parameter_schemas import Parameter, ParameterKeyframe, ParameterTable

METHOD = ("EF v3.1", "climate change", "GWP100")


def _archetype(expr: str, fallback: float = 0.0) -> Archetype:
    node = BOMNode(
        id="n1", name="cells", node_type="material", quantity=fallback, unit="kg",
        quantity_expression=expr,
        ecoinvent_activity=EcoinventLink(database="base", code="c1", name="cell act"),
    )
    return Archetype(id="arc1", name="Battery", bom=[node])


def _sim(years: list[int]) -> SimulationResult:
    yrs = [
        YearResult(year=y, stock={"arc1": 1.0}, stock_by_age={},
                   inflow={"arc1": 1.0}, outflow={}, outflow_by_age={})
        for y in years
    ]
    return SimulationResult(
        system_id="sys1", years=yrs,
        summary=SimulationSummary(
            total_stock_start=1.0, total_stock_end=1.0,
            total_inflows=float(len(years)), total_outflows=0.0,
        ),
    )


class _SumRunner:
    """score = Σ amount over demand keys — background-db agnostic, so the score
    reflects only the resolved BOM quantities."""

    def __init__(self):
        self.calls = 0

    def __call__(self, demand, methods):
        self.calls += 1
        # demand values are floats ((db, code) → amount).
        total = sum(float(v) for v in demand.values())
        return {tuple(m): (total, "kg") for m in methods}


def _pipeline(years, table, scenario=None, runner=None, expr="p"):
    runner = runner or _SumRunner()
    return DSMLCAPipeline(
        simulation_result=_sim(years),
        archetypes={"arc1": _archetype(expr)},
        cohort_mappings={"arc1": ("arc1", 1.0)},
        methods=[METHOD],
        lca_runner=runner,
        parameter_table=table,
        parameter_scenario=scenario,
    ), runner


def _scores_by_year(results):
    return {y.year: y.total_impact for y in results[0].years}


# ── Fleet compute with a time-varying parameter ─────────────────────────────


def test_fleet_time_varying_param_resolves_per_year():
    table = ParameterTable(parameters={
        "p": Parameter(name="p", base_value=1.0,
                       keyframes=[ParameterKeyframe(year=2025, value=1.0),
                                  ParameterKeyframe(year=2040, value=2.0)]),
    })
    pipe, _ = _pipeline(list(range(2025, 2041)), table, expr="p")
    assert pipe._year_varying is True

    sc = _scores_by_year(pipe.calculate("inflows"))
    # count=1, quantity = p(year); score = p(year). 2025→1.0, 2040→2.0.
    assert sc[2025] == pytest.approx(1.0)
    assert sc[2040] == pytest.approx(2.0)
    # A midpoint interpolates: 2032.5 is 0.5 of the way; 2032 ≈ 1.4667.
    assert sc[2032] == pytest.approx(1.0 + (2032 - 2025) / (2040 - 2025))


def test_flatten_yields_different_resolved_quantity_per_year():
    # Direct: the engine sees different resolved values at 2025 vs 2040.
    table = ParameterTable(parameters={
        "p": Parameter(name="p", base_value=1.0,
                       keyframes=[ParameterKeyframe(year=2025, value=1.0),
                                  ParameterKeyframe(year=2040, value=2.0)]),
    })
    pipe, _ = _pipeline([2025, 2040], table, expr="p * 10")
    q2025 = pipe._flatten("arc1", 2025, "inflows")[0].quantity
    q2040 = pipe._flatten("arc1", 2040, "inflows")[0].quantity
    assert q2025 == pytest.approx(10.0)
    assert q2040 == pytest.approx(20.0)
    assert q2025 != q2040


# ── Scalar-only table → resolve-once fast path ──────────────────────────────


def test_scalar_only_table_uses_resolve_once_path():
    table = ParameterTable(parameters={"p": Parameter(name="p", base_value=3.0)})
    pipe, _ = _pipeline([2025, 2030, 2040], table, expr="p")
    # Gate proves the per-year branch is NOT active.
    assert pipe._year_varying is False

    sc = _scores_by_year(pipe.calculate("inflows"))
    # Same resolved value (3.0) every year — no per-year variation.
    assert sc[2025] == pytest.approx(3.0)
    assert sc[2040] == pytest.approx(3.0)
    # The per-year resolved-archetype cache is never populated on the fast path.
    assert pipe._resolved_arc_cache == {}


def test_scalar_table_byte_identical_to_prebuilt_engine():
    # A scalar table (base 2.5) must produce exactly what a pre-built engine on
    # the same values produces — the resolve-once byte-identity guarantee.
    table = ParameterTable(parameters={"p": Parameter(name="p", base_value=2.5)})
    from mapper.core.parameter_engine import ParameterEngine
    eng = ParameterEngine(table)

    pipe_table, _ = _pipeline([2025, 2030], table, expr="p * 4")
    pipe_eng = DSMLCAPipeline(
        simulation_result=_sim([2025, 2030]),
        archetypes={"arc1": _archetype("p * 4")},
        cohort_mappings={"arc1": ("arc1", 1.0)},
        methods=[METHOD],
        lca_runner=_SumRunner(),
        parameter_engine=eng,
    )
    assert _scores_by_year(pipe_table.calculate("inflows")) == \
        _scores_by_year(pipe_eng.calculate("inflows"))


# ── Scenario threading (impact.py correctness fix) ──────────────────────────


def test_scenario_override_takes_effect_via_table_threading():
    table = ParameterTable(
        parameters={"p": Parameter(name="p", base_value=1.0, scenario_overrides={"Optimistic": 5.0})},
        scenarios=["Optimistic"],
    )
    base_pipe, _ = _pipeline([2025], table, scenario=None, expr="p")
    opt_pipe, _ = _pipeline([2025], table, scenario="Optimistic", expr="p")

    base_sc = _scores_by_year(base_pipe.calculate("inflows"))
    opt_sc = _scores_by_year(opt_pipe.calculate("inflows"))
    assert base_sc[2025] == pytest.approx(1.0)   # base value
    assert opt_sc[2025] == pytest.approx(5.0)    # scenario override applied
    # Neither is year-varying (scalar override) → resolve-once path.
    assert base_pipe._year_varying is False and opt_pipe._year_varying is False


def test_scenario_override_wins_flat_over_keyframe_trajectory():
    # A time-varying param with a scalar scenario override → override wins flat
    # (year-invariant) under that scenario; base scenario follows the trajectory.
    table = ParameterTable(
        parameters={"p": Parameter(
            name="p", base_value=1.0,
            keyframes=[ParameterKeyframe(year=2025, value=1.0), ParameterKeyframe(year=2040, value=2.0)],
            scenario_overrides={"Flat": 0.5},
        )},
        scenarios=["Flat"],
    )
    flat_pipe, _ = _pipeline([2025, 2040], table, scenario="Flat", expr="p")
    sc = _scores_by_year(flat_pipe.calculate("inflows"))
    assert sc[2025] == pytest.approx(0.5) and sc[2040] == pytest.approx(0.5)


# ── Single-product resolves at reference_year ───────────────────────────────


@pytest.fixture()
def registered_archetype_and_table():
    """Register a single-product archetype + parameter table in the in-memory
    stores so ``_build_archetype_source_demand`` can resolve them."""
    from mapper.api import bom as bom_api
    from mapper.api import parameters as param_api

    node = BOMNode(
        id="m1", name="cells", node_type="material", quantity=0.0, unit="kg",
        quantity_expression="p",
        ecoinvent_activity=EcoinventLink(database="base", code="c1", name="cell act"),
    )
    stage = BOMNode(id="s1", name="Manufacturing", node_type="component",
                    quantity=1.0, scope="inflows", children=[node])
    arc = Archetype(id="sp-arc", name="SP Battery", bom=[stage])

    proj = param_api._current_project()
    prev_table = param_api._tables.get(proj)
    bom_api._proj_archetypes()["sp-arc"] = arc
    yield arc, param_api, proj
    bom_api._proj_archetypes().pop("sp-arc", None)
    if prev_table is None:
        param_api._tables.pop(proj, None)
    else:
        param_api._tables[proj] = prev_table


def _demand_total(bundle) -> float:
    return sum(bundle.total_demand.values())


def test_single_product_keyframe_resolves_at_reference_year(registered_archetype_and_table):
    from mapper.api.lca import _build_archetype_source_demand
    _arc, param_api, proj = registered_archetype_and_table
    param_api._tables[proj] = ParameterTable(parameters={
        "p": Parameter(name="p", base_value=1.0,
                       keyframes=[ParameterKeyframe(year=2025, value=1.0),
                                  ParameterKeyframe(year=2040, value=2.0)]),
    })

    b2025 = _build_archetype_source_demand(
        archetype_id="sp-arc", scope="all", amount=1.0, stage_amounts={},
        methods=[list(METHOD)], parameter_scenario=None, resolve_year=2025,
    )
    b2040 = _build_archetype_source_demand(
        archetype_id="sp-arc", scope="all", amount=1.0, stage_amounts={},
        methods=[list(METHOD)], parameter_scenario=None, resolve_year=2040,
    )
    assert _demand_total(b2025) == pytest.approx(1.0)
    assert _demand_total(b2040) == pytest.approx(2.0)
    # Default reference year is 2025.
    b_default = _build_archetype_source_demand(
        archetype_id="sp-arc", scope="all", amount=1.0, stage_amounts={},
        methods=[list(METHOD)], parameter_scenario=None,
    )
    assert _demand_total(b_default) == pytest.approx(1.0)


def test_single_product_scalar_is_year_invariant(registered_archetype_and_table):
    # A scalar parameter resolves to the same value at any reference year (drive
    # resolution with an explicit "Base" scenario, since scenario=None + no
    # keyframes deliberately skips resolution — the byte-identity guarantee).
    from mapper.api.lca import _build_archetype_source_demand
    _arc, param_api, proj = registered_archetype_and_table
    param_api._tables[proj] = ParameterTable(parameters={"p": Parameter(name="p", base_value=7.0)})

    b2025 = _build_archetype_source_demand(
        archetype_id="sp-arc", scope="all", amount=1.0, stage_amounts={},
        methods=[list(METHOD)], parameter_scenario="Base", resolve_year=2025,
    )
    b2040 = _build_archetype_source_demand(
        archetype_id="sp-arc", scope="all", amount=1.0, stage_amounts={},
        methods=[list(METHOD)], parameter_scenario="Base", resolve_year=2040,
    )
    assert _demand_total(b2025) == pytest.approx(7.0)
    assert _demand_total(b2040) == pytest.approx(7.0)
