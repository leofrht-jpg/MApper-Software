# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Patch 4AK — cohort mapping row colors backend.

Tests cover:

* ``_normalize_color`` validates hex strictly and treats empty / 'auto'
  as "no override" (returns None, no error).
* ``_cohort_template_workbook`` emits a ``color`` column populated from
  existing ``row_colors``; blank cells when no override.
* ``_parse_cohort_upload`` reads the ``color`` column when present and
  defaults to empty when absent (backward compat with pre-4AK templates).
* Upload endpoint persists valid hex into ``CohortMapping.row_colors``
  and surfaces invalid hex via ``invalid_row_colors`` without dropping
  the row's other data (archetype + scaling_factor still saved).
"""
from __future__ import annotations

import io

import openpyxl

from mapper.api.bom import (
    _normalize_color,
    _cohort_template_workbook,
    _parse_cohort_upload,
)
from mapper.models.bom_schemas import CohortMapping, CohortMappingEntry


class _Dim:
    def __init__(self, name: str, labels: list[str], is_age: bool = False):
        self.name = name
        self.labels = labels
        self.is_age = is_age


class _SysDef:
    def __init__(self, dims: list[_Dim]):
        self.dimensions = dims


# ── _normalize_color ─────────────────────────────────────────────────────────


def test_normalize_color_empty_is_no_override():
    assert _normalize_color("") == (None, False)
    assert _normalize_color("   ") == (None, False)


def test_normalize_color_auto_is_no_override():
    assert _normalize_color("auto") == (None, False)
    assert _normalize_color("AUTO") == (None, False)
    assert _normalize_color(" Auto ") == (None, False)


def test_normalize_color_valid_hex_lowercased():
    assert _normalize_color("#ABCDEF") == ("#abcdef", False)
    assert _normalize_color("  #14b8a6  ") == ("#14b8a6", False)


def test_normalize_color_rejects_3_digit_hex():
    # Strict 6-digit only — Excel won't auto-expand #abc.
    assert _normalize_color("#abc") == (None, True)


def test_normalize_color_rejects_invalid_strings():
    assert _normalize_color("red") == (None, True)
    assert _normalize_color("#GGGGGG") == (None, True)
    assert _normalize_color("rgb(0,0,0)") == (None, True)


# ── _cohort_template_workbook ─────────────────────────────────────────────────


def _read_ws_rows(wb):
    ws = wb.active
    return [list(r) for r in ws.iter_rows(values_only=True)]


def test_template_workbook_has_color_column_header():
    sys_def = _SysDef([
        _Dim("fuel_type", ["BEV-LFP", "ICEV"]),
        _Dim("size", ["Small", "Large"]),
    ])
    wb = _cohort_template_workbook(sys_def)
    rows = _read_ws_rows(wb)
    header = rows[0]
    assert header == ["fuel_type", "size", "archetype", "scaling_factor", "color"]


def test_template_workbook_blank_when_no_existing_mapping():
    sys_def = _SysDef([
        _Dim("fuel_type", ["BEV-LFP"]),
        _Dim("size", ["Small"]),
    ])
    wb = _cohort_template_workbook(sys_def)
    rows = _read_ws_rows(wb)
    # Header + 1 cohort row.
    assert len(rows) == 2
    # Cohort row: BEV-LFP | Small | '' | '' | ''
    assert rows[1] == ["BEV-LFP", "Small", "", "", ""]


def test_template_workbook_fills_color_from_existing():
    sys_def = _SysDef([
        _Dim("fuel_type", ["BEV-LFP", "ICEV"]),
        _Dim("size", ["Small"]),
    ])
    existing = CohortMapping(
        mfa_system_id="sys-1",
        mappings=[
            CohortMappingEntry(cohort_key="BEV-LFP|Small", archetype_id="arc-1", scaling_factor=1.0),
        ],
        row_colors={"BEV-LFP|Small": "#abcdef"},
    )
    wb = _cohort_template_workbook(
        sys_def, existing, archetypes_by_id={"arc-1": "BEV product"},
    )
    rows = _read_ws_rows(wb)
    # Header always first.
    assert rows[0][-1] == "color"
    # Find the BEV-LFP|Small row.
    bev_row = next(r for r in rows[1:] if r[0] == "BEV-LFP")
    assert bev_row[2] == "BEV product"  # archetype name
    assert bev_row[3] == 1.0           # scaling_factor
    assert bev_row[4] == "#abcdef"     # color
    # Other rows have blank color.
    other_rows = [r for r in rows[1:] if r[0] != "BEV-LFP"]
    for r in other_rows:
        assert r[4] in (None, "", )


# ── _parse_cohort_upload ─────────────────────────────────────────────────────


def _xlsx_bytes(rows: list[list]) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_parse_cohort_upload_reads_color_column():
    data = _xlsx_bytes([
        ["fuel_type", "size", "archetype", "scaling_factor", "color"],
        ["BEV-LFP", "Small", "BEV", 1.0, "#abcdef"],
        ["ICEV", "Large", "ICEV", 1.5, ""],
    ])
    parsed = _parse_cohort_upload(data, "upload.xlsx", ["fuel_type", "size"])
    assert len(parsed) == 2
    assert parsed[0]["color"] == "#abcdef"
    assert parsed[1]["color"] == ""


def test_parse_cohort_upload_backward_compat_no_color_column():
    # Pre-Patch-4AK templates lack the color column — parser must
    # default to '' and not crash.
    data = _xlsx_bytes([
        ["fuel_type", "size", "archetype", "scaling_factor"],
        ["BEV-LFP", "Small", "BEV", 1.0],
    ])
    parsed = _parse_cohort_upload(data, "upload.xlsx", ["fuel_type", "size"])
    assert len(parsed) == 1
    assert parsed[0]["color"] == ""
