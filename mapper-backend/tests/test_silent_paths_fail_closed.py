# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Four paths that used to shrink a result in silence.

All four are the same class -- works until it doesn't, then lies -- and all
four produced a SMALLER, entirely plausible number with nothing said. That is
what makes them worse than a crash: a fleet total that is 8% low looks like a
fleet total.

They do not get the same answer, because the right behaviour differs:

  1. an unlinked BOM row            -> REFUSE. The row is in the BOM because
                                       the user wants it counted; dropping it
                                       has no defensible reading.
  2. a cohort carrying stock with
     no mapping                     -> REFUSE. Same defect as a DANGLING
                                       mapping, one step earlier in the same
                                       lookup, and that one already raised.
  3. a stage name matching no
     keyword                        -> WARN and default. The keyword table is
                                       an automotive vocabulary and MApper is
                                       general-purpose; refusing would block a
                                       legitimate wind-farm project over a
                                       naming convention.
  4. a node naming an undefined
     global lever                   -> REFUSE, but ONLY when levers are in
                                       play. The 1.0 identity when they are
                                       not is a designed guarantee.

The sweep at the bottom is the part that stops the class coming back.
"""
from __future__ import annotations

import ast
import re
import textwrap
from pathlib import Path

import pytest

from mapper.core.bom_engine import (
    UndefinedLeverError,
    resolve_quantity,
    stage_name_matches_a_keyword,
    stage_to_scope,
)
from mapper.core.bom_validator import BOMValidationRow, validate_bom
from mapper.core.dsm_lca_engine import DanglingArchetypeError, UnmappedCohortError
from mapper.models.bom_schemas import BOMNode

BACKEND = Path(__file__).resolve().parents[1] / "mapper"


# ── 1. unlinked rows ─────────────────────────────────────────────────────────


def test_the_unlinked_guard_names_the_rows_not_a_count():
    """"has 3 unlinked material(s)" is the guard that costs a debugging
    session. The detail carries stage, row name and node_id."""
    from fastapi import HTTPException

    from mapper.api.lca import _refuse_on_unlinked
    from mapper.models.bom_schemas import FlattenedMaterial

    mats = [
        FlattenedMaterial(node_id="n1", name="Steel frame", quantity=1.0, unit="kg",
                          ecoinvent_activity=None, path=["Manufacturing", "Steel frame"]),
        FlattenedMaterial(node_id="n2", name="Copper", quantity=1.0, unit="kg",
                          ecoinvent_activity=None, path=["End of Life", "Copper"]),
    ]
    with pytest.raises(HTTPException) as e:
        _refuse_on_unlinked("BEV-LFP", mats, "all")
    d = e.value.detail
    assert e.value.status_code == 422
    assert d["error"] == "unlinked_materials"
    assert d["unlinked_count"] == 2
    assert "Steel frame" in d["message"] and "Copper" in d["message"]
    assert "Manufacturing" in d["message"]          # names WHERE, not just what
    assert {r["node_id"] for r in d["rows"]} == {"n1", "n2"}
    assert "Link them" in d["message"]              # and how to fix it


def test_a_fully_linked_scope_passes_through():
    from mapper.api.lca import _refuse_on_unlinked
    from mapper.models.bom_schemas import EcoinventLink, FlattenedMaterial

    ok = [FlattenedMaterial(
        node_id="n1", name="Steel", quantity=1.0, unit="kg",
        ecoinvent_activity=EcoinventLink(database="db", code="a" * 32, name="steel"),
        path=["Manufacturing", "Steel"])]
    _refuse_on_unlinked("BEV-LFP", ok, "all")       # must not raise


def test_BOTH_builders_refuse_not_just_the_single_product_one():
    """Contribution analysis is a SEPARATE demand builder. Guarding only the
    first would leave a silent-drop path open behind a guard that looks shut."""
    src = (BACKEND / "api" / "lca.py").read_text(encoding="utf-8")
    assert src.count("_refuse_on_unlinked(") >= 3   # 1 def + 2 call sites


# ── 2. unmapped cohort ───────────────────────────────────────────────────────


def test_the_unmapped_and_dangling_errors_are_DIFFERENT_types():
    """The fixes differ -- add a mapping vs re-link an existing one -- so a
    caller must be able to tell them apart without parsing prose."""
    assert UnmappedCohortError is not DanglingArchetypeError
    assert issubclass(UnmappedCohortError, ValueError)


def test_the_unmapped_message_names_the_cohort_and_distinguishes_itself():
    doc = UnmappedCohortError.__doc__ or ""
    assert "dangling" in doc.lower()
    src = (BACKEND / "core" / "dsm_lca_engine.py").read_text(encoding="utf-8")
    i = src.index("raise UnmappedCohortError")
    msg = src[i:i + 900]
    assert "{cohort_key!r}" in msg                  # names WHICH cohort
    assert "no longer exists" in msg.lower()        # says what it is NOT


def test_an_EMPTY_cohort_still_never_raises():
    """`count > 0` is checked before the mapping lookup, so a declared-but-
    empty cartesian cohort contributes nothing and is not an error."""
    src = (BACKEND / "core" / "dsm_lca_engine.py").read_text(encoding="utf-8")
    body = src[src.index("for cohort_key, count in counts.items():"):]
    guard = body.index("if count <= 0:")
    lookup = body.index("mapping = self.mappings.get(cohort_key)")
    assert guard < lookup, "the empty-cohort skip must precede the mapping lookup"


# ── 3. stage name fall-through: WARN, never refuse ───────────────────────────


@pytest.mark.parametrize("name", [
    "Decommissioning", "Installation", "Construction", "Retirement",
    "Replacement", "Commissioning", "Transport", "Distribution",
    "Logistics", "Raw materials",
])
def test_an_unmatched_stage_name_still_RESOLVES(name):
    """It must not raise. These are all defensible stage names outside the
    automotive vocabulary the keyword table encodes."""
    assert not stage_name_matches_a_keyword(name)
    assert stage_to_scope(name, None) == "inflows"


@pytest.mark.parametrize("name,scope", [
    ("Manufacturing", "inflows"), ("Use Phase", "stock"),
    ("Maintenance", "stock"), ("End of Life", "outflows"),
    ("Operation", "stock"), ("Disposal", "outflows"),
])
def test_the_known_vocabulary_is_unchanged(name, scope):
    assert stage_name_matches_a_keyword(name)
    assert stage_to_scope(name, None) == scope


def test_an_explicit_scope_beats_the_name_and_suppresses_the_warning():
    assert stage_to_scope("Decommissioning", "outflows") == "outflows"
    rows = [BOMValidationRow(
        archetype="Turbine", stage="Decommissioning", row_idx=2, name="Steel",
        database=None, code=None, stage_scope="outflows")]
    assert not [i for i in validate_bom(rows, project_name="p").issues
                if i.error_type == "stage_scope_defaulted"]


def test_the_fall_through_now_WARNS_in_the_validation_report():
    rows = [BOMValidationRow(
        archetype="Turbine", stage="Decommissioning", row_idx=2, name="Steel",
        database=None, code=None, stage_scope=None)]
    rep = validate_bom(rows, project_name="p")
    hit = [i for i in rep.issues if i.error_type == "stage_scope_defaulted"]
    assert len(hit) == 1
    assert hit[0].severity == "warning"             # never an error
    assert rep.error_rows == 0
    assert "Decommissioning" in hit[0].message and "inflows" in hit[0].message
    assert "Scope" in hit[0].message                # and the fix


def test_it_warns_ONCE_per_stage_not_once_per_row():
    """A 250-row stage would otherwise raise 250 identical warnings."""
    rows = [BOMValidationRow(archetype="Turbine", stage="Decommissioning",
                             row_idx=i, name=f"part {i}", database=None, code=None)
            for i in range(2, 30)]
    rep = validate_bom(rows, project_name="p")
    assert len([i for i in rep.issues if i.error_type == "stage_scope_defaulted"]) == 1


# ── 4. undefined lever, only when levers are in play ─────────────────────────


def _tagged(lever: str = "p_bp") -> BOMNode:
    return BOMNode(id="n1", name="cells", node_type="material",
                   quantity=100.0, unit="kg", global_levers=[lever])


def test_the_three_way_identity_survives_untouched():
    """p_bp=1.0 == absent == levers not in play == the pre-lever engine."""
    node, plain = _tagged(), BOMNode(id="n2", name="cells", node_type="material",
                                     quantity=100.0, unit="kg")
    assert resolve_quantity(node, 2030, {"p_bp": 1.0}, levers_in_play=True) == 100.0
    assert resolve_quantity(node, 2030, {}) == 100.0            # not in play
    assert resolve_quantity(node, 2030, None) == 100.0          # not in play
    assert resolve_quantity(plain, 2030) == 100.0


def test_an_undefined_lever_raises_ONLY_when_levers_are_in_play():
    with pytest.raises(UndefinedLeverError) as e:
        resolve_quantity(_tagged("p_typo"), 2030, {"p_bp": 0.9}, levers_in_play=True)
    assert "p_typo" in str(e.value)                  # names the lever
    assert "p_bp" in str(e.value)                    # and what IS defined
    # identical call, levers not in play -> identity, no raise
    assert resolve_quantity(_tagged("p_typo"), 2030, {"p_bp": 0.9}) == 100.0


def test_an_EMPTY_table_in_play_still_raises_which_is_the_point_of_the_flag():
    """Inferring the flag from `lever_values` being non-empty would make this
    case silently neutral. The flag is a property of the CALL, so an empty but
    PRESENT table is still a table, and a lever missing from it is undefined."""
    with pytest.raises(UndefinedLeverError):
        resolve_quantity(_tagged("p_bp"), 2030, {}, levers_in_play=True)


def test_the_flag_is_never_inferred_from_the_dict():
    src = (BACKEND / "core" / "bom_engine.py").read_text(encoding="utf-8")
    body = src[src.index("def _apply_global_levers("):src.index("def resolve_quantity(")]
    assert "if lever_values:" not in body, "in-play must not be inferred from truthiness"
    assert "levers_in_play" in body


def test_the_engine_states_the_flag_from_the_table_not_the_dict():
    src = (BACKEND / "core" / "dsm_lca_engine.py").read_text(encoding="utf-8")
    assert src.count("levers_in_play=self._param_table is not None") == 2


# ── The class guard ──────────────────────────────────────────────────────────

#: A bare `continue` immediately after a falsy check on one of these lookups is
#: the shape all four shared. Matching the CHECK rather than the name of any one
#: variable is what makes this catch the next instance in a new file.
_SILENT = re.compile(
    r"^\s*if\s+(?:not\s+)?(?:\w+\s*(?:is\s+None|is\s+not\s+None)?|"
    r"\w+\.get\([^)]*\)|\w+\s*not\s+in\s+\w+)\s*:\s*$"
)

#: Declared, with a reason. Anything not here that skips a calculation input
#: must raise or warn.
_ALLOWED: dict[tuple[str, str], str] = {
    ("core/dsm_lca_engine.py", "if count <= 0:"):
        "an empty cohort genuinely contributes nothing; raising would make a "
        "sparse fleet unrunnable",
    ("api/lca.py", "if m.ecoinvent_activity is None:"):
        "reached only AFTER _refuse_on_unlinked has already raised on any "
        "unlinked row; kept as a type-narrowing no-op",
}


def _skip_sites(path: Path) -> list[tuple[int, str, str]]:
    """`if <falsy check>: continue` pairs, with the checked expression."""
    out = []
    lines = path.read_text(encoding="utf-8").splitlines()
    for i, line in enumerate(lines):
        if not _SILENT.match(line):
            continue
        nxt = lines[i + 1] if i + 1 < len(lines) else ""
        if nxt.strip() == "continue":
            out.append((i + 1, line.strip(), nxt.strip()))
    return out


def test_no_calculation_path_silently_continues_past_a_missing_input():
    """The class guard: a missing LINK, MAPPING, STAGE MATCH or LEVER must
    raise or warn -- never be stepped over."""
    watched = [
        "api/lca.py", "core/dsm_lca_engine.py", "core/bom_engine.py",
        "core/material_flow_engine.py",
    ]
    findings = []
    for rel in watched:
        f = BACKEND / rel
        for lineno, check, _ in _skip_sites(f):
            if (rel, check) in _ALLOWED:
                continue
            if not re.search(
                r"ecoinvent_activity|mapping|mappings|archetype|lever|scope|link",
                check, re.IGNORECASE,
            ):
                continue          # unrelated skip (a blank row, a zero amount)
            findings.append(f"{rel}:{lineno}: {check} -> continue")
    assert not findings, (
        "a calculation input is being skipped in silence:\n" + "\n".join(findings)
    )


def test_material_flows_closed_the_SAME_two_paths_as_the_lca_engine():
    """Found by the sweep above, not by the brief.

    `material_flow_engine` carried both the unmapped-cohort skip AND the
    dangling-archetype skip -- the second being the original WP5 shape, still
    open there after `dsm_lca_engine` closed it. One engine raised while its
    sibling stepped over the same condition on the same data, and Material
    Flows numbers are read and exported like any other.
    """
    src = (BACKEND / "core" / "material_flow_engine.py").read_text(encoding="utf-8")
    assert "raise UnmappedCohortError" in src
    assert "raise DanglingArchetypeError" in src
    assert not _skip_sites(BACKEND / "core" / "material_flow_engine.py") or all(
        "mapping" not in c and "arc" not in c
        for _, c, _ in _skip_sites(BACKEND / "core" / "material_flow_engine.py")
    )


def test_the_class_guard_would_catch_a_REINTRODUCED_continue(tmp_path):
    """Anti-vacuity, in both directions."""
    bad = tmp_path / "bad.py"
    bad.write_text(
        "for k, v in counts.items():\n"
        "    mapping = self.mappings.get(k)\n"
        "    if not mapping:\n"
        "        continue\n",
        encoding="utf-8",
    )
    assert _skip_sites(bad), "the guard would not have caught the original bug"

    good = tmp_path / "good.py"
    good.write_text(
        "for k, v in counts.items():\n"
        "    mapping = self.mappings.get(k)\n"
        "    if not mapping:\n"
        "        raise UnmappedCohortError(k)\n",
        encoding="utf-8",
    )
    assert not _skip_sites(good)


# ── The SECOND shape: a lookup miss returning a default ──────────────────────
#
# The `continue` sweep above is necessary and NOT sufficient. It reported zero
# for `subsystem_engine`, which had two real defects — because neither was a
# skipped iteration. Both were a silent VALUE:
#
#   allowed = {d: set(v) for d, v in driver_filter.items() if v}
#   if not allowed:
#       return float(sum(year_result.stock.values()))   # the WHOLE stock
#
#   if all(cohort_dict.get(dim) in vals for dim, vals in allowed.items()):
#                        # ^ .get() -> None for a dimension that is gone
#
# and path 1's original was a third:
#
#   linked = [m for m in all_materials if m.ecoinvent_activity is not None]
#
# All three answer a failed lookup with a plausible default instead of raising.

#: The vocabulary these lookups actually use. `cohort` and `dim` are in it
#: because the defect that motivated this shape reads `cohort_dict.get(dim)` --
#: neither word is "mapping" or "dimension", and leaving them out made the
#: sweep miss the very line it was written for.
_WATCHED_CONCEPT = re.compile(
    r"ecoinvent_activity|mappings?|archetypes?|lever|driver_filter"
    r"|dimension|cohort|\bdim\b|\blink\b",
    re.IGNORECASE,
)


def _mentions_watched(node: ast.AST) -> bool:
    return bool(_WATCHED_CONCEPT.search(ast.unparse(node)))


def _keeps_the_present_ones(test: ast.AST) -> bool:
    """Does this comprehension ``if`` KEEP the valid rows, thereby dropping the
    invalid ones?

    That sign is the whole distinction, and it is checkable:

    * ``if m.ecoinvent_activity is not None`` / ``if vals`` -- keeps what
      resolved, DROPS what did not. This is the defect shape.
    * ``if m.ecoinvent_activity is None`` / ``if aid not in mapping`` --
      COLLECTS the offenders, which is what a guard does before raising on
      them. Never a defect, and flagging it would make the sweep fire on its
      own fixes.
    """
    if isinstance(test, ast.Compare) and len(test.ops) == 1:
        op = test.ops[0]
        if isinstance(op, ast.IsNot):                 # `is not None`
            return True
        if isinstance(op, (ast.Is, ast.NotIn)):       # `is None`, `not in`
            return False
        return False
    if isinstance(test, ast.UnaryOp) and isinstance(test.op, ast.Not):
        return False                                  # `if not x` -- a domain
                                                      # filter, not a lookup
    return isinstance(test, (ast.Name, ast.Attribute))  # bare truthy keep


def _default_sites(path: Path) -> list[tuple[int, str]]:
    """Lines answering a failed lookup with a default instead of raising.

    AST, not regex, because the distinctions are STRUCTURAL. Two shapes:

    * a ``.get()`` with NO default whose result is consumed inline -- inside a
      comparison, a boolean, another call -- so a miss silently becomes
      ``None`` and flows on. ``x = d.get(k)`` on its own is not flagged: the
      caller still holds the miss, and whether they check it is the `continue`
      sweep's job. ``d.get(k, 0.0)`` is not flagged either: an explicit numeric
      default inside a running total means "nothing yet", which is correct.
    * a comprehension whose ``if`` KEEPS the resolved rows, thereby dropping
      the unresolved ones -- see ``_keeps_the_present_ones``. Covers list, set,
      dict and generator forms, which is why this is AST: the first version of
      this sweep was a regex over ``[...]`` and missed
      ``allowed = {dim: set(vals) ... if vals}`` entirely.
    """
    src = path.read_text(encoding="utf-8")
    tree = ast.parse(src)
    lines = src.splitlines()
    hits: set[int] = set()

    assigned_gets: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Assign, ast.AnnAssign)) and isinstance(
            getattr(node, "value", None), ast.Call
        ):
            assigned_gets.add(id(node.value))

    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "get"
            and len(node.args) < 2                    # no explicit default
            and id(node) not in assigned_gets         # not held by the caller
            and _WATCHED_CONCEPT.search(ast.unparse(node))
        ):
            hits.add(node.lineno)

        if isinstance(node, (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)):
            if not _WATCHED_CONCEPT.search(ast.unparse(node)):
                continue
            for gen in node.generators:
                if any(_keeps_the_present_ones(t) for t in gen.ifs):
                    hits.add(node.lineno)

    return [(n, lines[n - 1].strip()) for n in sorted(hits) if n <= len(lines)]


def test_the_second_shape_would_have_caught_all_THREE_historical_defects():
    """If it would not have caught these, it is the wrong shape.

    Verified against the exact lines that shipped, not paraphrases.
    """
    shipped = [
        # subsystem finding A -- empty filter -> the whole primary stock
        "    allowed = {dim: set(vals) for dim, vals in driver_filter.items() if vals}",
        # subsystem finding B -- .get() -> None for a dimension that is gone.
        # Carries its body: it is an `if`, and a lone `if` does not parse.
        "        if all(cohort_dict.get(dim) in vals for dim, vals in allowed.items()):\n"
        "            total += count",
        # path 1 -- the filtered comprehension that dropped unlinked rows
        "    linked = [m for m in all_materials if m.ecoinvent_activity is not None]",
    ]
    import tempfile

    for line in shipped:
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "x.py"
            # dedent: these are verbatim source lines, and `ast.parse` refuses
            # a lone indented statement
            f.write_text(textwrap.dedent(line) + "\n", encoding="utf-8")
            assert _default_sites(f), f"the second shape missed: {line.strip()}"


def test_the_second_shape_does_not_fire_on_the_corrected_forms():
    import tempfile

    clean = [
        "    total = sum(year_result.stock.values())",
        "        raise StaleDriverFilterError(f'gone: {dim_name}')",
        "    _refuse_on_unlinked(arc.name, all_materials, scope)",
        "    q = counts.get(year, 0.0)          # a COUNT, not a lookup of a link",
    ]
    for line in clean:
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "x.py"
            f.write_text(textwrap.dedent(line) + "\n", encoding="utf-8")
            assert not _default_sites(f), f"false positive on: {line.strip()}"


#: Declared, with a reason, exactly like `_ALLOWED` above. Four entries, and
#: each one has to say why the miss is not a dropped input.
_ALLOWED_DEFAULTS: dict[tuple[str, str], str] = {
    ("api/lca.py",
     "linked = [m for m in all_materials if m.ecoinvent_activity is not None]"):
        "reached only AFTER _refuse_on_unlinked has raised on any unlinked "
        "row, so nothing can be dropped here",
    ("core/subsystem_engine.py",
     "allowed = {dim: set(vals) for dim, vals in driver_filter.items() if vals}"):
        "an empty value list is refused at the WRITE boundary by "
        "validate_dependency_rule; the branch stays defined only for rules "
        "stored before that check existed",
    ("core/subsystem_engine.py",
     "if all(cohort_dict.get(dim) in vals for dim, vals in allowed.items()):"):
        "every key and label is validated against the primary dimensions "
        "ABOVE this line, so a .get miss here is a legitimate empty match "
        "(a declared label with no stock this year), not a stale reference",
    ("core/dsm_lca_engine.py",
     "r.dependent_archetype_id for r in subsystem.dependency_rules if r.dependent_archetype_id"):
        "builds the KNOWN-to-carry-stock set for the unmapped warning; a rule "
        "with no target cannot be unmapped, and a blank target is refused at "
        "save by validate_dependency_rule",
}


def _stmt_text(path: Path, lineno: int, span: int = 4) -> str:
    """The few lines from `lineno` — a comprehension can wrap, and the sweep
    reports the line it starts on."""
    lines = path.read_text(encoding="utf-8").splitlines()
    return " ".join(l.strip() for l in lines[lineno - 1: lineno - 1 + span])


def test_no_undeclared_lookup_default_in_a_calculation_path():
    watched = [
        "api/lca.py", "core/dsm_lca_engine.py", "core/bom_engine.py",
        "core/material_flow_engine.py", "core/subsystem_engine.py",
        "core/aesa_engine.py",
    ]
    findings = []
    for rel in watched:
        for lineno, line in _default_sites(BACKEND / rel):
            if (rel, line) in _ALLOWED_DEFAULTS:
                continue
            # a multi-line comprehension reports its first line; match the
            # declared body text anywhere in the statement instead
            if any(rel == r and body in _stmt_text(BACKEND / rel, lineno)
                   for (r, body) in _ALLOWED_DEFAULTS):
                continue
            findings.append(f"{rel}:{lineno}: {line}")
    assert not findings, (
        "a failed lookup answers with a default instead of raising:\n"
        + "\n".join(findings)
    )


def test_every_allowed_default_entry_still_exists():
    for (rel, line) in _ALLOWED_DEFAULTS:
        src = (BACKEND / rel).read_text(encoding="utf-8")
        assert line in src, f"{rel} no longer contains {line!r} — drop the entry"


def test_every_allowed_entry_still_exists():
    """A declared exemption that has moved is a stale exemption."""
    for (rel, check) in _ALLOWED:
        src = (BACKEND / rel).read_text(encoding="utf-8")
        assert check in src, f"{rel} no longer contains {check!r} — drop the entry"
