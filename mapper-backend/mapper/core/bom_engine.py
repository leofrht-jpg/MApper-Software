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
    Archetype,
    ArchetypeTimeline,
    ArchetypeTimelineRow,
    BOMNode,
    FlattenedMaterial,
)


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


def stage_to_scope(stage_name: str, explicit_scope: str | None = None) -> str:
    """Classify a stage into ``"inflows" | "stock" | "outflows"``.

    When ``explicit_scope`` is set on the stage node, it takes priority and the
    name is ignored. Otherwise the stage name is matched against a keyword
    table; unknown stages default to ``"inflows"`` (manufacturing assumption).
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
) -> list[FlattenedMaterial]:
    """Year-aware + stage-filtered flatten. ``lever_values`` threads global-lever
    multipliers (e.g. ``p_bp``) down to ``resolve_quantity``; ``None`` → identity."""
    out: list[FlattenedMaterial] = []
    for r in filter_roots_by_scope(roots, scope):
        out.extend(flatten_bom_for_year(r, year, lever_values=lever_values))
    return out


def total_mass_kg(materials: list[FlattenedMaterial]) -> float:
    """Sum quantities of all materials whose unit is a kilogram variant."""
    return sum(m.quantity for m in materials if m.unit.lower() in KG_UNITS)


# ── Time-varying quantities ─────────────────────────────────────────────────
# Materials can carry a ``MaterialEvolution`` describing how their per-unit
# quantity changes over time. ``resolve_quantity`` returns the effective
# quantity for a given year; the year-aware flatten helpers propagate that
# through the multiplicative cascade the same way ``flatten_bom`` does.


def _apply_global_levers(
    node: BOMNode, quantity: float, lever_values: dict[str, float] | None
) -> float:
    """Multiply ``quantity`` by each of ``node.global_levers`` resolved value.

    A node with no ``global_levers`` returns ``quantity`` unchanged (identity —
    non-tagged nodes are provably unaffected). A listed lever absent from
    ``lever_values`` (or ``lever_values`` itself ``None``) resolves to 1.0, so
    tagging a node with a lever the user hasn't defined is safe (no KeyError)
    and neutral. This is the ``× p_bp(year)`` term of the composition, applied
    AFTER the MaterialEvolution factor already baked into ``quantity``."""
    levers = node.global_levers
    if not levers:
        return quantity
    factor = 1.0
    for name in levers:
        v = lever_values.get(name, 1.0) if lever_values else 1.0
        factor *= float(v)
    return quantity * factor


def resolve_quantity(
    node: BOMNode, year: int, lever_values: dict[str, float] | None = None
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
        return _apply_global_levers(node, base, lever_values)
    if ev.method == "learning_rate" and ev.learning_rate is not None:
        q = base * (1.0 + float(ev.learning_rate)) ** (int(year) - int(ev.base_year))
        return _apply_global_levers(node, q, lever_values)
    if ev.method == "rebound_effect" and ev.rebound_rate is not None:
        # Same compounding math as learning_rate — the semantic difference is
        # only in labelling (rebound typically positive, LR typically negative).
        q = base * (1.0 + float(ev.rebound_rate)) ** (int(year) - int(ev.base_year))
        return _apply_global_levers(node, q, lever_values)
    if ev.method == "milestones" and ev.milestones:
        ms = sorted(ev.milestones, key=lambda m: m.year)
        if year <= ms[0].year:
            return _apply_global_levers(node, float(ms[0].quantity), lever_values)
        if year >= ms[-1].year:
            return _apply_global_levers(node, float(ms[-1].quantity), lever_values)
        for a, b in zip(ms, ms[1:]):
            if a.year <= year <= b.year:
                span = b.year - a.year
                if span == 0:
                    return _apply_global_levers(node, float(a.quantity), lever_values)
                t = (year - a.year) / span
                q = float(a.quantity) + t * (float(b.quantity) - float(a.quantity))
                return _apply_global_levers(node, q, lever_values)
    return _apply_global_levers(node, base, lever_values)


def flatten_bom_for_year(
    node: BOMNode,
    year: int,
    parent_quantity: float = 1.0,
    path: list[str] | None = None,
    lever_values: dict[str, float] | None = None,
) -> list[FlattenedMaterial]:
    """Year-aware variant of :func:`flatten_bom`. Uses ``resolve_quantity``.

    ``lever_values`` is threaded to ``resolve_quantity`` so global levers (e.g.
    ``p_bp``) multiply per-node quantities in the cascade. ``None`` → identity.
    """
    path = path or []
    effective = parent_quantity * resolve_quantity(node, year, lever_values)

    if node.node_type == "material":
        return [
            FlattenedMaterial(
                node_id=node.id or "",
                name=node.name,
                quantity=effective,
                unit=node.unit,
                ecoinvent_activity=node.ecoinvent_activity,
                path=path + [node.name],
            )
        ]

    out: list[FlattenedMaterial] = []
    if node.children:
        for child in node.children:
            out.extend(flatten_bom_for_year(child, year, effective, path + [node.name], lever_values))
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
        "stage_annual": {r.name: r.is_annual for r in arc.bom},
        "created_at": arc.created_at or "",
        "updated_at": arc.updated_at or arc.created_at or "",
        "validation_error_rows": err,
        "validation_warning_rows": warn,
    }
