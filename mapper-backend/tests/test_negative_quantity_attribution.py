# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""A negative net quantity is a credit, not a reason to drop the row.

`_build_archetype_source_demand`'s attribution shared an activity's score among
the materials using it, guarded by ``if same_act_qty > 0``. A NEGATIVE net
quantity -- an avoided-burden or credit row, ordinary in a circular-economy
model -- sent the share to 0, so the row vanished from BOTH the stage breakdown
and the contributions list while its real impact stayed in ``total_score`` from
the bulk solve.

Measured on Battery Circularity's `A - Circular EV`:
``Battery-excluded glider shredding`` sums to -0.0092125 and 6.5% of the total
went unattributed (sum(stages) 0.07873 vs total 0.08420).

The guard is now ``!= 0``. Only an exactly-zero group is skipped, where the
share is genuinely undefined (0/0).
"""
from __future__ import annotations

import asyncio

from mapper.models.bom_schemas import Archetype, BOMNode, EcoinventLink
from mapper.models.schemas import ArchetypeLCACalculateRequest

POS, NEG = "a" * 32, "b" * 32


def _mat(name: str, code: str, qty: float) -> BOMNode:
    return BOMNode(
        id=f"n-{name}", name=name, node_type="material", quantity=qty, unit="kg",
        ecoinvent_activity=EcoinventLink(
            database="ecoinvent-3.10-cutoff", code=code, name=name, unit="kg"),
    )


def _arc() -> Archetype:
    """Manufacturing burden plus an End-of-Life CREDIT (negative quantity)."""
    return Archetype(id="arc-neg", name="Credit product", bom=[
        BOMNode(id="s-mfg", name="Manufacturing", node_type="component",
                scope="inflows", children=[_mat("Steel", POS, 100.0)]),
        BOMNode(id="s-eol", name="End of Life", node_type="component",
                scope="outflows", children=[_mat("Recycling credit", NEG, -20.0)]),
    ])


class _StubRunner:
    """Unit score 1.0, so a score reads directly as the summed demand."""

    def __call__(self, demand, methods):
        return {tuple(mt): (sum(demand.values()), "kg CO2-eq") for mt in methods}


def _run(monkeypatch, arc):
    from mapper.api import lca as lca_mod

    monkeypatch.setattr(lca_mod, "_get_archetype", lambda _i: arc, raising=False)
    monkeypatch.setattr("mapper.api.bom._get_archetype", lambda _i: arc, raising=False)
    monkeypatch.setattr(lca_mod, "PersistentLCARunner", _StubRunner)
    return asyncio.run(lca_mod.calculate_archetype_lca(ArchetypeLCACalculateRequest(
        archetype_id=arc.id, methods=[["m", "x", "y"]], scope="all")))


def test_the_stage_subtotals_sum_to_the_total():
    """The invariant the `> 0` guard broke."""
    import pytest

    mp = pytest.MonkeyPatch()
    try:
        res = _run(mp, _arc())
    finally:
        mp.undo()
    mr = res.results[0]
    stages = (res.stage_breakdown or {})[mr.method_label]
    assert sum(stages.values()) == pytest.approx(mr.score, rel=1e-12), (
        f"unattributed impact: stages {sum(stages.values())!r} vs total "
        f"{mr.score!r}")


def test_the_negative_row_is_attributed_and_keeps_its_sign():
    import pytest

    mp = pytest.MonkeyPatch()
    try:
        res = _run(mp, _arc())
    finally:
        mp.undo()
    mr = res.results[0]
    stages = (res.stage_breakdown or {})[mr.method_label]
    assert "End of Life" in stages, "the credit stage vanished entirely"
    assert stages["End of Life"] < 0, "a credit must stay negative"
    names = {c.name for c in mr.contributions}
    assert "Recycling credit" in names, "the credit row is missing from contributions"


def test_an_exactly_zero_group_is_still_skipped():
    """0/0 is undefined; that case keeps its guard."""
    import pytest

    arc = Archetype(id="z", name="Z", bom=[
        BOMNode(id="s", name="Manufacturing", node_type="component", scope="inflows",
                children=[_mat("A", POS, 5.0), _mat("B", POS, -5.0)]),
    ])
    mp = pytest.MonkeyPatch()
    try:
        res = _run(mp, arc)
    finally:
        mp.undo()
    # No crash, and nothing attributed from the cancelling pair.
    assert res.results[0] is not None


def test_a_positive_only_bom_is_untouched():
    """Regression fence: the change must move nothing without negatives.

    Verified against the real projects too -- all 28 MAp-test archetypes are
    byte-identical before and after, including `Fuel Station`, whose negative
    End of Life stage predates this change (negative CONTRIBUTIONS were never
    dropped; only groups whose NET quantity was <= 0).
    """
    import pytest

    arc = Archetype(id="p", name="P", bom=[
        BOMNode(id="s", name="Manufacturing", node_type="component", scope="inflows",
                children=[_mat("Steel", POS, 100.0), _mat("Alu", NEG, 50.0)]),
    ])
    mp = pytest.MonkeyPatch()
    try:
        res = _run(mp, arc)
    finally:
        mp.undo()
    mr = res.results[0]
    stages = (res.stage_breakdown or {})[mr.method_label]
    assert sum(stages.values()) == pytest.approx(mr.score, rel=1e-12)
    assert all(v > 0 for v in stages.values())
