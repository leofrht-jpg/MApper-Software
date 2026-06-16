"""Tests for the per-stage breakdown emitted by /lca/calculate-archetype
(Patch 4B).

Stage breakdown is populated only when scope == "all". The invariant under
test: per method, the sum of the per-stage subtotals equals the method's
total score within float epsilon. The breakdown is built in the same loop
that already iterates linked materials × methods to assemble per-material
contributions, so this is a single-pass aggregation with no extra LCA
calls.

The test stubs `PersistentLCARunner` and `_get_archetype` so it doesn't
require a brightway2 project. The aggregation logic in
`calculate_archetype_lca` is unchanged by the runner identity — only the
per-activity scores it returns matter.
"""
from __future__ import annotations

import asyncio

import pytest

from mapper.models.bom_schemas import (
    Archetype,
    BOMNode,
    EcoinventLink,
)
from mapper.models.schemas import ArchetypeLCACalculateRequest


def _mk_arc() -> Archetype:
    """Synthetic archetype: 3 stages × 1 linked material each, distinct
    ecoinvent codes so per-activity scores can be assigned independently."""
    def mat(name: str, code: str, qty: float) -> BOMNode:
        return BOMNode(
            id=f"n-{code}",
            name=name,
            node_type="material",
            quantity=qty,
            unit="kg",
            ecoinvent_activity=EcoinventLink(
                database="ecoinvent-3.10-cutoff",
                code=code,
                name=name,
                unit="kg",
            ),
        )

    return Archetype(
        id="arc-test",
        name="Test product",
        bom=[
            BOMNode(
                id="stage-mfg",
                name="Manufacturing",
                node_type="component",
                scope="inflows",
                children=[mat("Steel", "a" * 32, 100.0)],
            ),
            BOMNode(
                id="stage-use",
                name="Use Phase",
                node_type="component",
                scope="stock",
                is_annual=True,
                children=[mat("Electricity", "b" * 32, 5.0)],
            ),
            BOMNode(
                id="stage-eol",
                name="End of Life",
                node_type="component",
                scope="outflows",
                children=[mat("Recycling", "c" * 32, 100.0)],
            ),
        ],
    )


class _StubRunner:
    """Deterministic runner. Per-activity unit score is encoded in the
    activity code's first byte (a→1.0, b→2.0, c→3.0). For the bulk-demand
    call (the totals run), returns sum(amounts × unit_score) so the totals
    invariant matches per-activity attribution exactly."""

    UNIT = {"a" * 32: 1.0, "b" * 32: 2.0, "c" * 32: 3.0}
    UNIT_NAME = "kg CO2-eq"

    def __call__(self, demand, methods):
        out = {}
        for mt in methods:
            score = 0.0
            for (db, code), amt in demand.items():
                score += amt * self.UNIT.get(code, 0.0)
            out[tuple(mt)] = (score, self.UNIT_NAME)
        return out


def test_stage_breakdown_present_when_scope_all_and_sum_invariant(monkeypatch):
    from mapper.api import lca as lca_mod

    monkeypatch.setattr(lca_mod, "_get_archetype", lambda _arc_id: _mk_arc(), raising=False)
    # Direct module path used inside calculate_archetype_lca for late import.
    monkeypatch.setattr("mapper.api.bom._get_archetype", lambda _arc_id: _mk_arc(), raising=False)
    monkeypatch.setattr(lca_mod, "PersistentLCARunner", _StubRunner)

    req = ArchetypeLCACalculateRequest(
        archetype_id="arc-test",
        scope="all",
        methods=[["IPCC", "GWP100a"], ["EF", "ClimateChange"]],
    )
    res = asyncio.run(lca_mod.calculate_archetype_lca(req))

    assert res.stage_breakdown is not None, "scope=all should populate stage_breakdown"
    # Stage names mirror BOM root names.
    expected_stages = {"Manufacturing", "Use Phase", "End of Life"}
    for method_label, by_stage in res.stage_breakdown.items():
        assert set(by_stage.keys()) == expected_stages, (
            f"method {method_label!r} missing stages, got {set(by_stage.keys())}"
        )

    # Sum-of-stages invariant: per method, stage subtotals sum to method score.
    for method_result in res.results:
        subtotals = res.stage_breakdown[method_result.method_label]
        stage_sum = sum(subtotals.values())
        assert stage_sum == pytest.approx(method_result.score, rel=1e-9, abs=1e-9), (
            f"stage sum {stage_sum} != method total {method_result.score} for "
            f"{method_result.method_label}"
        )


def test_stage_breakdown_none_when_scope_specific(monkeypatch):
    """For specific-stage scopes the result is already that one stage —
    a breakdown would carry redundant information. Field is None."""
    from mapper.api import lca as lca_mod

    monkeypatch.setattr(lca_mod, "_get_archetype", lambda _arc_id: _mk_arc(), raising=False)
    monkeypatch.setattr("mapper.api.bom._get_archetype", lambda _arc_id: _mk_arc(), raising=False)
    monkeypatch.setattr(lca_mod, "PersistentLCARunner", _StubRunner)

    req = ArchetypeLCACalculateRequest(
        archetype_id="arc-test",
        scope="inflows",
        methods=[["IPCC", "GWP100a"]],
    )
    res = asyncio.run(lca_mod.calculate_archetype_lca(req))
    assert res.stage_breakdown is None
