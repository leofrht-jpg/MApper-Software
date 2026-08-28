# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""A parameter scenario says WHICH values, never WHETHER to resolve.

This closes a defect class that shipped four times, each time behind the same
false premise: that skipping resolution "keeps the base values" because a
scalar-only table "resolves identically anyway". It does not. A BOM row whose
Quantity cell is a parameter expression is imported with ``quantity = 1.0`` as
a pre-resolution placeholder and the formula in ``quantity_expression``, so
skipping resolution keeps **1.0**, not the base value.

The four:

  1. ``api/lca.py``          gated on ``parameter_scenario is not None or
                             table.has_time_varying()``. Both single-product
                             panels send None for Base, so it never opened: a
                             WP5 use phase came out 727x low and a Battery
                             Circularity archetype lost its per-kWh functional
                             unit divisor (~1600x on the total).
  2. ``api/bom.py``          ``material_flows`` skipped for None AND "Base".
     material_flows          On the WP5 fleet every use-phase flow reported the
                             VEHICLE COUNT as kilograms -- 1,962,976 "kg" of
                             petrol in 2025 was 1.0 x 1,962,976 cars.
  3. ``api/bom.py``          ``param_table`` assigned only inside
  4. ``api/impact.py``       ``if body.parameter_set_id:``. DSMLCAPipeline
                             resolves iff handed a table, so a falsy id
                             silently disabled resolution for a whole
                             system-level run. Latent, not live -- every UI
                             path sends "Base" and the fan-out orchestrator
                             defaults to "Base" -- but the same class.

The guard is AST-based rather than textual: it finds every call to
``resolve_archetype_with_engine``, walks the ``if`` statements enclosing it,
and fails when any of their tests mention a scenario-valued name. Textual
matching cannot see enclosing scope, which is exactly where all four lived.

Anti-vacuity: ``test_the_guard_catches_each_historical_gate`` replays all four
shapes through the same analyser and requires each to be flagged, so the sweep
cannot pass by finding nothing.
"""
from __future__ import annotations

import ast
import pathlib

import pytest

PKG = pathlib.Path(__file__).resolve().parents[1] / "mapper"

# The call that performs the substitution. If a second entry point is ever
# added, add it here or the sweep silently stops covering it.
RESOLVE_CALLS = {"resolve_archetype_with_engine"}

# Names that identify a *scenario*. A condition mentioning one of these decides
# WHICH values -- so gating resolution on it is the defect.
SCENARIO_NAMES = {
    "parameter_scenario", "param_scenario", "parameter_set_id",
    "param_set_id", "scenario", "parameter_case", "case",
}

# Genuine exceptions, named explicitly. Empty on purpose: after the four fixes
# nothing legitimately gates resolution on a scenario value. An entry here must
# say why the gate is correct, not merely that it exists.
ALLOWED: dict[tuple[str, str], str] = {}


def _py_files() -> list[pathlib.Path]:
    return sorted(p for p in PKG.rglob("*.py") if "__pycache__" not in p.parts)


def _names_in(node: ast.AST) -> set[str]:
    return {n.id for n in ast.walk(node) if isinstance(n, ast.Name)} | {
        n.attr for n in ast.walk(node) if isinstance(n, ast.Attribute)
    }


def _violations_in_source(src: str, label: str) -> list[str]:
    """Every resolve call whose enclosing ``if`` tests a scenario value."""
    tree = ast.parse(src)
    for parent in ast.walk(tree):
        for child in ast.iter_child_nodes(parent):
            child.parent = parent  # type: ignore[attr-defined]

    out: list[str] = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                and node.func.id in RESOLVE_CALLS):
            continue
        cur = getattr(node, "parent", None)
        while cur is not None:
            if isinstance(cur, ast.If):
                gating = _names_in(cur.test) & SCENARIO_NAMES
                if gating:
                    out.append(
                        f"{label}:{node.lineno} resolution is gated on "
                        f"{sorted(gating)} (line {cur.lineno})")
            cur = getattr(cur, "parent", None)
    return out


def test_the_sweep_finds_the_package():
    files = _py_files()
    assert len(files) > 20, f"only {len(files)} files found under {PKG}"
    joined = "\n".join(p.read_text(encoding="utf-8") for p in files)
    assert "resolve_archetype_with_engine" in joined, (
        "the resolve call was renamed; RESOLVE_CALLS is now stale and this "
        "guard covers nothing")


def test_no_resolution_call_is_gated_on_a_scenario_value():
    found: list[str] = []
    for f in _py_files():
        rel = str(f.relative_to(PKG.parent))
        for v in _violations_in_source(f.read_text(encoding="utf-8"), rel):
            if (rel, v.split(" ", 1)[0].rsplit(":", 1)[0]) in ALLOWED:
                continue
            found.append(v)
    assert not found, (
        "a parameter scenario selects WHICH values, never WHETHER to "
        "resolve. Skipping does not keep the base values -- an expression row "
        "keeps its 1.0 placeholder:\n  " + "\n  ".join(found))


# Each entry is one of the four gates, reduced to its shape.
HISTORICAL_GATES = {
    "lca.py (instance 1)": '''
def build(parameter_scenario):
    table = _table_for()
    if parameter_scenario is not None or table.has_time_varying():
        arc = resolve_archetype_with_engine(arc, ParameterEngine(table))
''',
    "material_flows (instance 2)": '''
def flows(body):
    if body.parameter_scenario is not None and body.parameter_scenario != "Base":
        archetypes = {a: resolve_archetype_with_engine(x, engine)
                      for a, x in raw.items()}
''',
    "skip-for-Base": '''
def flows(body):
    if body.param_scenario != "Base":
        arc = resolve_archetype_with_engine(arc, engine)
''',
    "nested under a param-set branch": '''
def calc(body):
    if body.parameter_set_id:
        for k in items:
            if k:
                arc = resolve_archetype_with_engine(arc, engine)
''',
}


@pytest.mark.parametrize("label", sorted(HISTORICAL_GATES))
def test_the_guard_catches_each_historical_gate(label):
    """Anti-vacuity: the analyser must flag all four shapes it exists to stop."""
    assert _violations_in_source(HISTORICAL_GATES[label], label), (
        f"the guard no longer detects the {label!r} shape, so a green sweep "
        f"proves nothing")


def test_the_guard_accepts_the_corrected_shape():
    """The fixed form -- validate the scenario, then resolve unconditionally --
    must NOT be flagged, or the guard would block the fix it is enforcing."""
    ok = '''
def build(parameter_scenario):
    table = _table_for()
    if parameter_scenario not in (None, "Base") and parameter_scenario not in table.list_scenarios():
        raise HTTPException(status_code=400, detail="unknown scenario")
    arc = resolve_archetype_with_engine(arc, ParameterEngine(table, scenario=parameter_scenario))
'''
    assert not _violations_in_source(ok, "corrected"), (
        "the guard flags the corrected shape; validating a scenario name is "
        "not the same as gating resolution on it")


def test_the_year_varying_branch_is_not_a_scenario_gate():
    """``DSMLCAPipeline`` resolves per-year when the table has keyframes.

    That branch chooses resolve-once vs resolve-per-year -- never whether to
    resolve -- so it must stay unflagged. Pinned because it is the one real
    conditional that legitimately wraps a resolve call.
    """
    src = (PKG / "core" / "dsm_lca_engine.py").read_text(encoding="utf-8")
    assert not _violations_in_source(src, "dsm_lca_engine.py")


def test_the_param_table_is_assigned_outside_the_param_set_branch():
    """Instances 3 and 4, which the AST rule cannot see.

    ``DSMLCAPipeline`` resolves iff it is handed a table, so assigning
    ``param_table`` only inside ``if body.parameter_set_id:`` disables
    resolution for a falsy id -- a data-flow gate, not a syntactic one.
    """
    for rel in ("api/impact.py", "api/bom.py"):
        src = (PKG / rel).read_text(encoding="utf-8")
        tree = ast.parse(src)
        for node in ast.walk(tree):
            if not isinstance(node, ast.If):
                continue
            if not (_names_in(node.test) & {"parameter_set_id", "param_set_id"}):
                continue
            assigned = {
                t.id
                for stmt in ast.walk(node)
                if isinstance(stmt, ast.Assign)
                for t in stmt.targets
                if isinstance(t, ast.Name)
            }
            assert "param_table" not in assigned, (
                f"{rel}:{node.lineno} assigns param_table only when "
                f"parameter_set_id is truthy, so a falsy id hands "
                f"DSMLCAPipeline no table and silently skips resolution")
