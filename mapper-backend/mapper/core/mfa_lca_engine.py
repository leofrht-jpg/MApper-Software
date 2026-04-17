"""Combined MFA × LCA pipeline with multi-method support.

For each year of an MFA simulation:
  1. For every cohort with non-zero count, look up the linked archetype
     AND its per-cohort scaling factor.
  2. Flatten the archetype BOM and multiply every quantity by
     count × scaling_factor → demand vector.
  3. Aggregate across cohorts into one big demand for the year.
  4. Run LCA once per year across all requested methods (shared technosphere
     solve via bw2calc.LCA.switch_method when available).
  5. Attribute each method's score back to cohorts and materials proportionally
     to their demand share.

Cost: O(years) technosphere solves + O(years × methods) characterisation steps,
instead of O(years × methods) full solves. For 5 methods × 76 years that's 76
matrix solves vs 380.
"""
from __future__ import annotations

from typing import Callable

from mapper.models.bom_schemas import (
    Archetype,
    MFALCAResult,
    MFALCASummary,
    MFALCAYearResult,
)
from mapper.models.mfa_schemas import SimulationResult, YearResult

from mapper.core.bom_engine import (
    compute_demand_vector,
    flatten_roots_for_scope,
    flatten_roots_for_year_and_scope,
    has_evolution,
    stages_in_scope,
)


# scope="all" runs three scope-correct passes and sums them (Manufacturing ×
# inflows + Use/Maintenance × stock + EoL × outflows). The individual scopes
# are the only ones with a unique (count, stages) pairing.
_ATOMIC_SCOPES = ("inflows", "stock", "outflows")


# Multi-method runner: demand + list[method_tuple] → {method_tuple: (score, unit)}.
MultiMethodRunner = Callable[
    [dict[tuple[str, str], float], list[tuple]],
    dict[tuple, tuple[float, str]],
]


class MFALCAPipeline:
    def __init__(
        self,
        simulation_result: SimulationResult,
        archetypes: dict[str, Archetype],
        cohort_mappings: dict[str, tuple[str, float]],
        methods: list[tuple],
        lca_runner: MultiMethodRunner,
        year_start: int | None = None,
        year_end: int | None = None,
    ) -> None:
        """``cohort_mappings`` maps ``cohort_key`` → ``(archetype_id, scaling_factor)``.
        Scaling factor defaults to 1.0 and multiplies every material quantity
        in the flattened BOM for that cohort.

        ``methods`` is a list of method tuples (each 3-tuple of strings).
        ``lca_runner`` takes a demand dict and list of method tuples, returns
        ``{method_tuple: (score, unit)}``.

        ``year_start`` / ``year_end`` (inclusive) filter the simulation years.
        """
        self.sim = simulation_result
        self.archetypes = archetypes
        self.mappings = cohort_mappings
        self.methods = [tuple(m) for m in methods]
        if not self.methods:
            raise ValueError("At least one method is required")
        self.run_lca = lca_runner
        self.year_start = year_start
        self.year_end = year_end
        # Cache keyed by (archetype_id, scope). Year is irrelevant for the base
        # class (BOM treated as static) — the projected subclass adds a
        # separate year-aware cache.
        self._flat_cache: dict[tuple[str, str], list] = {}

    def _flatten(
        self, archetype_id: str, year: int | None = None, scope: str = "all"
    ) -> list:
        # ``year`` ignored here; the projected subclass overrides to honor
        # MaterialEvolution per year.
        key = (archetype_id, scope)
        if key not in self._flat_cache:
            arc = self.archetypes[archetype_id]
            self._flat_cache[key] = flatten_roots_for_scope(arc.bom, scope)
        return self._flat_cache[key]

    def _counts_for_year(self, year_result: YearResult, scope: str) -> dict[str, float]:
        if scope == "inflows":
            return year_result.inflow
        if scope == "outflows":
            return year_result.outflow
        if scope == "stock":
            return year_result.stock
        raise ValueError(f"Unknown scope: {scope!r}")

    def _collect_stages_included(self, scope: str) -> list[str]:
        seen: set[str] = set()
        out: list[str] = []
        for arc in self.archetypes.values():
            for name in stages_in_scope(arc.bom, scope):
                if name not in seen:
                    seen.add(name)
                    out.append(name)
        return out

    def _year_in_range(self, year: int) -> bool:
        if self.year_start is not None and year < self.year_start:
            return False
        if self.year_end is not None and year > self.year_end:
            return False
        return True

    def calculate(self, scope: str) -> list[MFALCAResult]:
        if scope == "all":
            return self._calculate_full_lifecycle()
        if scope not in _ATOMIC_SCOPES:
            raise ValueError(f"Unknown scope: {scope!r}")
        return self._calculate_single_scope(scope)

    def _calculate_full_lifecycle(self) -> list[MFALCAResult]:
        """Sum three correctly-paired sub-calculations (Manufacturing×inflows
        + Use+Maintenance×stock + EoL×outflows) year-by-year per method."""
        parts = [self._calculate_single_scope(s) for s in _ATOMIC_SCOPES]
        merged: dict[tuple, MFALCAResult] = {}
        for part_results in parts:
            for r in part_results:
                mkey = tuple(r.method)
                existing = merged.get(mkey)
                if existing is None:
                    # Deep-copy the first part; subsequent parts accumulate into it.
                    merged[mkey] = r.model_copy(
                        update={
                            "scope": "all",
                            "years": [y.model_copy() for y in r.years],
                            "summary": r.summary.model_copy(),
                            "stages_included": list(r.stages_included),
                        }
                    )
                    continue
                # Align year entries by year (sim loops are identical, so
                # this is a straight zip, but guard against length drift).
                by_year = {y.year: y for y in existing.years}
                for yr in r.years:
                    target = by_year.get(yr.year)
                    if target is None:
                        existing.years.append(yr.model_copy())
                        continue
                    target.total_impact += yr.total_impact
                    for k, v in yr.impact_by_cohort.items():
                        target.impact_by_cohort[k] = target.impact_by_cohort.get(k, 0.0) + v
                    for k, v in yr.impact_by_material.items():
                        target.impact_by_material[k] = target.impact_by_material.get(k, 0.0) + v
                    if not target.unit:
                        target.unit = yr.unit
                if not existing.unit:
                    existing.unit = r.unit
                existing.summary.total_impact += r.summary.total_impact
                # Peak tracked after merging (below).
                for name in r.stages_included:
                    if name not in existing.stages_included:
                        existing.stages_included.append(name)
        # Recompute per-method peak from the merged year list.
        out: list[MFALCAResult] = []
        for r in merged.values():
            r.years.sort(key=lambda y: y.year)
            peak_year = r.years[0].year if r.years else 0
            peak_impact = 0.0
            for y in r.years:
                if abs(y.total_impact) > abs(peak_impact):
                    peak_impact = y.total_impact
                    peak_year = y.year
            r.summary.peak_year = peak_year
            r.summary.peak_impact = peak_impact
            out.append(r)

        # For scope="all", use stock counts (index 1 in _ATOMIC_SCOPES).
        stock_results = parts[1]
        for r in out:
            stock_r = next(
                (sr for sr in stock_results if tuple(sr.method) == tuple(r.method)),
                None,
            )
            if stock_r:
                stock_by_year = {y.year: y.count_by_cohort for y in stock_r.years}
                for y in r.years:
                    y.count_by_cohort = stock_by_year.get(y.year, {})

        return out

    def _calculate_single_scope(self, scope: str) -> list[MFALCAResult]:
        # Accumulators — one entry per method.
        per_method_years: dict[tuple, list[MFALCAYearResult]] = {m: [] for m in self.methods}
        per_method_total: dict[tuple, float] = {m: 0.0 for m in self.methods}
        per_method_peak_year: dict[tuple, int] = {m: 0 for m in self.methods}
        per_method_peak_impact: dict[tuple, float] = {m: 0.0 for m in self.methods}
        per_method_unit: dict[tuple, str] = {m: "" for m in self.methods}

        for yr in self.sim.years:
            if not self._year_in_range(yr.year):
                continue
            counts = self._counts_for_year(yr, scope)

            # 1. Per-cohort demand + per-material quantities.
            per_cohort_demand: dict[str, dict[tuple[str, str], dict]] = {}
            per_cohort_material_qty: dict[str, dict[str, float]] = {}
            for cohort_key, count in counts.items():
                if count <= 0:
                    continue
                mapping = self.mappings.get(cohort_key)
                if not mapping:
                    continue
                archetype_id, scaling_factor = mapping
                if archetype_id not in self.archetypes:
                    continue
                flat = self._flatten(archetype_id, yr.year, scope)
                demand = compute_demand_vector(flat, count, scaling_factor)
                if not demand:
                    continue
                per_cohort_demand[cohort_key] = demand
                mat_qty: dict[str, float] = {}
                effective = count * scaling_factor
                for mat in flat:
                    if mat.ecoinvent_activity is None:
                        continue
                    mat_qty[mat.name] = mat_qty.get(mat.name, 0.0) + mat.quantity * effective
                per_cohort_material_qty[cohort_key] = mat_qty

            # Empty year — append zeros for every method.
            if not per_cohort_demand:
                for m in self.methods:
                    per_method_years[m].append(
                        MFALCAYearResult(
                            year=yr.year,
                            total_impact=0.0,
                            impact_by_cohort={},
                            impact_by_material={},
                            unit=per_method_unit[m],
                        )
                    )
                continue

            # 2. Aggregate demand across cohorts.
            aggregated: dict[tuple[str, str], float] = {}
            for cohort_demand in per_cohort_demand.values():
                for key, entry in cohort_demand.items():
                    aggregated[key] = aggregated.get(key, 0.0) + entry["amount"]

            # 3. Compute share weights (same across all methods).
            cohort_share: dict[str, float] = {}
            total_mass = 0.0
            for ck, demand in per_cohort_demand.items():
                m_mass = sum(e["amount"] for e in demand.values())
                cohort_share[ck] = m_mass
                total_mass += m_mass
            material_totals: dict[str, float] = {}
            for mq in per_cohort_material_qty.values():
                for name, qty in mq.items():
                    material_totals[name] = material_totals.get(name, 0.0) + qty
            grand_mat_total = sum(material_totals.values())

            # 4. Multi-method LCA — one technosphere solve, many characterisations.
            scores_by_method = self.run_lca(aggregated, self.methods)

            # 5. Attribute per method.
            for m in self.methods:
                score, unit = scores_by_method.get(m, (0.0, ""))
                per_method_unit[m] = unit or per_method_unit[m]

                impact_by_cohort = {
                    ck: (score * (mass / total_mass) if total_mass > 0 else 0.0)
                    for ck, mass in cohort_share.items()
                }
                impact_by_material = {
                    name: (score * (qty / grand_mat_total) if grand_mat_total > 0 else 0.0)
                    for name, qty in material_totals.items()
                }
                count_by_cohort = {
                    ck: counts.get(ck, 0.0)
                    for ck in cohort_share
                }

                per_method_years[m].append(
                    MFALCAYearResult(
                        year=yr.year,
                        total_impact=score,
                        impact_by_cohort=impact_by_cohort,
                        impact_by_material=impact_by_material,
                        count_by_cohort=count_by_cohort,
                        unit=unit,
                    )
                )
                per_method_total[m] += score
                if abs(score) > abs(per_method_peak_impact[m]):
                    per_method_peak_impact[m] = score
                    per_method_peak_year[m] = yr.year

        # Assemble one MFALCAResult per method.
        stages = self._collect_stages_included(scope)
        results: list[MFALCAResult] = []
        for m in self.methods:
            results.append(
                MFALCAResult(
                    mfa_system_id=self.sim.system_id,
                    method=list(m),
                    method_label=" › ".join(m),
                    scope=scope,
                    unit=per_method_unit[m],
                    years=per_method_years[m],
                    summary=MFALCASummary(
                        total_impact=per_method_total[m],
                        peak_year=per_method_peak_year[m],
                        peak_impact=per_method_peak_impact[m],
                    ),
                    stages_included=stages,
                )
            )
        return results


# ── Projected pipeline (BOM evolution + year-matched prospective DB) ─────────


def resolve_database_for_year(
    year: int, prospective_dbs: list[tuple[str, int]]
) -> tuple[str, int] | None:
    """Pick the prospective database closest to ``year``.

    ``prospective_dbs`` is a list of ``(name, year)`` tuples. Returns the exact
    match when present, otherwise the nearest earlier year, otherwise the
    earliest available (so 2025 data isn't lost for a 2024 query). Returns
    ``None`` only when the list is empty.
    """
    if not prospective_dbs:
        return None
    exact = [p for p in prospective_dbs if p[1] == year]
    if exact:
        return exact[0]
    earlier = [p for p in prospective_dbs if p[1] < year]
    if earlier:
        return max(earlier, key=lambda p: p[1])
    # All later — fall back to the earliest one.
    return min(prospective_dbs, key=lambda p: p[1])


class ProjectedMFALCAPipeline(MFALCAPipeline):
    """Year-aware pipeline.

    Differences from the base pipeline:
    - BOMs are re-flattened for each simulation year so that
      ``MaterialEvolution`` drives the per-year per-unit quantities.
    - Optionally swaps every material's ecoinvent ``database`` to a
      prospective database matched to the year (exact → nearest earlier).
      Activity ``code`` is preserved, so activities must exist under the same
      code in the prospective DB — which premise guarantees for copied
      activities.
    """

    def __init__(
        self,
        *args,
        prospective_dbs: list[tuple[str, int]] | None = None,
        fallback_base_db: str | None = None,
        **kwargs,
    ) -> None:
        super().__init__(*args, **kwargs)
        self.prospective_dbs = list(prospective_dbs or [])
        self.fallback_base_db = fallback_base_db
        # Cache keyed by (archetype_id, year, scope) since BOMs vary by year
        # AND the stage filter depends on the current sub-scope.
        self._flat_cache_year: dict[tuple[str, int, str], list] = {}

    def _rewrite_db(self, flat: list, year: int) -> list:
        if not self.prospective_dbs:
            return flat
        match = resolve_database_for_year(year, self.prospective_dbs)
        if match is None:
            return flat
        target_db, _ = match
        rewritten = []
        for m in flat:
            if m.ecoinvent_activity is None:
                rewritten.append(m)
                continue
            new_link = m.ecoinvent_activity.model_copy(update={"database": target_db})
            rewritten.append(m.model_copy(update={"ecoinvent_activity": new_link}))
        return rewritten

    def _flatten(
        self, archetype_id: str, year: int | None = None, scope: str = "all"
    ) -> list:
        y = int(year) if year is not None else 0
        key = (archetype_id, y, scope)
        if key in self._flat_cache_year:
            return self._flat_cache_year[key]
        arc = self.archetypes[archetype_id]
        flat = (
            flatten_roots_for_year_and_scope(arc.bom, y, scope)
            if year is not None and has_evolution(arc.bom)
            else flatten_roots_for_scope(arc.bom, scope)
        )
        flat = self._rewrite_db(flat, y) if year is not None else flat
        self._flat_cache_year[key] = flat
        return flat
