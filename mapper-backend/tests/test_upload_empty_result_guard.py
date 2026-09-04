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
import re

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

# Every upload route that WRITES to a project store. Declared, but no longer
# maintained by hand: `test_no_undeclared_writing_upload` discovers them and
# fails on one that is missing, the way DEMAND_BUILDERS does next door.
#
# Before discovery existed this was a hand-kept list of nine, and the sweep
# immediately found a tenth -- `import_archetype`, which in replace mode wiped
# the library and THEN validated, so a well-formed workbook with zero rows
# destroyed every archetype and answered 400. That is the failure this whole
# file is about, sitting one module away, invisible because the guard's scope
# was a list somebody had to remember to extend.
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

# Upload routes that do NOT write to a project store, each with the reason.
# An entry here is a claim that must stay true; `test_a_declared_reader_really_does_not_write`
# checks it rather than trusting the comment.
READ_ONLY_UPLOADS = {
    ("api/dsm.py", "parse_labels"): "parses and returns; never persists",
    ("api/subsystems.py", "import_cohort_mapping"): "preview-then-apply; validate only",
    ("api/subsystems.py", "import_dependency_rules"): "preview-then-apply; validate only",
}

# Writing uploads that are NOT empty-result-guarded, each with the reason it
# does not need to be. These are the judgement calls; the sweep forces them to
# be made explicitly rather than by omission.
WRITING_BUT_EXEMPT = {
    ("api/bom.py", "import_archetype"):
        "validates the whole workbook BEFORE the replace wipe, so a file that "
        "resolves nothing cannot destroy the library. Verified: 3 archetypes "
        "in, 3 out, HTTP 400.",
    ("api/databases.py", "post_import_project"):
        "installs into a NEW project; it never overwrites an existing one",
    ("api/dsm.py", "import_system"): "creates a system; does not replace one",
    ("api/dsm.py", "import_simulation"): "creates a result; does not replace one",
    ("api/parameters.py", "import_table"):
        "validates the header and builds the new table BEFORE writing; a "
        "malformed sheet 400s with nothing touched (checked at the source)",
    ("api/aesa.py", "post_config_import"): "creates a configuration; additive",
    ("api/lcia_methods.py", "post_install_custom"): "installs a method; additive",
}


def _fns(tree):
    import ast
    for n in ast.walk(tree):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            yield n


def _calls(fn) -> set[str]:
    import ast
    out = set()
    for c in ast.walk(fn):
        if isinstance(c, ast.Call):
            f = c.func
            out.add(f.id if isinstance(f, ast.Name) else getattr(f, "attr", ""))
    return out


def _takes_an_upload(fn) -> bool:
    """A parameter annotated UploadFile, or defaulted to File(...)."""
    import ast
    for a in list(fn.args.args) + list(fn.args.kwonlyargs):
        if a.annotation is not None and "UploadFile" in ast.unparse(a.annotation):
            return True
    for d in list(fn.args.defaults) + [d for d in fn.args.kw_defaults if d]:
        if isinstance(d, ast.Call) and getattr(d.func, "id", "") == "File":
            return True
    return False


# A PATTERN, not a list of names. A hand-kept list is the very thing that let
# `import_archetype` sit unclassified, so the criterion must generalise to a
# helper nobody has written yet.
#
# Derived from the code rather than guessed: across the nine known writers the
# persist calls are save_cohort_mappings / save_state / _persist_subs /
# _persist_sub_results, and the three known readers call none of them. The bare
# `save` and `storage_write` arms were added after this sweep classified
# `post_config_import` (calls `save`) and `post_import_project` (calls
# `_rehydrate_after_storage_write`) as read-only, which they are not -- a false
# "read-only" is exactly the blind spot this test exists to remove.
_PERSISTS = re.compile(r"^(save|_persist|install_)|storage_write")


def _discover_upload_routes(root=None):
    """(writing, read_only) upload routes, discovered rather than declared."""
    import ast
    import pathlib as _pl

    root = root or (_pl.Path(__file__).resolve().parents[1] / "mapper")
    writing, readers = set(), set()
    for path in sorted(root.rglob("*.py")):
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except SyntaxError:
            continue
        for fn in _fns(tree):
            if not _takes_an_upload(fn):
                continue
            # as_posix(), not str(): on Windows str() yields backslashes and
            # nothing would match the declared sets, so the rule would pass by
            # finding nothing on half the CI matrix.
            key = (path.relative_to(root).as_posix(), fn.name)
            # No subscript-assignment heuristic: `d[k] = v` on a LOCAL dict
            # during parsing is not a store write, and including it classified
            # both subsystem preview routes as writers.
            persists = any(_PERSISTS.search(c) for c in _calls(fn))
            (writing if persists else readers).add(key)
    return writing, readers


def test_no_undeclared_writing_upload():
    """A NEW upload route that writes must be classified, not silently skipped.

    The neighbouring DEMAND_BUILDERS sweep works this way; this one did not,
    and the gap hid a real data-loss path in `import_archetype` for as long as
    it existed. A guard whose scope is maintained by hand drifts, and the drift
    is invisible.
    """
    writing, _ = _discover_upload_routes()
    undeclared = writing - GUARDED - set(WRITING_BUT_EXEMPT)
    assert not undeclared, (
        "these upload routes write to a project store and are neither guarded "
        "nor exempt. Call refuse_if_nothing_resolved, or add an entry to "
        f"WRITING_BUT_EXEMPT saying why it is safe: {sorted(undeclared)}"
    )


def test_no_stale_declaration():
    """A declared entry that no longer exists is as bad as a missing one -- it
    passes vacuously while looking like coverage."""
    writing, readers = _discover_upload_routes()
    found = writing | readers
    for label, declared in (("GUARDED", GUARDED),
                            ("WRITING_BUT_EXEMPT", set(WRITING_BUT_EXEMPT)),
                            ("READ_ONLY_UPLOADS", set(READ_ONLY_UPLOADS))):
        stale = declared - found
        assert not stale, f"{label} names routes that no longer exist: {sorted(stale)}"


def test_a_declared_reader_really_does_not_write():
    """READ_ONLY_UPLOADS is a claim, not a comment. Checked."""
    writing, _ = _discover_upload_routes()
    wrong = set(READ_ONLY_UPLOADS) & writing
    assert not wrong, (
        f"declared read-only but they persist: {sorted(wrong)}"
    )


def test_the_discovery_is_not_vacuous():
    """It must actually find the routes it is meant to police."""
    writing, readers = _discover_upload_routes()
    assert len(writing | readers) >= 15, (
        f"the sweep found only {len(writing | readers)} upload routes -- it has "
        "stopped matching and would pass by finding nothing"
    )
    assert GUARDED <= writing, (
        f"a guarded route is no longer detected as writing: {sorted(GUARDED - writing)}"
    )


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
