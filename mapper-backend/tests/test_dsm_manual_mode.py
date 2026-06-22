# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Tests for the DSM manual simulation mode.

Manual mode bypasses the survival function: the user uploads stock, inflows,
and outflows, and the engine plays the data back with pure accounting. These
tests cover the accounting identity, FIFO outflow allocation, cohort-specific
outflows (``birth_year`` column), over-supply warnings, mixed manual + survival
cohorts within one system, and migration of the legacy mode-enum values.
"""
from __future__ import annotations

import pytest

from mapper.core.dsm_engine import (
    DynamicStockModel,
    outflow_template_csv,
    parse_outflow_file,
)
from mapper.models.dsm_schemas import (
    DimensionDef,
    DSMSystemState,
    InflowData,
    ModeConfig,
    OutflowData,
    SystemDefinition,
    TimeHorizon,
    get_base_scenario,
    materialize_scenario,
)


def _base(state: DSMSystemState):
    """Short-hand for writing data into the Base scenario of a new-style state."""
    return get_base_scenario(state)


def _sim(sys_def, state):
    return DynamicStockModel(sys_def, materialize_scenario(state)).simulate()


# ── Helpers ───────────────────────────────────────────────────────────────────


def _system(start: int, end: int, labels: list[str] | None = None) -> SystemDefinition:
    return SystemDefinition(
        id="s",
        name="test",
        time_horizon=TimeHorizon(start_year=start, end_year=end),
        dimensions=[
            DimensionDef(
                name="fuel_type",
                display_name="Fuel",
                labels=labels or ["BEV", "ICEV"],
            ),
        ],
    )


def _manual_state(system_id: str = "s") -> DSMSystemState:
    return DSMSystemState(
        system_id=system_id,
        mode_configs=[ModeConfig(dimension_filters={}, mode="manual")],
    )


# ── Legacy mode-value migration ───────────────────────────────────────────────


def test_legacy_mode_values_are_migrated():
    """Existing state.json files written with the pre-refactor enum names keep loading."""
    cfg_inflow = ModeConfig(dimension_filters={}, mode="inflow_driven")  # type: ignore[arg-type]
    cfg_stock = ModeConfig(dimension_filters={}, mode="stock_driven")  # type: ignore[arg-type]
    assert cfg_inflow.mode == "survival_inflow"
    assert cfg_stock.mode == "survival_stock"


# ── Accounting identity: stock(t) = stock(t-1) + in - out ────────────────────


def test_manual_mode_accounting_identity():
    sys = _system(2020, 2023)
    state = _manual_state()
    _base(state).initial_stock ={"BEV|0": 0.0, "ICEV|0": 1000.0}
    _base(state).inflows =[
        InflowData(year=2021, counts={"BEV": 200.0, "ICEV": 100.0}),
        InflowData(year=2022, counts={"BEV": 300.0, "ICEV": 50.0}),
    ]
    _base(state).outflows =[
        OutflowData(year=2021, counts={"BEV": 0.0, "ICEV": 80.0}),
        OutflowData(year=2022, counts={"BEV": 0.0, "ICEV": 40.0}),
    ]

    result = _sim(sys, state)
    per_year = {y.year: y for y in result.years}

    # Year 2020 is the initial stock (no flows applied).
    assert per_year[2020].stock["ICEV"] == pytest.approx(1000.0)
    # Each subsequent year: prev + in - out.
    assert per_year[2021].stock["ICEV"] == pytest.approx(1000.0 + 100.0 - 80.0)
    assert per_year[2022].stock["ICEV"] == pytest.approx(1020.0 + 50.0 - 40.0)
    assert per_year[2023].stock["ICEV"] == pytest.approx(1030.0)  # no flows scheduled in 2023

    # Manual outflows surface on the dedicated field too.
    assert per_year[2021].manual_outflow["ICEV"] == pytest.approx(80.0)
    assert per_year[2021].outflow["ICEV"] == pytest.approx(80.0)
    # No Weibull attrition when in manual mode.
    assert per_year[2021].natural_outflow["ICEV"] == pytest.approx(0.0)


# ── FIFO outflow allocation from the oldest age ──────────────────────────────


def test_manual_mode_fifo_oldest_age_first():
    """With an age-distributed initial stock, a manual outflow pulls from the oldest age first."""
    sys = _system(2020, 2021)
    state = _manual_state()
    # ICEV stock: 100 @ age 10, 100 @ age 5, 100 @ age 1.
    _base(state).initial_stock ={
        "ICEV|10": 100.0,
        "ICEV|5": 100.0,
        "ICEV|1": 100.0,
        "BEV|0": 0.0,
    }
    _base(state).outflows =[OutflowData(year=2021, counts={"ICEV": 150.0, "BEV": 0.0})]

    result = _sim(sys, state)
    year_2021 = next(y for y in result.years if y.year == 2021)

    # After aging one year: 100 @ age 11, 100 @ age 6, 100 @ age 2.
    # 150 outflow hits age 11 first (100) then age 6 (50). Age 2 untouched.
    stock_by_age = year_2021.stock_by_age["ICEV"]
    assert stock_by_age.get(11, 0.0) == pytest.approx(0.0)
    assert stock_by_age.get(6, 0.0) == pytest.approx(50.0)
    assert stock_by_age.get(2, 0.0) == pytest.approx(100.0)
    assert year_2021.manual_outflow["ICEV"] == pytest.approx(150.0)


# ── Cohort-specific outflows via birth_year column ───────────────────────────


def test_manual_mode_cohort_specific_outflows():
    sys = _system(2020, 2021)
    state = _manual_state()
    _base(state).initial_stock ={"ICEV|10": 100.0, "ICEV|5": 100.0, "BEV|0": 0.0}
    # Target the younger (age 5 → age 6 after aging) cohort explicitly.
    _base(state).outflows =[
        OutflowData(
            year=2021,
            counts={"ICEV": 30.0, "BEV": 0.0},
            cohort_age_counts={"ICEV|6": 30.0},
        )
    ]

    result = _sim(sys, state)
    year_2021 = next(y for y in result.years if y.year == 2021)
    stock = year_2021.stock_by_age["ICEV"]
    assert stock.get(11, 0.0) == pytest.approx(100.0)  # oldest untouched
    assert stock.get(6, 0.0) == pytest.approx(70.0)  # 30 removed from age 6


# ── Over-supply warning (outflow > available stock) ──────────────────────────


def test_manual_mode_over_supply_warns_and_caps():
    sys = _system(2020, 2021)
    state = _manual_state()
    _base(state).initial_stock ={"ICEV|0": 10.0, "BEV|0": 0.0}
    # Request 100 outflows but only 10 available.
    _base(state).outflows =[OutflowData(year=2021, counts={"ICEV": 100.0, "BEV": 0.0})]

    result = _sim(sys, state)
    warnings = result.summary.warnings
    assert any("exceeds available stock" in w for w in warnings)
    year_2021 = next(y for y in result.years if y.year == 2021)
    # Only 10 can actually be removed.
    assert year_2021.manual_outflow["ICEV"] == pytest.approx(10.0)
    assert year_2021.stock["ICEV"] == pytest.approx(0.0)


# ── Mixed modes: one cohort manual, another survival ──────────────────────────


def test_manual_and_survival_cohorts_coexist():
    sys = _system(2020, 2022)
    state = DSMSystemState(
        system_id="s",
        mode_configs=[
            ModeConfig(dimension_filters={}, mode="survival_inflow"),
            ModeConfig(dimension_filters={"fuel_type": "ICEV"}, mode="manual"),
        ],
    )
    _base(state).initial_stock ={"BEV|0": 0.0, "ICEV|0": 500.0}
    _base(state).inflows =[
        # BEV uses survival_inflow — count becomes new cohort. ICEV also has an
        # inflow in manual mode — just added to stock directly.
        InflowData(year=2021, counts={"BEV": 100.0, "ICEV": 50.0}),
    ]
    _base(state).outflows =[OutflowData(year=2021, counts={"ICEV": 30.0, "BEV": 0.0})]

    result = _sim(sys, state)
    y21 = next(y for y in result.years if y.year == 2021)

    # BEV: Weibull attrition at age 0 is 0 → stock becomes 100.
    assert y21.stock["BEV"] == pytest.approx(100.0)
    # ICEV manual: 500 + 50 - 30 = 520. No natural outflow.
    assert y21.stock["ICEV"] == pytest.approx(520.0)
    assert y21.natural_outflow["ICEV"] == pytest.approx(0.0)
    assert y21.manual_outflow["ICEV"] == pytest.approx(30.0)


# ── Parser: CSV without age/birth_year → FIFO ────────────────────────────────


def test_parse_outflow_file_basic_long_format():
    sys = _system(2020, 2021)
    csv = (
        "year,fuel_type,count\n"
        "2020,BEV,10\n"
        "2020,ICEV,20\n"
        "2021,ICEV,5\n"
    )
    out, rows, cohort_specific = parse_outflow_file(
        csv.encode(), "outflows.csv", sys.dimensions, sys.time_horizon.years
    )
    assert rows == 3
    assert cohort_specific is False
    assert out[0].year == 2020
    assert out[0].counts == {"BEV": 10.0, "ICEV": 20.0}
    assert out[0].cohort_age_counts == {}
    assert out[1].counts == {"ICEV": 5.0}


# ── Parser: CSV with birth_year → cohort-specific ────────────────────────────


def test_parse_outflow_file_birth_year_column():
    sys = _system(2020, 2022)
    csv = (
        "year,fuel_type,birth_year,count\n"
        "2022,ICEV,2015,30\n"
        "2022,ICEV,2018,10\n"
    )
    out, rows, cohort_specific = parse_outflow_file(
        csv.encode(), "outflows.csv", sys.dimensions, sys.time_horizon.years
    )
    assert rows == 2
    assert cohort_specific is True
    assert out[0].counts == {"ICEV": 40.0}
    # age = year - birth_year.
    assert out[0].cohort_age_counts == {"ICEV|7": 30.0, "ICEV|4": 10.0}


def test_parse_outflow_file_rejects_negative_count():
    sys = _system(2020, 2020)
    csv = "year,fuel_type,count\n2020,BEV,-5\n"
    with pytest.raises(ValueError, match="Negative outflow"):
        parse_outflow_file(
            csv.encode(), "outflows.csv", sys.dimensions, sys.time_horizon.years
        )


def test_parse_outflow_file_rejects_out_of_horizon_year():
    sys = _system(2020, 2020)
    csv = "year,fuel_type,count\n2030,BEV,1\n"
    with pytest.raises(ValueError, match="outside the system's time horizon"):
        parse_outflow_file(
            csv.encode(), "outflows.csv", sys.dimensions, sys.time_horizon.years
        )


# ── Template ─────────────────────────────────────────────────────────────────


def test_outflow_template_has_expected_columns():
    sys = _system(2020, 2021)
    csv = outflow_template_csv(sys.dimensions, sys.time_horizon.years)
    header = csv.splitlines()[0].split(",")
    assert header == ["year", "fuel_type", "count"]
    # Two years × two labels → four data rows.
    assert len(csv.splitlines()) == 1 + 4
