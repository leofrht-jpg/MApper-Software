# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Scaling rules go through the dimension migration, like the six beside them.

`_migrate_state` reconciled initial_stock, inflows, stock_targets, outflows,
mode_configs and survival_configs -- and skipped `scaling_rules`, which sits in
the SAME `_INHERITABLE_SLOTS` tuple and carries the same `dimension_filters`.

Renaming a dimension therefore left every rule matching nothing, and
`best_rule_for_cohort` returning None is not an error at the call site:

    out[year][ck] = count if rule is None else self._resolve_rule(...)

so a 1.4x growth rule quietly became 1.0x. It stayed hidden because the
scaling-rules UI was removed on 2026-05-01 while the backend stayed live --
no clicking reaches it, so nothing surfaced the gap. It was found by walking
the whole package instead of a watchlist.
"""
from __future__ import annotations

import pytest

from mapper.api.dsm import _migrate_state
from mapper.core.dsm_engine import best_rule_for_cohort
from mapper.models.dsm_schemas import (
    DimensionDef,
    DSMScalingRule,
    DSMScenario,
    DSMSystemState,
    SystemDefinition,
    TimeHorizon,
)


def _defn(labels: list[str]) -> SystemDefinition:
    return SystemDefinition(
        id="sys1", name="Fleet",
        dimensions=[
            DimensionDef(name="Fuel", display_name="Fuel", labels=labels),
            DimensionDef(name="Age", display_name="Age", labels=[], is_age=True),
        ],
        time_horizon=TimeHorizon(start_year=2025, end_year=2030),
    )


def _state(filters: dict[str, str]) -> DSMSystemState:
    rule = DSMScalingRule(
        id="r1", dimension_filters=dict(filters),
        applies_to="inflows", expression="count * 1.4",
    )
    return DSMSystemState(
        system_id="sys1",
        scenarios=[DSMScenario(id="base", name="Base", is_base=True,
                               scaling_rules=[rule])],
    )


def _rules(state: DSMSystemState) -> list[DSMScalingRule]:
    return state.scenarios[0].scaling_rules or []


def test_a_renamed_label_is_translated_not_dropped():
    old, new = _defn(["BEV", "ICEV"]), _defn(["Battery-electric", "ICEV"])
    state, warnings, _ = _migrate_state(old, new, _state({"Fuel": "BEV"}))
    assert _rules(state)[0].dimension_filters == {"Fuel": "Battery-electric"}
    assert not any("scaling rule" in w for w in warnings)   # nothing lost


def test_a_removed_label_drops_the_rule_and_warns():
    old, new = _defn(["BEV", "ICEV"]), _defn(["ICEV"])
    state, warnings, _ = _migrate_state(old, new, _state({"Fuel": "BEV"}))
    assert _rules(state) == []
    assert any("scaling rule" in w for w in warnings), warnings


def test_an_untouched_rule_survives_unchanged_and_warns_nothing():
    old, new = _defn(["BEV", "ICEV"]), _defn(["BEV", "ICEV"])
    state, warnings, _ = _migrate_state(old, new, _state({"Fuel": "BEV"}))
    assert _rules(state)[0].dimension_filters == {"Fuel": "BEV"}
    assert not any("scaling rule" in w for w in warnings)


def test_the_rule_still_MATCHES_after_the_rename():
    """The point of the whole thing: the rule keeps applying.

    Before this patch the filter still said "BEV" while the cohort said
    "Battery-electric", `best_rule_for_cohort` returned None, and the caller's
    `count if rule is None` handed back an unscaled count.
    """
    old, new = _defn(["BEV", "ICEV"]), _defn(["Battery-electric", "ICEV"])
    state, _w, _t = _migrate_state(old, new, _state({"Fuel": "BEV"}))

    cohort = {"Fuel": "Battery-electric"}
    assert best_rule_for_cohort(cohort, _rules(state), "inflows") is not None


def test_an_unmigrated_rule_would_have_matched_NOTHING():
    """Anti-vacuity: shows what the missing migration actually cost."""
    stale = [DSMScalingRule(id="r1", dimension_filters={"Fuel": "BEV"},
                            applies_to="inflows", expression="count * 1.4")]
    assert best_rule_for_cohort({"Fuel": "Battery-electric"}, stale, "inflows") is None


def test_scaling_rules_are_in_the_same_slot_tuple_as_mode_configs():
    """Which is why skipping them was an oversight rather than a decision."""
    from mapper.api.dsm import _INHERITABLE_SLOTS
    assert "scaling_rules" in _INHERITABLE_SLOTS
    assert "mode_configs" in _INHERITABLE_SLOTS


def test_a_scenario_with_no_rules_is_untouched():
    old, new = _defn(["BEV"]), _defn(["Battery-electric"])
    st = DSMSystemState(system_id="sys1",
                        scenarios=[DSMScenario(id="base", name="Base", is_base=True)])
    state, warnings, _ = _migrate_state(old, new, st)
    assert not any("scaling rule" in w for w in warnings)
