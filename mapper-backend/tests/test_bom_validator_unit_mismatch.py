# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""A BOM unit that is a different QUANTITY from the activity's reference unit.

Quantities go into the demand vector verbatim -- ``_build_archetype_source_demand``
does ``total_demand[key] += m.quantity * stage_amt`` with no dimensional
check -- so a kg amount against a per-unit activity is charged as that many
units. MAp-test's three charger ``Electronic waste treatment`` rows carried
7, 18.5 and 180 kg against ``market for manual dismantling of used electric
passenger car`` (unit = one vehicle), and nothing raised, warned or logged.

The check must be quiet about SPELLING. A BOM writes ``kg`` where ecoinvent
writes ``kilogram``; MAp-test has 870 such pairs against 3 real errors, so a
verbatim string compare would bury the signal it exists to raise.

WARNING, not error: the ``(db, code)`` pair still resolves, so the row is
computable. Refusing to compute would strand every project carrying one --
the same reasoning that keeps ``name_mismatch`` a warning.
"""
from __future__ import annotations

import sys
import types

import pytest

from mapper.core.bom_validator import (
    BOMValidationRow,
    _canonical_unit,
    validate_bom,
)

DB = "ecoinvent-3.10-cutoff"
CODE = "d" * 32


@pytest.fixture
def bw2_with_units(monkeypatch):
    """bw2data stub whose activities carry a reference unit."""
    fake = types.SimpleNamespace()
    fake.databases = {DB}
    fake.activities = {
        (DB, "a" * 32): {"name": "steel production", "location": "RER", "unit": "kilogram"},
        (DB, "b" * 32): {"name": "electricity, low voltage", "location": "DK",
                         "unit": "kilowatt hour"},
        (DB, CODE): {"name": "market for manual dismantling of used electric "
                             "passenger car", "location": "GLO", "unit": "unit"},
    }

    def _get_activity(key):
        if key in fake.activities:
            spec = fake.activities[key]
            act = types.SimpleNamespace()
            act.get = lambda k, default="": spec.get(k, default)
            return act
        raise KeyError(key)

    fake.get_activity = _get_activity
    monkeypatch.setitem(sys.modules, "bw2data", fake)
    return fake


def _row(unit: str, code: str = CODE, name: str = "Electronic waste treatment"):
    return BOMValidationRow(
        archetype="Public DC Charger", stage="End of Life", row_idx=7,
        name=name, database=DB, code=code, unit=unit,
    )


def _types(report):
    return [i.error_type for i in report.issues]


# ── The real error ───────────────────────────────────────────────────────────


def test_kg_against_a_per_unit_activity_is_reported(bw2_with_units):
    """The shipped bug: 180 kg charged as 180 whole-vehicle dismantlings."""
    report = validate_bom([_row("kg")], project_name="p")
    assert "unit_mismatch" in _types(report)
    issue = next(i for i in report.issues if i.error_type == "unit_mismatch")
    assert issue.severity == "warning"
    assert "kg" in issue.message and "unit" in issue.message


def test_it_does_not_block_compute(bw2_with_units):
    """A warning, so `validation_error_count` stays 0 and compute still runs.

    An error here would strand every project that already carries such a row,
    including the one this check was written for.
    """
    report = validate_bom([_row("kg")], project_name="p")
    assert report.error_rows == 0
    assert report.warning_rows == 1
    assert all(i.severity == "warning" for i in report.issues)


# ── Quiet about spelling ─────────────────────────────────────────────────────


@pytest.mark.parametrize("bom_unit,code", [
    ("kg", "a" * 32), ("kilogram", "a" * 32), ("kilograms", "a" * 32),
    ("kWh", "b" * 32), ("kilowatt hour", "b" * 32), ("kilowatt-hour", "b" * 32),
    ("unit", CODE), ("p", CODE), ("piece", CODE), ("item", CODE),
])
def test_spelling_variants_do_not_fire(bw2_with_units, bom_unit, code):
    report = validate_bom([_row(bom_unit, code=code)], project_name="p")
    assert "unit_mismatch" not in _types(report), bom_unit


def test_the_870_kg_kilogram_pairs_in_MAp_test_stay_silent(bw2_with_units):
    """Sanity at scale: the alias fold is what keeps the signal readable."""
    rows = [_row("kg", code="a" * 32, name=f"row {i}") for i in range(50)]
    report = validate_bom(rows, project_name="p")
    assert "unit_mismatch" not in _types(report)
    assert report.warning_rows == 0


# ── Boundaries ───────────────────────────────────────────────────────────────


def test_an_empty_bom_unit_skips_the_check(bw2_with_units):
    """Back-compat: a caller that does not supply `unit` is unaffected.

    `BOMValidationRow.unit` defaults to "", so every pre-existing construction
    site keeps its exact previous behaviour.
    """
    report = validate_bom([_row("")], project_name="p")
    assert "unit_mismatch" not in _types(report)


def test_an_activity_with_no_reference_unit_skips_the_check(bw2_with_units):
    bw2_with_units.activities[(DB, "e" * 32)] = {
        "name": "x", "location": "GLO", "unit": ""}
    report = validate_bom([_row("kg", code="e" * 32)], project_name="p")
    assert "unit_mismatch" not in _types(report)


def test_an_unknown_unit_is_compared_verbatim_not_silently_accepted(bw2_with_units):
    """Folding to itself is the safe default: an unrecognised unit that really
    does differ still reports, rather than being waved through."""
    assert _canonical_unit("furlong") == "furlong"
    report = validate_bom([_row("furlong", code="a" * 32)], project_name="p")
    assert "unit_mismatch" in _types(report)


def test_canonical_unit_folds_the_documented_families():
    assert _canonical_unit("kg") == _canonical_unit("kilogram")
    assert _canonical_unit("tkm") == _canonical_unit("ton kilometer")
    assert _canonical_unit("m3") == _canonical_unit("cubic meter")
    assert _canonical_unit("kWh") == _canonical_unit("kilowatt hour")
    # and does NOT fold across quantity kinds
    assert _canonical_unit("kg") != _canonical_unit("unit")
    assert _canonical_unit("kg") != _canonical_unit("gram")


def test_a_row_that_errors_earlier_never_reaches_the_unit_check(bw2_with_units):
    """Order is structural -> database -> code -> name/location/unit. A row
    whose code does not resolve has no reference unit to compare against."""
    r = _row("kg", code="f" * 32)
    report = validate_bom([r], project_name="p")
    assert "code_not_found" in _types(report)
    assert "unit_mismatch" not in _types(report)
