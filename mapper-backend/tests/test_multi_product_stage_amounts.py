"""Multi-product compute applies per-item stage amounts via the SAME
single-product application path (no forked logic).

The multi-product handler dispatches each ArchetypeProductItem to
`calculate_archetype_lca` with that item's `stage_amounts`. These tests
exercise the real `calculate_archetype_lca` (with a stubbed runner, no
brightway2 project) so they cover the actual stage-amount multiplication:

  - SCALING: raising an ANNUAL stage's amount scales its contribution
    while a one-time stage is unaffected.
  - PARITY: an equivalent configuration computed as single-product vs as a
    one-item multi-product run yields identical scores — proving both paths
    share the application logic.

Mirrors the stub harness from test_archetype_lca_stage_breakdown.py.
"""
from __future__ import annotations

import asyncio

import pytest

from mapper.models.bom_schemas import Archetype, BOMNode, EcoinventLink
from mapper.models.schemas import (
    ArchetypeLCACalculateRequest,
    ArchetypeProductItem,
    MultiProductLCARequest,
)


def _mk_arc() -> Archetype:
    """Manufacturing (one-time) + Use Phase (ANNUAL) + End of Life."""
    def mat(name: str, code: str, qty: float) -> BOMNode:
        return BOMNode(
            id=f"n-{code}", name=name, node_type="material", quantity=qty, unit="kg",
            ecoinvent_activity=EcoinventLink(database="ecoinvent-3.10-cutoff", code=code, name=name, unit="kg"),
        )
    return Archetype(
        id="arc-test", name="Test product",
        bom=[
            BOMNode(id="stage-mfg", name="Manufacturing", node_type="component", scope="inflows",
                    children=[mat("Steel", "a" * 32, 100.0)]),
            BOMNode(id="stage-use", name="Use Phase", node_type="component", scope="stock", is_annual=True,
                    children=[mat("Electricity", "b" * 32, 5.0)]),
            BOMNode(id="stage-eol", name="End of Life", node_type="component", scope="outflows",
                    children=[mat("Recycling", "c" * 32, 100.0)]),
        ],
    )


class _StubRunner:
    """unit score by activity code first byte: a→1, b→2, c→3."""
    UNIT = {"a" * 32: 1.0, "b" * 32: 2.0, "c" * 32: 3.0}
    UNIT_NAME = "kg CO2-eq"

    def __call__(self, demand, methods):
        out = {}
        for mt in methods:
            score = sum(amt * self.UNIT.get(code, 0.0) for (_db, code), amt in demand.items())
            out[tuple(mt)] = (score, self.UNIT_NAME)
        return out


def _patch(monkeypatch):
    from mapper.api import lca as lca_mod
    monkeypatch.setattr(lca_mod, "_get_archetype", lambda _id: _mk_arc(), raising=False)
    monkeypatch.setattr("mapper.api.bom._get_archetype", lambda _id: _mk_arc(), raising=False)
    monkeypatch.setattr(lca_mod, "PersistentLCARunner", _StubRunner)
    return lca_mod


def _score(res) -> float:
    return res.results[0].score


def test_annual_stage_scales_while_one_time_unaffected(monkeypatch):
    """Use Phase (annual) amount 1 → 15 scales its contribution ×15;
    Manufacturing (one-time) is unchanged."""
    lca_mod = _patch(monkeypatch)
    methods = [["IPCC", "GWP100a"]]

    # Baseline: every stage amount = 1.  Score = 100·1 + 5·2 + 100·3 = 410.
    base = asyncio.run(lca_mod.calculate_archetype_lca(ArchetypeLCACalculateRequest(
        archetype_id="arc-test", scope="all", methods=methods,
        stage_amounts={"Manufacturing": 1, "Use Phase": 1, "End of Life": 1},
    )))
    assert _score(base) == pytest.approx(410.0)

    # Use Phase × 15:  100·1 + (5·15)·2 + 100·3 = 100 + 150 + 300 = 550.
    scaled = asyncio.run(lca_mod.calculate_archetype_lca(ArchetypeLCACalculateRequest(
        archetype_id="arc-test", scope="all", methods=methods,
        stage_amounts={"Manufacturing": 1, "Use Phase": 15, "End of Life": 1},
    )))
    assert _score(scaled) == pytest.approx(550.0)

    # The delta is entirely the annual Use Phase contribution (10 → 150);
    # the one-time stages contributed the same 400 in both.
    assert _score(scaled) - _score(base) == pytest.approx(140.0)
    if base.stage_breakdown:
        assert base.stage_breakdown["GWP100a"]["Manufacturing"] == pytest.approx(
            scaled.stage_breakdown["GWP100a"]["Manufacturing"])


def test_single_vs_one_item_multi_parity(monkeypatch):
    """Same archetype + same stage_amounts, computed single-product vs as a
    one-item multi-product run → identical score (shared application path)."""
    lca_mod = _patch(monkeypatch)
    methods = [["IPCC", "GWP100a"]]
    amounts = {"Manufacturing": 1, "Use Phase": 15, "End of Life": 1}

    single = asyncio.run(lca_mod.calculate_archetype_lca(ArchetypeLCACalculateRequest(
        archetype_id="arc-test", scope="all", methods=methods, stage_amounts=amounts,
    )))

    multi = asyncio.run(lca_mod.calculate_multi_product_lca(MultiProductLCARequest(
        items=[ArchetypeProductItem(archetype_id="arc-test", stage_amounts=amounts)],
        methods=methods, scope="all",
    )))
    assert multi.success_count == 1
    item = multi.items[0]
    assert item.status == "success"
    assert _score(item.archetype_result) == pytest.approx(_score(single))


def test_default_no_amounts_matches_explicit_ones(monkeypatch):
    """Backward compat: omitting stage_amounts (None) yields the same score as
    explicit all-ones — so default multi-item results don't shift."""
    lca_mod = _patch(monkeypatch)
    methods = [["IPCC", "GWP100a"]]

    none_amounts = asyncio.run(lca_mod.calculate_multi_product_lca(MultiProductLCARequest(
        items=[ArchetypeProductItem(archetype_id="arc-test")],  # stage_amounts=None
        methods=methods, scope="all",
    )))
    ones = asyncio.run(lca_mod.calculate_multi_product_lca(MultiProductLCARequest(
        items=[ArchetypeProductItem(archetype_id="arc-test", stage_amounts={"Manufacturing": 1, "Use Phase": 1, "End of Life": 1})],
        methods=methods, scope="all",
    )))
    assert _score(none_amounts.items[0].archetype_result) == pytest.approx(
        _score(ones.items[0].archetype_result))
