"""AESA engine: N-layer downscaling chain (generalization of Multi-D,
Ferhati et al., SETAC 36th).

Given an Impact Assessment result (per-year total system impact per LCIA
method), produce Sustainability Ratios (SR = impact / allocated_SOS) for
each Planetary Boundary category and year. Allocated SOS is computed as the
product of user-defined downscaling layers; each layer applies either a
category-specific principle or a fixed principle across all categories.

Legacy ``MultiDConfig`` (2-layer: category principle × sector share) is
auto-migrated to an equivalent 2-layer chain on the fly.

Reference data is loaded from ``mapper/data/aesa/*.json`` (boundary sets,
SSP trajectories, carbon budgets, default sharing values).
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from mapper.models.aesa_schemas import (
    AESAComputeResult,
    AESAConfiguration,
    AESAYearSummary,
    BoundarySet,
    CarbonBudgetConfig,
    CategoryAssignment,
    DownscalingChain,
    DownscalingLayer,
    MethodPBMapping,
    MultiDConfig,
    PlanetaryBoundary,
    PrincipleDefinition,
    SharingPreset,
    SharingPrincipleConfig,
    SustainabilityRatioResult,
)
from mapper.models.bom_schemas import DSMLCAResult


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
    # Patch 5AO/5AR — fresh-config defaults: IPCC AR6 2.0°C 50th-pct (1150 Gt
    # from 2025) × SSP2-4.5. (Was 1.5°C/67th 200 Gt.)
    # `end_year` is the BUDGET ALLOCATION horizon only —
    # annual_global_allocation(t) = remaining_budget(t) / (end_year - t) — NOT
    # the study/SR-timeline window (that comes from the DSM fleet trajectory's
    # years, `mres.years` in AESAEngine.compute). The remaining budget is framed
    # over the full century, so allocate to 2100; truncating to the 2050 study
    # window (5AO) compressed a ~75-yr budget into ~25 yrs, inflating the
    # per-year safe allocation and collapsing the climate-change SR (5AR fix).
    budget_option_id: str = "IPCC_AR6_2C_50",
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


# ─── Built-in principles + default Ferhati preset ───────────────────────────


BUILTIN_PRINCIPLES: list[PrincipleDefinition] = [
    PrincipleDefinition(id="EpC", name="Equal per Capita",
                        description="Population share of your assessed entity vs global total"),
    PrincipleDefinition(id="IN", name="Industrial Output",
                        description="Share of global industrial output / GVA"),
    PrincipleDefinition(id="AGR", name="Agricultural Output",
                        description="Share of global agricultural output / GVA"),
    PrincipleDefinition(id="LA", name="Land Area",
                        description="Share of global land area"),
    PrincipleDefinition(id="AR", name="Acquired Rights",
                        description="Historical / grandfathered emissions or activity share"),
]


# Provisional 3-layer split for the built-in preset. Layer 2 (sector share of
# national burden) and Layer 3 (sub-sector share of the sector) are example
# placeholders — users should duplicate the preset and edit for their case.
_DEFAULT_LAYER2_AR = 0.25
_DEFAULT_LAYER3_AR = 0.60
_DEFAULT_BASE_YEAR = 2025
_BUILTIN_PRESET_ID = "ferhati_2026_multi_d"


def _layer1_data_from_sharing(sharing: dict) -> dict[str, dict[int, tuple[float, float]]]:
    """Build {principle → {year: (sys, glob)}} from sharing_data.json defaults."""
    raw = sharing.get("layer1_defaults", {})
    out: dict[str, dict[int, tuple[float, float]]] = {}
    for pid, d in raw.items():
        out[pid] = {
            _DEFAULT_BASE_YEAR: (
                float(d.get("system_value", 0.0)),
                float(d.get("global_value", 1.0)),
            )
        }
    return out


def build_default_sharing_preset(sharing: dict | None = None) -> SharingPreset:
    """Build the read-only built-in sharing preset (3-layer Ferhati et al. 2026)."""
    data = sharing or load_sharing_data()

    layer1 = DownscalingLayer(
        layer_number=1,
        name="Global → Country",
        principle_mode="category_specific",
        description="Allocates each PB category via its assigned principle.",
        data=_layer1_data_from_sharing(data),
    )
    layer2 = DownscalingLayer(
        layer_number=2,
        name="Country → Sector",
        principle_mode="fixed",
        fixed_principle="AR",
        description="Grandfathering: sector share of the national environmental burden.",
        data={"AR": {_DEFAULT_BASE_YEAR: (_DEFAULT_LAYER2_AR, 1.0)}},
    )
    layer3 = DownscalingLayer(
        layer_number=3,
        name="Sector → Sub-sector",
        principle_mode="fixed",
        fixed_principle="AR",
        description="Grandfathering: sub-sector share of the sector.",
        data={"AR": {_DEFAULT_BASE_YEAR: (_DEFAULT_LAYER3_AR, 1.0)}},
    )
    assignments = [
        CategoryAssignment(pb_id=pb_id, principle_id=principle, justification=just)
        for pb_id, (principle, just) in MULTI_D_DEFAULTS.items()
    ]
    return SharingPreset(
        id=_BUILTIN_PRESET_ID,
        name="Ferhati et al. 2026 — Multi-D",
        description=(
            "Provisional 3-layer downscaling: Global → Country → Sector → Sub-sector. "
            "Built-in (read-only). Duplicate to customize for your case study."
        ),
        built_in=True,
        principles=list(BUILTIN_PRINCIPLES),
        category_assignments=assignments,
        chain=DownscalingChain(layers=[layer1, layer2, layer3]),
        created_at=datetime.now(timezone.utc).isoformat(),
        updated_at=datetime.now(timezone.utc).isoformat(),
    )


# ─── Legacy MultiDConfig → chain-preset migration ───────────────────────────


def _sp_to_year_data(sp: SharingPrincipleConfig) -> dict[int, tuple[float, float]]:
    """Convert a legacy SharingPrincipleConfig into {year: (sys, glob)}.

    Preserves time series when present; falls back to a single base-year
    constant when neither series is provided."""
    sys_ts = sp.system_time_series or {}
    glob_ts = sp.global_time_series or {}
    years = sorted(set(sys_ts) | set(glob_ts))
    if not years:
        return {_DEFAULT_BASE_YEAR: (sp.system_value, sp.global_value)}
    out: dict[int, tuple[float, float]] = {}
    for y in years:
        s = sys_ts.get(y, sp.system_value)
        g = glob_ts.get(y, sp.global_value)
        out[y] = (float(s), float(g))
    return out


def migrate_multi_d_to_preset(multi_d: MultiDConfig) -> SharingPreset:
    """Convert a legacy 2-layer MultiDConfig into an equivalent SharingPreset.

    Layer 1 = category_specific using the principle assigned per PB in
    ``multi_d.layer1``. Layer 2 = fixed AR with ``layer2_sector_share``.
    """
    # Aggregate unique principle data. When the same principle is referenced
    # by multiple PBs with different (sys, glob), the first wins — in practice
    # they're identical because the legacy builder replicated a shared value.
    principle_data: dict[str, dict[int, tuple[float, float]]] = {}
    principles_seen: list[str] = []
    assignments: list[CategoryAssignment] = []
    for pb_id, sp in multi_d.layer1.items():
        principles_seen.append(sp.principle)
        if sp.principle not in principle_data:
            principle_data[sp.principle] = _sp_to_year_data(sp)
        assignments.append(CategoryAssignment(
            pb_id=pb_id, principle_id=sp.principle, justification=sp.justification,
        ))

    layer1 = DownscalingLayer(
        layer_number=1,
        name="Global → Country",
        principle_mode="category_specific",
        data=principle_data,
    )
    layer2 = DownscalingLayer(
        layer_number=2,
        name="Country → Sector",
        principle_mode="fixed",
        fixed_principle="AR",
        description=multi_d.layer2_source or "Sector share of the national burden",
        data={"AR": {_DEFAULT_BASE_YEAR: (multi_d.layer2_sector_share, 1.0)}},
    )

    # Principles = built-ins ∩ seen, plus any unknown custom ones seen.
    builtin_by_id = {p.id: p for p in BUILTIN_PRINCIPLES}
    principles: list[PrincipleDefinition] = []
    added: set[str] = set()
    for pid in principles_seen:
        if pid in added:
            continue
        added.add(pid)
        if pid in builtin_by_id:
            principles.append(builtin_by_id[pid])
        else:
            principles.append(PrincipleDefinition(id=pid, name=pid, description=""))

    return SharingPreset(
        id="migrated",
        name="Migrated (legacy 2-layer)",
        description="Auto-migrated from legacy MultiDConfig.",
        built_in=False,
        principles=principles,
        category_assignments=assignments,
        chain=DownscalingChain(layers=[layer1, layer2]),
    )


def resolve_sharing(config: AESAConfiguration) -> SharingPreset:
    """Return the effective SharingPreset for a config, migrating if needed."""
    if config.sharing is not None:
        return config.sharing
    if config.multi_d is not None:
        return migrate_multi_d_to_preset(config.multi_d)
    # No sharing information at all → fall back to built-in default.
    return build_default_sharing_preset()


# ─── Method → PB auto-mapping ────────────────────────────────────────────────


def suggest_method_mapping(
    methods: list[list[str]], boundary_set: BoundarySet,
) -> list[MethodPBMapping]:
    """Map LCIA methods to Planetary Boundaries by exact match against
    ``method[1]``.

    The boundary set's ``ef_indicator`` strings are intentionally authored
    to match BW2's ``method[1]`` directly (e.g.
    ``"climate change"``, ``"human toxicity: non-carcinogenic"``,
    ``"eutrophication: freshwater"``). Exact match is the only
    methodologically defensible mapping rule — substring-based token
    matching (the pre-Patch-4W approach) produced two failure modes:

    1. **Sub-component over-matching.** EF v3.1 ships
       ``("EF v3.1", "climate change", ...)`` AND
       ``("EF v3.1", "climate change: biogenic", ...)`` /
       ``"climate change: fossil"`` /
       ``"climate change: land use and land use change"``. Token
       substring matching scored all four against the single
       ``climate_change`` PB (tokens ``[climate, change]`` are present
       as substrings in each). The downstream engine then produced
       four ``SustainabilityRatioResult`` rows for the same
       ``(year, climate_change)`` bucket, one per source method. The
       AESA frontend's ``Map.set`` keyed by ``(year, pb_id)`` retained
       only the LAST iteration → users saw whichever sub-component's
       curve happened to be processed last, NOT the aggregate that
       Sala 2020 PB-EF requires.

    2. **Cancer/non-cancer cross-match.** ``"carcinogenic"`` is a
       substring of ``"non-carcinogenic"``. The non-cancer method's
       label substring-contains all three of the cancer PB's tokens →
       ties the score, and strict-greater iteration order picks the
       cancer PB (declared first in the boundary set). The non-cancer
       PB then receives no method → "1 method unmapped" warning. The
       non-cancer impact is silently characterized against the cancer
       boundary — invalid output.

    Exact match is the fix:

    - Climate change: only the aggregate method's
      ``method[1] == "climate change"`` matches the
      ``climate_change.ef_indicator``. Sub-components don't match any
      PB and are correctly omitted (they're diagnostic decomposition,
      not PB characterization sources).
    - Human toxicity: ``"human toxicity: carcinogenic"`` exact-matches
      cancer PB, ``"human toxicity: non-carcinogenic"`` exact-matches
      non-cancer PB. No cross-talk.

    Methods with no exact match are skipped — the caller's
    ``missing_categories`` field surfaces PBs that didn't receive a
    matching method, and the frontend offers a manual override path.
    """
    out: list[MethodPBMapping] = []
    # Pre-build {ef_indicator (lowered) → pb_id} lookup. Boundary
    # sets are small (~16 entries) so this is O(N) per call.
    by_ef_indicator: dict[str, str] = {
        pb.ef_indicator.lower().strip(): pb.id
        for pb in boundary_set.boundaries.values()
    }
    for m in methods:
        if len(m) < 2:
            continue
        key = m[1].lower().strip()
        pb_id = by_ef_indicator.get(key)
        if pb_id is not None:
            out.append(MethodPBMapping(method_tuple=list(m), pb_id=pb_id))
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
        impact_results: list[DSMLCAResult],
        config: AESAConfiguration,
        boundary_set: BoundarySet,
    ) -> AESAComputeResult:
        preset = resolve_sharing(config)
        chain = preset.chain
        assignments = preset.assignments_map()

        # Resolve method_mapping: use config.method_mapping or auto-suggest.
        mapping = config.method_mapping
        if not mapping:
            methods = [list(r.method) for r in impact_results]
            mapping = suggest_method_mapping(methods, boundary_set)

        # Method tuple (joined) → DSMLCAResult
        results_by_method: dict[str, DSMLCAResult] = {
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

                layer_factors = chain.per_layer_factors(pb.id, yr.year, assignments)
                total_factor = 1.0
                for f in layer_factors:
                    total_factor *= f

                # Allocated SOS
                remaining_budget_gt: float | None = None
                global_allocation_gt: float | None = None
                if pb.boundary_type == "cumulative" and config.carbon_budget is not None:
                    cb = config.carbon_budget
                    # Patch 5AS — capture the same intermediates
                    # `annual_system_allocation` derives, to surface on the row
                    # (pure deterministic functions → no drift vs `allocated`).
                    remaining_budget_gt = cb.remaining_budget(yr.year)
                    global_allocation_gt = cb.annual_global_allocation(yr.year)
                    allocated = cb.annual_system_allocation(
                        yr.year, chain, assignments,
                    )
                else:
                    allocated = pb.pb_value * total_factor

                sr: float | None
                if allocated <= 0:
                    sr = None
                    zone = "high_risk"
                else:
                    sr = impact / allocated
                    zone = _zone_for_sr(sr)

                principle = chain.category_layer_principle(pb.id, assignments)
                l1 = layer_factors[0] if layer_factors else 0.0
                l_rest = 1.0
                for f in layer_factors[1:]:
                    l_rest *= f

                sr_results.append(SustainabilityRatioResult(
                    year=yr.year,
                    pb_id=pb.id,
                    pb_name=pb.name,
                    ef_indicator=pb.ef_indicator,
                    impact=impact,
                    allocated_sos=allocated,
                    sr=sr,
                    remaining_budget_gt=remaining_budget_gt,
                    global_allocation_gt=global_allocation_gt,
                    zone=zone,
                    sharing_principle=principle,
                    layer_factors=layer_factors,
                    total_sharing_factor=total_factor,
                    sharing_factor_l1=l1,
                    sharing_factor_l2=l_rest,
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
        impact_results: list[DSMLCAResult],
        config: AESAConfiguration,
        boundary_set: BoundarySet,
    ) -> AESAComputeResult:
        """Run compute() once with the configured chain, then run one variant
        per principle in the active preset — each variant flips every
        ``category_specific`` layer to ``fixed`` with that principle. Attached
        under ``sensitivity`` (dict principle_id → results).
        """
        base = cls.compute(impact_results, config, boundary_set)
        preset = resolve_sharing(config)

        sensitivity: dict[str, list[SustainabilityRatioResult]] = {}
        # Only test principles that have data at every category_specific layer.
        # Fixed layers stay as-is (their principles are already determined).
        cat_layers = [ly for ly in preset.chain.layers
                      if ly.principle_mode == "category_specific"]
        for principle in preset.principles:
            if cat_layers and not all(principle.id in ly.data for ly in cat_layers):
                continue
            variant_assignments = [
                CategoryAssignment(
                    pb_id=a.pb_id, principle_id=principle.id,
                    justification=a.justification,
                )
                for a in preset.category_assignments
            ]
            variant_preset = preset.model_copy(update={
                "category_assignments": variant_assignments,
            })
            variant_cfg = config.model_copy(update={
                "sharing": variant_preset,
                "multi_d": None,  # ensure sharing takes precedence
            })
            var_result = cls.compute(impact_results, variant_cfg, boundary_set)
            sensitivity[principle.id] = var_result.results

        return base.model_copy(update={"sensitivity": sensitivity})
