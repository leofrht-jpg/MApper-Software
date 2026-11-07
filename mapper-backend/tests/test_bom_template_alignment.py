# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""The downloadable BOM template: every example value sits under its own header.

When ``Basis`` was added to ``_BOM_COLUMNS`` the example rows were positional
tuples and were not updated, so from column 4 on every value sat one column LEFT
of its header (``Manufacturing`` under Parent, ``component`` under Name, ``1``
under Type). The importer reads by header NAME, so the file still imported --
into 3 archetypes with ~70 structural warnings and no linked material.

The rows are now dicts keyed by column name, written by header index. Synthetic
data only: the ``EXAMPLE_CODE_*`` links point at nothing, on purpose.
"""
from __future__ import annotations

import asyncio
import io

import pytest
from openpyxl import load_workbook

from mapper.api import bom as bom_api
from mapper.api.bom import _BOM_COLUMNS, _MULTI_BOM_COLUMNS


def _template() -> "load_workbook":
    resp = asyncio.run(bom_api.download_bom_template())
    return load_workbook(io.BytesIO(resp.body))


def _bom_rows(wb) -> list[dict]:
    ws = wb["BOM"]
    header = [c.value for c in ws[1]]
    return [dict(zip(header, r)) for r in ws.iter_rows(min_row=2, values_only=True)]


def _find(rows: list[dict], arc: str, stage: str, name: str) -> dict:
    hits = [r for r in rows if (r["archetype_name"], r["Stage"], r["Name"]) == (arc, stage, name)]
    assert len(hits) == 1, (arc, stage, name, len(hits))
    return hits[0]


# ── 1. the header ───────────────────────────────────────────────────────────

def test_the_template_header_is_the_column_definition():
    ws = _template()["BOM"]
    header = [c.value for c in ws[1]]
    assert header == _MULTI_BOM_COLUMNS == ["archetype_name", *_BOM_COLUMNS]
    assert len(header) == 27 and header.index("Basis") == 3
    # every example row is exactly as wide as the header
    assert {len(r) for r in ws.iter_rows(min_row=2, values_only=True)} == {len(header)}


# ── 2. every value under its own header ─────────────────────────────────────

def test_a_stage_root_row_has_its_values_under_the_right_headers():
    rows = _bom_rows(_template())
    r = _find(rows, "Product_A", "Manufacturing", "Manufacturing")
    assert r["Stage"] == "Manufacturing" and r["Scope"] == "inflows" and r["Basis"] == "per unit"
    assert r["Parent"] in ("", None)
    assert r["Type"] == "component" and r["Quantity"] == 1 and r["Unit"] == "piece"
    assert all(r[c] in ("", None) for c in _BOM_COLUMNS[_BOM_COLUMNS.index("Ecoinvent Database"):])


def test_a_linked_material_row_has_its_values_under_the_right_headers():
    rows = _bom_rows(_template())
    r = _find(rows, "Product_A", "Manufacturing", "Aluminium")
    assert (r["Scope"], r["Basis"]) == (None, None) or (r["Scope"] in ("", None) and r["Basis"] in ("", None))
    assert r["Parent"] == "Manufacturing" and r["Type"] == "material"
    assert (r["Quantity"], r["Unit"]) == (120, "kg")
    assert r["Ecoinvent Database"] == "ecoinvent-3.9.1-cutoff"
    assert r["Ecoinvent Code"] == "EXAMPLE_CODE_ALU"
    assert r["Ecoinvent Name"] == "aluminium production" and r["Ecoinvent Location"] == "GLO"
    assert r["Evolution Method"] == "learning_rate"
    assert r["Learning Rate"] == -0.02 and r["Base Year"] == 2025
    assert r["Description"] in ("", None)


def test_each_evolution_method_lands_under_its_own_columns():
    rows = _bom_rows(_template())
    ms = _find(rows, "Product_A", "Key Component", "Functional material")
    assert ms["Evolution Method"] == "milestones"
    assert (ms["Milestone Years"], ms["Milestone Values"]) == ("2025;2035;2050", "300;230;180")
    assert ms["Learning Rate"] in ("", None) and ms["Rebound Rate"] in ("", None)
    rb = _find(rows, "Product_A", "Use Phase", "Energy consumption")
    assert rb["Evolution Method"] == "rebound_effect"
    assert (rb["Rebound Rate"], rb["Base Year"], rb["Rebound Applies To Stages"]) == (0.015, 2025, "Use Phase")
    assert rb["Learning Rate"] in ("", None)
    assert rb["Unit"] == "kWh" and rb["Ecoinvent Location"] == "EU"


def test_basis_is_set_on_stage_roots_only_and_is_per_unit_or_per_year():
    rows = _bom_rows(_template())
    roots = [r for r in rows if r["Parent"] in ("", None)]
    children = [r for r in rows if r["Parent"] not in ("", None)]
    assert roots and children
    assert all(r["Basis"] in ("per unit", "per year") for r in roots)
    assert all(r["Basis"] in ("", None) and r["Scope"] in ("", None) for r in children)
    # per-year only where a stage consumes per year
    assert {(r["archetype_name"], r["Stage"]) for r in roots if r["Basis"] == "per year"} == {
        ("Product_A", "Use Phase"), ("Product_B", "Use Phase"), ("Product_B", "Maintenance"),
    }


def test_no_cell_sits_under_a_header_of_another_kind():
    """The shift put text under Type/Quantity and numbers under Unit. Assert the kinds."""
    for r in _bom_rows(_template()):
        assert r["Type"] in ("component", "material")
        assert isinstance(r["Quantity"], (int, float))
        assert isinstance(r["Unit"], str) and r["Unit"] in ("piece", "kg", "kWh")
        assert r["Stage"] and r["Name"] and r["archetype_name"]
        if r["Ecoinvent Code"]:
            assert r["Ecoinvent Database"].startswith("ecoinvent-")
            assert r["Ecoinvent Code"].startswith("EXAMPLE_CODE_")


def test_a_header_change_cannot_shift_the_rows(monkeypatch):
    """Insert a column in the MIDDLE of the definition: the rows follow it."""
    cols = list(_MULTI_BOM_COLUMNS)
    cols.insert(cols.index("Scope"), "Inserted Column")
    monkeypatch.setattr(bom_api, "_MULTI_BOM_COLUMNS", cols)
    rows = _bom_rows(_template())
    r = _find(rows, "Product_A", "Manufacturing", "Steel")
    assert r["Inserted Column"] in ("", None)
    assert (r["Parent"], r["Type"], r["Quantity"], r["Unit"]) == ("Manufacturing", "material", 900, "kg")
    assert r["Ecoinvent Code"] == "EXAMPLE_CODE_STEEL"
    root = _find(rows, "Product_A", "Use Phase", "Use Phase")
    assert (root["Scope"], root["Basis"]) == ("stock", "per year")


def test_an_example_naming_a_column_that_does_not_exist_fails_loudly():
    with pytest.raises(KeyError, match="Bsis"):
        bom_api._template_bom_row({"archetype_name": "A", "Bsis": "per unit"})


# ── 3. the template through the real import path ────────────────────────────

@pytest.fixture
def temp_project(monkeypatch):
    """An isolated bw2 project plus in-memory BOM stores; nothing touches disk."""
    import gc, shutil, uuid
    import bw2data

    projects = bw2data.projects
    original = projects.current
    tmp = projects._use_temp_directory()
    name = f"pytest-bomtpl-{uuid.uuid4().hex[:8]}"
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


class _Upload:
    filename = "mapper_archetypes_template.xlsx"

    def __init__(self, data: bytes) -> None:
        self._data = data

    async def read(self) -> bytes:
        return self._data


def _import_template(project: str):
    body = asyncio.run(bom_api.download_bom_template()).body
    res = asyncio.run(bom_api.import_archetype(file=_Upload(body), mode="merge"))  # type: ignore[arg-type]
    return res, {a.name: a for a in bom_api._archetypes[project].values()}


def test_the_template_imports_with_no_structural_warning(temp_project):
    res, arcs = _import_template(temp_project)
    assert (res.format, res.created, res.updated) == ("multi", 3, 0)
    assert res.warnings == [], res.warnings
    assert set(arcs) == {"Product_A", "Product_B", "Asset_C"}


def test_the_imported_structure_matches_the_example(temp_project):
    _, arcs = _import_template(temp_project)
    a = arcs["Product_A"]
    assert [(s.name, s.scope, s.basis) for s in a.bom] == [
        ("Manufacturing", "inflows", "per_unit"),
        ("Key Component", "inflows", "per_unit"),
        ("Use Phase", "stock", "per_year"),
        ("End of Life", "outflows", "per_unit"),
    ]
    mfg = a.bom[0]
    steel, alu = mfg.children
    assert (steel.name, steel.node_type, steel.quantity, steel.unit) == ("Steel", "material", 900.0, "kg")
    assert (alu.node_type, alu.quantity) == ("material", 120.0)
    assert alu.ecoinvent_activity.code == "EXAMPLE_CODE_ALU"
    assert alu.evolution.method == "learning_rate" and alu.evolution.learning_rate == -0.02
    use = a.bom[2].children[0]
    assert use.evolution.method == "rebound_effect" and use.evolution.rebound_rate == 0.015
    assert use.evolution.applies_to_stages == ["Use Phase"]
    assert [(s.name, s.basis) for s in arcs["Product_B"].bom] == [
        ("Manufacturing", "per_unit"), ("Use Phase", "per_year"),
        ("Maintenance", "per_year"), ("End of Life", "per_unit"),
    ]
    assert all(s.basis == "per_unit" for s in arcs["Asset_C"].bom)


def test_the_only_import_errors_are_the_missing_example_codes(temp_project):
    """The EXAMPLE_CODE_* links point at nothing -- that is the template's point.
    What the importer says about them is one `code_truncated` per linked row
    (the 18-character placeholder is not a 32-character code), and nothing else."""
    _, arcs = _import_template(temp_project)
    issues = [i for a in arcs.values() for i in a.validation_report.issues]
    assert issues, "the placeholder codes were expected to be reported"
    assert {i.error_type for i in issues} == {"code_truncated"}
    assert all("EXAMPLE_CODE_" in i.message for i in issues)
    assert len(issues) == 8                      # 4 + 2 + 2 linked material rows
    assert sum(a.validation_report.error_rows for a in arcs.values()) == 8
    assert sum(a.validation_report.warning_rows for a in arcs.values()) == 0


# ── 4. the Instructions and Scaling Reference sheets ────────────────────────

def test_the_instructions_sheet_documents_the_columns_the_rows_use():
    wb = _template()
    keys = [r[0] for r in wb["Instructions"].iter_rows(min_row=2, values_only=True) if r and r[0]]
    for expected in ("Stage", "Basis", "Scope", "Parent", "Name", "Type", "Quantity / Unit",
                     "Evolution Method", "Learning Rate / Base Year", "Rebound Rate / Base Year",
                     "Rebound Applies To Stages", "Milestone Years / Values"):
        assert expected in keys, expected
    basis = next(r[1] for r in wb["Instructions"].iter_rows(min_row=2, values_only=True) if r[0] == "Basis")
    assert "'per unit'" in basis and "'per year'" in basis and "stage root row" in basis
    # what the Instructions say is what the example rows do
    assert wb["BOM"].max_row > 1


def test_the_scaling_reference_cohorts_name_an_archetype_in_the_file():
    wb = _template()
    archetypes = {r[0] for r in wb["Archetypes"].iter_rows(min_row=2, values_only=True) if r[0]}
    cohorts = [r for r in wb["Scaling Reference"].iter_rows(min_row=2, values_only=True)
               if r[0] and "|" in str(r[0]) and r[1]]
    assert cohorts
    for key, arc, factor, _notes in cohorts:
        assert arc in archetypes
        assert key.startswith(f"{arc}|")
        assert isinstance(factor, (int, float))
