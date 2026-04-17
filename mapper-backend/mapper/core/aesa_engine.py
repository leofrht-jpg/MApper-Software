"""AESA engine: compares Impact Assessment results against allocated
planetary-boundary thresholds.

Design note on units
--------------------
Planetary-boundary global limits are expressed in biophysical units
(ppm CO2, DU, Tg N/yr, ...) that are NOT directly comparable to LCIA-method
results (kg CO2-eq/yr, kg P-eq/yr, ...). The engine therefore trusts the
user-supplied ``allocated_threshold`` (in ``allocated_unit``) as the
ground-truth comparison target. The ``global_limit`` in DEFAULT_BOUNDARIES
is informational context only — it helps the user reason about *their own*
allocation, it is never automatically converted.
"""
from __future__ import annotations

from mapper.models.aesa_schemas import (
    AESAConfiguration,
    AESAIndicatorResult,
    AESAResult,
    AESASummary,
    AESAYearResult,
)
from mapper.models.bom_schemas import MFALCAResult


# ── Reference data ───────────────────────────────────────────────────────────


DEFAULT_BOUNDARIES: list[dict] = [
    {
        "id": "climate_change",
        "name": "Climate Change",
        "description": "Atmospheric CO2 concentration and radiative forcing",
        "global_limit": 350.0,
        "global_limit_unit": "ppm CO2",
        "control_variable": "Atmospheric CO2 concentration",
        "status": "beyond_boundary",
        "source": "Steffen et al. 2015; updated Richardson et al. 2023",
    },
    {
        "id": "ocean_acidification",
        "name": "Ocean Acidification",
        "description": "Carbonate ion concentration in surface seawater",
        "global_limit": 2.75,
        "global_limit_unit": "Ω aragonite",
        "control_variable": "Aragonite saturation state",
        "status": "safe",
        "source": "Steffen et al. 2015",
    },
    {
        "id": "ozone_depletion",
        "name": "Stratospheric Ozone Depletion",
        "description": "Stratospheric O3 concentration",
        "global_limit": 275.0,
        "global_limit_unit": "DU",
        "control_variable": "Stratospheric O3 concentration",
        "status": "safe",
        "source": "Steffen et al. 2015",
    },
    {
        "id": "nitrogen_flow",
        "name": "Biogeochemical Flows (N)",
        "description": "Industrial and intentional biological fixation of N",
        "global_limit": 62.0,
        "global_limit_unit": "Tg N/yr",
        "control_variable": "N fixation",
        "status": "beyond_boundary",
        "source": "Steffen et al. 2015",
    },
    {
        "id": "phosphorus_flow",
        "name": "Biogeochemical Flows (P)",
        "description": "P flow from freshwater systems into the ocean",
        "global_limit": 11.0,
        "global_limit_unit": "Tg P/yr",
        "control_variable": "P flow to ocean",
        "status": "beyond_boundary",
        "source": "Steffen et al. 2015",
    },
    {
        "id": "land_system_change",
        "name": "Land-System Change",
        "description": "Area of forested land as % of original forest cover",
        "global_limit": 75.0,
        "global_limit_unit": "% forest cover",
        "control_variable": "Forested land area",
        "status": "beyond_boundary",
        "source": "Steffen et al. 2015",
    },
    {
        "id": "freshwater_use",
        "name": "Freshwater Use",
        "description": "Global consumptive blue water use",
        "global_limit": 4000.0,
        "global_limit_unit": "km³/yr",
        "control_variable": "Consumptive blue water use",
        "status": "safe",
        "source": "Steffen et al. 2015",
    },
    {
        "id": "biosphere_integrity",
        "name": "Biosphere Integrity",
        "description": "Functional and genetic diversity",
        "global_limit": 10.0,
        "global_limit_unit": "E/MSY",
        "control_variable": "Extinction rate",
        "status": "beyond_boundary",
        "source": "Steffen et al. 2015",
    },
    {
        "id": "novel_entities",
        "name": "Novel Entities",
        "description": "Chemical pollution and plastics",
        "global_limit": None,
        "global_limit_unit": "not quantified",
        "control_variable": "Various",
        "status": "beyond_boundary",
        "source": "Persson et al. 2022",
    },
    {
        "id": "atmospheric_aerosol",
        "name": "Atmospheric Aerosol Loading",
        "description": "Aerosol optical depth",
        "global_limit": 0.25,
        "global_limit_unit": "AOD",
        "control_variable": "Aerosol optical depth",
        "status": "increasing_risk",
        "source": "Steffen et al. 2015",
    },
]


SHARING_PRINCIPLES: list[dict] = [
    {
        "id": "per_capita",
        "name": "Equal Per Capita",
        "description": "Global boundary divided equally by world population. "
                       "System share = (system population / world population) × global boundary.",
    },
    {
        "id": "per_gdp",
        "name": "GDP Share",
        "description": "Allocated proportionally to economic output. "
                       "System share = (system GDP / world GDP) × global boundary.",
    },
    {
        "id": "grandfathering",
        "name": "Grandfathering",
        "description": "Allocated based on historical contribution. System keeps its current share.",
    },
    {
        "id": "custom",
        "name": "Custom Allocation",
        "description": "User defines thresholds directly for each boundary indicator.",
    },
]


SUGGESTED_METHOD_MAPPINGS: dict[str, dict] = {
    "climate_change": {
        "keywords": ["climate change", "global warming", "gwp"],
        "suggested_methods": [
            ["EF v3.1", "climate change", "global warming potential (GWP100)"],
            ["IPCC 2021", "climate change", "GWP100"],
            ["CML v4.8 2016", "climate change", "global warming potential (GWP100)"],
        ],
    },
    "ocean_acidification": {
        "keywords": ["acidification", "ocean"],
        "suggested_methods": [],
    },
    "nitrogen_flow": {
        "keywords": ["eutrophication", "nitrogen", "marine"],
        "suggested_methods": [
            ["EF v3.1", "eutrophication: marine",
             "fraction of nutrients reaching marine end compartment (N)"],
        ],
    },
    "phosphorus_flow": {
        "keywords": ["eutrophication", "phosphorus", "freshwater"],
        "suggested_methods": [
            ["EF v3.1", "eutrophication: freshwater",
             "fraction of nutrients reaching freshwater end compartment (P)"],
        ],
    },
    "freshwater_use": {
        "keywords": ["water use", "freshwater", "water scarcity", "water"],
        "suggested_methods": [
            ["EF v3.1", "water use",
             "user deprivation potential (deprivation-weighted water consumption)"],
        ],
    },
    "land_system_change": {
        "keywords": ["land use", "land occupation", "land transformation"],
        "suggested_methods": [
            ["EF v3.1", "land use", "soil quality index"],
        ],
    },
    "ozone_depletion": {
        "keywords": ["ozone", "odp"],
        "suggested_methods": [
            ["EF v3.1", "ozone depletion", "ozone depletion potential (ODP)"],
        ],
    },
    "biosphere_integrity": {
        "keywords": ["biodiversity", "ecotoxicity"],
        "suggested_methods": [],
    },
    "atmospheric_aerosol": {
        "keywords": ["particulate", "pm2.5", "pm", "aerosol"],
        "suggested_methods": [
            ["EF v3.1", "particulate matter formation", "impact on human health"],
        ],
    },
    "novel_entities": {
        "keywords": ["toxicity", "human toxicity", "cancer", "non-cancer"],
        "suggested_methods": [],
    },
}


# ── Helpers exposed for the API ──────────────────────────────────────────────


def _boundary_name(boundary_id: str) -> str:
    for b in DEFAULT_BOUNDARIES:
        if b["id"] == boundary_id:
            return b["name"]
    return boundary_id


def suggest_mappings_for_methods(method_tuples: list[list[str]]) -> list[dict]:
    """For each method, pick the first boundary whose keyword list matches any
    token in the method label. Returns list of
    ``{"method_tuple": [...], "boundary_id": str | None, "match_score": int}``
    — the frontend shows the suggestion; the user confirms or overrides.
    """
    out: list[dict] = []
    for m in method_tuples:
        label = " ".join(m).lower()
        best_id: str | None = None
        best_score = 0
        for boundary_id, spec in SUGGESTED_METHOD_MAPPINGS.items():
            score = 0
            for kw in spec.get("keywords", []):
                if kw.lower() in label:
                    score += 1
            if score > best_score:
                best_id = boundary_id
                best_score = score
        out.append({
            "method_tuple": list(m),
            "boundary_id": best_id,
            "match_score": best_score,
        })
    return out


def compute_per_capita_threshold(
    global_limit: float,
    system_population: float,
    world_population: float = 8e9,
) -> float:
    if world_population <= 0:
        return 0.0
    return (system_population / world_population) * global_limit


# ── Assessment ───────────────────────────────────────────────────────────────


class AESAEngine:
    """Stateless assessor. Call ``assess(impact_results, config)``."""

    SAFE_THRESHOLD = 0.8  # ratio < 0.8 → safe
    CAUTION_THRESHOLD = 1.0  # 0.8 ≤ ratio < 1.0 → caution, else exceeded

    @classmethod
    def _status_for_ratio(cls, ratio: float) -> str:
        if ratio < cls.SAFE_THRESHOLD:
            return "safe"
        if ratio < cls.CAUTION_THRESHOLD:
            return "caution"
        return "exceeded"

    @classmethod
    def assess(
        cls,
        impact_results: list[MFALCAResult],
        config: AESAConfiguration,
    ) -> AESAResult:
        # method_tuple (joined) → MFALCAResult for fast lookup
        results_by_method: dict[str, MFALCAResult] = {
            "|".join(r.method): r for r in impact_results
        }

        # Build (boundary_id, year) → threshold lookup from custom_thresholds.
        thresholds: dict[tuple[str, int | None], float] = {}
        threshold_units: dict[str, str] = {}
        for alloc in config.custom_thresholds:
            thresholds[(alloc.boundary_id, alloc.year)] = alloc.allocated_threshold
            threshold_units[alloc.boundary_id] = alloc.allocated_unit

        def resolve_threshold(boundary_id: str, year: int) -> float | None:
            if (boundary_id, year) in thresholds:
                return thresholds[(boundary_id, year)]
            if (boundary_id, None) in thresholds:
                return thresholds[(boundary_id, None)]
            return None

        # Collect all years across mapped methods.
        all_years: set[int] = set()
        for mapping in config.method_mapping:
            mkey = "|".join(mapping.method_tuple)
            mres = results_by_method.get(mkey)
            if not mres:
                continue
            for yr in mres.years:
                all_years.add(yr.year)
        sorted_years = sorted(all_years)

        years_out: list[AESAYearResult] = []
        # Boundary → list of ratios over years, used for trend + summary.
        ratios_over_time: dict[str, list[tuple[int, float]]] = {}

        for y in sorted_years:
            indicators: list[AESAIndicatorResult] = []
            for mapping in config.method_mapping:
                mkey = "|".join(mapping.method_tuple)
                mres = results_by_method.get(mkey)
                if not mres:
                    continue
                yr = next((yy for yy in mres.years if yy.year == y), None)
                if yr is None:
                    continue
                impact_raw = yr.total_impact * (mapping.conversion_factor or 1.0)
                threshold = resolve_threshold(mapping.boundary_id, y)
                if threshold is None or threshold == 0:
                    continue
                ratio = impact_raw / threshold
                status = cls._status_for_ratio(ratio)
                bname = _boundary_name(mapping.boundary_id)
                indicators.append(AESAIndicatorResult(
                    boundary_id=mapping.boundary_id,
                    boundary_name=bname,
                    method_label=mres.method_label or " › ".join(mres.method),
                    impact_value=impact_raw,
                    threshold_value=threshold,
                    ratio=ratio,
                    unit=threshold_units.get(mapping.boundary_id) or mres.unit or "",
                    status=status,
                ))
                ratios_over_time.setdefault(mapping.boundary_id, []).append((y, ratio))
            years_out.append(AESAYearResult(year=y, indicators=indicators))

        summary = cls._build_summary(years_out, ratios_over_time)
        return AESAResult(config_id=config.id, years=years_out, summary=summary)

    @classmethod
    def _build_summary(
        cls,
        years_out: list[AESAYearResult],
        ratios_over_time: dict[str, list[tuple[int, float]]],
    ) -> AESASummary:
        if not years_out:
            return AESASummary(
                boundaries_assessed=0, boundaries_safe=0,
                boundaries_caution=0, boundaries_exceeded=0,
            )

        # Use the last year for safe/caution/exceeded counts + worst/best.
        last = years_out[-1]
        n_safe = sum(1 for i in last.indicators if i.status == "safe")
        n_caution = sum(1 for i in last.indicators if i.status == "caution")
        n_exceeded = sum(1 for i in last.indicators if i.status == "exceeded")

        worst = ""
        best = ""
        if last.indicators:
            worst = max(last.indicators, key=lambda i: i.ratio).boundary_name
            best = min(last.indicators, key=lambda i: i.ratio).boundary_name

        # Trend: average ratio change from first→last year across all boundaries.
        # > +5% → worsening; < -5% → improving; else stable.
        deltas: list[float] = []
        for _bid, series in ratios_over_time.items():
            if len(series) < 2:
                continue
            series_sorted = sorted(series, key=lambda t: t[0])
            first_ratio = series_sorted[0][1]
            last_ratio = series_sorted[-1][1]
            if first_ratio == 0:
                continue
            deltas.append((last_ratio - first_ratio) / abs(first_ratio))
        if not deltas:
            trend = "stable"
        else:
            avg = sum(deltas) / len(deltas)
            if avg > 0.05:
                trend = "worsening"
            elif avg < -0.05:
                trend = "improving"
            else:
                trend = "stable"

        return AESASummary(
            boundaries_assessed=len(last.indicators),
            boundaries_safe=n_safe,
            boundaries_caution=n_caution,
            boundaries_exceeded=n_exceeded,
            worst_indicator=worst,
            best_indicator=best,
            trend=trend,
        )
