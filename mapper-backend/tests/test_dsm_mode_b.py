# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Tests for DSM Mode B (stock-driven) + related helpers.

Covers the four validation scenarios from the spec:
  T1 — Pure decline (ICEV-Diesel|Small) with FIFO retirement
  T2 — Growth then plateau
  T3 — Stock target exactly matches natural Weibull attrition (no forced flow)
  T4 — Mode A → Mode B round-trip recovers original inflows

Plus: Weibull reverse decomposition, mode-config resolution, FIFO correctness,
aggregate-stock parser, fleet-drift warning, mixed Mode A+B in one system.
"""
from __future__ import annotations

import pytest

from mapper.core.dsm_engine import (
    DEFAULT_WEIBULL_SCALE,
    DEFAULT_WEIBULL_SHAPE,
    DynamicStockModel,
    aggregate_stock_template_csv,
    best_mode_for_cohort,
    parse_aggregate_stock_file,
    parse_stock_file,
    parse_stock_target_file,
    stock_target_template_csv,
    weibull_reverse_age_decomposition,
)
from mapper.models.dsm_schemas import (
    DSMSystemState,
    DimensionDef,
    InflowData,
    ModeConfig,
    StockTargetData,
    SurvivalConfig,
    SystemDefinition,
    TimeHorizon,
)


# ── Helpers ───────────────────────────────────────────────────────────────────


def _system(start: int, end: int, labels: list[str] = ["BEV", "ICEV"]) -> SystemDefinition:
    return SystemDefinition(
        id="s",
        name="test",
        time_horizon=TimeHorizon(start_year=start, end_year=end),
        dimensions=[
            DimensionDef(name="fuel_type", display_name="Fuel", labels=labels),
        ],
    )


def _decomposed(total: float, cohort_key: str, max_age: int = 20) -> dict[str, float]:
    dist = weibull_reverse_age_decomposition(
        total, DEFAULT_WEIBULL_SHAPE, DEFAULT_WEIBULL_SCALE, max_age
    )
    return {f"{cohort_key}|{age}": count for age, count in dist.items()}


# ── Weibull reverse decomposition ─────────────────────────────────────────────


def test_reverse_decomposition_sums_to_total():
    dist = weibull_reverse_age_decomposition(1000.0, DEFAULT_WEIBULL_SHAPE, DEFAULT_WEIBULL_SCALE)
    assert sum(dist.values()) == pytest.approx(1000.0, rel=1e-9)


def test_reverse_decomposition_monotonically_decreasing():
    dist = weibull_reverse_age_decomposition(1000.0, DEFAULT_WEIBULL_SHAPE, DEFAULT_WEIBULL_SCALE)
    ages = sorted(dist.keys())
    for i in range(len(ages) - 1):
        assert dist[ages[i]] >= dist[ages[i + 1]]


def test_reverse_decomposition_zero_total_returns_empty():
    assert weibull_reverse_age_decomposition(0.0) == {}


def test_reverse_decomposition_degenerate_scale_collapses_to_age_one():
    # Survival drops below floor immediately → fallback collapses total to age=1.
    dist = weibull_reverse_age_decomposition(500.0, 4.0, 1e-9)
    assert sum(dist.values()) == pytest.approx(500.0)
    assert 0 not in dist


def test_reverse_decomposition_excludes_age_zero():
    """The decomposition produces age=1..max_age cohorts only — never age=0."""
    dist = weibull_reverse_age_decomposition(1000.0, DEFAULT_WEIBULL_SHAPE, DEFAULT_WEIBULL_SCALE)
    assert 0 not in dist
    assert min(dist.keys()) == 1
    assert sum(dist.values()) == pytest.approx(1000.0)


# ── Mode resolution ───────────────────────────────────────────────────────────


def test_mode_defaults_to_survival_inflow_when_no_configs():
    assert best_mode_for_cohort({"fuel_type": "BEV"}, []) == "survival_inflow"


def test_mode_config_most_specific_wins():
    configs = [
        ModeConfig(dimension_filters={}, mode="survival_inflow"),
        ModeConfig(dimension_filters={"fuel_type": "ICEV"}, mode="survival_stock"),
    ]
    assert best_mode_for_cohort({"fuel_type": "ICEV"}, configs) == "survival_stock"
    assert best_mode_for_cohort({"fuel_type": "BEV"}, configs) == "survival_inflow"


def test_mode_config_empty_filter_is_default():
    configs = [ModeConfig(dimension_filters={}, mode="survival_stock")]
    assert best_mode_for_cohort({"fuel_type": "BEV"}, configs) == "survival_stock"


# ── T1: Pure decline + FIFO ───────────────────────────────────────────────────


def test_mode_b_pure_decline_matches_target():
    """Stock target: 10,000 → 0 linearly over 5 years. Stock must match each year."""
    system = _system(2025, 2030)
    initial = _decomposed(10000.0, "ICEV")
    targets = [
        StockTargetData(year=y, counts={"ICEV": max(0.0, 10000 - 2000 * (y - 2025))})
        for y in range(2025, 2031)
    ]
    state = DSMSystemState(
        system_id="s",
        initial_stock=initial,
        mode_configs=[ModeConfig(dimension_filters={"fuel_type": "ICEV"}, mode="survival_stock")],
        stock_targets=targets,
    )
    result = DynamicStockModel(system, state).simulate()

    for yr_result, target in zip(result.years, targets):
        expected = target.counts["ICEV"]
        if yr_result.year == 2025:
            # Year 0 is setup — initial stock taken as given; may not equal target.
            continue
        stock = yr_result.stock.get("ICEV", 0.0)
        assert stock == pytest.approx(expected, abs=1e-6), (
            f"Year {yr_result.year}: stock {stock} != target {expected}"
        )

    # Forced retirement should be positive in at least some years.
    forced_years = [yr for yr in result.years[1:] if yr.forced_retirement.get("ICEV", 0.0) > 0]
    assert forced_years, "Expected forced retirement in declining-target scenario"

    # Pure decline = no new manufacturing. survival_stock takes initial stock
    # as given at t₀ (year-0 inflow = 0), and the declining target plus natural
    # attrition keeps inflows at zero in subsequent years too.
    for yr in result.years[1:]:
        assert yr.inflow.get("ICEV", 0.0) == pytest.approx(0.0, abs=1e-9)


def test_mode_b_fifo_retires_highest_age_first():
    """Two age buckets; forced retirement should drain the oldest first."""
    system = _system(2025, 2026)
    # 10 old vehicles (age 15) + 20 young (age 0). Target next year: 15.
    initial = {"ICEV|15": 10.0, "ICEV|0": 20.0}
    targets = [
        StockTargetData(year=2025, counts={"ICEV": 30.0}),
        StockTargetData(year=2026, counts={"ICEV": 15.0}),
    ]
    # Effectively disable Weibull attrition so the test is deterministic.
    state = DSMSystemState(
        system_id="s",
        initial_stock=initial,
        mode_configs=[ModeConfig(dimension_filters={"fuel_type": "ICEV"}, mode="survival_stock")],
        stock_targets=targets,
        survival_configs=[
            SurvivalConfig(
                dimension_filters={},
                method="weibull",
                weibull_shape=4.0,
                weibull_scale=1e9,
            )
        ],
    )
    result = DynamicStockModel(system, state).simulate()
    yr2026 = result.years[1]
    # After aging: age 16 has 10, age 1 has 20. Target 15 → forced 15.
    # FIFO: drain age 16 (10) first, then age 1 (5).
    forced_by_age = yr2026.forced_retirement_by_age.get("ICEV", {})
    assert forced_by_age.get(16) == pytest.approx(10.0)
    assert forced_by_age.get(1) == pytest.approx(5.0)
    # Residual stock: 15 @ age 1.
    assert yr2026.stock_by_age.get("ICEV", {}).get(1) == pytest.approx(15.0)
    assert 16 not in yr2026.stock_by_age.get("ICEV", {})
    assert yr2026.stock.get("ICEV", 0.0) == pytest.approx(15.0)


# ── T2: Growth then plateau ───────────────────────────────────────────────────


def test_mode_b_growth_then_plateau():
    system = _system(2025, 2035, labels=["BEV"])
    initial = _decomposed(50000.0, "BEV")
    targets = []
    for y in range(2025, 2036):
        s = 50000.0 + (100000.0 - 50000.0) * min(1.0, (y - 2025) / 5)
        targets.append(StockTargetData(year=y, counts={"BEV": s}))
    state = DSMSystemState(
        system_id="s",
        initial_stock=initial,
        mode_configs=[ModeConfig(dimension_filters={}, mode="survival_stock")],
        stock_targets=targets,
    )
    result = DynamicStockModel(system, state).simulate()
    # Plateau (2033-2035): stock matches target.
    for yr in result.years[-3:]:
        assert yr.stock["BEV"] == pytest.approx(100000.0, abs=1e-4)
    # No forced retirement during growth.
    for yr in result.years:
        assert yr.forced_retirement.get("BEV", 0.0) == pytest.approx(0.0, abs=1e-9)


# ── T3: Target matches natural attrition ──────────────────────────────────────


def test_mode_b_no_flows_when_target_matches_natural_attrition():
    system = _system(2025, 2028)
    # Single-age initial stock — Weibull hazard at age 10+ will retire some.
    initial = {"ICEV|10": 1000.0}

    # Mode A with zero inflows ⇒ produces the natural trajectory.
    state_a = DSMSystemState(system_id="s", initial_stock=initial, inflows=[])
    result_a = DynamicStockModel(system, state_a).simulate()
    trajectory = {yr.year: yr.stock.get("ICEV", 0.0) for yr in result_a.years}

    # Feed the same trajectory into Mode B as targets.
    targets = [StockTargetData(year=y, counts={"ICEV": s}) for y, s in trajectory.items()]
    state_b = DSMSystemState(
        system_id="s",
        initial_stock=initial,
        mode_configs=[ModeConfig(dimension_filters={"fuel_type": "ICEV"}, mode="survival_stock")],
        stock_targets=targets,
    )
    result_b = DynamicStockModel(system, state_b).simulate()
    for yr in result_b.years:
        assert yr.inflow.get("ICEV", 0.0) == pytest.approx(0.0, abs=1e-6)
        assert yr.forced_retirement.get("ICEV", 0.0) == pytest.approx(0.0, abs=1e-6)
    for yr_a, yr_b in zip(result_a.years, result_b.years):
        assert yr_b.stock["ICEV"] == pytest.approx(yr_a.stock["ICEV"], abs=1e-6)


# ── T4: Mode A → Mode B round-trip ────────────────────────────────────────────


def test_mode_b_round_trip_recovers_mode_a_inflows():
    system = _system(2025, 2030)
    initial = _decomposed(5000.0, "ICEV")
    inflows_a = [InflowData(year=y, counts={"ICEV": 500.0}) for y in range(2026, 2031)]
    state_a = DSMSystemState(system_id="s", initial_stock=initial, inflows=inflows_a)
    result_a = DynamicStockModel(system, state_a).simulate()

    targets = [StockTargetData(year=yr.year, counts=dict(yr.stock)) for yr in result_a.years]
    state_b = DSMSystemState(
        system_id="s",
        initial_stock=initial,
        mode_configs=[ModeConfig(dimension_filters={"fuel_type": "ICEV"}, mode="survival_stock")],
        stock_targets=targets,
    )
    result_b = DynamicStockModel(system, state_b).simulate()
    for yr_a, yr_b in zip(result_a.years, result_b.years):
        assert yr_b.inflow.get("ICEV", 0.0) == pytest.approx(
            yr_a.inflow.get("ICEV", 0.0), abs=1e-6,
        )


# ── Output structure ──────────────────────────────────────────────────────────


def test_mode_b_outflow_equals_natural_plus_forced():
    system = _system(2025, 2028)
    initial = _decomposed(1000.0, "ICEV")
    targets = [StockTargetData(year=y, counts={"ICEV": 500.0}) for y in range(2025, 2029)]
    state = DSMSystemState(
        system_id="s",
        initial_stock=initial,
        mode_configs=[ModeConfig(dimension_filters={}, mode="survival_stock")],
        stock_targets=targets,
    )
    result = DynamicStockModel(system, state).simulate()
    for yr in result.years:
        for ck in yr.outflow:
            natural = yr.natural_outflow.get(ck, 0.0)
            forced = yr.forced_retirement.get(ck, 0.0)
            assert yr.outflow[ck] == pytest.approx(natural + forced, abs=1e-9)


def test_mode_a_outflow_has_no_forced_retirement():
    """Sanity: Mode A behavior preserved — forced_retirement stays empty/zero."""
    system = _system(2025, 2027)
    initial = _decomposed(1000.0, "BEV")
    inflows = [InflowData(year=y, counts={"BEV": 100.0}) for y in range(2026, 2028)]
    state = DSMSystemState(system_id="s", initial_stock=initial, inflows=inflows)
    result = DynamicStockModel(system, state).simulate()
    for yr in result.years:
        for ck in yr.outflow:
            assert yr.forced_retirement.get(ck, 0.0) == pytest.approx(0.0)
            assert yr.natural_outflow.get(ck, 0.0) == pytest.approx(yr.outflow[ck])


# ── Mixed Mode A + Mode B ─────────────────────────────────────────────────────


def test_mixed_modes_in_one_system():
    """BEV stays Mode A (inflow-driven); ICEV switches to Mode B (stock-driven)."""
    system = _system(2025, 2027)
    initial = {
        **_decomposed(1000.0, "BEV"),
        **_decomposed(2000.0, "ICEV"),
    }
    inflows = [InflowData(year=y, counts={"BEV": 300.0}) for y in range(2026, 2028)]
    targets = [
        StockTargetData(year=y, counts={"ICEV": max(0.0, 2000 - 500 * (y - 2025))})
        for y in range(2025, 2028)
    ]
    state = DSMSystemState(
        system_id="s",
        initial_stock=initial,
        inflows=inflows,
        mode_configs=[ModeConfig(dimension_filters={"fuel_type": "ICEV"}, mode="survival_stock")],
        stock_targets=targets,
    )
    result = DynamicStockModel(system, state).simulate()
    for yr in result.years[1:]:
        assert yr.inflow.get("BEV", 0.0) == pytest.approx(300.0)
    for yr_result, tgt in zip(result.years[1:], targets[1:]):
        assert yr_result.stock.get("ICEV", 0.0) == pytest.approx(
            tgt.counts["ICEV"], abs=1e-6,
        )


# ── Fleet-drift warning ───────────────────────────────────────────────────────


def test_fleet_drift_warning_fires_on_large_drift():
    """Mode B target implying >5% drift from year-0 baseline triggers a warning."""
    system = _system(2025, 2028)
    initial = _decomposed(1000.0, "ICEV")
    # Target halves by year 2 — >50% drift, way over ±5% threshold.
    targets = [
        StockTargetData(year=2025, counts={"ICEV": 1000.0}),
        StockTargetData(year=2026, counts={"ICEV": 500.0}),
        StockTargetData(year=2027, counts={"ICEV": 500.0}),
        StockTargetData(year=2028, counts={"ICEV": 500.0}),
    ]
    state = DSMSystemState(
        system_id="s",
        initial_stock=initial,
        mode_configs=[ModeConfig(dimension_filters={}, mode="survival_stock")],
        stock_targets=targets,
    )
    result = DynamicStockModel(system, state).simulate()
    assert result.summary.warnings, "Expected a drift warning for ≥50% reduction"
    assert "drift" in result.summary.warnings[0].lower()


def test_fleet_drift_warning_silent_within_band():
    """A target trajectory that stays close to year-0 post-hazard stock
    produces no warning."""
    system = _system(2025, 2028)
    # Single young-cohort initial stock → negligible year-0 Weibull attrition,
    # so holding the target constant keeps drift well under ±5%.
    initial = {"ICEV|0": 1000.0}
    targets = [StockTargetData(year=y, counts={"ICEV": 1000.0}) for y in range(2025, 2029)]
    state = DSMSystemState(
        system_id="s",
        initial_stock=initial,
        mode_configs=[ModeConfig(dimension_filters={}, mode="survival_stock")],
        stock_targets=targets,
    )
    result = DynamicStockModel(system, state).simulate()
    assert result.summary.warnings == []


# ── Manufacturing exclusion for pre-2025 cohorts ──────────────────────────────


def test_mode_b_year_0_has_no_inflow():
    """survival_stock mode takes the year-0 initial stock as given.
    Year-0 inflow is therefore zero — no manufacturing booked at t₀.
    Manufacturing impacts at t₀ must be supplied via the inflows CSV
    (which requires switching the cohort to survival_inflow mode)."""
    system = _system(2025, 2028)
    initial = _decomposed(1000.0, "ICEV")
    targets = [StockTargetData(year=y, counts={"ICEV": 1000.0}) for y in range(2025, 2029)]
    state = DSMSystemState(
        system_id="s",
        initial_stock=initial,
        mode_configs=[ModeConfig(dimension_filters={}, mode="survival_stock")],
        stock_targets=targets,
    )
    result = DynamicStockModel(system, state).simulate()
    year_0 = result.years[0]
    assert year_0.inflow.get("ICEV", 0.0) == pytest.approx(0.0)
    assert year_0.forced_retirement.get("ICEV", 0.0) == pytest.approx(0.0)


# ── File parsers ──────────────────────────────────────────────────────────────


def test_parse_stock_target_file_basic():
    dims = [DimensionDef(name="fuel_type", display_name="F", labels=["BEV", "ICEV"])]
    content = b"year,fuel_type,count\n2025,ICEV,1000\n2026,ICEV,800\n2025,BEV,100\n"
    targets, rows = parse_stock_target_file(content, "targets.csv", dims, [2025, 2026])
    assert rows == 3
    by_year = {t.year: t.counts for t in targets}
    assert by_year[2025] == {"ICEV": 1000.0, "BEV": 100.0}
    assert by_year[2026] == {"ICEV": 800.0}


def test_parse_stock_target_file_rejects_out_of_horizon_year():
    dims = [DimensionDef(name="fuel_type", display_name="F", labels=["BEV"])]
    content = b"year,fuel_type,count\n2099,BEV,100\n"
    with pytest.raises(ValueError, match="outside the system's time horizon"):
        parse_stock_target_file(content, "t.csv", dims, [2025, 2026])


def test_parse_stock_target_file_rejects_negative_targets():
    dims = [DimensionDef(name="fuel_type", display_name="F", labels=["BEV"])]
    content = b"year,fuel_type,count\n2025,BEV,-5\n"
    with pytest.raises(ValueError, match="Negative stock target"):
        parse_stock_target_file(content, "t.csv", dims, [2025])


def test_parse_aggregate_stock_file_decomposes_rows():
    dims = [DimensionDef(name="fuel_type", display_name="F", labels=["BEV", "ICEV"])]
    content = b"fuel_type,count\nICEV,1000\nBEV,500\n"
    out, rows = parse_aggregate_stock_file(content, "stock.csv", dims)
    assert rows == 2
    icev_total = sum(v for k, v in out.items() if k.startswith("ICEV|"))
    bev_total = sum(v for k, v in out.items() if k.startswith("BEV|"))
    assert icev_total == pytest.approx(1000.0)
    assert bev_total == pytest.approx(500.0)
    # Decomposition must produce no age=0 cohort — initial stock is age ≥ 1.
    ages = [int(k.split("|")[1]) for k in out if k.startswith("ICEV|")]
    assert 0 not in ages
    assert min(ages) == 1
    # Age 1 has the highest Weibull survival weight among the produced ages.
    assert out.get("ICEV|1", 0) >= out.get("ICEV|15", 0)


def test_parse_stock_file_rejects_age_zero():
    """Initial stock with age=0 rows must be rejected with a clear error
    pointing the user to the inflows CSV."""
    dims = [DimensionDef(name="fuel_type", display_name="F", labels=["BEV"])]
    content = b"fuel_type,age,count\nBEV,0,100\n"
    with pytest.raises(ValueError, match="ages 1 and above"):
        parse_stock_file(content, "stock.csv", dims)


def test_parse_stock_file_rejects_negative_age():
    dims = [DimensionDef(name="fuel_type", display_name="F", labels=["BEV"])]
    content = b"fuel_type,age,count\nBEV,-1,100\n"
    with pytest.raises(ValueError, match="ages 1 and above"):
        parse_stock_file(content, "stock.csv", dims)


def test_stock_target_template_has_year_dim_count_columns():
    dims = [DimensionDef(name="fuel_type", display_name="F", labels=["BEV"])]
    csv_text = stock_target_template_csv(dims, [2025, 2026])
    header = csv_text.splitlines()[0]
    assert header == "year,fuel_type,count"


def test_aggregate_stock_template_has_no_age_column():
    dims = [DimensionDef(name="fuel_type", display_name="F", labels=["BEV"])]
    csv_text = aggregate_stock_template_csv(dims)
    header = csv_text.splitlines()[0]
    assert header == "fuel_type,count"
    assert "age" not in header
