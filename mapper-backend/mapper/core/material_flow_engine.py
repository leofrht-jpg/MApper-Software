"""Material Flow engine — physical quantities through the DSM system.

Combines DSM vehicle counts x archetype BOMs x learning rates to produce
year-by-year material quantities (kg, kWh, tkm, etc.).  No LCA — this is
the physical inventory that feeds into Impact Assessment.
"""
from __future__ import annotations

import time
from typing import Any

from mapper.models.bom_schemas import (
    Archetype,
    MaterialFlowResult,
    MaterialSeries,
)
from mapper.models.dsm_schemas import SimulationResult, YearResult

from mapper.core.bom_engine import (
    find_node_in_roots,
    flatten_roots_for_scope,
    flatten_roots_for_year_and_scope,
    has_evolution,
    stages_in_scope,
    FlattenedMaterial,
)


_ATOMIC_SCOPES = ("inflows", "stock", "outflows")


# ── Helpers ─────────────────────────────────────────────────────────────────


def _counts_for_year(yr: YearResult, scope: str) -> dict[str, float]:
    if scope == "inflows":
        return yr.inflow
    if scope == "outflows":
        return yr.outflow
    if scope == "stock":
        return yr.stock
    raise ValueError(f"Unknown scope: {scope!r}")


def _year_in_range(year: int, year_start: int | None, year_end: int | None) -> bool:
    if year_start is not None and year < year_start:
        return False
    if year_end is not None and year > year_end:
        return False
    return True


def _group_key(
    mat: FlattenedMaterial, group_by: str, archetype_name: str,
) -> tuple[str, str]:
    """Return ``(display_name, unit)`` for grouping.

    For "stage" and "archetype" group_by modes, unit is left empty so
    materials with different physical units are merged into a single
    series per stage / archetype.  The dominant unit is resolved later
    by ``_compute_single_scope``.
    """
    if group_by == "component":
        name = mat.path[1] if len(mat.path) > 2 else (mat.path[0] if mat.path else mat.name)
        return (name, mat.unit)
    if group_by == "stage":
        name = mat.path[0] if mat.path else "Unknown"
        return (name, "")
    if group_by == "archetype":
        return (archetype_name, "")
    # default: "material"
    return (mat.name, mat.unit)


def _collect_stages(archetypes: dict[str, Archetype], scope: str) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for arc in archetypes.values():
        for name in stages_in_scope(arc.bom, scope):
            if name not in seen:
                seen.add(name)
                out.append(name)
    return out


# ── Single-scope computation ───────────────────────────────────────────────


def _compute_single_scope(
    sim: SimulationResult,
    archetypes: dict[str, Archetype],
    cohort_mappings: dict[str, tuple[str, float]],
    scope: str,
    year_start: int | None,
    year_end: int | None,
    group_by: str,
) -> dict[tuple[str, str], dict[str, Any]]:
    """Accumulate material quantities for one atomic scope.

    Returns ``accum`` keyed by ``(display_name, unit)`` → dict with
    ``values``, ``by_archetype``, and metadata fields.
    """
    accum: dict[tuple[str, str], dict[str, Any]] = {}
    flat_cache: dict[tuple[str, int | None, str], list[FlattenedMaterial]] = {}
    # Track per-unit totals for group_by modes that merge across units.
    unit_totals: dict[tuple[str, str], dict[str, float]] = {}

    for yr in sim.years:
        if not _year_in_range(yr.year, year_start, year_end):
            continue
        counts = _counts_for_year(yr, scope)

        for cohort_key, count in counts.items():
            if count <= 0:
                continue
            mapping = cohort_mappings.get(cohort_key)
            if not mapping:
                continue
            archetype_id, scaling_factor = mapping
            arc = archetypes.get(archetype_id)
            if arc is None:
                continue

            # Flatten BOM (with cache).
            use_year = yr.year if has_evolution(arc.bom) else None
            cache_key = (archetype_id, use_year, scope)
            if cache_key not in flat_cache:
                if use_year is not None:
                    flat_cache[cache_key] = flatten_roots_for_year_and_scope(
                        arc.bom, use_year, scope
                    )
                else:
                    flat_cache[cache_key] = flatten_roots_for_scope(arc.bom, scope)
            flat = flat_cache[cache_key]

            effective = count * scaling_factor
            for mat in flat:
                qty = mat.quantity * effective
                if qty == 0:
                    continue
                key = _group_key(mat, group_by, arc.name)

                # Track per-unit contributions when key merges across units.
                if key[1] == "":
                    if key not in unit_totals:
                        unit_totals[key] = {}
                    unit_totals[key][mat.unit] = (
                        unit_totals[key].get(mat.unit, 0.0) + abs(qty)
                    )

                if key not in accum:
                    ea = mat.ecoinvent_activity
                    accum[key] = {
                        "values": {},
                        "by_archetype": {},
                        "unit": mat.unit,
                        "stage": mat.path[0] if mat.path else "",
                        "component": mat.path[1] if len(mat.path) > 2 else "",
                        "ecoinvent_name": ea.name if ea else "",
                        "ecoinvent_code": ea.code if ea else "",
                        "evolution_method": None,
                        "evolution_rate": None,
                    }

                entry = accum[key]
                entry["values"][yr.year] = entry["values"].get(yr.year, 0.0) + qty

                # Per-archetype sub-breakdown.
                arc_name = arc.name
                if arc_name not in entry["by_archetype"]:
                    entry["by_archetype"][arc_name] = {}
                entry["by_archetype"][arc_name][yr.year] = (
                    entry["by_archetype"][arc_name].get(yr.year, 0.0) + qty
                )

                # Track evolution (first non-fixed wins).
                if entry["evolution_method"] is None and group_by == "material":
                    node = find_node_in_roots(arc.bom, mat.node_id)
                    if node and node.evolution and node.evolution.method != "fixed":
                        entry["evolution_method"] = node.evolution.method
                        entry["evolution_rate"] = (
                            node.evolution.learning_rate
                            if node.evolution.method == "learning_rate"
                            else node.evolution.rebound_rate
                        )

    # Resolve dominant unit for keys that merged across units.
    for key, ut in unit_totals.items():
        if key in accum:
            accum[key]["unit"] = max(ut, key=ut.get)

    return accum


def _accum_to_series(accum: dict[tuple[str, str], dict[str, Any]]) -> list[MaterialSeries]:
    series: list[MaterialSeries] = []
    for (name, _unit), data in accum.items():
        series.append(
            MaterialSeries(
                name=name,
                unit=data["unit"],
                ecoinvent_name=data["ecoinvent_name"],
                ecoinvent_code=data["ecoinvent_code"],
                stage=data["stage"],
                component=data["component"],
                values=data["values"],
                by_archetype=data["by_archetype"],
                evolution_method=data["evolution_method"],
                evolution_rate=data["evolution_rate"],
            )
        )
    series.sort(key=lambda s: sum(s.values.values()), reverse=True)
    return series


# ── Public API ──────────────────────────────────────────────────────────────


def compute_material_flows(
    sim: SimulationResult,
    archetypes: dict[str, Archetype],
    cohort_mappings: dict[str, tuple[str, float]],
    scope: str,
    year_start: int | None = None,
    year_end: int | None = None,
    group_by: str = "material",
) -> MaterialFlowResult:
    t0 = time.perf_counter()

    if scope == "all":
        # Run three sub-scopes and merge.
        merged: dict[tuple[str, str], dict] = {}
        all_stages: list[str] = []
        for sub_scope in _ATOMIC_SCOPES:
            part = _compute_single_scope(
                sim, archetypes, cohort_mappings, sub_scope,
                year_start, year_end, group_by,
            )
            for key, data in part.items():
                if key not in merged:
                    merged[key] = {
                        "values": {},
                        "by_archetype": {},
                        "unit": data["unit"],
                        "stage": data["stage"],
                        "component": data["component"],
                        "ecoinvent_name": data["ecoinvent_name"],
                        "ecoinvent_code": data["ecoinvent_code"],
                        "evolution_method": data["evolution_method"],
                        "evolution_rate": data["evolution_rate"],
                    }
                target = merged[key]
                for yr, qty in data["values"].items():
                    target["values"][yr] = target["values"].get(yr, 0.0) + qty
                for arc_name, arc_years in data["by_archetype"].items():
                    if arc_name not in target["by_archetype"]:
                        target["by_archetype"][arc_name] = {}
                    for yr, qty in arc_years.items():
                        target["by_archetype"][arc_name][yr] = (
                            target["by_archetype"][arc_name].get(yr, 0.0) + qty
                        )
                if target["evolution_method"] is None and data["evolution_method"]:
                    target["evolution_method"] = data["evolution_method"]
                    target["evolution_rate"] = data["evolution_rate"]
            all_stages.extend(_collect_stages(archetypes, sub_scope))

        materials = _accum_to_series(merged)
        # Deduplicate stages while preserving order.
        seen: set[str] = set()
        stages: list[str] = []
        for s in all_stages:
            if s not in seen:
                seen.add(s)
                stages.append(s)
    else:
        accum = _compute_single_scope(
            sim, archetypes, cohort_mappings, scope,
            year_start, year_end, group_by,
        )
        materials = _accum_to_series(accum)
        stages = _collect_stages(archetypes, scope)

    # Determine actual year range from the data.
    all_years: set[int] = set()
    for m in materials:
        all_years.update(m.values.keys())
    actual_start = min(all_years) if all_years else (year_start or 0)
    actual_end = max(all_years) if all_years else (year_end or 0)

    return MaterialFlowResult(
        scope=scope,
        stages_included=stages,
        year_start=actual_start,
        year_end=actual_end,
        group_by=group_by,
        materials=materials,
        elapsed_seconds=round(time.perf_counter() - t0, 3),
    )
