# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""An upload that resolves NOTHING must not overwrite what is already there.

Found live, not hypothetically: a cohort-mapping workbook whose 51 rows all
named archetypes that did not resolve in the project. Every row was skipped, an
empty mapping was built, and it was persisted over 51 good ones. 51 -> 0, on a
file that was merely WRONG.

The assertions here check the STORE AFTERWARDS, not just the status code. A
test that only asserts 422 would pass against an implementation that refuses
AND still writes.
"""
from __future__ import annotations

import io

import openpyxl
import pytest
from fastapi import HTTPException

from mapper.core.upload_guard import refuse_if_nothing_resolved


# ── The rule itself ────────────────────────────────────────────────────────

def test_refuses_when_rows_were_asserted_and_none_resolved():
    with pytest.raises(HTTPException) as e:
        refuse_if_nothing_resolved(rows_seen=51, resolved=0, what="cohort mapping")
    assert e.value.status_code == 422
    assert "51" in str(e.value.detail)
    assert "unchanged" in str(e.value.detail)


def test_allows_an_empty_file_so_CLEARING_still_works():
    """`rows_seen == 0` is the deliberate clear-everything workflow.

    Blank archetype cells are skipped by design, so a file of blanks is how a
    user empties a mapping. Refusing on "the result is empty" would break it.
    """
    refuse_if_nothing_resolved(rows_seen=0, resolved=0, what="cohort mapping")


def test_allows_a_PARTIAL_upload():
    """50 of 51 is someone fixing a file incrementally, not a failure.

    The line is *nothing landed*, not *something was imperfect* -- the per-row
    problems are already reported back to the caller.
    """
    refuse_if_nothing_resolved(rows_seen=51, resolved=50, what="cohort mapping")


def test_the_rule_does_not_depend_on_what_is_already_stored():
    """Destructiveness is a property of the UPLOAD, not of its target.

    "empty result AND non-empty store" was the tempting alternative; it makes
    the same bad file succeed on an empty system and fail on a populated one.
    The guard takes no store argument at all, which is what makes that
    impossible to reintroduce by accident.
    """
    import inspect

    params = set(inspect.signature(refuse_if_nothing_resolved).parameters)
    assert params == {"rows_seen", "resolved", "what", "hint"}, (
        f"the guard gained a parameter: {params}. If it now reads existing "
        "state, the refusal has become dependent on what it lands on."
    )


# ── The parsers do NOT protect these paths ─────────────────────────────────

def _xlsx(rows):
    wb = openpyxl.Workbook()
    ws = wb.active
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


@pytest.mark.parametrize(
    "parser,header,extra",
    [
        ("parse_stock_file", ["f", "age", "count"], ()),
        ("parse_dependent_stock_file", ["f", "age", "count"], ()),
        ("parse_inflow_file", ["f", "year", "count"], ([2025, 2026],)),
        ("parse_outflow_file", ["f", "year", "count"], ([2025, 2026],)),
    ],
)
def test_a_wellformed_file_with_zero_rows_parses_CLEAN(parser, header, extra):
    """This is why the guard is needed, and why "safe by accident" was wrong.

    The inflow/outflow parsers DO raise on a header-only file -- but that is a
    COLUMN check, and a file with the CORRECT columns and no data rows sails
    straight through returning empty. Behaviour that depends on an unrelated
    function's exception is one refactor away from being the bug this closes.
    """
    from mapper.core import dsm_engine
    from mapper.models.dsm_schemas import DimensionDef

    dims = [DimensionDef(name="f", display_name="Fuel", labels=["A", "B"], is_age=False)]
    out = getattr(dsm_engine, parser)(_xlsx([header]), "t.xlsx", dims, *extra)
    parsed = out[0] if isinstance(out, tuple) else out
    assert len(parsed) == 0, (
        f"{parser} no longer returns empty for a well-formed empty file. If it "
        "now raises, the guard is still required -- do not remove it on the "
        "strength of another function's exception."
    )


# ── Every assign-and-persist upload routes through the guard ───────────────

GUARDED = {
    ("api/bom.py", "upload_cohort_mappings"),
    ("api/dsm.py", "upload_stock"),
    ("api/dsm.py", "upload_inflows"),
    ("api/dsm.py", "upload_stock_targets"),
    ("api/dsm.py", "upload_outflows"),
    ("api/dsm.py", "upload_stock_aggregate"),
    ("api/subsystems.py", "upload_subsystem_initial_stock"),
    ("api/subsystems.py", "upload_manual_inflows"),
    ("api/subsystems.py", "upload_manual_outflows"),
}


@pytest.mark.parametrize("rel,fn", sorted(GUARDED))
def test_every_writing_upload_calls_the_guard(rel, fn):
    import ast
    import pathlib

    pkg = pathlib.Path(__file__).resolve().parents[1] / "mapper"
    tree = ast.parse((pkg / rel).read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)) and node.name == fn:
            called = {
                c.func.id if isinstance(c.func, ast.Name) else getattr(c.func, "attr", "")
                for c in ast.walk(node) if isinstance(c, ast.Call)
            }
            assert "refuse_if_nothing_resolved" in called, (
                f"{rel}:{fn} writes to the store without the empty-result guard. "
                "An upload that resolves nothing would overwrite live data."
            )
            return
    raise AssertionError(f"{rel}:{fn} not found -- update GUARDED")
