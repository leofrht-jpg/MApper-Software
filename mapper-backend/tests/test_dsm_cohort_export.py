# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""DSM "Cohorts in {year}" Excel export — structural test for the pure
data-shaping function `_cohort_export_rows` (ALL years, long format).

Locks the long-format flatten: one row per (year × cohort) across every year
and cohort, columns Year + dims + Stock/Inflow/Outflow/Net, Net = Inflow −
Outflow, years ascending and cohorts sorted by Stock desc within a year. Does
NOT assert the file/download (openpyxl writes the bytes; the shaping is what
matters)."""
from __future__ import annotations

from types import SimpleNamespace

from mapper.api.dsm import _cohort_export_rows
from mapper.models.dsm_schemas import (
    DimensionDef,
    SystemDefinition,
    TimeHorizon,
    YearResult,
)


def _system() -> SystemDefinition:
    return SystemDefinition(
        id="s", name="test",
        time_horizon=TimeHorizon(start_year=2025, end_year=2030),
        dimensions=[
            DimensionDef(name="fuel_type", display_name="Fuel", labels=["BEV", "ICE"]),
            DimensionDef(name="size", display_name="Size", labels=["Small", "Large"]),
        ],
    )


def _result():
    """Two years; year 2026 exercises the key-union (a cohort only in inflow,
    one only in outflow). Duck-typed: the pure fn only reads `result.years`."""
    y2025 = YearResult(
        year=2025,
        stock={"BEV|Small": 100.0, "ICE|Large": 40.0},
        stock_by_age={},
        inflow={"BEV|Small": 10.0},
        outflow={"ICE|Large": 4.0},
        outflow_by_age={},
    )
    y2026 = YearResult(
        year=2026,
        stock={"BEV|Small": 130.0},
        stock_by_age={},
        inflow={"BEV|Small": 12.0, "ICE|Small": 6.0},  # ICE|Small only in inflow
        outflow={"ICE|Large": 7.0},                      # ICE|Large only in outflow
        outflow_by_age={},
    )
    # Deliberately out of order to prove the fn sorts years ascending.
    return SimpleNamespace(years=[y2026, y2025])


def test_headers_year_dims_then_metrics():
    headers, _ = _cohort_export_rows(_system(), _result())
    assert headers == ["Year", "Fuel", "Size", "Stock", "Inflow", "Outflow", "Net"]


def test_one_row_per_year_times_cohort():
    _, rows = _cohort_export_rows(_system(), _result())
    # 2025: {BEV|Small, ICE|Large} = 2 ; 2026: {BEV|Small, ICE|Small, ICE|Large} = 3
    assert len(rows) == 5
    keys = {(r[0], r[1], r[2]) for r in rows}
    assert keys == {
        (2025, "BEV", "Small"), (2025, "ICE", "Large"),
        (2026, "BEV", "Small"), (2026, "ICE", "Small"), (2026, "ICE", "Large"),
    }


def test_values_net_and_ordering():
    _, rows = _cohort_export_rows(_system(), _result())
    by = {(r[0], r[1], r[2]): r for r in rows}

    # 2025 BEV|Small: stock 100, inflow 10, outflow 0 → net 10
    assert by[(2025, "BEV", "Small")] == [2025, "BEV", "Small", 100.0, 10.0, 0.0, 10.0]
    # 2026 ICE|Large: only in outflow → stock 0, inflow 0, outflow 7 → net -7
    assert by[(2026, "ICE", "Large")] == [2026, "ICE", "Large", 0.0, 0.0, 7.0, -7.0]
    # 2026 ICE|Small: only in inflow → stock 0, inflow 6, outflow 0 → net 6
    assert by[(2026, "ICE", "Small")] == [2026, "ICE", "Small", 0.0, 6.0, 0.0, 6.0]

    # years ascending: all 2025 rows precede all 2026 rows
    years_col = [r[0] for r in rows]
    assert years_col == sorted(years_col)
    assert years_col[0] == 2025 and years_col[-1] == 2026
    # within 2025, sorted by Stock desc (BEV|Small 100 before ICE|Large 40)
    y2025_rows = [r for r in rows if r[0] == 2025]
    assert [r[3] for r in y2025_rows] == sorted([r[3] for r in y2025_rows], reverse=True)


def test_empty_result_yields_headers_only():
    headers, rows = _cohort_export_rows(_system(), SimpleNamespace(years=[]))
    assert headers == ["Year", "Fuel", "Size", "Stock", "Inflow", "Outflow", "Net"]
    assert rows == []
