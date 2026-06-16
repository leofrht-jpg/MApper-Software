"""Tests for the DSM ``integer_units`` toggle.

Ensures that with ``DSMSystemState.integer_units=True``:
- the largest-remainder rounding helper preserves sum and is deterministic,
- every YearResult field surfaces integer-valued floats,
- mass balance is preserved across steps (stock[t] = stock[t-1] + in - out).

The toggle is off by default — backwards compatibility is covered implicitly
by the existing DSM tests that don't set the flag.
"""
from __future__ import annotations

import math

from mapper.core.dsm_engine import (
    DynamicStockModel,
    largest_remainder_round,
    weibull_reverse_age_decomposition,
)
from mapper.models.dsm_schemas import (
    DimensionDef,
    DSMSystemState,
    InflowData,
    ModeConfig,
    OutflowData,
    StockTargetData,
    SystemDefinition,
    TimeHorizon,
)


def _system(start: int = 2020, end: int = 2024) -> SystemDefinition:
    return SystemDefinition(
        id="s",
        name="test",
        time_horizon=TimeHorizon(start_year=start, end_year=end),
        dimensions=[
            DimensionDef(name="fuel", display_name="Fuel", labels=["BEV", "ICEV"]),
        ],
    )


def _all_integer(values) -> bool:
    return all(float(v).is_integer() for v in values)


# ── largest_remainder_round helper ─────────────────────────────────────────────


def test_largest_remainder_preserves_sum():
    r = largest_remainder_round({"a": 1.4, "b": 2.4, "c": 3.2})
    assert sum(r.values()) == round(1.4 + 2.4 + 3.2)
    assert all(float(v).is_integer() for v in r.values())


def test_largest_remainder_deterministic():
    # Equal remainders — tie-break by key order must be stable.
    a = largest_remainder_round({"b": 1.5, "a": 2.5})
    b = largest_remainder_round({"a": 2.5, "b": 1.5})
    assert a == b


def test_largest_remainder_explicit_target():
    r = largest_remainder_round({"a": 1.0, "b": 2.0, "c": 3.0}, target_total=5)
    assert sum(r.values()) == 5


def test_largest_remainder_empty():
    assert largest_remainder_round({}) == {}


# ── Aggregate decomposition with integer_units ─────────────────────────────────


def test_reverse_decomposition_integer_preserves_total():
    d = weibull_reverse_age_decomposition(
        total=1000.0, shape=4.0, scale=15.0, max_age=25, integer_units=True
    )
    assert sum(d.values()) == 1000
    assert _all_integer(d.values())


# ── End-to-end simulation: all YearResult surfaces are integers ────────────────


def test_survival_inflow_integer_units_yields_integer_results():
    sys = _system(2020, 2023)
    state = DSMSystemState(
        system_id="s",
        initial_stock={"BEV|2": 123.0, "ICEV|5": 456.0, "ICEV|6": 789.0},
        inflows=[
            # Fractional inflows: engine must round per cohort before using.
            InflowData(year=2021, counts={"BEV": 100.4, "ICEV": 50.6}),
            InflowData(year=2022, counts={"BEV": 200.5, "ICEV": 75.3}),
        ],
        integer_units=True,
    )
    res = DynamicStockModel(sys, state).simulate()

    for yr in res.years:
        assert _all_integer(yr.stock.values())
        assert _all_integer(yr.inflow.values())
        assert _all_integer(yr.outflow.values())
        assert _all_integer(yr.natural_outflow.values())
        for ages in yr.stock_by_age.values():
            assert _all_integer(ages.values())
        for ages in yr.outflow_by_age.values():
            assert _all_integer(ages.values())


def test_manual_mode_integer_units_preserves_mass_balance():
    sys = _system(2020, 2023)
    state = DSMSystemState(
        system_id="s",
        mode_configs=[ModeConfig(dimension_filters={}, mode="manual")],
        initial_stock={"BEV|0": 0.0, "ICEV|0": 1000.0},
        inflows=[InflowData(year=2021, counts={"BEV": 200.5, "ICEV": 100.6})],
        outflows=[OutflowData(year=2021, counts={"BEV": 0.0, "ICEV": 80.4})],
        integer_units=True,
    )
    res = DynamicStockModel(sys, state).simulate()

    y0 = res.years[0]
    y1 = res.years[1]
    for ck in y0.stock:
        balance = (
            y0.stock[ck]
            + y1.inflow.get(ck, 0.0)
            - y1.outflow.get(ck, 0.0)
        )
        assert math.isclose(balance, y1.stock[ck], abs_tol=1e-9)
        assert float(y1.stock[ck]).is_integer()


def test_survival_stock_integer_units_forced_retirement_is_integer():
    sys = _system(2020, 2022)
    state = DSMSystemState(
        system_id="s",
        mode_configs=[ModeConfig(dimension_filters={}, mode="survival_stock")],
        initial_stock={"BEV|1": 1000.0, "ICEV|1": 1000.0},
        # Drive a forced-retirement event via a lower target than surviving stock.
        stock_targets=[
            StockTargetData(year=2021, counts={"BEV": 800.4, "ICEV": 700.7}),
        ],
        integer_units=True,
    )
    res = DynamicStockModel(sys, state).simulate()

    for yr in res.years:
        assert _all_integer(yr.forced_retirement.values())
        for ages in yr.forced_retirement_by_age.values():
            assert _all_integer(ages.values())
        assert _all_integer(yr.stock.values())


def test_integer_units_default_is_off_and_backward_compatible():
    # Default state has integer_units False — results may be fractional.
    sys = _system(2020, 2022)
    state = DSMSystemState(
        system_id="s",
        initial_stock={"BEV|2": 100.0},
    )
    assert state.integer_units is False
    res = DynamicStockModel(sys, state).simulate()
    # Weibull hazard on a 100-unit cohort will produce fractional outflow.
    fractional_seen = False
    for yr in res.years:
        for v in yr.outflow.values():
            if not float(v).is_integer():
                fractional_seen = True
    assert fractional_seen
