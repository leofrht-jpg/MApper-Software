# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""The ONE export-filename scheme: {system}+{subs}_{DOMAIN}.xlsx.

PARITY_FIXTURES is duplicated VERBATIM (same inputs → same expected strings) in
mapper-frontend/tests/exportFilename.test.ts, so the backend
``build_export_filename`` and the frontend ``buildExportFilename`` can't drift —
they set the Content-Disposition and the browser ``a.download`` respectively.
"""
from __future__ import annotations

from mapper.api.bom import build_export_filename

# [system, subsystems, domain, max_base|None, expected]
PARITY_FIXTURES = [
    ("Car Fleet", [], "LCA", None, "Car_Fleet_LCA.xlsx"),
    ("Car Fleet", [], "pLCA", None, "Car_Fleet_pLCA.xlsx"),
    ("Car Fleet", [], "AESA", None, "Car_Fleet_AESA.xlsx"),
    ("Car Fleet", [], "DSM", None, "Car_Fleet_DSM.xlsx"),
    ("Car Fleet", [], "MFA", None, "Car_Fleet_MFA.xlsx"),
    ("Car Fleet", ["Fueling Infrastructure"], "LCA", None, "Car_Fleet+Fueling_Infrastructure_LCA.xlsx"),
    ("Car Fleet", ["Fueling Infrastructure"], "pLCA", None, "Car_Fleet+Fueling_Infrastructure_pLCA.xlsx"),
    # AESA + contributing subsystem — the SR numerator sums primary + subsystem
    # impacts, so the AESA export now names the subsystem too (bugfix parity).
    ("Car Fleet", ["Fueling Infrastructure"], "AESA", None, "Car_Fleet+Fueling_Infrastructure_AESA.xlsx"),
    # Subsystem DSM export: scope (a) main+subsystem, scope (b) subsystem is the
    # subject (expressible with the current helper: subsystem name + no subs).
    ("Car Fleet", ["Fueling Infrastructure"], "DSM", None, "Car_Fleet+Fueling_Infrastructure_DSM.xlsx"),
    ("Fueling Infrastructure", [], "DSM", None, "Fueling_Infrastructure_DSM.xlsx"),
    ("Car Fleet", ["A", "B"], "LCA", None, "Car_Fleet+A+B_LCA.xlsx"),
    ("Car Fleet", ["", "  "], "LCA", None, "Car_Fleet_LCA.xlsx"),
    ("Car Fleet / v2", [], "LCA", None, "Car_Fleet_v2_LCA.xlsx"),
    ("Fleet", ["Sub/One:*"], "LCA", None, "Fleet+SubOne_LCA.xlsx"),
    ("", [], "LCA", None, "system_LCA.xlsx"),
    ("Primary", ["abcdefghij", "klmnopqrst", "uvwxyzabcd", "efghijklmn", "opqrstuvwx", "yzabcdefgh", "ijklmnopqr"], "LCA", None,
     "Primary+7_subsystems_LCA.xlsx"),
    ("BEV-LFP SUV", [], "LCA", None, "BEV-LFP_SUV_LCA.xlsx"),
    ("BEV-LFP SUV comparison", [], "LCA", None, "BEV-LFP_SUV_comparison_LCA.xlsx"),
    ("Multi-item comparison", [], "LCA", None, "Multi-item_comparison_LCA.xlsx"),
]


def test_parity_fixtures():
    for system, subs, domain, max_base, expected in PARITY_FIXTURES:
        got = (
            build_export_filename(system, subs, domain)
            if max_base is None
            else build_export_filename(system, subs, domain, max_base=max_base)
        )
        assert got == expected, f"{system} / {subs} / {domain}: {got!r} != {expected!r}"


def test_each_domain_suffix():
    for domain in ("LCA", "pLCA", "AESA", "DSM", "MFA"):
        assert build_export_filename("Car Fleet", [], domain) == f"Car_Fleet_{domain}.xlsx"


def test_no_subsystems():
    assert build_export_filename("Car Fleet", [], "LCA") == "Car_Fleet_LCA.xlsx"


def test_one_and_two_subsystems():
    assert build_export_filename("Car Fleet", ["Fueling Infrastructure"], "pLCA") == \
        "Car_Fleet+Fueling_Infrastructure_pLCA.xlsx"
    assert build_export_filename("Car Fleet", ["A", "B"], "LCA") == "Car_Fleet+A+B_LCA.xlsx"


def test_empty_subsystem_excluded():
    assert build_export_filename("Car Fleet", ["", "   ", "Real"], "LCA") == "Car_Fleet+Real_LCA.xlsx"


def test_sanitisation():
    assert build_export_filename("Car Fleet / v2", [], "LCA") == "Car_Fleet_v2_LCA.xlsx"
    fn = build_export_filename('Car/Fleet:*?', ['Sub"<>|'], "LCA")
    for bad in '/\\:*?"<>|':
        assert bad not in fn


def test_truncation_past_80():
    subs = [f"subsystem_number_{i}_with_a_long_name" for i in range(7)]
    fn = build_export_filename("Primary", subs, "LCA")
    assert fn == "Primary+7_subsystems_LCA.xlsx"
    assert len(fn) - len("_LCA.xlsx") <= 80


def test_no_date_or_scenario_count():
    import re
    fn = build_export_filename("Car Fleet", ["Fueling Infrastructure"], "pLCA")
    assert not re.search(r"\d{4}-\d{2}-\d{2}", fn)
    assert "scenario" not in fn.lower() and "multi_lci" not in fn.lower()
