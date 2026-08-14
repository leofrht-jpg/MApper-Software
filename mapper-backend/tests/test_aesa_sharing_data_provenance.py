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
without one, and that is how its AR principle drifted twice over: it sat a
vintage behind (*Global Carbon Budget 2023*) while the budgets moved to GCB
2024, and — the larger error — it held a CUMULATIVE 1850-2020 CO2 total in a
file where every other principle is a single-year snapshot.

The structural checks here are basis-independent: every principle names a
source, every share is a fraction of the world, and anything claiming to be
sourced carries a vintage that can be checked later. They would have caught the
missing attribution regardless of which quantity AR turned out to be.

The published-source invariant is deliberately narrower than the one drafted
against the GCB figures. It pins the two Climate TRACE totals and the metric,
because a value re-sourced from a different dataset, year or metric must break
a test rather than land silently.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from mapper.core.aesa_engine import DATA_DIR, build_default_sharing_preset, load_sharing_data

SHARING = json.loads((DATA_DIR / "sharing_data.json").read_text(encoding="utf-8"))
LAYER1 = SHARING["layer1_defaults"]

# ── The published source, transcribed once ─────────────────────────────────
# Climate TRACE Country Inventory, data year 2022: Denmark's total across all
# sectors, and the world total, both on a 100-year GWP CO2e basis.
#
# These are NOT read from the data file — that is the point. A re-sourcing from
# a different dataset, a different year or a different metric has to break a
# test rather than land silently, which is how the previous value survived.
CLIMATE_TRACE_2022_T_CO2E = {"Denmark": 59.3e6, "World": 60.57e9}
DATA_YEAR = "2022"
METRIC = "CO2e-100yr"


# ── Structural ──────────────────────────────────────────────────────────────

def test_the_reference_values_are_not_empty():
    """A guard whose ground truth is blank passes against anything."""
    assert len(CLIMATE_TRACE_2022_T_CO2E) == 2
    assert all(v > 0 for v in CLIMATE_TRACE_2022_T_CO2E.values())
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


# ── Published-source invariant: the AR pair ────────────────────────────────

def test_ar_matches_the_climate_trace_2022_totals():
    """The check the structural layer cannot make.

    Both sides pinned to the cited dataset and year. If AR is re-sourced from a
    different inventory, a different data year or a different metric, this
    fails and the `unit` / `source` strings have to move with it.
    """
    ar = LAYER1["AR"]
    assert ar["system_value"] == pytest.approx(CLIMATE_TRACE_2022_T_CO2E["Denmark"], rel=1e-12)
    assert ar["global_value"] == pytest.approx(CLIMATE_TRACE_2022_T_CO2E["World"], rel=1e-12)


def test_ar_is_a_single_year_share_like_every_other_principle():
    """The distinction that was actually wrong.

    AR used to hold a cumulative 1850-2020 CO2 total in a file where EpC, IN,
    AGR and LA are all current-state snapshots keyed at ``year_base``. The two
    bases are not interchangeable: on the same dataset a cumulative share and a
    single-year share differ by a factor of roughly three for an
    early-industrialised entity, and that factor divides straight into every
    AR-allocated Sustainability Ratio.
    """
    unit = LAYER1["AR"]["unit"].lower()
    assert "cumulative" not in unit, (
        "AR is a single-year emissions share; a cumulative window is the "
        "basis error this guard exists to prevent recurring")
    assert not re.search(r"1[89]\d{2}\s*[-\u2013]\s*\d{4}", unit), (
        "AR's unit still declares a historical window")
    assert DATA_YEAR in unit and METRIC.lower() in unit, (
        "AR's unit must state its data year and its metric")


def test_every_layer1_principle_is_a_single_year_snapshot():
    """The property that makes the five comparable at all.

    Each is a value AT a point in time, divided by the world's value at the
    same point. One principle silently integrating over 171 years while the
    others sample one is not a methodological variant; it is a units error that
    happens to typecheck.
    """
    for pid, d in LAYER1.items():
        unit = str(d.get("unit", "")).lower()
        assert "cumulative" not in unit, f"{pid} declares a cumulative basis"


def test_ar_prose_agrees_with_the_values_it_describes():
    """The source string quotes the totals it was derived from. If the numbers
    move and the prose does not, the citation becomes a fiction."""
    src = LAYER1["AR"]["source"]
    assert "Climate TRACE" in src
    assert DATA_YEAR in src
    assert METRIC in src
    assert "59.3" in src and "60.57" in src, (
        "the source prose does not quote the totals it was derived from")


def test_ar_is_stored_to_more_than_two_significant_figures():
    """The rounding is part of the defect history, not a cosmetic detail.

    At 2 s.f. the previous pair was unrecognisable as a scope mismatch.
    Precision is what makes the next basis error visible.
    """
    for side in ("system_value", "global_value"):
        v = LAYER1["AR"][side]
        assert v != float(f"{v:.2g}"), f"AR {side} is stored at 2 s.f. ({v})"


def test_the_builtin_preset_keys_ar_at_the_base_year():
    """AR is keyed at ``year_base`` like the other four, even though its data
    year is 2022. The data year lives in the source string, not the key."""
    from mapper.core.aesa_engine import _DEFAULT_BASE_YEAR

    layer1 = build_default_sharing_preset().chain.layers[0]
    assert set(layer1.data["AR"]) == {_DEFAULT_BASE_YEAR}
    assert SHARING["year_base"] == _DEFAULT_BASE_YEAR


# ── The provenance has to survive into the preset and the export ────────────

def test_the_builtin_preset_carries_the_sources():
    """Provenance that stops at the JSON file is invisible to a user: the
    exported AESACFG workbook is what a reader of a configuration sees."""
    preset = build_default_sharing_preset()
    layer1 = preset.chain.layers[0]
    for pid in LAYER1:
        assert layer1.sources.get(pid), f"layer 1 lost the source for {pid}"
    assert "Climate TRACE" in layer1.sources["AR"]


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
