# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""B1 — every carbon-budget label in an exported workbook follows the basis.

The reported artefact: on a CO2e-basis run the workbook wrote
"Initial budget (Gt CO2) = 1150.0" on the Carbon Budget sheet while the
Impacts-vs-SOS chain columns — reading the same run's engine output — wrote
"Remaining Budget (Gt CO2e) = 1707.2". Both cells were individually correct
(one is the pre-basis CO2 scalar, the other the CO2e series compute ran on),
but side by side they read as a remaining budget exceeding its initial budget.
These files get attached to papers.

The invariant asserted here is narrow and deliberate: **on a CO2e run, no cell
labels a basis-applied magnitude in CO2.** Cells that state the PUBLISHED CO2
input keep their CO2 label — the AR6 source prose and the explicit
"before conversion" row — because the conversion's whole value is that it stays
traceable to a cited CO2 budget. What must never happen is a CO2 unit sitting
over a number compute produced in CO2e.

The CO2-basis path is unchanged in value and its labels only become explicit
("(Gt)" -> "(Gt CO2)" on the Carbon Budget sheet, which already said "Gt CO2"
on its first row). The Impacts-vs-SOS columns keep their historical bare "(Gt)".
"""
from __future__ import annotations

import re

import pytest

from mapper.api.aesa import _build_aesa_workbook
from mapper.core.aesa_engine import build_carbon_budget
from mapper.models.aesa_schemas import (
    AESAComputeResult,
    AESAConfiguration,
    AESAYearSummary,
    SustainabilityRatioResult,
)

# Cells that legitimately state the PUBLISHED CO2 input on a CO2e run.
PRE_CONVERSION_LABELS = {
    "Source",                                        # the AR6 citation prose
    "Initial budget before conversion (Gt CO2)",     # the traceability figure
    "CO2->CO2e factor",
    "CO2->CO2e conversion",
    "Carbon budget",     # "<source prose> — N Gt CO2e": prose carries the input
    "Budget basis",
}

# "Gt CO2" but NOT "Gt CO2e" / "Gt CO2-eq".
CO2_UNIT = re.compile(r"\bGt\s*CO2(?!e|-eq)\b", re.IGNORECASE)


def _config(basis: str) -> tuple[AESAConfiguration, AESAComputeResult, float]:
    cb = build_carbon_budget().model_copy(update={"budget_basis": basis})
    f = cb.co2e_ratio() or 1.0
    config = AESAConfiguration(
        id="cfg", name="Basis test", mfa_system_id="sys", multi_d=None,
        carbon_budget=cb, created_at="2025-01-01T00:00:00Z",
    )
    # The engine emits remaining_budget_gt from the BASIS-APPLIED budget, so the
    # fixture does too — that is exactly the number the label must match.
    applied = cb.with_basis_applied()
    rows = [
        SustainabilityRatioResult(
            year=y, pb_id="climate_change", pb_name="Climate change",
            ef_indicator="climate change", method_label="EF v3.1 | climate change",
            impact=6.0e9, allocated_sos=1.2e10, sr=0.5,
            remaining_budget_gt=applied.remaining_budget(y),
            global_allocation_gt=applied.annual_global_allocation(y),
            zone="safe", sharing_principle="EpC",
            layer_factors=[0.001], total_sharing_factor=0.001,
            sharing_factor_l1=0.001, sharing_factor_l2=1.0,
            boundary_type="cumulative", unit="kg CO2-eq",
        )
        for y in (2025, 2030)
    ]
    result = AESAComputeResult(
        config_id="cfg", results=rows,
        summary_by_year=[AESAYearSummary(year=y, safe=1, zone_of_uncertainty=0,
                                         high_risk=0, total_assessed=1)
                         for y in (2025, 2030)],
    )
    return config, result, f


def _co2_labelled_cells(wb) -> list[tuple[str, str]]:
    """(sheet, text) for every string cell that states a CO2 unit.

    Exemption is per ROW, keyed on the row's label (column A): a row whose whole
    purpose is to record the published CO2 input is skipped entirely, including
    its value — the conversion's `source` string quotes "x20=1350 GtCO2", which
    is the provenance, not a mislabelled result.
    """
    out: list[tuple[str, str]] = []
    for name in wb.sheetnames:
        for row in wb[name].iter_rows(values_only=True):
            if not row or row[0] is None:
                continue
            if str(row[0]) in PRE_CONVERSION_LABELS:
                continue
            for cell in row:
                if isinstance(cell, str) and CO2_UNIT.search(cell):
                    out.append((name, cell))
    return out


def test_co2e_run_labels_no_basis_applied_value_in_co2():
    """The load-bearing one. Fails against the pre-B1 builder."""
    config, result, f = _config("CO2e_GHG")
    assert f > 1.0, "fixture must actually be on a CO2e basis"
    wb = _build_aesa_workbook(config, result, "Sys")

    offenders = _co2_labelled_cells(wb)
    assert offenders == [], (
        "CO2e-basis workbook carries CO2-labelled cells that are not the "
        f"published pre-conversion input: {offenders}"
    )


def test_co2e_run_initial_budget_is_the_converted_magnitude():
    config, result, f = _config("CO2e_GHG")
    wb = _build_aesa_workbook(config, result, "Sys")
    cells = {str(r[0]): r[1] for r in wb["Carbon Budget"].iter_rows(values_only=True) if r[0]}
    assert cells["Initial budget (Gt CO2e)"] == pytest.approx(1150.0 * f)
    # And the CO2 input stays visible, explicitly named, so the CO2e magnitude
    # is traceable to the AR6 budget it was converted from.
    assert cells["Initial budget before conversion (Gt CO2)"] == 1150.0
    assert cells["CO2->CO2e factor"] == pytest.approx(f)


def test_remaining_never_exceeds_initial_within_one_workbook():
    """The artefact as a reader meets it: initial 1150 next to remaining 1707.2.

    Cross-sheet, because the two numbers lived on different sheets — which is
    why neither sheet's own tests caught it.
    """
    for basis in ("CO2", "CO2e_GHG"):
        config, result, _ = _config(basis)
        wb = _build_aesa_workbook(config, result, "Sys")
        cb_cells = {str(r[0]): r[1] for r in wb["Carbon Budget"].iter_rows(values_only=True) if r[0]}
        initial = next(v for k, v in cb_cells.items() if k.startswith("Initial budget (Gt"))

        ivs = wb["Impacts vs SOS"]
        header = [c.value for c in ivs[1]]
        col = next(i for i, h in enumerate(header) if str(h).startswith("Remaining Budget"))
        remaining = [r[col] for r in ivs.iter_rows(min_row=2, values_only=True)
                     if r[col] is not None]
        assert remaining, "fixture produced no remaining-budget rows"
        assert max(remaining) <= initial + 1e-6, (
            f"{basis}: remaining budget {max(remaining)} exceeds initial {initial}"
        )


def test_co2_basis_values_are_unchanged():
    """No drift on the default basis: values byte-identical to the raw config."""
    config, result, f = _config("CO2")
    assert f == 1.0
    wb = _build_aesa_workbook(config, result, "Sys")
    cells = {str(r[0]): r[1] for r in wb["Carbon Budget"].iter_rows(values_only=True) if r[0]}
    cb = config.carbon_budget
    assert cells["Initial budget (Gt CO2)"] == cb.initial_budget_gt == 1150.0
    assert cells["Start year"] == cb.start_year
    assert cells["End year"] == cb.end_year
    # No conversion rows on the CO2 path.
    assert "CO2->CO2e factor" not in cells
    # And the per-year block still reports the raw pathway.
    ws = wb["Carbon Budget"]
    rows = [r for r in ws.iter_rows(values_only=True) if isinstance(r[0], int)]
    y, emis, rem, alloc = rows[0]
    assert y == cb.start_year
    assert emis == cb.projected_emissions.get(y, 0.0)
    assert rem == cb.remaining_budget(y)
    assert alloc == cb.annual_global_allocation(y)


def test_co2e_per_year_block_matches_the_engine_series():
    """The Carbon Budget sheet's per-year column must agree with the SR rows'
    `remaining_budget_gt`, which is what made the two sheets disagree."""
    config, result, _ = _config("CO2e_GHG")
    wb = _build_aesa_workbook(config, result, "Sys")
    sheet_rem = {r[0]: r[2] for r in wb["Carbon Budget"].iter_rows(values_only=True)
                 if isinstance(r[0], int)}
    for row in result.results:
        assert sheet_rem[row.year] == pytest.approx(row.remaining_budget_gt)
