# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Single-product compute must resolve expression quantities, always.

A BOM row whose Quantity cell is a parameter expression is imported with
``quantity = 1.0`` as a *pre-resolution placeholder* and the formula in
``quantity_expression``. So "don't resolve" does not mean "use the base
values" -- it means "use 1.0".

``_build_archetype_source_demand`` used to gate resolution on
``parameter_scenario is not None or table.has_time_varying()``, on the stated
grounds that a scalar-only table "resolves identically anyway". Both
single-product panels send ``None`` for Base, so on a scalar-only table the
gate never opened. Measured against the real projects: a WP5 use phase came
out 727x low (0.78 vs 567.7 kg CO2e), and a Battery Circularity archetype lost
its per-kWh functional-unit divisor entirely -- its total moved ~1600x, and its
Manufacturing/Use split went from 99.9/0.1 to 44/55.

The system-level path never had the bug: ``DSMLCAPipeline`` gates on
``parameter_table is not None`` and ``_table_for`` always returns a table.
``test_matches_the_system_level_path`` is the alignment pin -- it flattens the
same archetype through both and requires the same quantity, so the two cannot
drift apart again.
"""
from __future__ import annotations

import asyncio

from mapper.models.bom_schemas import Archetype, BOMNode, EcoinventLink
from mapper.models.parameter_schemas import Parameter, ParameterTable
from mapper.models.schemas import ArchetypeLCACalculateRequest

CODE_MFG = "a" * 32
CODE_USE = "b" * 32

# Mirrors WP5's shape: a one-time manufacturing row with a literal quantity,
# and an annual use-phase row stored as an expression behind a 1.0 placeholder.
D_ANNUAL = 16425.0
INTENSITY = 0.16
EXPECTED_USE_QTY = D_ANNUAL * INTENSITY  # 2628.0


def _mat(name: str, code: str, qty: float, expr: str | None = None) -> BOMNode:
    return BOMNode(
        id=f"n-{code}", name=name, node_type="material",
        quantity=qty, quantity_expression=expr, unit="kg",
        ecoinvent_activity=EcoinventLink(
            database="ecoinvent-3.10-cutoff", code=code, name=name, unit="kg"),
    )


def _mk_arc(with_expression: bool = True) -> Archetype:
    use_row = (
        _mat("Fuel consumption (annual)", CODE_USE, 1.0, "d_annual * fuel_intensity")
        if with_expression
        else _mat("Fuel consumption (annual)", CODE_USE, EXPECTED_USE_QTY)
    )
    return Archetype(
        id="arc-expr", name="Expression product",
        bom=[
            BOMNode(id="s-mfg", name="Manufacturing", node_type="component",
                    scope="inflows", children=[_mat("Steel", CODE_MFG, 100.0)]),
            BOMNode(id="s-use", name="Use Phase", node_type="component",
                    scope="stock", is_annual=True, children=[use_row]),
        ],
    )


def _mk_table() -> ParameterTable:
    """Scalar-only, no scenarios -- the case the old gate skipped."""
    return ParameterTable(parameters={
        "d_annual": Parameter(name="d_annual", base_value=D_ANNUAL, unit="km/yr"),
        "fuel_intensity": Parameter(name="fuel_intensity", base_value=INTENSITY),
    })


class _StubRunner:
    """Unit score 1.0 per activity, so a returned score reads directly as the
    summed demand quantity."""
    UNIT = {CODE_MFG: 1.0, CODE_USE: 1.0}

    def __call__(self, demand, methods):
        return {tuple(mt): (sum(amt * self.UNIT.get(c, 0.0) for (_d, c), amt in demand.items()),
                            "kg CO2-eq") for mt in methods}


def _install(monkeypatch, arc: Archetype, table: ParameterTable):
    from mapper.api import lca as lca_mod
    monkeypatch.setattr(lca_mod, "_get_archetype", lambda _i: arc, raising=False)
    monkeypatch.setattr("mapper.api.bom._get_archetype", lambda _i: arc, raising=False)
    monkeypatch.setattr(lca_mod, "PersistentLCARunner", _StubRunner)
    # `_build_archetype_source_demand` imports `_table_for` inside the function,
    # so it must be patched at its source module, not on `lca`.
    monkeypatch.setattr("mapper.api.parameters._table_for", lambda *a, **k: table)


def _use_phase(monkeypatch, arc, table, scenario=None) -> float:
    _install(monkeypatch, arc, table)
    from mapper.api.lca import calculate_archetype_lca
    res = asyncio.run(calculate_archetype_lca(ArchetypeLCACalculateRequest(
        archetype_id=arc.id, methods=[["m", "x", "y"]], scope="all",
        parameter_scenario=scenario)))
    return (res.stage_breakdown or {})[res.results[0].method_label]["Use Phase"]


def test_expression_resolves_with_no_scenario(monkeypatch):
    """The regression. Base sends ``None``; the row must still resolve."""
    got = _use_phase(monkeypatch, _mk_arc(), _mk_table(), scenario=None)
    hint = (" -- that is the 1.0 placeholder, so the resolution gate skipped a"
            " scalar-only table") if got == 1.0 else ""
    assert got == EXPECTED_USE_QTY, (
        f"expression quantity did not resolve: got {got}, expected "
        f"{EXPECTED_USE_QTY}{hint}")


def test_explicit_base_matches_none(monkeypatch):
    """``None`` and ``"Base"`` are the same scenario, so they must agree.

    They did not: the panels send ``None`` and the gate only opened for a
    non-None value, so the two spellings of Base computed different numbers.
    """
    a, t = _mk_arc(), _mk_table()
    assert _use_phase(monkeypatch, a, t, None) == _use_phase(monkeypatch, a, t, "Base")


def test_a_bom_without_expressions_is_unchanged(monkeypatch):
    """Backward compat: always-resolving must not move literal quantities.

    ``resolve_archetype_with_engine`` on an expression-free BOM is a deep copy
    with no substitutions. Every archetype in the demo, Wind Farm and
    ``default`` projects is expression-free, so none of their numbers move.
    """
    got = _use_phase(monkeypatch, _mk_arc(with_expression=False), _mk_table(), None)
    assert got == EXPECTED_USE_QTY


def test_an_empty_table_still_computes_literal_boms(monkeypatch):
    """A project with no parameter table at all must keep working."""
    got = _use_phase(monkeypatch, _mk_arc(with_expression=False), ParameterTable(), None)
    assert got == EXPECTED_USE_QTY


def test_matches_the_system_level_path(monkeypatch):
    """The alignment pin.

    Flatten the SAME archetype through the system-level pipeline, built the way
    ``api/impact.py`` builds it (table always present, scenario ``None``), and
    require the same use-phase quantity the single-product path computes. This
    is what makes the two paths' agreement a checked property rather than a
    coincidence -- the single-product bug was precisely a divergence from it.
    """
    from mapper.core.dsm_lca_engine import DSMLCAPipeline
    from mapper.models.dsm_schemas import (
        SimulationResult, SimulationSummary, YearResult,
    )

    arc, table = _mk_arc(), _mk_table()
    cohort = "c1"
    sim = SimulationResult(
        system_id="probe",
        years=[YearResult(year=2025, stock={cohort: 1.0},
                          stock_by_age={cohort: {1: 1.0}},
                          inflow={}, outflow={}, outflow_by_age={})],
        summary=SimulationSummary(total_stock_start=1.0, total_stock_end=1.0,
                                  total_inflows=0.0, total_outflows=0.0),
    )
    pipe = DSMLCAPipeline(
        simulation_result=sim, archetypes={arc.id: arc},
        cohort_mappings={cohort: (arc.id, 1.0)}, methods=[("m", "x", "y")],
        lca_runner=_StubRunner(), parameter_table=table, parameter_scenario=None,
    )
    system_qty = sum(m.quantity for m in pipe._flatten(arc.id, 2025, "stock", db=None))

    assert system_qty == EXPECTED_USE_QTY, "the system path stopped resolving"
    assert _use_phase(monkeypatch, arc, table, None) == system_qty
