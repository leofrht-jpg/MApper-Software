# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""The AESACFG workbook: whole section-(2) configuration round-tripped via xlsx.

The headline guarantee is round-trip identity — export a configuration, import
it back, get the same configuration. That has to hold across all seven groups,
including boundary set, method mapping and carbon budget, which did not
round-trip before.

Also locked here: the object split. ``method_mapping`` and ``carbon_budget``
are config-level; a preset saved from an import must not silently acquire
fields ``SharingPreset`` does not model.
"""
import io

import pytest
from openpyxl import load_workbook

from mapper.api.aesa import (
    ImportRejected,
    _build_sharing_workbook,
    _parse_aesa_config_workbook,
)
from mapper.core.aesa_engine import build_carbon_budget, build_default_sharing_preset
from mapper.models.aesa_schemas import AESAConfigBundle, MethodPBMapping


def _bundle() -> AESAConfigBundle:
    preset = build_default_sharing_preset()
    return AESAConfigBundle(
        boundary_set_id=preset.boundary_set_id,
        sharing_preset_id="preset-abc",
        sharing=preset,
        method_mapping=[
            MethodPBMapping(
                method_tuple=["EF v3.1", "climate change, GWP100", "global warming"],
                pb_id="climate_change",
                conversion_factor=1.0,
            ),
            MethodPBMapping(
                method_tuple=["EF v3.1", "land use"],
                pb_id="land_system_change",
                conversion_factor=2.5,
            ),
        ],
        carbon_budget=build_carbon_budget(),
    )


def _roundtrip(bundle: AESAConfigBundle) -> AESAConfigBundle:
    wb = _build_sharing_workbook(bundle.sharing, include_instructions=True, bundle=bundle)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return _parse_aesa_config_workbook(load_workbook(buf, data_only=True), "roundtrip")


# ── The acceptance criterion ────────────────────────────────────────────────


def test_roundtrip_identity():
    """export -> import -> identical, across all seven groups."""
    original = _bundle()
    back = _roundtrip(original)

    assert back.boundary_set_id == original.boundary_set_id
    assert back.sharing_preset_id == original.sharing_preset_id
    assert back.sharing.name == original.sharing.name
    assert back.sharing.description == original.sharing.description

    assert [p.model_dump() for p in back.sharing.principles] == \
           [p.model_dump() for p in original.sharing.principles]
    assert [a.model_dump() for a in back.sharing.category_assignments] == \
           [a.model_dump() for a in original.sharing.category_assignments]
    assert back.sharing.chain.model_dump() == original.sharing.chain.model_dump()

    assert [m.model_dump() for m in back.method_mapping] == \
           [m.model_dump() for m in original.method_mapping]

    assert (back.carbon_budget is None) == (original.carbon_budget is None)
    if original.carbon_budget is not None:
        o = original.carbon_budget.model_dump()
        n = back.carbon_budget.model_dump()
        # Floats compare with a tolerance, and only floats. xlsx stores numbers
        # as ~15-significant-digit decimal text, so a float64 carrying binary
        # noise (3.5999999999999996) comes back as the value it was always
        # meant to be (3.6). No transport through Excel can preserve full
        # float64; the workbook is canonical, which is what
        # test_roundtrip_survives_a_second_pass pins exactly.
        assert n["projected_emissions"] == pytest.approx(o["projected_emissions"], rel=1e-12)
        if o["co2e_conversion"] is None:
            assert n["co2e_conversion"] is None
        else:
            assert n["co2e_conversion"]["factor"] == pytest.approx(
                o["co2e_conversion"]["factor"], rel=1e-12)
            assert n["co2e_conversion"]["kind"] == o["co2e_conversion"]["kind"]
            assert n["co2e_conversion"]["source"] == o["co2e_conversion"]["source"]
        for k in o:
            if k not in ("projected_emissions", "co2e_conversion"):
                assert n[k] == o[k], k


def test_roundtrip_survives_a_second_pass():
    # A serialiser that is not idempotent will drift on the second export.
    once = _roundtrip(_bundle())
    twice = _roundtrip(once)
    assert twice.model_dump() == once.model_dump()


def test_method_tuple_with_commas_survives():
    # Joined on " | " precisely because method names contain commas.
    b = _bundle()
    back = _roundtrip(b)
    assert back.method_mapping[0].method_tuple == [
        "EF v3.1", "climate change, GWP100", "global warming",
    ]


def test_roundtrip_with_no_carbon_budget():
    b = _bundle().model_copy(update={"carbon_budget": None})
    assert _roundtrip(b).carbon_budget is None


# ── Template + Reference ────────────────────────────────────────────────────


def test_template_has_every_sheet_and_field():
    b = _bundle()
    wb = _build_sharing_workbook(b.sharing, include_instructions=True, bundle=b)
    for sheet in ("Configuration", "Principles", "Category Assignments",
                  "Downscaling Chain", "Sharing Data", "Method Mapping",
                  "Carbon Budget", "Reference", "Instructions"):
        assert sheet in wb.sheetnames, sheet

    cfg = {r[0] for r in wb["Configuration"].iter_rows(values_only=True) if r[0]}
    assert {"boundary_set_id", "sharing_preset_id", "preset_name"} <= cfg

    budget = {r[0] for r in wb["Carbon Budget"].iter_rows(values_only=True) if r[0]}
    for f in ("initial_budget_gt", "budget_source", "start_year", "end_year",
              "ssp_scenario", "budget_basis", "provisional"):
        assert f in budget, f


def test_reference_sheet_is_populated_from_live_data_and_locked():
    from mapper.core.aesa_engine import load_boundary_sets, load_ssp_trajectories

    b = _bundle()
    wb = _build_sharing_workbook(b.sharing, include_instructions=True, bundle=b)
    ref = wb["Reference"]
    assert ref.protection.sheet is True, "Reference sheet must be locked"

    rows = [r for r in ref.iter_rows(values_only=True) if r[0]]
    by_field: dict[str, set] = {}
    for field, value, *_ in rows:
        by_field.setdefault(str(field), set()).add(str(value))

    # Live, not hardcoded: every boundary set the engine knows must appear.
    assert set(load_boundary_sets()) <= by_field["boundary_set_id"]
    assert {s["id"] for s in load_ssp_trajectories()} <= by_field["ssp_scenario"]
    assert by_field["budget_basis"] == {"CO2", "CO2e_GHG"}
    assert by_field["principle_mode"] == {"category_specific", "fixed"}


# ── Import rejects, and applies nothing ─────────────────────────────────────


def _wb_with_config_override(**overrides):
    b = _bundle()
    wb = _build_sharing_workbook(b.sharing, include_instructions=True, bundle=b)
    ws = wb["Configuration"]
    for row in ws.iter_rows(min_row=2):
        key = row[0].value
        if key in overrides:
            row[1].value = overrides[key]
    return wb


def test_import_rejects_unknown_boundary_set():
    wb = _wb_with_config_override(boundary_set_id="NotARealSet_2099")
    with pytest.raises(ImportRejected) as ei:
        _parse_aesa_config_workbook(wb, "x")
    errs = ei.value.errors
    assert any(e["field"] == "boundary_set_id" for e in errs)
    assert any("NotARealSet_2099" in e["error"] for e in errs)


def test_import_rejects_unknown_principle_in_assignments():
    b = _bundle()
    wb = _build_sharing_workbook(b.sharing, include_instructions=True, bundle=b)
    wb["Category Assignments"].cell(row=2, column=2, value="NOPE")
    with pytest.raises(ImportRejected):
        _parse_aesa_config_workbook(wb, "x")


def test_import_rejects_invalid_budget_basis():
    b = _bundle()
    wb = _build_sharing_workbook(b.sharing, include_instructions=True, bundle=b)
    for row in wb["Carbon Budget"].iter_rows(min_row=2):
        if row[0].value == "budget_basis":
            row[1].value = "CH4_ONLY"
    with pytest.raises(ImportRejected) as ei:
        _parse_aesa_config_workbook(wb, "x")
    assert any("budget_basis" in e["field"] for e in ei.value.errors)


def test_rejection_reports_every_failure_not_just_the_first():
    wb = _wb_with_config_override(boundary_set_id="bogus")
    for row in wb["Carbon Budget"].iter_rows(min_row=2):
        if row[0].value == "budget_basis":
            row[1].value = "bogus_basis"
    with pytest.raises(ImportRejected) as ei:
        _parse_aesa_config_workbook(wb, "x")
    fields = {e["field"] for e in ei.value.errors}
    assert "boundary_set_id" in fields
    assert any("budget_basis" in f for f in fields)


def test_rejected_import_returns_a_bundle_for_nothing():
    # Nothing partially built escapes: the parser raises rather than returning.
    wb = _wb_with_config_override(boundary_set_id="bogus")
    with pytest.raises(ImportRejected):
        _parse_aesa_config_workbook(wb, "x")


# ── Object split: config-level fields must not leak onto a preset ───────────


def test_preset_from_bundle_does_not_carry_method_mapping():
    b = _bundle()
    preset = b.to_preset("Saved from import")
    assert not hasattr(preset, "method_mapping")
    assert "method_mapping" not in preset.model_dump()


def test_preset_from_bundle_keeps_the_patch2a_seeding_defaults():
    # boundary_set_id / carbon_budget DO belong on a preset — as creation-time
    # defaults — so they should be carried over.
    b = _bundle()
    preset = b.to_preset("Saved from import")
    assert preset.boundary_set_id == b.boundary_set_id
    assert preset.carbon_budget == b.carbon_budget
    assert preset.built_in is False
    assert preset.name == "Saved from import"


def test_instructions_document_the_12dp_rounding():
    """A reader must not mistake a cell for the exact in-memory float.

    The workbook is canonical and the engine is left untouched, so the loss of
    precision happens on write — that has to be stated where someone reading
    the file will see it, not only in the commit history.
    """
    b = _bundle()
    wb = _build_sharing_workbook(b.sharing, include_instructions=True, bundle=b)
    text = "\n".join(
        str(r[0]) for r in wb["Instructions"].iter_rows(values_only=True) if r and r[0]
    )
    assert "12 decimal places" in text
    assert "NOT necessarily the exact in-memory figure" in text
    # and the sheets added by this feature are described
    for sheet in ("Configuration", "Method Mapping", "Carbon Budget", "Reference"):
        assert f"Sheet: {sheet}" in text, sheet


# ── The demo project must not break the round trip ──────────────────────────


def test_demo_stamped_export_still_imports():
    """A config exported from a demo project must be re-importable.

    excel_response() stamps a warning row at the top of every sheet on a demo
    project. That row landed above the header row, so the importer rejected the
    very file MApper had just exported — and the demo project is exactly what a
    reviewer uses. Config exports are now marked round-trippable (prefix only),
    and the parser additionally tolerates a stamped row so files exported
    before that fix still load.
    """
    from mapper.api.cohort_export import stamp_demo_warning

    b = _bundle()
    wb = _build_sharing_workbook(b.sharing, include_instructions=True, bundle=b)
    stamp_demo_warning(wb)          # simulate the pre-fix demo export

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    back = _parse_aesa_config_workbook(load_workbook(buf, data_only=True), "demo")

    assert back.boundary_set_id == b.boundary_set_id
    assert [m.model_dump() for m in back.method_mapping] == \
           [m.model_dump() for m in b.method_mapping]
    assert back.carbon_budget is not None


def test_config_export_endpoint_is_marked_round_trippable():
    """Structural: the export must not be stamped, or the file cannot re-import."""
    import inspect

    from mapper.api import aesa

    src = inspect.getsource(aesa.post_config_export)
    assert "template=True" in src, (
        "config export must pass template=True so excel_response does not stamp "
        "a warning row above the header row"
    )
