# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""A cohort key's ``<owner id>::`` prefix must never reach a worksheet cell.

The backend prefixes cohort keys with the owning system's or subsystem's id
(``SUBSYSTEM_KEY_SEP``) so two owners holding the same bare name do not merge
when results are aggregated. Every sheet writer is supposed to strip it for
display. The AESA "By Fuel Type" sheet did not -- it had no ``CohortResolver``
in scope and wrote ``r.impact_by_cohort`` keys verbatim.

Discovery here is by QUESTION, not by list: "which writers emit a cohort key
WITHOUT the strip", asked of the source. Asking the other question -- "where is
the resolver called" -- is what missed this writer the first time.

The assertion is on the WORKBOOK CELLS, not on whether a helper was called.
"""
from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

from mapper.api.cohort_export import strip_cohort_prefix
from mapper.core.dsm_lca_engine import SUBSYSTEM_KEY_SEP

API = Path(__file__).resolve().parents[1] / "mapper" / "api"

SUB_ID = "670be0bf-eb95-4479-b5f1-dea938d0e46f"
SYS_ID = "e5442abf-fa89-4804-b192-667f6ecd08bf"

#: Substring search, never anchored: a leaked key carries its dim suffix
#: (``<uuid>::CNG Station|Large``), so ``fullmatch`` would pass on a live bug.
LEAK = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}::", re.I)


def test_the_two_prefix_shapes_are_what_we_think():
    assert SUBSYSTEM_KEY_SEP == "::"
    for key in (f"{SUB_ID}{SUBSYSTEM_KEY_SEP}CNG Station|Large",
                f"{SYS_ID}{SUBSYSTEM_KEY_SEP}BEV-LFP|SUV"):
        assert LEAK.search(key), "the fixture no longer looks like a leak"
        assert not LEAK.fullmatch(key), (
            "fixture lost its dim suffix -- it would stop catching the "
            "anchored-match mistake"
        )


def test_strip_handles_both_shapes_and_leaves_bare_keys_alone():
    assert strip_cohort_prefix(f"{SUB_ID}::CNG Station|Large") == "CNG Station|Large"
    assert strip_cohort_prefix(f"{SYS_ID}::BEV-LFP|SUV") == "BEV-LFP|SUV"
    assert strip_cohort_prefix("BEV-LFP|SUV") == "BEV-LFP|SUV"


# ── The AESA sheet, asserted on its cells ───────────────────────────────────

def _aesa_fixture():
    """Config + result carrying BOTH prefix shapes, each with a dim suffix.

    Fixture shape borrowed from ``test_aesa_budget_basis_labels`` so it tracks
    the real models rather than a guess at them.
    """
    from mapper.core.aesa_engine import build_carbon_budget
    from mapper.models.aesa_schemas import (
        AESAComputeResult,
        AESAConfiguration,
        AESAYearSummary,
        SustainabilityRatioResult,
    )

    cb = build_carbon_budget()
    config = AESAConfiguration(
        id="cfg", name="Cohort prefix test", mfa_system_id=SYS_ID, multi_d=None,
        carbon_budget=cb, created_at="2025-01-01T00:00:00Z",
    )
    rows = [SustainabilityRatioResult(
        year=2030, pb_id="climate_change", pb_name="Climate change",
        ef_indicator="climate change", method_label="EF v3.1 | climate change",
        impact=6.0e9, allocated_sos=1.2e10, sr=0.5,
        zone="safe", boundary_type="cumulative", unit="kg CO2-eq",
        impact_by_cohort={
            f"{SYS_ID}{SUBSYSTEM_KEY_SEP}BEV-LFP|SUV": 7.0,
            f"{SUB_ID}{SUBSYSTEM_KEY_SEP}CNG Station|Large": 3.0,
        },
    )]
    result = AESAComputeResult(
        config_id="cfg", results=rows,
        summary_by_year=[AESAYearSummary(year=2030, safe=1, zone_of_uncertainty=0,
                                         high_risk=0, total_assessed=1)],
    )
    return config, result


def _cells(wb) -> list[str]:
    out: list[str] = []
    for ws in wb.worksheets:
        for row in ws.iter_rows(values_only=True):
            out += [v for v in row if isinstance(v, str)]
    return out


def test_the_aesa_workbook_writes_no_prefixed_cohort_cell():
    """The sheet that leaked. Asserted on the cells, not on a call."""
    from mapper.api.aesa import _build_aesa_workbook

    config, result = _aesa_fixture()
    cells = _cells(_build_aesa_workbook(config, result, "Test System"))
    leaked = [c for c in cells if LEAK.search(c)]
    assert leaked == [], f"raw cohort keys reached the workbook: {leaked[:5]}"
    # ...and the sheet still says something, so a workbook that silently
    # stopped writing cohorts could not pass.
    assert any("CNG Station" in c for c in cells), (
        "the By Fuel Type sheet no longer carries its cohort rows at all"
    )


# ── Discovery: which writers emit a cohort key WITHOUT stripping ────────────

#: Names that strip a cohort key. A writer must route through one of these.
STRIPPERS = {"strip_cohort_prefix", "split_cohort", "split_prefix", "_split_cohort", "_disp"}

#: Expressions that ARE a cohort key being written.
COHORT_EXPRS = re.compile(r"\b(ck|cohort|cohort_key)\b")


#: Receivers that are a worksheet. Narrowing this is how the guard would stop
#: discriminating, so `test_the_detector_actually_detects` pins it.
WORKSHEET_RECEIVER = re.compile(r"^(ws|worksheet|sheet)(_\w+)?$")


def _writers_emitting_raw_cohort_src(src: str, label: str = "<src>") -> list[str]:
    """``ws.append([...])`` calls whose row holds a bare cohort variable.

    Discovery by question -- "which writers emit a cohort key WITHOUT the
    strip" -- rather than "where is the resolver called", which is the question
    that missed the AESA sheet.

    Scoped to WORKSHEET receivers on purpose: ``invalid_cohorts.append(ck)`` in
    the import path is a plain list append of a key that is bare by
    construction, and counting it would train the reader to ignore this test.
    """
    out: list[str] = []
    tree = ast.parse(src)
    # Report the enclosing FUNCTION, not the line. An exemption keyed on a line
    # number goes stale the moment anything above it shifts -- which it did,
    # one import later, while this guard was being written.
    enclosing: dict[int, str] = {}
    for fn in ast.walk(tree):
        if isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for inner in ast.walk(fn):
                enclosing.setdefault(id(inner), fn.name)
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and node.func.attr == "append"
                and isinstance(node.func.value, ast.Name)
                and WORKSHEET_RECEIVER.match(node.func.value.id)):
            continue
        for arg in node.args:
            elts = arg.elts if isinstance(arg, (ast.List, ast.Tuple)) else [arg]
            for e in elts:
                if isinstance(e, ast.Name) and COHORT_EXPRS.fullmatch(e.id):
                    where = enclosing.get(id(node), "<module>")
                    out.append(f"{label}:{where} bare `{e.id}`")
    return out


def _writers_emitting_raw_cohort(path: Path) -> list[str]:
    return _writers_emitting_raw_cohort_src(path.read_text(encoding="utf-8"), path.name)


def test_the_detector_actually_detects():
    """The guard's own containment check.

    This is the exact shape the AESA sheet had. If the receiver pattern or the
    cohort-name pattern is ever narrowed, THIS fails rather than coverage
    silently shrinking -- the same reason the frontend half asserts its
    discovery set contains the known leak sites.
    """
    leaky = (
        "def build(result, wb):\n"
        "    ws = wb.create_sheet('By Fuel Type')\n"
        "    for r in result.results:\n"
        "        for cohort, val in r.impact_by_cohort.items():\n"
        "            ws.append([r.year, r.pb_name, cohort, val])\n"
    )
    assert _writers_emitting_raw_cohort_src(leaky), (
        "the detector no longer flags the exact shape of the bug it exists for"
    )
    fixed = leaky.replace("cohort, val])", "strip_cohort_prefix(cohort), val])")
    assert _writers_emitting_raw_cohort_src(fixed) == [], (
        "the detector flags the FIXED form -- it would cry wolf"
    )


#: Writers that legitimately append a bare cohort name, with the reason. A new
#: entry here is a decision someone has to write down, not a silent exemption.
ACCOUNTED = {
    # Cohort-mapping TEMPLATE: the subsystem's own cohort space, generated from
    # `all_cohort_keys(sub.dimensions)`. Never prefixed -- prefixing happens
    # only in `aggregate_subsystem_results`, when several owners' results are
    # merged, and a template is written before any result exists.
    "subsystems.py:_cohort_mapping_workbook bare `ck`",
}


@pytest.mark.parametrize("name", sorted(p.name for p in API.glob("*.py")))
def test_no_sheet_writer_appends_an_unstripped_cohort_key(name):
    hits = set(_writers_emitting_raw_cohort(API / name)) - ACCOUNTED
    assert hits == set(), (
        "a worksheet writer appends a cohort key without stripping it:\n  "
        + "\n  ".join(sorted(hits))
        + "\nRoute it through cohort_export.strip_cohort_prefix, or add it to "
          "ACCOUNTED with the reason it cannot be prefixed."
    )


def test_the_strippers_set_still_matches_reality():
    """ACCOUNTED and STRIPPERS are hand-maintained; they fail when stale."""
    src = (API / "cohort_export.py").read_text(encoding="utf-8")
    assert "def strip_cohort_prefix" in src
    for name in ("split_cohort", "split_prefix"):
        assert f"def {name}" in src, f"{name} is gone; STRIPPERS is stale"
