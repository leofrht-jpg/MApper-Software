# SPDX-License-Identifier: MPL-2.0
"""The material-name table's scope: what it lists, what it counts, and the
splice that keeps it consistent with the impact-weighted denominator.

The composed cases are synthetic ON PURPOSE. Composition shipped but no project
uses it yet, so relying on real data would leave the splice untested until the
day someone composes something -- which is exactly when a silent divergence
would surface.
"""

from __future__ import annotations

import asyncio

import pytest

from mapper.api import monte_carlo as mc
from mapper.models.bom_schemas import (
    Archetype, ArchetypeInclude, BOMNode, EcoinventLink,
)


def _mat(name, qty=1.0, expr=None, code=None):
    return BOMNode(
        id=f"n-{name}", name=name, node_type="material", quantity=qty,
        unit="kg", quantity_expression=expr,
        ecoinvent_activity=EcoinventLink(database="db", code=code or f"c-{name}", name=name),
    )


def _arc(aid, name, materials, includes=None):
    return Archetype(
        id=aid, name=name,
        includes=[ArchetypeInclude(archetype_id=i, quantity=q) for i, q in (includes or [])],
        bom=[BOMNode(id=f"s-{aid}", name="Manufacturing", node_type="component",
                     quantity=1.0, unit="piece", scope="inflows", children=materials)],
    )


@pytest.fixture
def registry(monkeypatch):
    def _install(arcs: dict):
        monkeypatch.setattr(mc, "_project_scoring_scope", mc._project_scoring_scope)
        from mapper.api import bom as bom_api
        monkeypatch.setattr(bom_api, "_proj_archetypes", lambda: arcs)
        return arcs
    return _install


# ── (1) the splice ────────────────────────────────────────────────────────────
#
# HONEST SCOPE OF THIS FIX. The project-wide totals do NOT change: an
# ``ArchetypeInclude`` references an archetype id, so every child is itself a
# registered archetype and its materials were already counted on their own
# pass. A first version of these tests asserted otherwise and passed with the
# splice REMOVED -- vacuous, for exactly that reason.
#
# What the splice fixes is PER-ARCHETYPE reach and the shared walk: the
# impact-weighted denominator has always been spliced, so the two sides now
# derive from one function instead of two that agreed by coincidence.


def test_the_spliced_walk_reaches_a_child_s_materials(registry):
    """Per archetype, which is where the splice is observable."""
    child = _arc("child", "Battery Pack", [_mat("Cathode active material")])
    parent = _arc("parent", "Composed EV", [_mat("Glider")], includes=[("child", 2.0)])
    arcs = {"child": child, "parent": parent}

    own: set[str] = set()
    for root in parent.bom:
        mc._collect_names(root, own, set(), 0, 0)
    assert own == {"Glider"}, "the parent's own tree does not contain the child's rows"

    spliced: set[str] = set()
    for root in mc._spliced_roots(parent, arcs):
        mc._collect_names(root, spliced, set(), 0, 0)
    assert spliced == {"Glider", "Cathode active material"}


def test_project_totals_are_unchanged_by_the_splice(registry):
    """Stated as a test so nobody later 'fixes' a count that was never wrong.

    The child is its own archetype, so its materials appear on its own pass
    whether or not the parent is spliced.
    """
    child = _arc("child", "Battery Pack", [_mat("Cathode active material")])
    parent = _arc("parent", "Composed EV", [_mat("Glider")], includes=[("child", 2.0)])
    registry({"child": child, "parent": parent})
    scope = asyncio.run(mc.list_project_materials())
    assert set(scope.materials) == {"Glider", "Cathode active material"}
    # ...and the child's row is counted ONCE per archetype it appears in, so
    # splicing the parent double-counts ROWS while leaving NAMES alone.
    assert scope.literal_rows == 3   # child's own + parent's Glider + spliced copy


def test_a_dangling_include_degrades_rather_than_taking_the_list_down(registry):
    """Compute reports a dangling reference loudly; this endpoint must still
    return the archetype's own rows rather than 500."""
    parent = _arc("parent", "Composed EV", [_mat("Glider")], includes=[("gone", 1.0)])
    registry({"parent": parent})
    scope = asyncio.run(mc.list_project_materials())
    assert scope.materials == ["Glider"]


# ── the denominator mismatch ──────────────────────────────────────────────────


def test_count_and_coverage_use_the_SAME_spliced_row_set(registry):
    """The mismatch found alongside the splice bug: the count walked the
    unspliced tree while impact_share came from the spliced demand, so on a
    composed archetype they were computed over different rows.

    Asserted structurally: coverage derives its project name set from the very
    function the materials list returns, so the two cannot diverge again.
    """
    import inspect

    src = inspect.getsource(mc.get_pedigree_coverage)
    assert "_project_scoring_scope()" in src, (
        "coverage must reuse the spliced scope walk, not re-derive names"
    )
    # And no independent walk survives in it.
    assert "for root in arc.bom" not in src

    child = _arc("child", "Battery Pack", [_mat("Cathode active material")])
    parent = _arc("parent", "Composed EV", [_mat("Glider")], includes=[("child", 2.0)])
    registry({"child": child, "parent": parent})
    assert set(asyncio.run(mc.list_project_materials()).materials) == {
        "Cathode active material", "Glider"
    }


# ── (2) the counts that explain a short list ──────────────────────────────────


def test_expression_rows_are_counted_not_listed(registry):
    """They can never carry their own score, so they are excluded from the
    list -- but a bare short list gives no hint why."""
    a = _arc("a", "Parameterised", [
        _mat("PV electricity"),
        _mat("Cathode", expr="mass / fu_kwh"),
        _mat("Anode", expr="mass2 / fu_kwh"),
        _mat("Housing", expr="mass3 / fu_kwh"),
    ])
    registry({"a": a})
    scope = asyncio.run(mc.list_project_materials())
    assert scope.materials == ["PV electricity"]
    assert scope.literal_rows == 1
    assert scope.expression_rows == 3
    assert scope.expression_names == 3
    assert scope.archetypes == 1


def test_the_counts_describe_a_literal_project_too(registry):
    """The message must be able to say the OPPOSITE thing: on a mostly-literal
    project the table IS where the uncertainty lives."""
    a = _arc("a", "Literal", [_mat("Steel"), _mat("Aluminium"), _mat("Glass")])
    registry({"a": a})
    scope = asyncio.run(mc.list_project_materials())
    assert len(scope.materials) == 3
    assert scope.expression_rows == 0


def test_a_name_recurring_across_archetypes_counts_rows_but_one_name(registry):
    """148 names over 914 rows is the whole reason the table is tractable."""
    a1 = _arc("a1", "One", [_mat("Steel frame")])
    a2 = _arc("a2", "Two", [_mat("Steel frame")])
    registry({"a1": a1, "a2": a2})
    scope = asyncio.run(mc.list_project_materials())
    assert scope.materials == ["Steel frame"]
    assert scope.literal_rows == 2
