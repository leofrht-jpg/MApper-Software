# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Pure-Python BOM engine.

Walks the recursive ``BOMNode`` tree, computes effective per-unit material
quantities (multiplicative cascade through parent quantities), and aggregates
per-cohort demand into LCA-ready vectors.

No FastAPI, no brightway2 imports here — those live in api/bom.py and the
DSM × LCA pipeline.
"""
from __future__ import annotations

import uuid
from typing import Iterable

from mapper.models.bom_schemas import (
    INCLUDE_KEY_SEP,
    MAX_INCLUDE_DEPTH,
    Archetype,
    ArchetypeTimeline,
    ArchetypeTimelineRow,
    BOMNode,
    FlattenedMaterial,
)
from mapper.models.interpolation import interpolate_anchors


KG_UNITS = {"kg", "kgs", "kilogram", "kilograms"}


# ── ID assignment & tree utilities ───────────────────────────────────────────


def assign_node_ids(node: BOMNode) -> BOMNode:
    """Recursively assign UUIDs to any node missing an id."""
    if not node.id:
        node.id = str(uuid.uuid4())
    if node.children:
        for child in node.children:
            assign_node_ids(child)
    return node


def find_node(root: BOMNode, node_id: str) -> BOMNode | None:
    if root.id == node_id:
        return root
    if root.children:
        for child in root.children:
            found = find_node(child, node_id)
            if found is not None:
                return found
    return None


def find_parent(root: BOMNode, node_id: str) -> BOMNode | None:
    if root.children:
        for child in root.children:
            if child.id == node_id:
                return root
            parent = find_parent(child, node_id)
            if parent is not None:
                return parent
    return None


def remove_node(root: BOMNode, node_id: str) -> bool:
    """Remove a node by id. Returns True if removed. Cannot remove the root."""
    parent = find_parent(root, node_id)
    if parent is None or not parent.children:
        return False
    parent.children = [c for c in parent.children if c.id != node_id]
    return True


def add_child(root: BOMNode, parent_id: str, child: BOMNode) -> bool:
    """Add ``child`` (with new ids assigned) under ``parent_id``."""
    parent = find_node(root, parent_id)
    if parent is None:
        return False
    if parent.node_type != "component":
        # Materials cannot have children — promote the parent to component.
        parent.node_type = "component"
        parent.ecoinvent_activity = None
    if parent.children is None:
        parent.children = []
    assign_node_ids(child)
    parent.children.append(child)
    return True


# ── Multi-root helpers ───────────────────────────────────────────────────────
# An archetype owns a list[BOMNode] — each root is a life cycle stage
# (Body, Battery Pack, Maintenance, End of Life, …). The helpers below operate
# on that list, delegating to the single-tree helpers above.


def assign_ids_to_roots(roots: list[BOMNode]) -> list[BOMNode]:
    for r in roots:
        assign_node_ids(r)
    return roots


def find_node_in_roots(roots: list[BOMNode], node_id: str) -> BOMNode | None:
    for r in roots:
        found = find_node(r, node_id)
        if found is not None:
            return found
    return None


def find_root_containing(roots: list[BOMNode], node_id: str) -> BOMNode | None:
    """Return the root node whose subtree contains ``node_id``, else None."""
    for r in roots:
        if find_node(r, node_id) is not None:
            return r
    return None


def remove_node_in_roots(roots: list[BOMNode], node_id: str) -> bool:
    """Remove a node from the list of roots. Removes top-level roots too."""
    # Top-level root?
    for i, r in enumerate(roots):
        if r.id == node_id:
            roots.pop(i)
            return True
    # Otherwise descend into each root.
    for r in roots:
        if remove_node(r, node_id):
            return True
    return False


def add_child_in_roots(
    roots: list[BOMNode], parent_id: str | None, child: BOMNode
) -> bool:
    """Add ``child`` under ``parent_id``. If ``parent_id`` is None, append as a new root."""
    if parent_id is None:
        assign_node_ids(child)
        roots.append(child)
        return True
    for r in roots:
        if add_child(r, parent_id, child):
            return True
    return False


def iter_materials(node: BOMNode) -> Iterable[BOMNode]:
    """Yield every material leaf in the subtree."""
    if node.node_type == "material":
        yield node
        return
    if node.children:
        for child in node.children:
            yield from iter_materials(child)


def iter_all_materials(roots: list[BOMNode]) -> Iterable[BOMNode]:
    for r in roots:
        yield from iter_materials(r)


def material_count(node: BOMNode) -> int:
    return sum(1 for _ in iter_materials(node))


def unlinked_count(node: BOMNode) -> int:
    return sum(1 for m in iter_materials(node) if m.ecoinvent_activity is None)


def material_count_total(roots: list[BOMNode]) -> int:
    return sum(1 for _ in iter_all_materials(roots))


def unlinked_count_total(roots: list[BOMNode]) -> int:
    return sum(1 for m in iter_all_materials(roots) if m.ecoinvent_activity is None)


def validation_error_count(roots: list[BOMNode]) -> int:
    """Count materials marked as validation errors at upload time (Patch 2).

    Read straight from each node's persisted ``validation_status`` — we do NOT
    re-run the bw2 validator at compute time. See "Archetype validation
    lifecycle" in CLAUDE.md for the rationale."""
    return sum(1 for m in iter_all_materials(roots) if m.validation_status == "error")


# ── Flatten ──────────────────────────────────────────────────────────────────


def flatten_bom(node: BOMNode, parent_quantity: float = 1.0, path: list[str] | None = None) -> list[FlattenedMaterial]:
    """Walk the tree and return one FlattenedMaterial per material leaf.

    ``effective_quantity = product of every parent quantity down the tree``.
    The root's own quantity is included in the cascade (so an archetype with
    quantity 2 doubles every leaf).
    """
    path = path or []
    effective = parent_quantity * float(node.quantity or 0.0)

    if node.node_type == "material":
        return [
            FlattenedMaterial(
                node_id=node.id or "",
                name=node.name,
                quantity=effective,
                unit=node.unit,
                ecoinvent_activity=node.ecoinvent_activity,
                path=path + [node.name],
                quantity_expression=node.quantity_expression,
                uncertainty=node.uncertainty,
            )
        ]

    out: list[FlattenedMaterial] = []
    if node.children:
        for child in node.children:
            out.extend(flatten_bom(child, effective, path + [node.name]))
    return out


def flatten_roots(roots: list[BOMNode]) -> list[FlattenedMaterial]:
    """Flatten every root's subtree and concatenate the material lists."""
    out: list[FlattenedMaterial] = []
    for r in roots:
        out.extend(flatten_bom(r))
    return out


# ── Stage → DSM scope mapping ────────────────────────────────────────────────
# Each lifecycle stage (a root BOMNode) maps to exactly one scope:
#   Manufacturing / assembly → inflows (produced at birth)
#   Use Phase / operation    → stock   (consumed every year of life)
#   Maintenance / service    → stock   (consumed every year of life)
#   End of Life / disposal   → outflows (processed at death)
#
# The mapping is keyword-based and case-insensitive so different naming
# conventions across projects don't silently misattribute impacts.


_STAGE_KEYWORDS: list[tuple[tuple[str, ...], str]] = [
    (("manufactur", "production", "assembly", "fabricat"), "inflows"),
    (("use phase", "use-phase", "operation", "driving", "usage"), "stock"),
    (("maintenance", "service", "repair"), "stock"),
    (("end of life", "end-of-life", "eol", "disposal", "recycl", "scrap", "dismantle"), "outflows"),
]

_VALID_SCOPES = frozenset({"inflows", "stock", "outflows"})


class ArchetypeCompositionError(ValueError):
    """A reference that cannot be resolved: dangling, cyclic, or too deep.

    Always raised, never swallowed. A dangling reference that silently shrinks
    a number is the WP5 failure mode, and composition adds a second class of
    dangling id on top of the cohort mapping's.
    """


def _child_stage_name(child_name: str, stage_name: str) -> str:
    """Name a spliced stage so its rows stay distinct from the parent's.

    DSM aggregation keys materials by NAME (``mat_qty[mat.name]``,
    ``material_totals[name]``), so a "Steel frame" in the parent and one in a
    child would otherwise merge into a single contribution line. Reuses the
    subsystem separator rather than inventing a second scheme, so a reader can
    recover the source with ``key.split(INCLUDE_KEY_SEP)``.
    """
    return f"{child_name}{INCLUDE_KEY_SEP}{stage_name}"


def material_key(m: FlattenedMaterial) -> str:
    """Aggregation/display key for a flattened material, source-qualified.

    DSM aggregation keys by material NAME (``mat_qty[mat.name]``,
    ``material_totals[name]``), so a "Steel frame" in the parent and one in an
    included child would merge into a single contribution line. Renaming the
    spliced STAGE is not enough -- the leaf name is what those dicts key on.

    Qualifies the leaf with the NEAREST enclosing include, so a grandchild
    reports the grandchild rather than the child. Uses the subsystem separator
    rather than a second scheme, so a reader recovers the source with
    ``key.split(INCLUDE_KEY_SEP)``. Materials outside any include are returned
    unchanged, which keeps every existing key byte-identical.
    """
    for seg in reversed(m.path or []):
        if INCLUDE_KEY_SEP in seg:
            return f"{seg.split(INCLUDE_KEY_SEP, 1)[0]}{INCLUDE_KEY_SEP}{m.name}"
    return m.name


def splice_includes(
    arc: Archetype,
    registry: dict[str, Archetype],
    *,
    _depth: int = 0,
    _path: tuple[str, ...] = (),
) -> Archetype:
    """Return ``arc`` with every ``includes`` reference spliced into its BOM.

    Stage-by-stage, MATCHED ON SCOPE: a child's Manufacturing rows land in the
    parent's Manufacturing and its End of Life in the parent's End of Life. A
    child that spans several stages (Battery Pack carries both) must not
    collapse into whichever stage the reference happened to sit in.

    Splicing is EAGER -- done at resolution time, upstream of every flatten
    cache -- so the child's content is baked into the parent's tree before any
    cache key is computed and no cache needs to learn about references.

    The child's stage roots keep their own ``basis``. They become non-root
    nodes, which is why basis must be readable below the root; see
    ``resolve_stage_amount`` for the multiplier side of that.

    Raises :class:`ArchetypeCompositionError` on a dangling id, a cycle, or a
    chain deeper than ``MAX_INCLUDE_DEPTH``.
    """
    if not getattr(arc, "includes", None):
        return arc

    here = _path + (arc.id or arc.name,)
    if _depth >= MAX_INCLUDE_DEPTH:
        raise ArchetypeCompositionError(
            f"Archetype includes nested deeper than MAX_INCLUDE_DEPTH="
            f"{MAX_INCLUDE_DEPTH}: {' -> '.join(here)}"
        )

    roots = [r.model_copy(deep=True) for r in arc.bom]
    by_scope: dict[str, BOMNode] = {}
    for r in roots:
        by_scope.setdefault(stage_to_scope(r.name, r.scope), r)

    for inc in arc.includes:
        if inc.archetype_id in here:
            raise ArchetypeCompositionError(
                f"Archetype include cycle: "
                f"{' -> '.join(here + (inc.archetype_id,))}"
            )
        child = registry.get(inc.archetype_id)
        if child is None:
            raise ArchetypeCompositionError(
                f"Archetype '{arc.name}' includes archetype id "
                f"'{inc.archetype_id}', which does not exist in this project. "
                f"Cross-project references are not supported."
            )
        child = splice_includes(child, registry, _depth=_depth + 1, _path=here)

        for cr in child.bom:
            scope = stage_to_scope(cr.name, cr.scope)
            target = by_scope.get(scope)
            if target is None:
                # The parent has no stage in this scope yet -- give the child's
                # rows one rather than dropping them into an unrelated stage.
                target = BOMNode(
                    name=cr.name, node_type="component", quantity=1.0,
                    unit="piece", scope=scope, children=[],
                )
                roots.append(target)
                by_scope[scope] = target
            node = cr.model_copy(deep=True)
            node.id = None                       # re-minted by assign_node_ids
            node.name = _child_stage_name(child.name, cr.name)
            # The include quantity rides on the spliced node, so the existing
            # flatten cascade scales the child's whole subtree by it.
            node.quantity = float(inc.quantity or 1.0)
            node.quantity_expression = inc.quantity_expression
            # `basis` and `scope` are carried through untouched: the child's
            # rows keep the child's basis.
            target.children = list(target.children or []) + [node]

    return arc.model_copy(update={"bom": roots, "includes": []})


def flatten_root_with_amounts(
    root: BOMNode,
    stage_amounts: dict[str, float],
    basis_amounts: dict[str, float] | None = None,
) -> list[tuple[FlattenedMaterial, float]]:
    """Flatten one stage root, pairing each material with ITS OWN multiplier.

    Ordinarily every material in a stage takes that stage root's amount. But a
    spliced child stage sits BELOW the root while carrying its own ``basis``,
    and the child's basis must win -- a per-year child under a per-unit parent
    stage still scales with the lifetime. So the multiplier is inherited down
    the tree and overridden by the nearest ancestor that declares a basis,
    excluding the root itself (whose amount is already in ``stage_amounts``).

    ``basis_amounts`` is ``{"per_unit": 1.0, "per_year": <lifetime>}``. Absent,
    every material takes the root's amount -- byte-identical to the
    pre-composition behaviour.

    Mirrors :func:`flatten_bom`'s cascade exactly; the pairing is the only
    addition.
    """
    base = float(stage_amounts.get(root.name, 1.0))
    out: list[tuple[FlattenedMaterial, float]] = []

    def walk(node: BOMNode, parent_quantity: float, path: list[str], amount: float) -> None:
        effective = parent_quantity * float(node.quantity or 0.0)
        if node is not root and node.basis and basis_amounts:
            override = basis_amounts.get(node.basis)
            if override is not None:
                amount = float(override)
        if node.node_type == "material":
            out.append((
                FlattenedMaterial(
                    node_id=node.id or "",
                    name=node.name,
                    quantity=effective,
                    unit=node.unit,
                    ecoinvent_activity=node.ecoinvent_activity,
                    path=path + [node.name],
                    quantity_expression=node.quantity_expression,
                    uncertainty=node.uncertainty,
                ),
                amount,
            ))
            return
        for child in node.children or []:
            walk(child, effective, path + [node.name], amount)

    walk(root, 1.0, [], base)
    return out


def stage_name_matches_a_keyword(stage_name: str) -> bool:
    """Whether the name resolves by the keyword table at all.

    Split out so callers can DETECT the fall-through without re-implementing
    the match. ``stage_to_scope`` cannot report it in its return value -- it
    returns a scope -- and a second copy of the matching rule would drift.
    """
    name = (stage_name or "").lower().strip()
    return any(any(kw in name for kw in kws) for kws, _ in _STAGE_KEYWORDS)


def stage_to_scope(stage_name: str, explicit_scope: str | None = None) -> str:
    """Classify a stage into ``"inflows" | "stock" | "outflows"``.

    When ``explicit_scope`` is set on the stage node, it takes priority and the
    name is ignored. Otherwise the stage name is matched against a keyword
    table; an unmatched name defaults to ``"inflows"``.

    THE DEFAULT IS DELIBERATE, and this is the one silent path of the four that
    should not raise. The keyword table encodes an automotive vocabulary, and
    MApper is a general-purpose tool: ``Decommissioning``, ``Installation``,
    ``Construction``, ``Retirement``, ``Replacement``, ``Commissioning``,
    ``Transport``, ``Distribution``, ``Logistics`` and ``Raw materials`` all
    match nothing today. Refusing would block a legitimate wind-farm or
    building project at import over a naming convention.

    What was wrong was that the fall-through was SILENT -- ``Decommissioning``
    is an obvious end-of-life stage counted at production, and nothing said so.
    So it now WARNS: ``validate_bom`` emits a ``stage_scope_defaulted`` warning
    beside ``unit_mismatch``, and the fix is one click, because an explicit
    ``scope`` on the stage root always wins over the name.
    """
    if explicit_scope and explicit_scope in _VALID_SCOPES:
        return explicit_scope
    name = (stage_name or "").lower().strip()
    for keywords, scope in _STAGE_KEYWORDS:
        if any(kw in name for kw in keywords):
            return scope
    return "inflows"


def filter_roots_by_scope(roots: list[BOMNode], scope: str) -> list[BOMNode]:
    """Return the subset of roots whose stage matches ``scope``.

    Each root's explicit ``scope`` field wins over keyword matching. Roots
    with no explicit scope fall back to the stage-name heuristic.
    ``scope="all"`` returns the roots unchanged. Unknown scope values raise.
    """
    if scope == "all":
        return list(roots)
    if scope not in _VALID_SCOPES:
        raise ValueError(f"Unknown scope: {scope!r}")
    return [r for r in roots if stage_to_scope(r.name, r.scope) == scope]


def stages_in_scope(roots: list[BOMNode], scope: str) -> list[str]:
    """Return the stage names that would be included for ``scope`` (dedup,
    preserves BOM order). Used for UI labelling and export breadcrumbs."""
    seen: set[str] = set()
    out: list[str] = []
    for r in filter_roots_by_scope(roots, scope):
        if r.name not in seen:
            seen.add(r.name)
            out.append(r.name)
    return out


def flatten_roots_for_scope(
    roots: list[BOMNode], scope: str
) -> list[FlattenedMaterial]:
    """Flatten only the stages matching ``scope``. Empty list when no stage
    matches (e.g. an archetype with no End of Life stage under scope='outflows')."""
    return flatten_roots(filter_roots_by_scope(roots, scope))


def flatten_roots_for_year_and_scope(
    roots: list[BOMNode], year: int, scope: str,
    lever_values: dict[str, float] | None = None,
    levers_in_play: bool = False,
) -> list[FlattenedMaterial]:
    """Year-aware + stage-filtered flatten. ``lever_values`` threads global-lever
    multipliers (e.g. ``p_bp``) down to ``resolve_quantity``; ``levers_in_play``
    states whether a resolved parameter table was supplied at all."""
    out: list[FlattenedMaterial] = []
    for r in filter_roots_by_scope(roots, scope):
        out.extend(flatten_bom_for_year(
            r, year, lever_values=lever_values, levers_in_play=levers_in_play))
    return out


def total_mass_kg(materials: list[FlattenedMaterial]) -> float:
    """Sum quantities of all materials whose unit is a kilogram variant."""
    return sum(m.quantity for m in materials if m.unit.lower() in KG_UNITS)


# ── Time-varying quantities ─────────────────────────────────────────────────
# Materials can carry a ``MaterialEvolution`` describing how their per-unit
# quantity changes over time. ``resolve_quantity`` returns the effective
# quantity for a given year; the year-aware flatten helpers propagate that
# through the multiplicative cascade the same way ``flatten_bom`` does.


class UndefinedLeverError(ValueError):
    """A node names a global lever that the resolved parameter table lacks.

    Raised only when levers are IN PLAY -- see ``levers_in_play`` below. A
    lever that does not exist multiplied silently by 1.0, which is the
    "works until it doesn't, then lies" shape: a typo'd or deleted parameter
    produces a plausible smaller number and nothing says so.
    """


def _apply_global_levers(
    node: BOMNode,
    quantity: float,
    lever_values: dict[str, float] | None,
    levers_in_play: bool = False,
) -> float:
    """Multiply ``quantity`` by each of ``node.global_levers`` resolved value.

    A node with no ``global_levers`` returns ``quantity`` unchanged (identity --
    non-tagged nodes are provably unaffected). This is the ``x p_bp(year)`` term
    of the composition, applied AFTER the MaterialEvolution factor already baked
    into ``quantity``.

    ``levers_in_play`` is an EXPLICIT flag, deliberately not inferred from
    ``lever_values``. There are two different situations and an empty dict
    cannot tell them apart:

    * **not in play** (the default): no parameter table is threaded through
      this call at all, so a lever cannot be looked up and resolves to 1.0.
      This is the documented three-way identity -- ``p_bp=1.0`` == absent ==
      untagged == the pre-lever engine -- and it is what makes lever tagging
      provably inert. Untouched.
    * **in play**: a resolved parameter table WAS threaded through, so every
      lever the project defines is present. A named lever missing from it names
      a parameter that does not exist, and that raises.

    Inferring the flag from ``lever_values`` being non-empty would work on
    today's data and become a false positive the first time a project has a
    parameter table with no entries. The distinction is a property of the CALL,
    not of the container's contents, so the caller states it.
    """
    levers = node.global_levers
    if not levers:
        return quantity
    values = lever_values or {}
    factor = 1.0
    for name in levers:
        if name in values:
            factor *= float(values[name])
            continue
        if levers_in_play:
            raise UndefinedLeverError(
                f"Node {node.name!r} is tagged with global lever {name!r}, which "
                f"is not a parameter in this project's table. Defined parameters: "
                f"{', '.join(sorted(values)) or '(none)'}. Remove the tag or add "
                f"the parameter -- an undefined lever used to multiply by 1.0 "
                f"silently, which is indistinguishable from a lever that is "
                f"genuinely neutral."
            )
        # Levers not in play: identity, as designed.
    return quantity * factor


def resolve_quantity(
    node: BOMNode, year: int, lever_values: dict[str, float] | None = None,
    levers_in_play: bool = False,
) -> float:
    """Return the effective per-unit quantity for ``node`` in ``year``.

    Falls back to ``node.quantity`` when no evolution is defined or the
    evolution is malformed (so callers never see NaN). Milestones outside the
    provided range are clamped to the nearest endpoint — we do not extrapolate.

    ``lever_values`` (name → resolved value at ``year``, from the Phase 2
    per-year parameter resolution) supplies the global-lever multipliers applied
    AFTER the evolution factor. When ``None`` (or the node carries no
    ``global_levers``) the result is byte-identical to the pre-lever engine.
    """
    base = float(node.quantity or 0.0)
    ev = node.evolution
    if ev is None or ev.method == "fixed":
        return _apply_global_levers(node, base, lever_values, levers_in_play)
    if ev.method == "learning_rate" and ev.learning_rate is not None:
        q = base * (1.0 + float(ev.learning_rate)) ** (int(year) - int(ev.base_year))
        return _apply_global_levers(node, q, lever_values, levers_in_play)
    if ev.method == "rebound_effect" and ev.rebound_rate is not None:
        # Same compounding math as learning_rate — the semantic difference is
        # only in labelling (rebound typically positive, LR typically negative).
        q = base * (1.0 + float(ev.rebound_rate)) ** (int(year) - int(ev.base_year))
        return _apply_global_levers(node, q, lever_values, levers_in_play)
    if ev.method == "milestones" and ev.milestones:
        # `interpolate_anchors` is the single implementation of MApper's
        # year-anchor rule — linear between anchors, clamped at both ends,
        # never extrapolated — shared with Parameter.keyframes and the AESA
        # per-principle sharing series. This branch used to be a fourth
        # hand-written copy of the same arithmetic.
        #
        # The `and ev.milestones` guard above is load-bearing and must stay:
        # an empty milestone list falls through to `base` (node.quantity),
        # whereas the helper raises on an empty anchor list — "no anchors" is
        # a caller bug there, not a value. Guarding here keeps the empty case
        # on its original fallback.
        q = interpolate_anchors(
            [(m.year, m.quantity) for m in ev.milestones], year,
        )
        return _apply_global_levers(node, q, lever_values, levers_in_play)
    return _apply_global_levers(node, base, lever_values, levers_in_play)


def flatten_bom_for_year(
    node: BOMNode,
    year: int,
    parent_quantity: float = 1.0,
    path: list[str] | None = None,
    lever_values: dict[str, float] | None = None,
    levers_in_play: bool = False,
) -> list[FlattenedMaterial]:
    """Year-aware variant of :func:`flatten_bom`. Uses ``resolve_quantity``.

    ``lever_values`` is threaded to ``resolve_quantity`` so global levers (e.g.
    ``p_bp``) multiply per-node quantities in the cascade. ``levers_in_play``
    travels with it and states whether a resolved parameter table was supplied
    at all -- see ``_apply_global_levers`` for why that cannot be inferred from
    the dict.
    """
    path = path or []
    effective = parent_quantity * resolve_quantity(node, year, lever_values, levers_in_play)

    if node.node_type == "material":
        return [
            FlattenedMaterial(
                node_id=node.id or "",
                name=node.name,
                quantity=effective,
                unit=node.unit,
                ecoinvent_activity=node.ecoinvent_activity,
                path=path + [node.name],
                quantity_expression=node.quantity_expression,
                uncertainty=node.uncertainty,
            )
        ]

    out: list[FlattenedMaterial] = []
    if node.children:
        for child in node.children:
            out.extend(flatten_bom_for_year(
                child, year, effective, path + [node.name], lever_values, levers_in_play))
    return out


def flatten_roots_for_year(roots: list[BOMNode], year: int) -> list[FlattenedMaterial]:
    out: list[FlattenedMaterial] = []
    for r in roots:
        out.extend(flatten_bom_for_year(r, year))
    return out


def has_evolution(roots: list[BOMNode]) -> bool:
    for m in iter_all_materials(roots):
        ev = m.evolution
        if ev is not None and ev.method != "fixed":
            return True
    return False


def _node_has_evolution(node: BOMNode) -> bool:
    ev = node.evolution
    return ev is not None and ev.method != "fixed"


def has_global_levers(roots: list[BOMNode]) -> bool:
    """True if any node in the tree (component OR material) opts into a global
    lever. Levers can tag a component (multiplying all its descendants via the
    cascade), so this walks all nodes, not only materials."""
    for n in iter_all_nodes(roots):
        if n.global_levers:
            return True
    return False


def generate_archetype_timeline(
    arc: Archetype, years: list[int]
) -> ArchetypeTimeline:
    """Flatten the archetype for each year and index by material ``node_id``.

    Two materials that share a node_id across years collapse into one row.
    ``total_mass_by_year`` only sums kg-like units.
    """
    years_sorted = sorted({int(y) for y in years})
    rows: dict[str, ArchetypeTimelineRow] = {}
    total_mass: dict[int, float] = {}

    for y in years_sorted:
        flat = flatten_roots_for_year(arc.bom, y)
        total_mass[y] = total_mass_kg(flat)
        for m in flat:
            row = rows.get(m.node_id)
            if row is None:
                # Find the underlying node to read evolution flag.
                node = find_node_in_roots(arc.bom, m.node_id)
                row = ArchetypeTimelineRow(
                    node_id=m.node_id,
                    name=m.name,
                    unit=m.unit,
                    path=m.path,
                    quantities={},
                    has_evolution=_node_has_evolution(node) if node is not None else False,
                )
                rows[m.node_id] = row
            row.quantities[y] = m.quantity

    return ArchetypeTimeline(
        archetype_id=arc.id or "",
        years=years_sorted,
        rows=list(rows.values()),
        total_mass_by_year=total_mass,
    )


# ── Demand vector ────────────────────────────────────────────────────────────


def compute_demand_vector(
    flat_bom: list[FlattenedMaterial],
    count: float,
    scaling_factor: float = 1.0,
) -> dict[tuple[str, str], dict]:
    """Convert a flattened BOM × cohort count × scaling factor into a
    brightway-ready demand.

    Keys are ``(database, code)`` tuples. Materials lacking an ecoinvent link
    are skipped (they don't contribute to LCA but the UI flags them).
    Multiple materials pointing at the same activity are summed.

    ``scaling_factor`` lets the caller inflate/deflate the BOM for a specific
    cohort (e.g., SUV = 1.5× base archetype).
    """
    out: dict[tuple[str, str], dict] = {}
    effective_multiplier = float(count) * float(scaling_factor)
    for m in flat_bom:
        if m.ecoinvent_activity is None:
            continue
        key = (m.ecoinvent_activity.database, m.ecoinvent_activity.code)
        amount = m.quantity * effective_multiplier
        if key in out:
            out[key]["amount"] += amount
            out[key]["material_names"].append(m.name)
        else:
            out[key] = {
                "amount": amount,
                "database": m.ecoinvent_activity.database,
                "code": m.ecoinvent_activity.code,
                "name": m.ecoinvent_activity.name,
                "material_names": [m.name],
            }
    return out


def aggregate_demand(
    per_cohort: dict[str, dict[tuple[str, str], dict]],
) -> dict[tuple[str, str], float]:
    """Sum amounts across cohorts → single demand vector per year."""
    out: dict[tuple[str, str], float] = {}
    for _, demand in per_cohort.items():
        for key, entry in demand.items():
            out[key] = out.get(key, 0.0) + entry["amount"]
    return out


# ── Validation ───────────────────────────────────────────────────────────────


def validate_bom(node: BOMNode) -> list[str]:
    """Return a list of human-readable validation issues. Empty = clean."""
    issues: list[str] = []
    if node.node_type == "material" and node.ecoinvent_activity is None:
        issues.append(f"Material '{node.name}' has no ecoinvent activity linked.")
    if node.node_type == "component":
        if not node.children:
            issues.append(f"Component '{node.name}' has no children.")
        else:
            for child in node.children:
                issues.extend(validate_bom(child))
    return issues


def validate_roots(roots: list[BOMNode]) -> list[str]:
    issues: list[str] = []
    for r in roots:
        issues.extend(validate_bom(r))
    return issues


# ── Parameter expression resolution ─────────────────────────────────────────


def iter_all_nodes(roots: list[BOMNode]) -> Iterable[BOMNode]:
    """Yield every node in the tree (roots, components, materials)."""
    for r in roots:
        yield from _iter_node(r)


def _iter_node(node: BOMNode) -> Iterable[BOMNode]:
    yield node
    if node.children:
        for child in node.children:
            yield from _iter_node(child)


def collect_quantity_expressions(roots: list[BOMNode]) -> list[str]:
    """Return every distinct ``quantity_expression`` string in the tree."""
    out: set[str] = set()
    for n in iter_all_nodes(roots):
        if n.quantity_expression:
            out.add(n.quantity_expression)
    return sorted(out)


def resolve_roots_with_engine(roots: list[BOMNode], engine) -> list[BOMNode]:
    """Return a deep copy of ``roots`` where every ``quantity_expression`` is
    resolved to a numeric ``quantity`` via ``engine``. Nodes without an
    expression keep their pre-resolved ``quantity`` untouched.

    Raises :class:`mapper.core.parameter_engine.ParameterError` on the first
    expression that fails to resolve — the caller is expected to surface that
    as a validation error before running the pipeline.
    """
    return [_resolve_node(r, engine) for r in roots]


def _resolve_node(node: BOMNode, engine) -> BOMNode:
    if node.quantity_expression:
        new_qty = engine.resolve(node.quantity_expression)
        updated = node.model_copy(update={"quantity": float(new_qty)})
    else:
        updated = node.model_copy()
    if updated.children:
        updated.children = [_resolve_node(c, engine) for c in updated.children]
    return updated


def resolve_archetype_with_engine(arc: Archetype, engine) -> Archetype:
    """Return a copy of ``arc`` with every BOM ``quantity_expression`` resolved."""
    return arc.model_copy(update={"bom": resolve_roots_with_engine(arc.bom, engine)})


def summarize_archetype(arc: Archetype) -> dict:
    err = warn = 0
    if arc.validation_report is not None:
        err = arc.validation_report.error_rows
        warn = arc.validation_report.warning_rows
    return {
        "id": arc.id or "",
        "name": arc.name,
        "description": arc.description,
        "category": arc.category,
        "folder": arc.folder,
        "material_count": material_count_total(arc.bom),
        "unlinked_count": unlinked_count_total(arc.bom),
        "stages": [r.name for r in arc.bom],
        # The declaration (decides the multiplier) and, separately, the
        # scope-derived suggestion (a UI hint only).
        "stage_basis": {r.name: r.basis for r in arc.bom},
        # Stage-root node ids, so the UI can PUT a basis declaration without
        # re-importing the archetype.
        "stage_ids": {r.name: r.id for r in arc.bom},
        "stage_annual": {r.name: r.is_annual for r in arc.bom},
        "created_at": arc.created_at or "",
        "updated_at": arc.updated_at or arc.created_at or "",
        "validation_error_rows": err,
        "validation_warning_rows": warn,
    }
