# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""A row number in a BOM import message is the row the user sees in Excel.

The parser filtered rows per archetype and sorted stage roots first, THEN
numbered them, so "Row 6" was a position in that reordered list and pointed at
the wrong line of the sheet. Every row now carries its 1-based sheet row (header
is row 1, first data row row 2) from the moment it is read.

Synthetic workbooks only. The rows are laid out so that roots sort ahead of
children and two archetypes interleave: a position and a sheet row then differ
for every row that matters.
"""
from __future__ import annotations

import asyncio
import io

import pytest
from fastapi import HTTPException
from openpyxl import Workbook, load_workbook

from mapper.api import bom as bom_api

HEADER = ["archetype_name", "Stage", "Parent", "Name", "Type", "Quantity", "Unit",
          "Ecoinvent Database", "Ecoinvent Code", "Evolution Method"]


def _wb(rows: list[list], *, multi: bool = True) -> Workbook:
    wb = Workbook()
    if multi:
        meta = wb.active
        meta.title = "Archetypes"
        meta.append(["archetype_name", "folder", "description"])
        for a in sorted({r[0] for r in rows}):
            meta.append([a, "", ""])
        bom = wb.create_sheet("BOM")
        bom.append(HEADER)
        for r in rows:
            bom.append(r)
    else:
        bom = wb.active
        bom.title = "BOM"
        bom.append(HEADER[1:])
        for r in rows:
            bom.append(r[1:])
    return wb


def _row(arc, stage, parent, name, typ="material", qty=1, unit="kg", db="", code="", evo=""):
    return [arc, stage, parent, name, typ, qty, unit, db, code, evo]


def _bytes(wb: Workbook) -> bytes:
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


class _Upload:
    filename = "t.xlsx"

    def __init__(self, data: bytes) -> None:
        self._data = data

    async def read(self) -> bytes:
        return self._data


@pytest.fixture
def temp_project(monkeypatch):
    import gc, shutil, uuid
    import bw2data

    projects = bw2data.projects
    original = projects.current
    tmp = projects._use_temp_directory()
    name = f"pytest-bomrow-{uuid.uuid4().hex[:8]}"
    projects.set_current(name)
    monkeypatch.setattr(bom_api, "_current_project", lambda: name)
    bom_api._archetypes[name] = {}
    bom_api._cohort_mappings[name] = {}
    monkeypatch.setattr(bom_api.dsm_storage, "save_archetype", lambda *a, **k: None)
    monkeypatch.setattr(bom_api.dsm_storage, "delete_archetype_file", lambda *a, **k: None)
    monkeypatch.setattr(bom_api.dsm_storage, "load_folders", lambda *a, **k: [])
    monkeypatch.setattr(bom_api.dsm_storage, "save_folders", lambda *a, **k: None)
    try:
        yield name
    finally:
        bom_api._archetypes.pop(name, None)
        bom_api._cohort_mappings.pop(name, None)
        projects._restore_orig_directory()
        projects.set_current(original, update=False)
        gc.collect()
        shutil.rmtree(tmp, ignore_errors=True)


def _import(wb: Workbook):
    return asyncio.run(bom_api.import_archetype(file=_Upload(_bytes(wb)), mode="merge"))  # type: ignore[arg-type]


# Sheet rows (header is row 1):
#   2 A child, bad Type          4 A root         6 A child, bad Evolution Method
#   3 B child, bad Type          5 B root         7 B child, code that is too short
INTERLEAVED = [
    _row("A", "Manufacturing", "Manufacturing", "Bolt", typ="gadget"),
    _row("B", "Housing", "Housing", "Panel", typ="widget"),
    _row("A", "Manufacturing", "", "Manufacturing", typ="component", unit="piece"),
    _row("B", "Housing", "", "Housing", typ="component", unit="piece"),
    _row("A", "Manufacturing", "Manufacturing", "Nut", evo="wobble"),
    _row("B", "Housing", "Housing", "Screw", db="ecoinvent-3.10-cutoff", code="abc"),
]


# ── the parser's warnings ───────────────────────────────────────────────────

def test_warnings_cite_the_sheet_row_when_roots_sort_ahead_of_children():
    roots, warnings, _ = bom_api._parse_bom_workbook(_wb(INTERLEAVED, multi=False))
    assert roots
    # one archetype's worth of rows, no filter: roots are processed first, children after
    assert "Row 2: unknown Type 'gadget'; defaulted to 'component'." in warnings
    assert "Row 3: unknown Type 'widget'; defaulted to 'component'." in warnings
    assert "Row 6: unknown Evolution Method 'wobble'; ignored." in warnings


def test_two_interleaved_archetypes_each_get_their_own_sheet_rows():
    wb = _wb(INTERLEAVED)
    _, wa, _ = bom_api._parse_bom_workbook(wb, archetype_filter="A")
    _, wb_, _ = bom_api._parse_bom_workbook(wb, archetype_filter="B")
    assert "Row 2: unknown Type 'gadget'; defaulted to 'component'." in wa
    assert "Row 6: unknown Evolution Method 'wobble'; ignored." in wa
    assert not any("widget" in w for w in wa)
    assert "Row 3: unknown Type 'widget'; defaulted to 'component'." in wb_
    assert not any("gadget" in w or "wobble" in w for w in wb_)


def test_the_message_points_at_the_cell_it_describes():
    """Read the cell back from the sheet at the number the message gives."""
    wb = _wb(INTERLEAVED)
    ws = wb["BOM"]
    _, warnings, _ = bom_api._parse_bom_workbook(wb, archetype_filter="A")
    for w in warnings:
        if "unknown Type" in w:
            n = int(w.split(":")[0].removeprefix("Row "))
            assert ws.cell(row=n, column=HEADER.index("Type") + 1).value == "gadget"


# ── the validator's errors and the structured fields ────────────────────────

def test_a_validation_error_carries_the_sheet_row(temp_project):
    res = _import(_wb(INTERLEAVED))
    arcs = {a.name: a for a in bom_api._archetypes[temp_project].values()}
    # stage_scope_defaulted is the advisory about a stage root with no Scope; not under test here
    real = lambda a: [i for i in arcs[a].validation_report.issues if i.error_type != "stage_scope_defaulted"]
    issues = real("B")
    assert [(i.error_type, i.row_idx) for i in issues] == [("code_truncated", 7)]
    assert "Row 7 (B, Housing, Screw)" in issues[0].message
    assert real("A") == []
    assert any("Row 6: unknown Evolution Method" in w for w in res.warnings)


def test_the_biosphere_refusal_names_the_sheet_row(temp_project):
    rows = list(INTERLEAVED)
    rows[5] = _row("B", "Housing", "Housing", "Screw", db="biosphere3", code="x" * 36)   # sheet row 7 (position 4 once roots sort first)
    with pytest.raises(HTTPException) as exc:
        _import(_wb(rows))
    detail = exc.value.detail
    assert exc.value.status_code == 422 and detail["error"] == "bom_biosphere_link"
    assert [(r["sheet"], r["row"], r["archetype"]) for r in detail["rows"]] == [("BOM", 7, "B")]
    assert "BOM sheet, row 7 (B, Housing, Screw)" in detail["rows"][0]["message"]
    assert bom_api._archetypes[temp_project] == {}      # nothing was imported


def test_single_archetype_format_uses_the_sheet_row_too(temp_project):
    rows = [
        _row("", "Manufacturing", "Manufacturing", "Screw", db="ecoinvent-3.10-cutoff", code="abc"),   # sheet row 2
        _row("", "Manufacturing", "", "Manufacturing", typ="component", unit="piece"),                  # sheet row 3
    ]
    res = asyncio.run(bom_api.import_archetype(file=_Upload(_bytes(_wb(rows, multi=False))), mode="merge"))  # type: ignore[arg-type]
    assert res.format == "single"
    arc = next(iter(bom_api._archetypes[temp_project].values()))
    assert [(i.error_type, i.row_idx) for i in arc.validation_report.issues
            if i.error_type != "stage_scope_defaulted"] == [("code_truncated", 2)]


# ── the template, as in #216, and its Instructions sheet ────────────────────

def test_the_template_still_imports_and_every_error_row_is_a_real_sheet_row(temp_project):
    body = asyncio.run(bom_api.download_bom_template()).body
    res = asyncio.run(bom_api.import_archetype(file=_Upload(body), mode="merge"))  # type: ignore[arg-type]
    assert res.created == 3 and res.warnings == []
    issues = [i for a in bom_api._archetypes[temp_project].values() for i in a.validation_report.issues]
    assert len(issues) == 8 and {i.error_type for i in issues} == {"code_truncated"}
    ws = load_workbook(io.BytesIO(body))["BOM"]
    header = [c.value for c in ws[1]]
    code_col = header.index("Ecoinvent Code")
    rows_with_code = {r for r in range(2, ws.max_row + 1) if ws.cell(row=r, column=code_col + 1).value}
    assert {i.row_idx for i in issues} == rows_with_code
    for i in issues:
        assert ws.cell(row=i.row_idx, column=header.index("Name") + 1).value == i.name


def test_the_instructions_sheet_has_a_description_row():
    wb = load_workbook(io.BytesIO(asyncio.run(bom_api.download_bom_template()).body))
    rows = {r[0]: r[1] for r in wb["Instructions"].iter_rows(min_row=2, values_only=True) if r and r[0]}
    assert "Description" in rows
    assert "not used in any calculation" in rows["Description"]
