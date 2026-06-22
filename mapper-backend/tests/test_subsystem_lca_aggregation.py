# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Tests for multi-subsystem DSM-LCA result aggregation.

Run with: python -m pytest mapper-backend/tests/test_subsystem_lca_aggregation.py -v
"""
from __future__ import annotations

import pytest

from mapper.core.dsm_lca_engine import (
    SUBSYSTEM_KEY_SEP,
    aggregate_subsystem_results,
    identity_cohort_mapping,
)
from mapper.models.bom_schemas import DSMLCAResult, DSMLCASummary, DSMLCAYearResult
from mapper.models.dsm_schemas import DimensionDef
from mapper.models.subsystem_schemas import DependencyRule, Subsystem


# ── identity_cohort_mapping ─────────────────────────────────────────────────


def _dependent_sub(rules: list[DependencyRule]) -> Subsystem:
    return Subsystem(
        id="sub1",
        name="Infra",
        type="dependent",
        dimensions=[
            DimensionDef(name="infra_type", display_name="Type", labels=["a", "b"])
        ],
        depends_on="sys1",
        dependency_rules=rules,
    )


def test_identity_mapping_basic():
    sub = _dependent_sub([
        DependencyRule(id="r1", dependent_archetype_id="home_charger", expression="1"),
        DependencyRule(id="r2", dependent_archetype_id="public_charger", expression="1"),
    ])
    mapping = identity_cohort_mapping(sub)
    assert mapping == {
        "home_charger": ("home_charger", 1.0),
        "public_charger": ("public_charger", 1.0),
    }


def test_identity_mapping_deduplicates_archetypes():
    sub = _dependent_sub([
        DependencyRule(id="r1", dependent_archetype_id="home_charger", expression="1"),
        DependencyRule(id="r2", dependent_archetype_id="home_charger", expression="2"),
    ])
    mapping = identity_cohort_mapping(sub)
    assert mapping == {"home_charger": ("home_charger", 1.0)}


def test_identity_mapping_with_scaling():
    sub = _dependent_sub([
        DependencyRule(id="r1", dependent_archetype_id="home_charger", expression="1"),
        DependencyRule(id="r2", dependent_archetype_id="public_charger", expression="1"),
    ])
    mapping = identity_cohort_mapping(
        sub, scaling_by_archetype={"home_charger": 0.5}
    )
    assert mapping["home_charger"] == ("home_charger", 0.5)
    # Unscaled archetypes default to 1.0.
    assert mapping["public_charger"] == ("public_charger", 1.0)


def test_identity_mapping_empty_rules():
    sub = _dependent_sub([])
    assert identity_cohort_mapping(sub) == {}


# ── aggregate_subsystem_results ─────────────────────────────────────────────


GWP = ("IPCC 2013", "climate change", "GWP100")
EUTRO = ("ReCiPe", "eutrophication", "freshwater")


def _result(
    sys_id: str, method: tuple, years: list[DSMLCAYearResult], unit: str = "kg CO2eq"
) -> DSMLCAResult:
    total = sum(y.total_impact for y in years)
    peak_year = 0
    peak_impact = 0.0
    for y in years:
        if abs(y.total_impact) > abs(peak_impact):
            peak_impact = y.total_impact
            peak_year = y.year
    return DSMLCAResult(
        mfa_system_id=sys_id,
        method=list(method),
        method_label=" › ".join(method),
        scope="stock",
        unit=unit,
        years=years,
        summary=DSMLCASummary(
            total_impact=total, peak_year=peak_year, peak_impact=peak_impact
        ),
        stages_included=["Manufacturing"],
    )


def _year(y: int, total: float, cohort: str, material: str) -> DSMLCAYearResult:
    return DSMLCAYearResult(
        year=y,
        total_impact=total,
        impact_by_cohort={cohort: total},
        impact_by_material={material: total},
        count_by_cohort={cohort: total / 10.0},
        unit="kg CO2eq",
    )


def test_aggregate_sums_years_across_subsystems():
    primary = [
        _result(
            "sys1", GWP,
            [_year(2020, 100.0, "bev|small", "steel"), _year(2021, 120.0, "bev|small", "steel")],
        )
    ]
    dependent = [
        _result(
            "sub_infra", GWP,
            [_year(2020, 10.0, "home_charger", "copper"), _year(2021, 15.0, "home_charger", "copper")],
        )
    ]
    merged = aggregate_subsystem_results({"sys1": primary, "sub_infra": dependent})
    assert len(merged) == 1
    r = merged[0]
    assert tuple(r.method) == GWP
    # Year totals sum across subsystems.
    assert r.years[0].year == 2020
    assert r.years[0].total_impact == 110.0
    assert r.years[1].total_impact == 135.0
    # Cohort/material keys are prefixed with subsystem id.
    assert f"sys1{SUBSYSTEM_KEY_SEP}bev|small" in r.years[0].impact_by_cohort
    assert f"sub_infra{SUBSYSTEM_KEY_SEP}home_charger" in r.years[0].impact_by_cohort
    assert f"sys1{SUBSYSTEM_KEY_SEP}steel" in r.years[0].impact_by_material
    assert f"sub_infra{SUBSYSTEM_KEY_SEP}copper" in r.years[0].impact_by_material
    # Summary recomputed.
    assert r.summary.total_impact == 245.0
    assert r.summary.peak_year == 2021
    assert r.summary.peak_impact == 135.0


def test_aggregate_multi_method():
    primary = [
        _result("sys1", GWP, [_year(2020, 100.0, "bev", "steel")]),
        _result("sys1", EUTRO, [_year(2020, 5.0, "bev", "steel")], unit="kg Peq"),
    ]
    dependent = [
        _result("sub1", GWP, [_year(2020, 10.0, "hc", "copper")]),
        _result("sub1", EUTRO, [_year(2020, 0.5, "hc", "copper")], unit="kg Peq"),
    ]
    merged = aggregate_subsystem_results({"sys1": primary, "sub1": dependent})
    assert len(merged) == 2
    by_method = {tuple(r.method): r for r in merged}
    assert by_method[GWP].years[0].total_impact == 110.0
    assert by_method[EUTRO].years[0].total_impact == 5.5
    assert by_method[EUTRO].unit == "kg Peq"


def test_aggregate_missing_year_treated_as_zero():
    # Dependent has no 2021 entry — primary's 2021 stands alone.
    primary = [
        _result(
            "sys1", GWP,
            [_year(2020, 100.0, "bev", "steel"), _year(2021, 120.0, "bev", "steel")],
        )
    ]
    dependent = [
        _result("sub1", GWP, [_year(2020, 10.0, "hc", "copper")])
    ]
    merged = aggregate_subsystem_results({"sys1": primary, "sub1": dependent})
    r = merged[0]
    years_by_y = {y.year: y for y in r.years}
    assert years_by_y[2020].total_impact == 110.0
    assert years_by_y[2021].total_impact == 120.0


def test_aggregate_method_present_only_in_one_subsystem():
    # Only primary computed GWP; dependent computed nothing. Aggregation
    # should still produce a GWP result from primary alone.
    primary = [_result("sys1", GWP, [_year(2020, 50.0, "bev", "steel")])]
    merged = aggregate_subsystem_results({"sys1": primary, "sub1": []})
    assert len(merged) == 1
    assert merged[0].years[0].total_impact == 50.0


def test_aggregate_prefix_disabled_leaves_keys_raw():
    primary = [_result("sys1", GWP, [_year(2020, 10.0, "bev", "steel")])]
    dependent = [_result("sub1", GWP, [_year(2020, 5.0, "hc", "copper")])]
    merged = aggregate_subsystem_results(
        {"sys1": primary, "sub1": dependent}, prefix_keys=False
    )
    r = merged[0]
    # Raw cohort keys preserved (disjoint namespaces, so no collision here).
    assert "bev" in r.years[0].impact_by_cohort
    assert "hc" in r.years[0].impact_by_cohort


def test_aggregate_empty_input_raises():
    with pytest.raises(ValueError, match="empty"):
        aggregate_subsystem_results({})


def test_aggregate_stages_included_union():
    r1 = _result("sys1", GWP, [_year(2020, 10.0, "bev", "steel")])
    r1.stages_included = ["Manufacturing", "Operation"]
    r2 = _result("sub1", GWP, [_year(2020, 5.0, "hc", "copper")])
    r2.stages_included = ["Manufacturing", "End of Life"]
    merged = aggregate_subsystem_results({"sys1": [r1], "sub1": [r2]})
    # Subsystem ids iterate sorted → "sub1" before "sys1" → End of Life first.
    assert merged[0].stages_included == ["Manufacturing", "End of Life", "Operation"]
