# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""The ReCiPe midpoint (H) and (I) climate indicators are DISPLAYED with the name of the
factors they hold, and nothing else about them changes.

bw2io's bundled data names both "global warming potential (GWP1000)". (H) holds 100-year
factors (CH4 36, N2O 298), (I) 20-year ones (CH4 85, N2O 264); only (E) is 1000-year
(CH4 4.9, N2O 78.8). `core.method_labels.display_method` corrects what a person reads.
The tuple stays the method's identity, so the installer, `is_complete`, stored results and
the AESA mapping (which reads ``method[1]``) must behave exactly as before. Synthetic tuples
only: no project, database or user data is touched.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

from mapper.core.method_labels import (
    RECIPE_GWP_DISPLAY, disambiguated_labels, display_indicator, display_method, method_path,
)

H = ("ReCiPe 2016 v1.03, midpoint (H)", "climate change", "global warming potential (GWP1000)")
I = ("ReCiPe 2016 v1.03, midpoint (I)", "climate change", "global warming potential (GWP1000)")
E = ("ReCiPe 2016 v1.03, midpoint (E)", "climate change", "global warming potential (GWP1000)")
H_NOLT = ("ReCiPe 2016 v1.03, midpoint (H) no LT", "climate change no LT", "global warming potential (GWP1000) no LT")
I_NOLT = ("ReCiPe 2016 v1.03, midpoint (I) no LT", "climate change no LT", "global warming potential (GWP1000) no LT")
# A project installed from the ecoinvent LCIA file (WP15-original) already carries the right names.
H_OK = ("ReCiPe 2016 v1.03, midpoint (H)", "climate change", "global warming potential (GWP100)")
I_OK = ("ReCiPe 2016 v1.03, midpoint (I)", "climate change", "global warming potential (GWP20)")


@pytest.mark.parametrize("raw,shown", [
    (H, "global warming potential (GWP100)"),
    (I, "global warming potential (GWP20)"),
    (E, "global warming potential (GWP1000)"),                      # correct already: untouched
    (H_NOLT, "global warming potential (GWP100) no LT"),
    (I_NOLT, "global warming potential (GWP20) no LT"),
    (H_OK, "global warming potential (GWP100)"),                     # already corrected: not corrected again
    (I_OK, "global warming potential (GWP20)"),
])
def test_the_indicator_reads_as_the_factors_it_holds(raw, shown):
    assert display_indicator(raw) == shown
    assert display_method(raw)[-1] == shown
    assert display_method(raw)[:-1] == raw[:-1]                      # package and category untouched


@pytest.mark.parametrize("raw", [H, I, E, H_NOLT, I_NOLT, H_OK, I_OK,
                                 ("EF v3.1", "climate change", "global warming potential (GWP100)"),
                                 ("IPCC 2013", "climate change", "GWP100a")])
def test_the_correction_is_idempotent_and_never_mutates_its_input(raw):
    once = display_method(raw)
    assert display_method(once) == once
    assert raw == tuple(raw)                                         # the caller's tuple is as it was
    as_list = list(raw)
    display_method(as_list)
    assert as_list == list(raw)


def test_only_the_four_known_wrong_names_are_in_the_table():
    # An EF GWP100, a correct (E), and anything unknown must never be rewritten.
    assert set(RECIPE_GWP_DISPLAY) == {H, I, H_NOLT, I_NOLT}
    assert display_method(("EF v3.1", "climate change", "global warming potential (GWP100)")) == (
        "EF v3.1", "climate change", "global warming potential (GWP100)")
    assert display_method(()) == ()
    assert display_indicator(()) == ""


def test_the_three_perspectives_read_differently_in_one_table():
    # Chosen together, (H), (I) and (E) share a category, so the label carries the indicator. Before
    # this, all three read "climate change / global warming potential (GWP1000)": one name, three methods.
    labels = disambiguated_labels([H, I, E])
    assert labels[H] == "climate change / global warming potential (GWP100)"
    assert labels[I] == "climate change / global warming potential (GWP20)"
    assert labels[E] == "climate change / global warming potential (GWP1000)"
    assert len(set(labels.values())) == 3
    # the keys are still the stored tuples
    assert set(labels) == {H, I, E}


def test_a_project_with_corrected_names_gets_the_same_labels():
    assert disambiguated_labels([H_OK, I_OK, E]) == {
        H_OK: "climate change / global warming potential (GWP100)",
        I_OK: "climate change / global warming potential (GWP20)",
        E: "climate change / global warming potential (GWP1000)",
    }


def test_the_method_path_stays_the_raw_tuple_because_it_is_an_identifier():
    assert method_path(H) == "ReCiPe 2016 v1.03, midpoint (H) › climate change › global warming potential (GWP1000)"


# ── what must NOT change ─────────────────────────────────────────────────────


def test_the_bundled_data_and_installer_still_use_the_raw_tuples():
    """The premise of the correction, pinned. If bw2io ever fixes its names or factors, this fails and
    the table should be removed rather than left correcting something that is no longer wrong."""
    from mapper.core import lcia_ef_install as inst

    bundled = set(inst.family_tuples(["ReCiPe 2016 v1.03, midpoint (H)", "ReCiPe 2016 v1.03, midpoint (I)",
                                       "ReCiPe 2016 v1.03, midpoint (E)"]))
    for t in (H, I, E):
        assert t in bundled, f"{t[0]} is no longer named {t[2]!r} in the bundled data: drop RECIPE_GWP_DISPLAY"
    for t in (H_OK, I_OK):
        assert t not in bundled

    def ch4_n2o(fam):
        m = next(m for m in inst.load_families(fam) if m["name"][1] == "climate change")
        f = {e["name"]: e["amount"] for e in m["exchanges"]
             if tuple(e.get("categories") or ()) == ("air",) and e["name"] in ("Methane, fossil", "Dinitrogen monoxide")}
        return f["Methane, fossil"], f["Dinitrogen monoxide"]

    assert ch4_n2o("ReCiPe 2016 v1.03, midpoint (H)") == (36, 298)      # 100-year, under the name GWP1000
    assert ch4_n2o("ReCiPe 2016 v1.03, midpoint (I)") == (85, 264)      # 20-year, under the name GWP1000
    assert ch4_n2o("ReCiPe 2016 v1.03, midpoint (E)") == (4.9, 78.8)    # genuinely 1000-year


def test_installed_and_complete_are_judged_on_the_raw_tuples(monkeypatch):
    import bw2data
    from mapper.core import lcia_ef_install as inst

    fam = "ReCiPe 2016 v1.03, midpoint (H)"
    wanted = inst.family_tuples(fam)
    monkeypatch.setattr(bw2data, "methods", {t: {} for t in wanted})
    assert inst.is_complete(fam)
    assert set(inst.installed_tuples(fam)) == set(wanted)
    assert H in inst.installed_tuples(fam)                              # the raw name, not the displayed one


def test_aesa_maps_on_method_1_so_the_label_cannot_move_it():
    from mapper.core import aesa_engine

    src = Path(aesa_engine.__file__).read_text(encoding="utf-8")
    assert "method[1]" in src
    assert "RECIPE_GWP_DISPLAY" not in src and "display_indicator" not in src


# ── where the corrected name is written ──────────────────────────────────────


def test_row_and_column_labels_on_the_fleet_and_single_product_sheets_use_it():
    from mapper.api.bom import _short_method_label
    from mapper.api.impact import _sp_short_method

    assert _short_method_label(list(H)) == "global warming potential (GWP100)"
    assert _short_method_label(list(I)) == "global warming potential (GWP20)"
    assert _short_method_label(list(E)) == "global warming potential (GWP1000)"
    assert _sp_short_method(list(I)) == "global warming potential (GWP20)"
    both = [list(H), list(I)]
    assert _short_method_label(list(H), both) == "climate change / global warming potential (GWP100)"
    assert _sp_short_method(list(I), both) == "climate change / global warming potential (GWP20)"


def test_the_static_workbook_labels_the_indicator_and_keeps_the_path_raw():
    from mapper.api.impact import _build_single_product_static_workbook
    from mapper.models.schemas import ArchetypeLCACalculateResult, ArchetypeLCAMethodResult

    def result():
        return ArchetypeLCACalculateResult(
            archetype_id="a", archetype_name="Synthetic", scope="inflows", amount=1.0,
            stage_amounts={"Manufacturing": 1.0}, stages_included=["Manufacturing"],
            results=[ArchetypeLCAMethodResult(method=list(t), method_label="x", score=1.0 + i, unit="kg CO2-eq", contributions=[])
                     for i, t in enumerate((H, I, E))],
            elapsed_seconds=0.1,
        )

    wb = _build_single_product_static_workbook("Synthetic", "inflows", [("Base", result())])
    ws = wb["Total impacts"]
    rows = [r for r in ws.iter_rows(values_only=True) if r and r[0] is not None]
    assert rows[0][:2] == ("Indicator", "Method path")
    by_path = {r[1]: r[0] for r in rows[1:]}
    # label column: the name of the factors held. path column: the registered tuple, verbatim.
    assert by_path[" › ".join(H)] == "global warming potential (GWP100)"
    assert by_path[" › ".join(I)] == "global warming potential (GWP20)"
    assert by_path[" › ".join(E)] == "global warming potential (GWP1000)"


def test_the_monte_carlo_and_dsm_result_labels_use_it():
    from mapper.core.method_labels import display_method

    # `" | ".join(display_method(m)[1:])` is the Monte Carlo label rule; `" › ".join(display_method(m))` the fleet's.
    assert " | ".join(display_method(I)[1:]) == "climate change | global warming potential (GWP20)"
    assert " › ".join(display_method(H)) == "ReCiPe 2016 v1.03, midpoint (H) › climate change › global warming potential (GWP100)"


# ── the two language mirrors must agree ──────────────────────────────────────


def test_the_frontend_table_is_the_same_as_the_backend_one():
    ts = (Path(__file__).resolve().parents[2] / "mapper-frontend" / "src" / "utils" / "methodLabels.ts").read_text(encoding="utf-8")
    block = ts[ts.index("const RECIPE_GWP_DISPLAY"):]
    block = block[:block.index("\n]\n") + 3]
    rows = re.findall(r"\[\['([^']+)', '([^']+)', '([^']+)'\], '([^']+)'\]", block)
    assert {(a, b, c): d for a, b, c, d in rows} == RECIPE_GWP_DISPLAY


def test_the_method_library_entry_says_what_the_names_mean():
    import json
    reg = json.loads((Path(__file__).resolve().parents[1] / "mapper" / "data" / "lcia_methods.json").read_text(encoding="utf-8"))
    entry = next(m for m in reg["methods"] if m["id"] == "recipe_2016_midpoint")
    text = entry["long_description"]
    assert "GWP1000" in text and "GWP100" in text and "GWP20" in text
    assert "stored method names are unchanged" in text
    # the installer is untouched: it still names the three raw families
    assert entry["bundled_families"] == ["ReCiPe 2016 v1.03, midpoint (H)", "ReCiPe 2016 v1.03, midpoint (I)",
                                         "ReCiPe 2016 v1.03, midpoint (E)"]
