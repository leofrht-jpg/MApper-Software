# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""`Sensitivity case` as a leading export column.

Routed through the EXISTING `_build_multi_product_workbook` rather than a
fourth sibling builder: the shape is the same workbook with one more
discriminator column, not a different shape. `body.result` stays the Base
envelope, so Configuration / Stage amounts / Vintages / stage-breakdown sheets
are untouched and every existing consumer keeps working.

The column header is the same string the user sees in-app — the naming-drift
rule the multi-param / multi-DSM / multi-LCI workbooks already follow.
"""
from __future__ import annotations

from mapper.api.impact import _build_multi_product_workbook
from mapper.models.schemas import (
    ArchetypeLCACalculateResult,
    ArchetypeLCAMethodResult,
    MultiProductExportRequest,
    MultiProductItemResult,
    MultiProductLCAResult,
)


def _env(score: float) -> MultiProductLCAResult:
    return MultiProductLCAResult(
        items=[MultiProductItemResult(
            type="archetype", item_id="arc-1", label="A - Circular EV",
            status="success",
            archetype_result=ArchetypeLCACalculateResult(
                archetype_id="arc-1", archetype_name="A - Circular EV",
                scope="all", amount=1.0, stage_amounts={}, stages_included=["Manufacturing"],
                results=[ArchetypeLCAMethodResult(
                    method=["EF v3.1", "climate change", "GWP100"],
                    method_label="GWP100", score=score, unit="kg CO2-Eq",
                    contributions=[])],
                elapsed_seconds=0.1,
            ),
        )],
        success_count=1, error_count=0, elapsed_seconds=0.1,
    )


def _rows(ws):
    return [[c.value for c in r] for r in ws.iter_rows()]


def test_a_single_case_export_is_unchanged():
    """Absent or single-entry cases → byte-identical to before."""
    wb = _build_multi_product_workbook(MultiProductExportRequest(result=_env(1.0)))
    for sheet in ("Comparison (wide)", "Comparison (long)"):
        assert _rows(wb[sheet])[0][0] != "Sensitivity case", (
            f"{sheet} gained the discriminator with only one case")
    assert _rows(wb["Comparison (wide)"])[0][:3] == ["#", "Type", "Item"]


def test_multi_case_adds_the_leading_column_to_both_data_sheets():
    body = MultiProductExportRequest(
        result=_env(0.084197),
        results_by_case={
            "Base": _env(0.084197),
            "sa_early_repurpose_120kkm": _env(0.098647),
        },
        case_order=["Base", "sa_early_repurpose_120kkm"],
    )
    wb = _build_multi_product_workbook(body)

    wide = _rows(wb["Comparison (wide)"])
    assert wide[0][0] == "Sensitivity case"
    assert [r[0] for r in wide[1:]] == ["Base", "sa_early_repurpose_120kkm"]
    # The real spread survives the round trip.
    assert wide[1][4] == 0.084197
    assert wide[2][4] == 0.098647

    long = _rows(wb["Comparison (long)"])
    assert long[0][0] == "Sensitivity case"
    assert [r[0] for r in long[1:]] == ["Base", "sa_early_repurpose_120kkm"]
    assert [r[4] for r in long[1:]] == [0.084197, 0.098647]


def test_case_order_drives_the_row_order():
    """Selection order is the convention, not alphabetical."""
    body = MultiProductExportRequest(
        result=_env(1.0),
        results_by_case={"Base": _env(1.0), "zeta": _env(2.0), "alpha": _env(3.0)},
        case_order=["Base", "zeta", "alpha"],
    )
    wide = _rows(_build_multi_product_workbook(body)["Comparison (wide)"])
    assert [r[0] for r in wide[1:]] == ["Base", "zeta", "alpha"]


def test_a_case_missing_from_the_map_is_dropped_not_guessed():
    body = MultiProductExportRequest(
        result=_env(1.0),
        results_by_case={"Base": _env(1.0)},
        case_order=["Base", "never_ran"],
    )
    wide = _rows(_build_multi_product_workbook(body)["Comparison (wide)"])
    # One case left → single-case shape, no discriminator invented.
    assert wide[0][0] != "Sensitivity case"


def test_the_other_sheets_are_untouched_by_the_cases():
    body = MultiProductExportRequest(
        result=_env(1.0),
        results_by_case={"Base": _env(1.0), "b": _env(2.0)},
        case_order=["Base", "b"],
    )
    wb = _build_multi_product_workbook(body)
    cfg = _rows(wb["Configuration"])
    assert not any(
        row and row[0] == "Sensitivity case" for row in cfg
    ), "Configuration should not carry the per-row discriminator"
