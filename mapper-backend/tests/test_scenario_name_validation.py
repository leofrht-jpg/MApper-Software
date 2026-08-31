"""A named sensitivity case that does not exist must RAISE, not become Base.

``ParameterTable.resolve_value`` falls through to ``base_value`` when the
requested scenario carries no override -- which is correct for a parameter the
case does not touch, and silent for a case that does not exist at all::

    scenario='Optimistic'    -> 150.0
    scenario='Optimsitic'    -> 100.0   <- Base, no warning
    scenario='does-not-exist'-> 100.0

So a sensitivity run against a typo reported "no sensitivity" and looked like
a finding. The case names in play are of the shape
``sa_early_repurpose_120kkm``; a typo in one of those is not hypothetical.

``dsm.py``'s ``simulate_scenarios`` had this check for one route. Every other
boundary taking a case name accepted anything. There is now one helper and
every boundary calls it.
"""
from __future__ import annotations

import ast
import pathlib
import re

import pytest
from fastapi import HTTPException

from mapper.api import parameters as params_api
from mapper.api.parameters import validate_parameter_scenarios
from mapper.models.parameter_schemas import Parameter, ParameterTable

BACKEND = pathlib.Path(__file__).resolve().parents[1] / "mapper"


@pytest.fixture()
def table(monkeypatch):
    t = ParameterTable(
        parameters={"p": Parameter(name="p", base_value=100.0,
                                   scenario_overrides={"Optimistic": 150.0})},
        scenarios=["Optimistic", "sa_early_repurpose_120kkm"],
    )
    monkeypatch.setattr(params_api, "_table_for", lambda project=None: t)
    return t


# ── the helper itself ────────────────────────────────────────────────────────

def test_none_is_base_and_never_raises(table):
    validate_parameter_scenarios(None)
    validate_parameter_scenarios([])
    validate_parameter_scenarios([None])


def test_base_and_real_cases_pass(table):
    validate_parameter_scenarios("Base")
    validate_parameter_scenarios("Optimistic")
    validate_parameter_scenarios(["Base", "sa_early_repurpose_120kkm"])


def test_the_typo_that_prompted_this(table):
    with pytest.raises(HTTPException) as e:
        validate_parameter_scenarios("sa_early_repurpose_120km")  # dropped a k
    assert e.value.status_code == 400
    assert "sa_early_repurpose_120km" in e.value.detail
    # It lists what IS available -- a guard that only says "unknown" costs a
    # debugging session.
    assert "sa_early_repurpose_120kkm" in e.value.detail
    assert "Optimistic" in e.value.detail


def test_reports_every_unknown_not_just_the_first(table):
    with pytest.raises(HTTPException) as e:
        validate_parameter_scenarios(["Optimistic", "bogus_a", "bogus_b"])
    assert "bogus_a" in e.value.detail and "bogus_b" in e.value.detail


def test_a_case_with_no_overrides_behind_it_is_still_valid():
    """MAp-test's two cases carry ZERO overrides across 43 parameters.

    They resolve identically to Base -- but they EXIST, so naming one is not
    an error. Validity is membership, never whether the case moves a number.
    """
    t = ParameterTable(
        parameters={"p": Parameter(name="p", base_value=1.0)},
        scenarios=["Optimistic", "Pessimistic"],
    )
    import mapper.api.parameters as m
    orig = m._table_for
    m._table_for = lambda project=None: t
    try:
        validate_parameter_scenarios(["Optimistic", "Pessimistic"])
    finally:
        m._table_for = orig


# ── the silent behaviour the guard exists to stop ────────────────────────────

def test_resolve_value_itself_still_falls_through_to_base(table):
    """Documented, deliberately unchanged: the FALLTHROUGH is correct for a
    parameter the case does not override. The guard is at the boundary, so the
    engine keeps its simple rule and the name is checked once, up front."""
    assert table.resolve("p", "Optimistic") == 150.0
    assert table.resolve("p", "Optimsitic") == 100.0  # <- why the guard exists
    assert table.resolve("p", None) == 100.0


# ── the class guard: every boundary taking a case name checks it ─────────────

CASE_FIELDS = {"parameter_scenario", "parameter_scenarios", "parameter_set_id", "cases"}

# Two accepted implementations. ``get_parameter_set`` returns None for any name
# outside ``table.list_scenarios()`` -- the SAME namespace and the same rule --
# and its callers raise on None, so it is a real check, not a near-miss.
# Matched as CALLS, not substrings. The first version matched bare names, so
# the ``from ... import validate_parameter_scenarios`` line inside a route body
# satisfied the check on its own -- deleting the actual call left the guard
# green. Verified by re-running the revert.
ACCEPTED = ("validate_parameter_scenarios(", "get_parameter_set(", "_build_engine(")

# Routes that legitimately take a case field without checking it. Each entry
# needs a reason; an empty dict is the goal.
_ALLOWED: dict[str, str] = {}


def _request_schemas() -> set[str]:
    out = set()
    for f in BACKEND.rglob("*.py"):
        for n in ast.walk(ast.parse(f.read_text(encoding="utf-8"))):
            if isinstance(n, ast.ClassDef):
                fields = {
                    s.target.id for s in n.body
                    if isinstance(s, ast.AnnAssign) and isinstance(s.target, ast.Name)
                }
                if fields & CASE_FIELDS:
                    out.add(n.name)
    return out


def _routes_taking_a_case_field():
    schemas = _request_schemas()
    for f in sorted(BACKEND.rglob("*.py")):
        src = f.read_text(encoding="utf-8")
        lines = src.splitlines()
        for n in ast.walk(ast.parse(src)):
            if not isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            if not any("router." in ast.unparse(d) for d in n.decorator_list):
                continue
            sig = ast.unparse(n.args)
            if not any(re.search(rf"\b{s}\b", sig) for s in schemas):
                continue
            body = "\n".join(
                ln for ln in lines[n.lineno - 1: (n.end_lineno or n.lineno)]
                if not ln.lstrip().startswith(("import ", "from "))
            )
            # ``.as_posix()`` -- a Windows ``\`` key breaks every exemption.
            key = f"{f.relative_to(BACKEND).as_posix()}:{n.name}"
            yield key, body


def test_every_route_taking_a_case_name_checks_it():
    unchecked = [
        key for key, body in _routes_taking_a_case_field()
        if not any(a in body for a in ACCEPTED) and key not in _ALLOWED
    ]
    assert not unchecked, (
        "These routes accept a sensitivity-case name without checking it, so a "
        "typo resolves silently to Base:\n  " + "\n  ".join(unchecked)
    )


def test_the_sweep_finds_the_routes_it_claims_to():
    """Anti-vacuity: an empty sweep would pass the test above trivially."""
    found = {k for k, _ in _routes_taking_a_case_field()}
    for expected in (
        "api/lca.py:calculate_archetype_lca",
        "api/impact.py:post_calculate",
        "api/impact.py:post_calculate_scenarios",
        "api/monte_carlo.py:post_monte_carlo",
        "api/monte_carlo.py:post_monte_carlo_multi",
        "api/dsm.py:simulate_scenarios",
        "api/bom.py:material_flows",
        "api/bom.py:material_flows_multi",
    ):
        assert expected in found, f"sweep lost {expected}"
    assert len(found) >= 12


def test_declared_exemptions_still_exist():
    """An exemption for a route that no longer exists is rot."""
    found = {k for k, _ in _routes_taking_a_case_field()}
    assert not (set(_ALLOWED) - found), f"stale exemptions: {set(_ALLOWED) - found}"
