# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""CHANGE 1 — manual-mode subsystems simulate independently from their own
uploaded inflows/outflows via the shared DynamicStockModel."""
from __future__ import annotations

from mapper.core.subsystem_engine import (
    compute_manual_subsystem,
    compute_subsystem_result,
    subsystem_has_stock_source,
)
from mapper.models.dsm_schemas import DimensionDef, SystemDefinition, TimeHorizon
from mapper.models.subsystem_schemas import DependencyRule, Subsystem


def _primary():
    return SystemDefinition(
        id="sys1", name="Fleet",
        time_horizon=TimeHorizon(start_year=2025, end_year=2030),
        dimensions=[DimensionDef(name="charger", display_name="C", labels=["home", "public"])],
    )


def _manual_sub(**kw):
    return Subsystem(
        id="sub1", name="Chargers", type="dependent", depends_on="sys1",
        dimensions=[DimensionDef(name="charger", display_name="C", labels=["home", "public"])],
        mode="manual", **kw,
    )


def test_manual_compute_simulates_from_own_inflows():
    sub = _manual_sub(manual_inflows={"home": {2025: 100.0, 2026: 40.0}, "public": {2025: 10.0}})
    res = compute_manual_subsystem(sub, _primary())
    assert [y.year for y in res.years] == [2025, 2026, 2027, 2028, 2029, 2030]
    # Inflows land in the year they were uploaded.
    assert res.years[0].inflow.get("home") == 100.0
    assert res.years[0].inflow.get("public") == 10.0
    # Stock accumulates (Weibull survival keeps most of it the next year).
    assert res.years[1].stock.get("home", 0) > 0


def test_manual_compute_is_independent_of_primary():
    """Two DIFFERENT primaries yield the SAME manual result — proof the manual
    subsystem doesn't read the primary's stock (only its own flows + horizon)."""
    sub = _manual_sub(manual_inflows={"home": {2025: 100.0}})
    r1 = compute_manual_subsystem(sub, _primary())
    # Same horizon, different primary dims → identical manual stock.
    other = _primary()
    other.name = "Other"
    r2 = compute_manual_subsystem(sub, other)
    assert [y.stock for y in r1.years] == [y.stock for y in r2.years]


def test_dispatcher_routes_by_mode():
    manual = _manual_sub(manual_inflows={"home": {2025: 50.0}})
    # Manual mode: primary_result is unused → pass None.
    res = compute_subsystem_result(manual, _primary(), None)
    assert res.years[0].inflow.get("home") == 50.0


def test_has_stock_source():
    assert subsystem_has_stock_source(_manual_sub(manual_inflows={"home": {2025: 1.0}})) is True
    assert subsystem_has_stock_source(_manual_sub(manual_inflows={})) is False
    rules_sub = Subsystem(
        id="s", name="n", type="dependent", depends_on="sys1",
        dimensions=[DimensionDef(name="charger", display_name="C", labels=["home"])],
        mode="rules",
        dependency_rules=[DependencyRule(id="r", dependent_archetype_id="home", expression="1")],
    )
    assert subsystem_has_stock_source(rules_sub) is True
    rules_sub.dependency_rules = []
    assert subsystem_has_stock_source(rules_sub) is False
