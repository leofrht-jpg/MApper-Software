# SPDX-License-Identifier: MPL-2.0
"""What a single-product AESA impact means: as computed, or per year.

The Sustainability Ratio divides an impact by an allocated Safe Operating
Space stated PER YEAR. The single-product adapters document the functional
unit as a single-year flow and never divide, so the impact must already be per
year for the ratio to compare like with like. Two ways to get there:

* the BOM yields a per-year impact itself -- a 1-year run, or a BOM that
  divides its one-off stages by the lifetime in its own expressions (the
  EVS40 EV9 archetype does: ``(m_ev9_kg - ...) / lifetime_yr``);
* the run is a WHOLE-LIFE total (Lifetime preset: one product, its use phase
  scaled by the lifetime), and AESA divides it by that lifetime.

Doing the second to the first divides twice. That is the failure this module
guards against: :func:`lifetime_division_rows` finds BOM rows that already
divide by the lifetime, and the route refuses "per year" when it finds any.
"""

from __future__ import annotations

import ast
from collections.abc import Iterable

from mapper.models.bom_schemas import BOMNode, ImpactAssessmentResult


def _divisor_names(expression: str) -> set[str]:
    """Names that appear anywhere in the right operand of a division."""
    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError:
        return set()
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Div, ast.FloorDiv)):
            names |= {n.id for n in ast.walk(node.right) if isinstance(n, ast.Name)}
    return names


def lifetime_division_rows(
    roots: Iterable[BOMNode],
    lifetime: float,
    lifetime_param: str | None,
    values: dict[str, float],
) -> list[str]:
    """BOM rows (``stage > row``) whose expression divides by the lifetime.

    A row counts when it divides by the parameter the run's lifetime was taken
    from, or by any parameter whose value equals that lifetime -- so a BOM
    dividing by ``lifetime_yr = 16`` is caught under a typed lifetime of 16 as
    much as under a reference to ``lifetime_yr``.
    """
    def is_lifetime(name: str) -> bool:
        if lifetime_param and name == lifetime_param:
            return True
        v = values.get(name)
        return v is not None and abs(v - lifetime) < 1e-9

    hits: list[str] = []

    def walk(node: BOMNode, stage: str) -> None:
        expr = node.quantity_expression
        if expr and any(is_lifetime(n) for n in _divisor_names(expr)):
            hits.append(f"{stage} > {node.name}")
        for child in node.children or []:
            walk(child, stage)

    for root in roots:
        for child in root.children or []:
            walk(child, root.name)
    return hits


def annualise(impact: ImpactAssessmentResult, lifetime: float) -> ImpactAssessmentResult:
    """Every impact magnitude divided by ``lifetime``; nothing else touched.

    Counts and units are not magnitudes and stay as they are. Returns a copy.
    """
    if lifetime <= 0:
        raise ValueError(f"lifetime must be positive, got {lifetime}")
    results = []
    for r in impact.results:
        years = [
            y.model_copy(update={
                "total_impact": y.total_impact / lifetime,
                "impact_by_cohort": {k: v / lifetime for k, v in y.impact_by_cohort.items()},
                "impact_by_material": {k: v / lifetime for k, v in y.impact_by_material.items()},
            })
            for y in r.years
        ]
        summary = r.summary.model_copy(update={
            "total_impact": r.summary.total_impact / lifetime,
            "peak_impact": r.summary.peak_impact / lifetime,
        })
        results.append(r.model_copy(update={"years": years, "summary": summary}))
    return impact.model_copy(update={"results": results})
