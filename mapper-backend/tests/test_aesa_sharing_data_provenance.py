# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Provenance guard for ``sharing_data.json``.

``ssp_trajectories.json`` and ``carbon_budgets.json`` have had one of these
since Patch X1; ``sharing_data.json`` was the only bundled AESA data file
without one, and that is exactly how its AR principle sat a vintage behind
(*Global Carbon Budget 2023*) while the budgets moved to GCB 2024 — and, worse,
how a **scope mismatch** survived: a fossil-only Denmark numerator over a
net-CO2 (fossil + land-use change) world denominator, both rounded to two
significant figures so neither could be recognised.

Two layers, matching the carbon-budget file's:

* the **structural** checks — every principle carries values, a unit and a
  source; anything not flagged provisional names a dataset and a vintage;
* the **published-source invariant** — the AR pair is re-derived here from the
  Global Carbon Budget 2024 territorial series and compared. The structural
  layer alone would not notice both sides being replaced in lockstep from a
  different scope, which is the failure that actually happened.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from mapper.core.aesa_engine import DATA_DIR, build_default_sharing_preset, load_sharing_data

SHARING = json.loads((DATA_DIR / "sharing_data.json").read_text(encoding="utf-8"))
LAYER1 = SHARING["layer1_defaults"]

# ── The published source, transcribed once ──────────────────────────────────
# Global Carbon Budget 2024 (Friedlingstein et al. 2024,
# doi:10.5194/essd-17-965-2025), file National_Carbon_Emissions_2024v1.01.xlsx,
# sheet "Territorial Emissions": the sum of the annual MtC values over
# 1850-2020 inclusive (171 years) for the Denmark column and the World column.
# The World column includes bunker fuels, per note (1) on that sheet.
#
# These are the numbers to re-derive from the workbook if the vintage or the
# window ever moves. They are NOT read from the data file — that is the point.
GCB2024_TERRITORIAL_MTC_1850_2020 = {"Denmark": 1114.0004764144057,
                                     "World": 462120.6396995324}
MTC_TO_MTCO2 = 3.664          # stated in the header of every GCB sheet
MT_TO_T = 1.0e6


def _expected(entity: str) -> float:
    return GCB2024_TERRITORIAL_MTC_1850_2020[entity] * MTC_TO_MTCO2 * MT_TO_T


# ── Structural ──────────────────────────────────────────────────────────────

def test_the_reference_values_are_not_empty():
    """A guard whose ground truth is blank passes against anything."""
    assert len(GCB2024_TERRITORIAL_MTC_1850_2020) == 2
    assert all(v > 0 for v in GCB2024_TERRITORIAL_MTC_1850_2020.values())
    assert len(LAYER1) >= 5


@pytest.mark.parametrize("pid", sorted(LAYER1))
def test_every_principle_carries_values_and_a_source(pid):
    d = LAYER1[pid]
    for field in ("description", "system_value", "global_value", "source"):
        assert d.get(field) not in (None, ""), f"{pid} is missing {field}"
    assert isinstance(d.get("provisional"), bool), f"{pid} must state provisional"


@pytest.mark.parametrize("pid", sorted(LAYER1))
def test_every_share_is_a_fraction_of_the_world(pid):
    """Catches a numerator and denominator swapped, or a unit dropped on one
    side — both of which produce a 'share' above 1."""
    d = LAYER1[pid]
    assert d["global_value"] > 0, f"{pid} has a non-positive global value"
    share = d["system_value"] / d["global_value"]
    assert 0 < share < 1, f"{pid} share {share} is not a fraction"


# LA's value is a geographic constant ("Denmark land area 43,094 km2 / world
# land area 148.94 M km2"), not a measurement from a dated release, so the
# vintage rule below does not apply to it. It IS still under-attributed — no
# dataset is named — but that is a separate gap, recorded here rather than
# waived silently. The exact-equality assertion is what stops the exemption
# quietly growing to cover the next entry someone cannot be bothered to cite.
_VINTAGE_EXEMPT = {"LA"}


def test_the_vintage_exemption_has_not_grown():
    assert _VINTAGE_EXEMPT == {"LA"}, (
        "a principle was exempted from the vintage rule; if it is a dated "
        "measurement it needs a vintage, not an exemption")


@pytest.mark.parametrize("pid", sorted(LAYER1))
def test_a_sourced_entry_names_a_dataset_and_a_vintage(pid):
    """``provisional: false`` is the file's claim that a number is sourced
    rather than estimated. A source with no year cannot be checked against
    anything later, so it does not count as sourced."""
    d = LAYER1[pid]
    if d["provisional"] or pid in _VINTAGE_EXEMPT:
        return
    import re
    assert re.search(r"\b(1[89]|20)\d{2}\b", d["source"]), (
        f"{pid} is flagged non-provisional but its source names no vintage: {d['source']!r}")


def test_the_notice_explains_the_provisional_convention():
    notice = SHARING["_notice"]
    assert "provisional:true" in notice and "provisional:false" in notice, (
        "the notice must say what the flag means, since it is the only "
        "distinction between a sourced value and an estimate")


# ── Published-source invariant: the AR pair ─────────────────────────────────

def test_ar_matches_the_gcb_2024_territorial_series():
    """The check the structural layer cannot make.

    Both sides re-derived from the cited workbook. If someone re-sources AR
    from a different scope, a different window or a different vintage, this
    fails and the `unit` / `source` strings have to move with it.
    """
    ar = LAYER1["AR"]
    assert ar["system_value"] == pytest.approx(_expected("Denmark"), rel=1e-8)
    assert ar["global_value"] == pytest.approx(_expected("World"), rel=1e-8)


def test_ar_is_fossil_only_on_both_sides():
    """The scope that was actually wrong.

    The AR principle allocates ozone depletion, particulate matter and
    photochemical ozone formation — all combustion- and industry-driven, none
    produced by land conversion. Climate change is allocated by EpC, which is
    where a net-CO2 basis would belong. A net-CO2 world denominator for the
    same window is ~2504 GtCO2 against this ~1693 GtCO2, so a silent switch of
    one side moves every AR-allocated SR by tens of percent.
    """
    ar = LAYER1["AR"]
    unit = ar["unit"].lower()
    assert "1850-2020" in unit, "the AR unit must declare its window"
    assert "fossil" in unit and "cement" in unit, "the AR unit must declare its scope"
    assert "land-use change excluded" in unit, (
        "the AR unit must say explicitly that land-use change is out, on BOTH "
        "sides — that is the distinction the previous values got wrong")
    # The world figure must be the fossil-only one, not net CO2.
    assert 1.60e12 < ar["global_value"] < 1.80e12, (
        "the AR world value is outside the GCB 2024 fossil+cement range for "
        "1850-2020; net CO2 including land-use change is ~2.50e12")


def test_ar_prose_agrees_with_the_values_it_describes():
    """The source string quotes the MtC subtotals it was derived from. If the
    numbers move and the prose does not, the citation becomes a fiction."""
    src = LAYER1["AR"]["source"]
    assert "2024" in src and "Global Carbon Budget" in src
    assert "National_Carbon_Emissions_2024v1.01.xlsx" in src
    assert "1850-2020" in src
    for mtc in GCB2024_TERRITORIAL_MTC_1850_2020.values():
        assert f"{mtc:.4f}" in src, (
            f"the source prose does not quote the {mtc:.4f} MtC subtotal it "
            f"was derived from")


def test_ar_is_stored_to_more_than_two_significant_figures():
    """The rounding is part of the defect, not a cosmetic detail.

    At 2 s.f. the fossil-only Denmark figure (4.08e9) and the value that was
    stored (3.5e9) are both '~4e9', and the world figure rounds identically
    whether it is a GCB 2023 or a GCB 2024 read. Precision is what makes the
    next scope error visible.
    """
    for side in ("system_value", "global_value"):
        v = LAYER1["AR"][side]
        two_sf = float(f"{v:.2g}")
        assert v != two_sf, f"AR {side} is stored at 2 s.f. ({v})"


# ── The provenance has to survive into the preset and the export ────────────

def test_the_builtin_preset_carries_the_sources():
    """Provenance that stops at the JSON file is invisible to a user: the
    exported AESACFG workbook is what a reader of a configuration sees."""
    preset = build_default_sharing_preset()
    layer1 = preset.chain.layers[0]
    for pid in LAYER1:
        assert layer1.sources.get(pid), f"layer 1 lost the source for {pid}"
    assert "Global Carbon Budget 2024" in layer1.sources["AR"]


def test_sources_are_display_only_and_never_reach_a_ratio():
    """Nothing in the engine may read `sources`. Mutating every one of them to
    garbage must leave the chain factors byte-identical."""
    from mapper.core.aesa_engine import _DEFAULT_BASE_YEAR

    clean = build_default_sharing_preset()
    dirty = build_default_sharing_preset()
    dirty = dirty.model_copy(update={"chain": dirty.chain.model_copy(update={
        "layers": [ly.model_copy(update={"sources": {k: "GARBAGE" for k in ly.sources}})
                   for ly in dirty.chain.layers]})})
    assert any(ly.sources for ly in dirty.chain.layers), "nothing was mutated"

    assignments = {a.pb_id: a.principle_id for a in clean.category_assignments}
    for pb_id in assignments:
        assert (clean.chain.compute_factor(pb_id, _DEFAULT_BASE_YEAR, assignments)
                == dirty.chain.compute_factor(pb_id, _DEFAULT_BASE_YEAR, assignments)), (
            f"{pb_id}: a source string reached the chain factor")


def test_load_sharing_data_still_parses():
    d = load_sharing_data()
    assert d["layer1_defaults"]["AR"]["system_value"] == LAYER1["AR"]["system_value"]
