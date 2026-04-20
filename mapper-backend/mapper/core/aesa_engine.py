"""AESA engine: Multi-Dimensional allocation model (Ferhati et al., SETAC 36th).

Given an Impact Assessment result (per-year total fleet impact per LCIA
method), produce Sustainability Ratios (SR = impact / allocated_SOS) for
each Planetary Boundary category and year. Allocated SOS is computed via
two-layer Multi-D downscaling (global → entity → sector) with a per-category
first-layer sharing principle and fixed-grandfathering second layer.

Reference data is loaded from ``mapper/data/aesa/*.json`` (boundary sets,
SSP trajectories, carbon budgets, default sharing values).
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from mapper.models.aesa_schemas import (
    AESAComputeResult,
    AESAConfiguration,
    AESAYearSummary,
    BoundarySet,
    CarbonBudgetConfig,
    MethodPBMapping,
    MultiDConfig,
    PlanetaryBoundary,
    SharingPrincipleConfig,
    SustainabilityRatioResult,
)
from mapper.models.bom_schemas import MFALCAResult


DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "aesa"


# ─── Multi-D defaults (per poster) ───────────────────────────────────────────


MULTI_D_DEFAULTS: dict[str, tuple[str, str]] = {
    "acidification":                 ("EpC", "Global issue, equal right"),
    "climate_change":                ("EpC", "Global issue, equal right"),
    "ecotoxicity_freshwater":        ("EpC", "Equal right"),
    "resource_use_fossils":          ("IN",  "Industrial causation"),
    "eutrophication_marine":         ("AGR", "Driven by food system"),
    "eutrophication_freshwater":     ("AGR", "Driven by food system"),
    "eutrophication_terrestrial":    ("AGR", "Driven by food system"),
    "human_toxicity_cancer":         ("EpC", "Equal rights"),
    "human_toxicity_non_cancer":     ("EpC", "Equal rights"),
    "ionising_radiation":            ("EpC", "Equal rights"),
    "land_use":                      ("LA",  "Land-based"),
    "resource_use_minerals_metals":  ("IN",  "Industrial causation"),
    "ozone_depletion":               ("AR",  "Legacy responsibility"),
    "particulate_matter":            ("AR",  "Legacy responsibility"),
    "photochemical_ozone_formation": ("AR",  "Legacy responsibility"),
    "water_use":                     ("EpC", "Global issue, equal right"),
}


# ─── Built-in data loaders ───────────────────────────────────────────────────


def _read_json(name: str) -> dict:
    return json.loads((DATA_DIR / name).read_text(encoding="utf-8"))


def load_boundary_sets() -> dict[str, BoundarySet]:
    raw = _read_json("boundary_sets.json")
    out: dict[str, BoundarySet] = {}
    for s in raw.get("sets", []):
        boundaries = {
            bid: PlanetaryBoundary(**bdata)
            for bid, bdata in s["boundaries"].items()
        }
        out[s["id"]] = BoundarySet(
            id=s["id"], name=s["name"], source=s["source"],
            boundaries=boundaries,
        )
    return out


def load_sharing_data() -> dict:
    return _read_json("sharing_data.json")


def load_carbon_budget_options() -> list[dict]:
    raw = _read_json("carbon_budgets.json")
    return raw.get("options", [])


def load_ssp_trajectories() -> list[dict]:
    raw = _read_json("ssp_trajectories.json")
    scenarios = raw.get("scenarios", [])
    for s in scenarios:
        s["projected_emissions"] = _expand_ssp_anchors(s["anchors_gt_co2"])
    return scenarios


def _expand_ssp_anchors(anchors: dict) -> dict[int, float]:
    """Linear-interpolate between anchor years → annual dict year→Gt CO2."""
    items = sorted(((int(y), float(v)) for y, v in anchors.items()), key=lambda t: t[0])
    if not items:
        return {}
    out: dict[int, float] = {}
    for (y0, v0), (y1, v1) in zip(items, items[1:]):
        span = max(1, y1 - y0)
        for y in range(y0, y1):
            t = (y - y0) / span
            out[y] = v0 + (v1 - v0) * t
    out[items[-1][0]] = items[-1][1]
    return out


# ─── Default config builders ─────────────────────────────────────────────────


def build_default_multi_d_config(sharing: dict | None = None) -> MultiDConfig:
    """Build a MultiDConfig with MULTI_D_DEFAULTS principles applied to all
    boundaries, using the values from sharing_data.json."""
    data = sharing or load_sharing_data()
    layer1_data = data.get("layer1_defaults", {})
    layer2 = data.get("layer2", {})

    def _sp_cfg(principle: str, justification: str) -> SharingPrincipleConfig:
        d = layer1_data.get(principle, {})
        return SharingPrincipleConfig(
            principle=principle,
            justification=justification,
            system_value=float(d.get("system_value", 1.0)),
            global_value=float(d.get("global_value", 1.0)),
        )

    layer1 = {
        pb_id: _sp_cfg(principle, just)
        for pb_id, (principle, just) in MULTI_D_DEFAULTS.items()
    }
    return MultiDConfig(
        layer1=layer1,
        layer2_sector_share=float(layer2.get("sector_share", 0.1)),
        layer2_source=str(layer2.get("source", "")),
    )


def build_carbon_budget(
    budget_option_id: str = "IPCC_AR6_1p5C_67",
    ssp_id: str = "SSP2-4.5",
    start_year: int = 2025,
    end_year: int = 2100,
) -> CarbonBudgetConfig:
    opts = {o["id"]: o for o in load_carbon_budget_options()}
    ssps = {s["id"]: s for s in load_ssp_trajectories()}
    budget = opts.get(budget_option_id)
    if budget is None:
        raise ValueError(f"Unknown carbon budget option: {budget_option_id}")
    ssp = ssps.get(ssp_id)
    if ssp is None:
        raise ValueError(f"Unknown SSP scenario: {ssp_id}")
    return CarbonBudgetConfig(
        initial_budget_gt=float(budget["remaining_gt_from_2025"]),
        budget_source=str(budget["source"]),
        start_year=start_year,
        end_year=end_year,
        projected_emissions={int(y): float(v) for y, v in ssp["projected_emissions"].items()},
        ssp_scenario=ssp_id,
        provisional=bool(budget.get("provisional", True) or ssp.get("provisional", True)),
    )


# ─── Method → PB auto-mapping ────────────────────────────────────────────────


def suggest_method_mapping(
    methods: list[list[str]], boundary_set: BoundarySet,
) -> list[MethodPBMapping]:
    """Token-match method[1] to PlanetaryBoundary.ef_indicator. Returns one
    mapping per method; methods with no match are skipped (caller can inspect
    the returned list to see which boundaries were covered)."""
    out: list[MethodPBMapping] = []
    for m in methods:
        if len(m) < 2:
            continue
        label = " ".join(m).lower()
        best_id: str | None = None
        best_score = 0
        for pb in boundary_set.boundaries.values():
            kw = pb.ef_indicator.lower()
            # score = number of whitespace-split tokens of ef_indicator present in label
            score = sum(1 for tok in kw.replace(":", "").split() if tok in label)
            if score > best_score:
                best_id = pb.id
                best_score = score
        if best_id and best_score > 0:
            out.append(MethodPBMapping(method_tuple=list(m), pb_id=best_id))
    return out


# ─── Engine ──────────────────────────────────────────────────────────────────


def _zone_for_sr(sr: float) -> Literal["safe", "zone_of_uncertainty", "high_risk"]:
    if sr <= 1.0:
        return "safe"
    if sr <= 2.0:
        return "zone_of_uncertainty"
    return "high_risk"


class AESAEngine:
    """Stateless compute: ``AESAEngine.compute(impact_results, config, boundary_set)``."""

    @classmethod
    def compute(
        cls,
        impact_results: list[MFALCAResult],
        config: AESAConfiguration,
        boundary_set: BoundarySet,
    ) -> AESAComputeResult:
        # Resolve method_mapping: use config.method_mapping or auto-suggest.
        mapping = config.method_mapping
        if not mapping:
            methods = [list(r.method) for r in impact_results]
            mapping = suggest_method_mapping(methods, boundary_set)

        # Method tuple (joined) → MFALCAResult
        results_by_method: dict[str, MFALCAResult] = {
            "|".join(r.method): r for r in impact_results
        }

        sr_results: list[SustainabilityRatioResult] = []
        matched_pb_ids: set[str] = set()

        for mp in mapping:
            pb = boundary_set.boundaries.get(mp.pb_id)
            if pb is None:
                continue
            mres = results_by_method.get("|".join(mp.method_tuple))
            if mres is None:
                continue
            matched_pb_ids.add(pb.id)

            for yr in mres.years:
                impact = yr.total_impact * mp.conversion_factor
                if impact == 0:
                    continue

                # Allocated SOS
                if pb.boundary_type == "cumulative" and config.carbon_budget is not None:
                    allocated = config.carbon_budget.annual_fleet_allocation(
                        yr.year, config.multi_d,
                    )
                else:
                    allocated = config.multi_d.compute_allocated_sos(
                        pb.id, pb.pb_value, yr.year,
                    )

                sr: float | None
                if allocated <= 0:
                    sr = None
                    zone = "high_risk"
                else:
                    sr = impact / allocated
                    zone = _zone_for_sr(sr)

                l1_factor = config.multi_d.layer1_factor(pb.id, yr.year)
                principle = config.multi_d.layer1_principle(pb.id)

                sr_results.append(SustainabilityRatioResult(
                    year=yr.year,
                    pb_id=pb.id,
                    pb_name=pb.name,
                    ef_indicator=pb.ef_indicator,
                    impact=impact,
                    allocated_sos=allocated,
                    sr=sr,
                    zone=zone,
                    sharing_principle=principle,
                    sharing_factor_l1=l1_factor,
                    sharing_factor_l2=config.multi_d.layer2_sector_share,
                    boundary_type=pb.boundary_type,
                    unit=pb.unit,
                    impact_by_cohort=dict(yr.impact_by_cohort),
                    method_label=mres.method_label or " › ".join(mres.method),
                ))

        # Summary per year: count zones
        by_year: dict[int, dict[str, int]] = {}
        for r in sr_results:
            d = by_year.setdefault(r.year, {"safe": 0, "zone_of_uncertainty": 0, "high_risk": 0})
            d[r.zone] += 1
        summary_by_year = [
            AESAYearSummary(
                year=y,
                safe=d["safe"],
                zone_of_uncertainty=d["zone_of_uncertainty"],
                high_risk=d["high_risk"],
                total_assessed=d["safe"] + d["zone_of_uncertainty"] + d["high_risk"],
            )
            for y, d in sorted(by_year.items())
        ]

        # Boundaries in set that never got a method hit
        missing = [
            pb.id for pb in boundary_set.boundaries.values()
            if pb.id not in matched_pb_ids
        ]

        return AESAComputeResult(
            config_id=config.id,
            results=sr_results,
            summary_by_year=summary_by_year,
            missing_categories=missing,
        )

    @classmethod
    def compute_with_sensitivity(
        cls,
        impact_results: list[MFALCAResult],
        config: AESAConfiguration,
        boundary_set: BoundarySet,
    ) -> AESAComputeResult:
        """Run compute() once with the configured Multi-D mix, then run five
        uniform-principle variants (all PBs use EpC, IN, AGR, LA, or AR) and
        attach them under ``sensitivity``."""
        base = cls.compute(impact_results, config, boundary_set)

        sharing = load_sharing_data()
        l1_data = sharing.get("layer1_defaults", {})
        sensitivity: dict = {}

        for principle in ("EpC", "IN", "AGR", "LA", "AR"):
            d = l1_data.get(principle, {})
            uniform_sp = SharingPrincipleConfig(
                principle=principle,
                justification=f"Sensitivity: all categories share via {principle}",
                system_value=float(d.get("system_value", 1.0)),
                global_value=float(d.get("global_value", 1.0)),
            )
            uniform_multi_d = MultiDConfig(
                layer1={pb_id: uniform_sp for pb_id in MULTI_D_DEFAULTS},
                layer2_sector_share=config.multi_d.layer2_sector_share,
                layer2_source=config.multi_d.layer2_source,
            )
            variant = config.model_copy(update={"multi_d": uniform_multi_d})
            var_result = cls.compute(impact_results, variant, boundary_set)
            sensitivity[principle] = var_result.results

        return base.model_copy(update={"sensitivity": sensitivity})
