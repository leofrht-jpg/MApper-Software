# SPDX-License-Identifier: MPL-2.0
"""The boundary acronyms follow the author's figure convention.

They reach the screen (the Cases view's category axis and its tooltips, the
glossary) and the AESA export's "Abbreviation" column from ONE place, the
``conventional_acronym`` of each boundary in ``boundary_sets.json``. So the
convention is pinned on the data, and once through the real export.
"""
from __future__ import annotations

import json
from pathlib import Path

CONVENTION = {
    "AP", "GWP100", "ETfw", "EPf", "EPm", "EPt", "HTPc", "HTPnc",
    "IRP", "LU", "ODP", "PM", "POCP", "ADPf", "ADPmm", "WU",
}
DATA = Path(__file__).resolve().parents[1] / "mapper" / "data" / "aesa" / "boundary_sets.json"


def _sala():
    sets = json.loads(DATA.read_text())["sets"]
    return next(s for s in (sets.values() if isinstance(sets, dict) else sets)
                if (s.get("id") if isinstance(s, dict) else None) == "Sala2020_EF" or "Sala2020_EF" in str(s.get("id", "")))


def test_the_sixteen_acronyms_are_the_convention():
    b = _sala()["boundaries"]
    got = {v["conventional_acronym"] for v in (b.values() if isinstance(b, dict) else b)}
    assert got == CONVENTION


def test_no_old_hyphenated_form_survives():
    assert not any("-" in a for a in CONVENTION)
    text = DATA.read_text()
    for old in ("ETP-fw", "ADP-f", "ADP-mm", "EP-f", "EP-m", "EP-t", "HTP-c", "HTP-nc"):
        assert f'"conventional_acronym": "{old}"' not in text, old
