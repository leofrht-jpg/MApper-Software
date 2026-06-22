# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Combined DSM × LCA pipeline with multi-method support.

For each year of an DSM simulation:
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

import logging
from typing import Callable, NamedTuple

_log = logging.getLogger(__name__)

from mapper.models.bom_schemas import (
    Archetype,
    DSMLCAResult,
    DSMLCASummary,
    DSMLCAYearResult,
)
from mapper.models.dsm_schemas import SimulationResult, YearResult
from mapper.models.subsystem_schemas import Subsystem

from mapper.core.bom_engine import (
    compute_demand_vector,
    flatten_roots_for_scope,
    flatten_roots_for_year_and_scope,
    has_evolution,
    resolve_archetype_with_engine,
    stages_in_scope,
)
from mapper.core.parameter_engine import ParameterEngine


# scope="all" runs three scope-correct passes and sums them (Manufacturing ×
# inflows + Use/Maintenance × stock + EoL × outflows). The individual scopes
# are the only ones with a unique (count, stages) pairing.
_ATOMIC_SCOPES = ("inflows", "stock", "outflows")


# Multi-method runner: demand + list[method_tuple] → {method_tuple: (score, unit)}.
MultiMethodRunner = Callable[
    [dict[tuple[str, str], float], list[tuple]],
    dict[tuple, tuple[float, str]],
]


class DSMLCAPipeline:
    def __init__(
        self,
        simulation_result: SimulationResult,
        archetypes: dict[str, Archetype],
        cohort_mappings: dict[str, tuple[str, float]],
        methods: list[tuple],
        lca_runner: MultiMethodRunner,
        year_start: int | None = None,
        year_end: int | None = None,
        parameter_engine: ParameterEngine | None = None,
    ) -> None:
        """``cohort_mappings`` maps ``cohort_key`` → ``(archetype_id, scaling_factor)``.
        Scaling factor defaults to 1.0 and multiplies every material quantity
        in the flattened BOM for that cohort.

        ``methods`` is a list of method tuples (each 3-tuple of strings).
        ``lca_runner`` takes a demand dict and list of method tuples, returns
        ``{method_tuple: (score, unit)}``.

        ``year_start`` / ``year_end`` (inclusive) filter the simulation years.

        ``parameter_engine``: optional engine used to resolve every node's
        ``quantity_expression`` to a numeric ``quantity`` before flattening.
        When ``None``, archetypes are used as-is (backward compat for BOMs
        without expressions). Archetypes are deep-copied when resolved; the
        originals are not mutated.
        """
        self.sim = simulation_result
        if parameter_engine is not None:
            archetypes = {
                k: resolve_archetype_with_engine(arc, parameter_engine)
                for k, arc in archetypes.items()
            }
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
        self, archetype_id: str, year: int | None = None, scope: str = "all",
        db: str | None = None,
    ) -> list:
        # ``year``/``db`` ignored here; the projected subclass overrides to
        # honor MaterialEvolution per year and an explicit background db.
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

    def calculate(self, scope: str) -> list[DSMLCAResult]:
        if scope == "all":
            return self._calculate_full_lifecycle()
        if scope not in _ATOMIC_SCOPES:
            raise ValueError(f"Unknown scope: {scope!r}")
        return self._calculate_single_scope(scope)

    def _calculate_full_lifecycle(self) -> list[DSMLCAResult]:
        """Sum three correctly-paired sub-calculations (Manufacturing×inflows
        + Use+Maintenance×stock + EoL×outflows) year-by-year per method."""
        parts = [self._calculate_single_scope(s) for s in _ATOMIC_SCOPES]
        merged: dict[tuple, DSMLCAResult] = {}
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
        out: list[DSMLCAResult] = []
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

    def _build_aggregated(self, yr, scope: str, counts, db: str | None = None):
        """Build the count-weighted aggregated demand + share/material bundle
        for one (year, scope), optionally rewriting every material to an
        explicit background ``db`` (else the year-resolved db via ``_flatten``).
        Returns a :class:`_YearAgg`, or ``None`` for an empty year."""
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
            flat = self._flatten(archetype_id, yr.year, scope, db=db)
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

        if not per_cohort_demand:
            return None

        aggregated: dict[tuple[str, str], float] = {}
        for cohort_demand in per_cohort_demand.values():
            for key, entry in cohort_demand.items():
                aggregated[key] = aggregated.get(key, 0.0) + entry["amount"]

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
        return _YearAgg(aggregated, cohort_share, total_mass, material_totals, grand_mat_total)

    def _compute_year_scores(self, yr, scope: str, counts):
        """Per-year LCA: one technosphere solve on the year-resolved background.
        Returns ``(scores_by_method, _YearAgg)`` or ``None`` for an empty year.
        The projected subclass overrides this for temporal interpolation."""
        agg = self._build_aggregated(yr, scope, counts, db=None)
        if agg is None:
            return None
        scores_by_method = self.run_lca(agg.aggregated, self.methods)
        return scores_by_method, agg

    def _calculate_single_scope(self, scope: str) -> list[DSMLCAResult]:
        # Accumulators — one entry per method.
        per_method_years: dict[tuple, list[DSMLCAYearResult]] = {m: [] for m in self.methods}
        per_method_total: dict[tuple, float] = {m: 0.0 for m in self.methods}
        per_method_peak_year: dict[tuple, int] = {m: 0 for m in self.methods}
        per_method_peak_impact: dict[tuple, float] = {m: 0.0 for m in self.methods}
        per_method_unit: dict[tuple, str] = {m: "" for m in self.methods}

        for yr in self.sim.years:
            if not self._year_in_range(yr.year):
                continue
            counts = self._counts_for_year(yr, scope)

            # 1-4. Build the count-weighted demand + solve. The projected
            # subclass overrides _compute_year_scores for temporal
            # interpolation (block mode → identical single solve as before).
            year_scores = self._compute_year_scores(yr, scope, counts)

            # Empty year — append zeros for every method.
            if year_scores is None:
                for m in self.methods:
                    per_method_years[m].append(
                        DSMLCAYearResult(
                            year=yr.year,
                            total_impact=0.0,
                            impact_by_cohort={},
                            impact_by_material={},
                            unit=per_method_unit[m],
                        )
                    )
                continue

            scores_by_method, _agg = year_scores
            cohort_share = _agg.cohort_share
            total_mass = _agg.total_mass
            material_totals = _agg.material_totals
            grand_mat_total = _agg.grand_mat_total

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
                    DSMLCAYearResult(
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

        # Assemble one DSMLCAResult per method.
        stages = self._collect_stages_included(scope)
        results: list[DSMLCAResult] = []
        for m in self.methods:
            results.append(
                DSMLCAResult(
                    mfa_system_id=self.sim.system_id,
                    method=list(m),
                    method_label=" › ".join(m),
                    scope=scope,
                    unit=per_method_unit[m],
                    years=per_method_years[m],
                    summary=DSMLCASummary(
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


class TemporalBracket(NamedTuple):
    """Result of bracketing a fleet year against the premise anchor years.

    ``upper_db is None`` → SINGLE db (no blend): exact-anchor year, or clamped
    before the first / after the last anchor (no extrapolation). Otherwise a
    proper bracket ``a < year < b`` with ``frac = (year − a) / (b − a)`` for the
    linear blend ``(1−frac)·score_a + frac·score_b``.
    """
    lower_db: str
    lower_year: int
    upper_db: str | None
    upper_year: int | None
    frac: float


def resolve_bracket(
    year: int, prospective_dbs: list[tuple[str, int]]
) -> TemporalBracket | None:
    """Bracket ``year`` between premise anchors for temporal interpolation.

    - EXACT (``year`` is an anchor) → single db, ``frac=0``.
    - CLAMP (before first / after last anchor) → endpoint anchor, single db
      (matches ``resolve_database_for_year``'s fallback — no extrapolation).
    - BRACKET (``a < year < b``) → ``(db_a, a, db_b, b, frac)``. Handles missing
      interior anchors by bracketing across the wider gap (e.g. anchors 2030,
      2040 → year 2035 brackets 2030↔2040, frac 0.5).

    Returns ``None`` only when the anchor list is empty.
    """
    if not prospective_dbs:
        return None
    dbs = sorted(prospective_dbs, key=lambda p: p[1])
    years = [y for _, y in dbs]
    for name, y in dbs:
        if y == year:
            return TemporalBracket(name, y, None, None, 0.0)
    if year < years[0]:
        name, y = dbs[0]
        return TemporalBracket(name, y, None, None, 0.0)
    if year > years[-1]:
        name, y = dbs[-1]
        return TemporalBracket(name, y, None, None, 0.0)
    lower = max((p for p in dbs if p[1] < year), key=lambda p: p[1])
    upper = min((p for p in dbs if p[1] > year), key=lambda p: p[1])
    frac = (year - lower[1]) / (upper[1] - lower[1])
    return TemporalBracket(lower[0], lower[1], upper[0], upper[1], frac)


def blend_method_scores(
    scores_a: dict[tuple, tuple[float, str]],
    scores_b: dict[tuple, tuple[float, str]],
    frac: float,
    methods: list[tuple],
) -> dict[tuple, tuple[float, str]]:
    """Linear per-method blend of two ``{method: (score, unit)}`` solves:
    ``(1−frac)·a + frac·b`` per method. The single source of truth for
    prospective temporal interpolation between two bracketing-anchor solves
    (year-invariant LCIA CFs → scalar-score interpolation is rigorous). Reused
    by the system-level pipeline (``_compute_year_scores``) and the
    single-product continuous-horizon path."""
    out: dict[tuple, tuple[float, str]] = {}
    for m in methods:
        sa, unit = scores_a.get(m, (0.0, ""))
        sb, _ = scores_b.get(m, (sa, unit))
        out[m] = ((1.0 - frac) * sa + frac * sb, unit)
    return out


class _YearAgg(NamedTuple):
    """Aggregated demand + share/material bundle for one (year, scope). The
    share/material fields depend only on per-cohort AMOUNTS (not the background
    db), so they're identical across two bracketing-db solves — built once and
    reused for attribution under temporal interpolation."""
    aggregated: dict
    cohort_share: dict
    total_mass: float
    material_totals: dict
    grand_mat_total: float


class ProjectedDSMLCAPipeline(DSMLCAPipeline):
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
        temporal_mode: str = "block",
        **kwargs,
    ) -> None:
        super().__init__(*args, **kwargs)
        self.prospective_dbs = list(prospective_dbs or [])
        self.fallback_base_db = fallback_base_db
        # Patch — "block" (default, per-year nearest-earlier anchor, step) vs
        # "interpolate" (blend the two bracketing-anchor solves, smooth).
        self.temporal_mode = temporal_mode
        # Cache keyed by (archetype_id, year, scope, db) since BOMs vary by year,
        # the stage filter depends on the sub-scope, AND interpolation rewrites
        # the same year's flat to two different bracketing dbs.
        self._flat_cache_year: dict[tuple[str, int, str, str | None], list] = {}

    def _rewrite_db(self, flat: list, year: int, db: str | None = None) -> list:
        if db is None:
            # Block: resolve the nearest-earlier anchor db for this year.
            if not self.prospective_dbs:
                _log.debug("_rewrite_db(year=%d): no prospective_dbs, keeping base links", year)
                return flat
            match = resolve_database_for_year(year, self.prospective_dbs)
            if match is None:
                _log.warning(
                    "_rewrite_db(year=%d): resolve_database_for_year returned None "
                    "(prospective_dbs=%s)", year, self.prospective_dbs,
                )
                return flat
            target_db, matched_year = match
            _log.info(
                "_rewrite_db(year=%d): matched → db=%r (year=%d) from %d candidates",
                year, target_db, matched_year, len(self.prospective_dbs),
            )
        else:
            # Interpolation: caller pins an explicit bracketing-anchor db.
            target_db = db
        rewritten = []
        for m in flat:
            if m.ecoinvent_activity is None:
                rewritten.append(m)
                continue
            new_link = m.ecoinvent_activity.model_copy(update={"database": target_db})
            rewritten.append(m.model_copy(update={"ecoinvent_activity": new_link}))
        return rewritten

    def _flatten(
        self, archetype_id: str, year: int | None = None, scope: str = "all",
        db: str | None = None,
    ) -> list:
        y = int(year) if year is not None else 0
        key = (archetype_id, y, scope, db)
        if key in self._flat_cache_year:
            return self._flat_cache_year[key]
        arc = self.archetypes[archetype_id]
        flat = (
            flatten_roots_for_year_and_scope(arc.bom, y, scope)
            if year is not None and has_evolution(arc.bom)
            else flatten_roots_for_scope(arc.bom, scope)
        )
        flat = self._rewrite_db(flat, y, db=db) if year is not None else flat
        self._flat_cache_year[key] = flat
        return flat

    def _compute_year_scores(self, yr, scope: str, counts):
        """Temporal handling for the projected pipeline.

        ``block`` (default): identical to the base — one solve on the
        year-resolved (nearest-earlier anchor) background.

        ``interpolate``: bracket the year between premise anchors. EXACT /
        CLAMP → single solve on that anchor db (matches block for those years,
        so anchor + clamped years never drift). BRACKET a<Y<b → solve the SAME
        year-Y demand against db_a AND db_b and linearly blend the per-category
        scalar scores by ``frac=(Y−a)/(b−a)``. Share/material attribution comes
        from the db_a build (amounts are db-invariant → identical to db_b)."""
        if self.temporal_mode != "interpolate" or not self.prospective_dbs:
            return super()._compute_year_scores(yr, scope, counts)
        bracket = resolve_bracket(yr.year, self.prospective_dbs)
        if bracket is None:
            return super()._compute_year_scores(yr, scope, counts)
        if bracket.upper_db is None:
            # Single solve (exact anchor or clamped) — no blend.
            agg = self._build_aggregated(yr, scope, counts, db=bracket.lower_db)
            if agg is None:
                return None
            return self.run_lca(agg.aggregated, self.methods), agg
        # Bracket — two solves on the same year-Y demand, blend per category.
        agg_a = self._build_aggregated(yr, scope, counts, db=bracket.lower_db)
        if agg_a is None:
            return None
        agg_b = self._build_aggregated(yr, scope, counts, db=bracket.upper_db)
        scores_a = self.run_lca(agg_a.aggregated, self.methods)
        scores_b = self.run_lca(agg_b.aggregated, self.methods) if agg_b is not None else scores_a
        blended = blend_method_scores(scores_a, scores_b, bracket.frac, self.methods)
        return blended, agg_a


# ── Multi-subsystem aggregation ──────────────────────────────────────────────

# Separator used when prefixing cohort/material keys with a subsystem id.
# Keeps keys unique across subsystems when aggregating results, so the UI can
# recover the source via ``key.split(SUBSYSTEM_KEY_SEP, 1)``.
SUBSYSTEM_KEY_SEP = "::"


def identity_cohort_mapping(
    subsystem: Subsystem, scaling_by_archetype: dict[str, float] | None = None,
) -> dict[str, tuple[str, float]]:
    """Build a cohort→(archetype_id, scaling_factor) map for a dependent subsystem.

    Dependent subsystems key their cohorts by ``dependent_archetype_id``, so
    the mapping is an identity: each archetype points at a BOM archetype of
    the same id. ``scaling_by_archetype`` overrides the default 1.0.
    """
    archetype_ids = {r.dependent_archetype_id for r in subsystem.dependency_rules}
    scales = scaling_by_archetype or {}
    return {aid: (aid, float(scales.get(aid, 1.0))) for aid in archetype_ids}


def build_subsystem_cohort_mapping(
    subsystem: Subsystem,
) -> tuple[dict[str, tuple[str, float]], list[str]]:
    """Return ``(mapping, unmapped)`` for a dependent subsystem.

    Uses the user-defined ``subsystem.cohort_mappings`` if present; archetypes
    referenced by rules but missing a mapping entry (or mapped to a blank
    archetype id) are returned in ``unmapped`` so callers can skip them and
    surface a warning. If the subsystem has no user-defined mappings at all,
    falls back to identity mapping for backward compatibility.
    """
    archetype_ids = {
        r.dependent_archetype_id for r in subsystem.dependency_rules if r.dependent_archetype_id
    }
    cm = subsystem.cohort_mappings or {}
    if not cm:
        return identity_cohort_mapping(subsystem), []

    mapping: dict[str, tuple[str, float]] = {}
    unmapped: list[str] = []
    for aid in archetype_ids:
        entry = cm.get(aid)
        if entry is None or not entry.archetype_id:
            unmapped.append(aid)
            continue
        mapping[aid] = (entry.archetype_id, float(entry.scaling_factor or 1.0))
    return mapping, sorted(unmapped)


def _prefix_key(subsystem_id: str, key: str) -> str:
    return f"{subsystem_id}{SUBSYSTEM_KEY_SEP}{key}"


def aggregate_subsystem_results(
    results_by_subsystem: dict[str, list[DSMLCAResult]],
    *,
    prefix_keys: bool = True,
) -> list[DSMLCAResult]:
    """Merge per-subsystem DSMLCAResults into one list, one entry per method.

    Each input value is the output of ``DSMLCAPipeline.calculate(scope)`` run
    for one subsystem. Years and methods are expected to align across
    subsystems, but missing years are tolerated — they're taken as zero.
    Cohort and material dict keys are prefixed with the subsystem id by
    default (``"{sub_id}::{key}"``) so the UI can split impact by subsystem.

    The merged result's ``mfa_system_id`` is set to the first non-empty
    subsystem id encountered (callers that need a different id can overwrite).
    Raises ``ValueError`` if the input is empty.
    """
    if not results_by_subsystem:
        raise ValueError("results_by_subsystem is empty")

    # Order subsystems deterministically for reproducible merging.
    ordered_subs = sorted(results_by_subsystem.keys())

    # First pass: collect the union of methods and years.
    method_keys: list[tuple] = []
    seen_methods: set[tuple] = set()
    for sid in ordered_subs:
        for r in results_by_subsystem[sid]:
            mkey = tuple(r.method)
            if mkey not in seen_methods:
                seen_methods.add(mkey)
                method_keys.append(mkey)

    # For each method: accumulate by year.
    merged: list[DSMLCAResult] = []
    first_system_id = next(
        (r.mfa_system_id for sid in ordered_subs for r in results_by_subsystem[sid] if r.mfa_system_id),
        "",
    )

    for mkey in method_keys:
        year_acc: dict[int, DSMLCAYearResult] = {}
        unit = ""
        scope = ""
        method_label = ""
        stages: list[str] = []
        seen_stages: set[str] = set()

        for sid in ordered_subs:
            method_result = next(
                (r for r in results_by_subsystem[sid] if tuple(r.method) == mkey),
                None,
            )
            if method_result is None:
                continue
            unit = unit or method_result.unit
            scope = scope or method_result.scope
            method_label = method_label or method_result.method_label
            for name in method_result.stages_included:
                if name not in seen_stages:
                    seen_stages.add(name)
                    stages.append(name)

            for yr in method_result.years:
                target = year_acc.get(yr.year)
                if target is None:
                    target = DSMLCAYearResult(
                        year=yr.year,
                        total_impact=0.0,
                        impact_by_cohort={},
                        impact_by_material={},
                        count_by_cohort={},
                        unit=yr.unit or unit,
                    )
                    year_acc[yr.year] = target
                target.total_impact += yr.total_impact
                if not target.unit:
                    target.unit = yr.unit
                for k, v in yr.impact_by_cohort.items():
                    new_k = _prefix_key(sid, k) if prefix_keys else k
                    target.impact_by_cohort[new_k] = (
                        target.impact_by_cohort.get(new_k, 0.0) + v
                    )
                for k, v in yr.impact_by_material.items():
                    new_k = _prefix_key(sid, k) if prefix_keys else k
                    target.impact_by_material[new_k] = (
                        target.impact_by_material.get(new_k, 0.0) + v
                    )
                for k, v in yr.count_by_cohort.items():
                    new_k = _prefix_key(sid, k) if prefix_keys else k
                    target.count_by_cohort[new_k] = (
                        target.count_by_cohort.get(new_k, 0.0) + v
                    )

        years_sorted = sorted(year_acc.values(), key=lambda y: y.year)
        total = sum(y.total_impact for y in years_sorted)
        peak_year = 0
        peak_impact = 0.0
        for y in years_sorted:
            if abs(y.total_impact) > abs(peak_impact):
                peak_impact = y.total_impact
                peak_year = y.year

        merged.append(
            DSMLCAResult(
                mfa_system_id=first_system_id,
                method=list(mkey),
                method_label=method_label,
                scope=scope,
                unit=unit,
                years=years_sorted,
                summary=DSMLCASummary(
                    total_impact=total,
                    peak_year=peak_year,
                    peak_impact=peak_impact,
                ),
                stages_included=stages,
            )
        )

    return merged
