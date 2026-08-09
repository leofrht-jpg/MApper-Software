# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati
"""Boundary naming lives on the boundary record, and nowhere else.

The frontend labels AESA charts from ``SustainabilityRatioResult.pb_short_name``,
which the engine stamps from the ``PlanetaryBoundary``. That makes the shipped
data the single source of truth for how a category is named on screen and in
exports. These tests hold that line from the backend side:

* the fields exist and survive a round-trip;
* the engine stamps every SR row;
* the shipped Sala set carries a conventional acronym for every boundary;
* no Python module carries its own name-to-acronym table.

The acronyms themselves are CML/ILCD convention, NOT EF. Zampori & Pant (2019),
*Suggestions for updating the Product Environmental Footprint (PEF) method*,
EUR 29682 EN, Table 2, defines EF v3.1's category names, indicators and units
and gives no per-category abbreviations. They are carried for the glossary's
"commonly written" cross-reference only — never as a label.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from mapper.core.aesa_engine import load_boundary_sets
from mapper.models.aesa_schemas import PlanetaryBoundary, SustainabilityRatioResult

BOUNDARY_FILE = (
    Path(__file__).resolve().parents[1] / "mapper" / "data" / "aesa" / "boundary_sets.json"
)
BACKEND_PKG = Path(__file__).resolve().parents[1] / "mapper"


@pytest.fixture(scope="module")
def sets():
    return load_boundary_sets()


@pytest.fixture(scope="module")
def sala(sets):
    return sets["Sala2020_EF"]


# ── the fields ──────────────────────────────────────────────────────────────


def test_planetary_boundary_carries_naming_fields():
    pb = PlanetaryBoundary(
        id="x", name="Climate change", control_variable="cv", unit="kg CO2 eq",
        boundary_type="cumulative", conventional_acronym="GWP100",
    )
    assert pb.short_name is None       # optional: `name` is already EF's short form
    assert pb.conventional_acronym == "GWP100"


def test_naming_fields_are_optional_for_older_saved_data():
    # A boundary persisted before the fields existed must still load.
    pb = PlanetaryBoundary(
        id="x", name="n", control_variable="cv", unit="u", boundary_type="flow",
    )
    assert pb.short_name is None
    assert pb.conventional_acronym is None


def test_sr_row_defaults_pb_short_name_for_older_sessions():
    # Sessions saved before the field existed deserialise with "", and the
    # frontend falls back to pb_name — a blank axis would be the regression.
    row = SustainabilityRatioResult(
        year=2035, pb_id="climate_change", pb_name="Climate change",
        ef_indicator="climate change", boundary_type="cumulative",
        impact=1.0, allocated_sos=1.0, sr=1.0, zone="safe",
    )
    assert row.pb_short_name == ""


# ── the shipped data ────────────────────────────────────────────────────────


def test_every_sala_boundary_has_a_conventional_acronym(sala):
    missing = [b.id for b in sala.boundaries.values() if not b.conventional_acronym]
    assert missing == [], f"no conventional_acronym for: {missing}"


def test_sala_acronyms_are_distinct(sala):
    acr = [b.conventional_acronym for b in sala.boundaries.values()]
    assert len(set(acr)) == len(acr), f"duplicate acronyms in {acr}"


def test_sala_boundary_names_are_the_ef_category_names(sala):
    # The label IS this string, so a typo here is a typo on every chart and in
    # every export. Pinned against EF v3.1 (Zampori & Pant 2019, Table 2).
    expected = {
        "climate_change": "Climate change",
        "ozone_depletion": "Ozone depletion",
        "human_toxicity_cancer": "Human toxicity, cancer",
        "human_toxicity_non_cancer": "Human toxicity, non-cancer",
        "particulate_matter": "Particulate matter",
        "ionising_radiation": "Ionising radiation",
        "photochemical_ozone_formation": "Photochemical ozone formation",
        "acidification": "Acidification",
        "eutrophication_terrestrial": "Eutrophication, terrestrial",
        "eutrophication_freshwater": "Eutrophication, freshwater",
        "eutrophication_marine": "Eutrophication, marine",
        "ecotoxicity_freshwater": "Ecotoxicity, freshwater",
        "land_use": "Land use",
        "water_use": "Water use",
        "resource_use_fossils": "Resource use, fossils",
        "resource_use_minerals_metals": "Resource use, minerals and metals",
    }
    actual = {b.id: b.name for b in sala.boundaries.values()}
    assert actual == expected


def test_short_name_is_absent_where_the_name_is_already_short(sala):
    # Deliberate: `name` is EF's own short category name, so a `short_name`
    # duplicating it would be two strings that can drift. The field exists for
    # a future set whose names are genuinely long.
    assert all(b.short_name is None for b in sala.boundaries.values())


def test_scaffold_set_needs_no_acronyms(sets):
    # Ryberg is structure-only and not EF-linked, so it has no EF category to
    # abbreviate. Its boundaries must load with the fields absent.
    ryberg = sets["Ryberg2018_PBLCIA"]
    assert ryberg.computable is False
    assert all(b.conventional_acronym is None for b in ryberg.boundaries.values())


# ── the engine stamps it ────────────────────────────────────────────────────


def test_engine_stamps_pb_short_name_from_the_boundary(sala):
    from mapper.core import aesa_engine

    src = Path(aesa_engine.__file__).read_text(encoding="utf-8")
    # The stamp must fall back to `name`, so a set without short_name still
    # labels its charts rather than emitting "".
    assert "pb_short_name=pb.short_name or pb.name" in src


# ── no second copy ──────────────────────────────────────────────────────────


def test_no_python_module_hardcodes_a_category_acronym(sala, sets):
    """Acronyms belong to the data file; a literal in code is a second copy."""
    acronyms = {
        b.conventional_acronym
        for s in sets.values()
        for b in s.boundaries.values()
        if b.conventional_acronym
    }
    assert len(acronyms) >= 16, "empty sweep — the acronyms did not load"

    offenders: list[str] = []
    for path in BACKEND_PKG.rglob("*.py"):
        text = path.read_text(encoding="utf-8", errors="ignore")
        for acr in acronyms:
            if re.search(rf"""(['"]){re.escape(acr)}\1""", text):
                offenders.append(f"{path.relative_to(BACKEND_PKG)}: {acr}")
    assert offenders == [], (
        "hardcode an impact-category acronym. Acronyms live on the boundary "
        f"record in boundary_sets.json and reach consumers from there: {offenders}"
    )


def test_no_python_module_maps_category_names_to_short_forms(sala):
    names = [b.name for b in sala.boundaries.values()]
    offenders: list[str] = []
    for path in BACKEND_PKG.rglob("*.py"):
        text = path.read_text(encoding="utf-8", errors="ignore")
        for name in names:
            # A dict literal keyed on a category name is the shortPbName shape.
            if re.search(rf"""(['"]){re.escape(name)}\1\s*:""", text):
                offenders.append(f"{path.relative_to(BACKEND_PKG)}: {name}")
    assert offenders == [], f"build a lookup keyed on category names: {offenders}"


def test_the_data_file_is_the_only_place_the_acronyms_appear(sala):
    # Belt and braces on the sweep above: prove they ARE in the data file, so a
    # green result cannot mean "the acronyms vanished everywhere".
    raw = BOUNDARY_FILE.read_text(encoding="utf-8")
    payload = json.loads(raw)
    assert "conventional_acronym" in raw
    sala_raw = next(s for s in payload["sets"] if s["id"] == "Sala2020_EF")
    bounds = sala_raw["boundaries"]
    listed = bounds if isinstance(bounds, list) else list(bounds.values())
    assert all(b.get("conventional_acronym") for b in listed)
