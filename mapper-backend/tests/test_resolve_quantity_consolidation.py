# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""`bom_engine.resolve_quantity` reads milestones through the shared rule.

It was the fourth hand-written copy of "linear between anchors, clamped, never
extrapolated" (after Parameter.keyframes, the AESA per-principle sharing
series, and the helper itself). It now calls
:func:`mapper.models.interpolation.interpolate_anchors`.

This is on the LCA compute path, so the gate is bit-identity, pinned the same
way ``test_shipped_template_sharing_factors_are_unchanged`` pins the AESA
sharing factors: hex-exact expected quantities captured from a run BEFORE the
consolidation. float.hex() rather than decimal literals, because 0.1 and
0.10000000000000001 print the same and are not the same number.

Two semantic differences between the old copy and the shared helper were found
during the consolidation. Both are neutralised rather than papered over, and
both are pinned below:

  * EMPTY milestone list — the old code fell through to ``node.quantity``; the
    helper raises, because "no anchors" is a caller bug there rather than a
    value. The ``and ev.milestones`` guard at the call site keeps the empty
    case on its original fallback. See ``test_empty_milestones_fall_back``.
  * LOOP FALL-THROUGH — if no anchor pair bracketed the year, the old code
    returned ``node.quantity`` while the helper returns the last anchor. This
    is unreachable in both: after the two clamps the year is strictly inside
    ``[first, last]``, and sorted anchors cover that interval contiguously.
    ``test_every_interior_year_is_bracketed`` pins the unreachability, so if a
    future change makes it reachable this fails rather than silently taking a
    different branch.
"""
from __future__ import annotations

import pytest

from mapper.core.bom_engine import flatten_bom_for_year, resolve_quantity
from mapper.models.bom_schemas import BOMNode, MaterialEvolution, QuantityMilestone
from mapper.models.interpolation import interpolate_anchors


def _node(pairs, *, quantity: float = 42.0, method: str = "milestones") -> BOMNode:
    return BOMNode(
        name="n", node_type="material", quantity=quantity, unit="kg",
        evolution=MaterialEvolution(
            method=method,
            milestones=[QuantityMilestone(year=y, quantity=q) for y, q in pairs],
        ),
    )


# ── the bit-identity gate ───────────────────────────────────────────────────

# Captured from a run of resolve_quantity BEFORE it was folded onto the shared
# helper. A failure here means the interpolation rule moved — which moves LCA
# results — and needs a human, not a re-baseline.
# milestones (2025, 100.0) -> (2050, 200.0)
EXPECTED_TWO_POINT = {
    2018: "0x1.9000000000000p+6",  # clamped to the 2025 value (100.0)
    2025: "0x1.9000000000000p+6",  # first anchor exactly
    2031: "0x1.f000000000000p+6",  # interior: 100 + (6/25)*100 = 124.0
    2037: "0x1.2800000000000p+7",  # 100 + (12/25)*100 = 148.0
    2044: "0x1.6000000000000p+7",  # 100 + (19/25)*100 = 176.0
    2050: "0x1.9000000000000p+7",  # last anchor exactly (200.0)
    2055: "0x1.9000000000000p+7",  # clamped, never extrapolated
}

# milestones (2020, 1.0) -> (2033, 7.5) -> (2049, 2.25)
EXPECTED_THREE_UNEVEN = {
    2018: "0x1.0000000000000p+0",
    2020: "0x1.0000000000000p+0",
    2033: "0x1.e000000000000p+2",  # middle anchor exactly (7.5)
    2041: "0x1.3800000000000p+2",
    2049: "0x1.2000000000000p+1",
    2055: "0x1.2000000000000p+1",
}


def test_two_point_series_is_bit_identical():
    node = _node([(2025, 100.0), (2050, 200.0)])
    for year, expected in EXPECTED_TWO_POINT.items():
        got = resolve_quantity(node, year)
        assert got.hex() == expected, f"{year}: {got.hex()} != {expected}"


def test_three_point_uneven_series_is_bit_identical():
    node = _node([(2020, 1.0), (2033, 7.5), (2049, 2.25)])
    for year, expected in EXPECTED_THREE_UNEVEN.items():
        got = resolve_quantity(node, year)
        assert got.hex() == expected, f"{year}: {got.hex()} != {expected}"


def test_resolve_quantity_agrees_with_the_shared_helper_everywhere():
    """The consolidation's premise, checked directly rather than assumed."""
    pairs = [(2020, 1.0), (2033, 7.5), (2049, 2.25)]
    node = _node(pairs)
    for year in range(2010, 2061):
        assert resolve_quantity(node, year) == interpolate_anchors(pairs, year)


# ── the two differences found, pinned ───────────────────────────────────────


def test_empty_milestones_fall_back_to_node_quantity_and_do_not_raise():
    """The helper raises on an empty anchor list; the call-site guard keeps the
    empty case on its original fallback instead."""
    node = _node([], quantity=42.0)
    assert node.evolution.milestones == []
    assert resolve_quantity(node, 2030) == 42.0
    with pytest.raises(ValueError):
        interpolate_anchors([], 2030)


def test_every_interior_year_is_bracketed_so_the_fallthrough_stays_unreachable():
    """After the clamps, some consecutive anchor pair always brackets the year.

    The old code and the helper disagree about what to return if that were ever
    false (node.quantity vs the last anchor), so the unreachability is the
    thing that makes the two equivalent. Pin it.
    """
    for pairs in (
        [(2020, 1.0), (2033, 7.5), (2049, 2.25)],
        [(2020, 1.0), (2030, 5.0), (2030, 9.0), (2040, 2.0)],  # duplicate years
        [(2030, 3.0), (2030, 8.0)],                            # zero span
    ):
        ms = sorted(pairs)
        for year in range(ms[0][0] + 1, ms[-1][0]):
            assert any(a[0] <= year <= b[0] for a, b in zip(ms, ms[1:])), (
                f"{year} unbracketed in {pairs}"
            )


# ── shape-by-shape equivalence ──────────────────────────────────────────────


@pytest.mark.parametrize("pairs", [
    [(2030, 5.0)],                                          # single anchor
    [(2025, 100.0), (2050, 200.0)],
    [(2050, 200.0), (2025, 100.0), (2035, 400.0)],          # unsorted input
    [(2020, 1.0), (2030, 5.0), (2030, 9.0), (2040, 2.0)],   # duplicate years
    [(2030, 3.0), (2030, 8.0)],                             # zero span
    [(2025, 900.0), (2050, 3.0)],                           # descending
    [(2025, -4.0), (2040, 6.0)],                            # negative values
])
def test_every_milestone_shape_matches_the_shared_helper(pairs):
    node = _node(pairs)
    for year in range(2015, 2061):
        assert resolve_quantity(node, year) == interpolate_anchors(pairs, year)


def test_single_milestone_is_a_constant_across_all_years():
    node = _node([(2030, 5.0)])
    assert {resolve_quantity(node, y) for y in range(2000, 2101)} == {5.0}


@pytest.mark.parametrize("method,kw,expect", [
    ("fixed", {}, 42.0),
    ("learning_rate", {"learning_rate": -0.02, "base_year": 2025}, None),
    ("rebound_effect", {"rebound_rate": 0.03, "base_year": 2025}, None),
])
def test_non_milestone_methods_are_untouched(method, kw, expect):
    """The consolidation must not reach any branch but `milestones`."""
    node = BOMNode(
        name="n", node_type="material", quantity=42.0, unit="kg",
        evolution=MaterialEvolution(method=method, **kw),
    )
    got = resolve_quantity(node, 2035)
    if expect is not None:
        assert got == expect
    else:
        # Compounding, not interpolation — a milestone rule would give 42.0.
        assert got != 42.0


def test_node_without_evolution_is_unaffected():
    node = BOMNode(name="n", node_type="material", quantity=42.0, unit="kg")
    assert resolve_quantity(node, 2035) == 42.0


# ── the cascade, not just the leaf ──────────────────────────────────────────


def test_milestones_flow_through_flatten_bom_for_year():
    """resolve_quantity feeds the flattening cascade, which feeds the LCA
    demand. Pin one composed number so a regression cannot hide behind a
    correct leaf function."""
    root = BOMNode(
        name="stage", node_type="component", quantity=2.0, unit="unit",
        children=[_node([(2025, 100.0), (2050, 200.0)], quantity=100.0)],
    )
    flat = flatten_bom_for_year(root, 2037)
    assert len(flat) == 1
    # 2 (parent) × 148.0 (interpolated at 12/25 of the way) = 296.0
    assert flat[0].quantity.hex() == (2.0 * 148.0).hex()
