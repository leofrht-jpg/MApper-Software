# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

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

from dataclasses import dataclass

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
    RatioCO2eConversion,
    SharingPreset,
    SharingPrincipleConfig,
    SustainabilityRatioResult,
)
from mapper.models.bom_schemas import (
    DSMLCAResult,
    DSMLCASummary,
    DSMLCAYearResult,
    ImpactAssessmentMeta,
    ImpactAssessmentResult,
)
from mapper.models.schemas import ArchetypeLCACalculateResult


DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "aesa"


# ─── Multi-D defaults (per poster) ───────────────────────────────────────────


MULTI_D_DEFAULTS: dict[str, tuple[str, str]] = {
    # Methodological correction: acidification is driven predominantly by
    # agricultural emissions (NH3 from livestock and fertiliser), so the
    # agricultural-output principle allocates it, not equal-per-capita.
    # Same rationale family as the three eutrophication boundaries below.
    "acidification":                 ("AGR", "Driven by agricultural emissions (NH3)"),
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
            computable=s.get("computable", True),  # Patch 2c — default True (back-compat)
        )
    return out


def load_sharing_data() -> dict:
    return _read_json("sharing_data.json")


def load_carbon_budget_options() -> list[dict]:
    raw = _read_json("carbon_budgets.json")
    return raw.get("options", [])


@dataclass(frozen=True)
class CarbonBudgetVintage:
    """The budget data's baseline years, read from ``carbon_budgets.json``.

    The AR6 budgets are published "from the beginning of 2020"
    (``reference_year``); MApper ships them re-baselined to the start of
    ``base_year`` by deducting the cumulative emissions of
    ``reference_year..deduction_end_year``.

    ONE place writes this vintage down: the data file. Everything that used to
    hardcode "2025" now derives it from here — ``build_carbon_budget``'s
    ``start_year`` default and the config-workbook Reference sheet's
    "N Gt from YYYY" detail. A re-baselining (say to 2030) is then a data edit
    that moves every dependent surface, and fails
    ``test_carbon_budget_vintage_is_read_from_the_data_file`` if a consumer is
    left behind — where previously the test asserted 2025 against the same 2025
    it was derived from and would have stayed green.
    """
    reference_year: int       # AR6's own baseline (budgets "from 2020")
    deduction_end_year: int   # last year covered by the deduction
    consumed_gt: float        # the deduction itself, Gt CO2

    @property
    def base_year(self) -> int:
        """The year MApper's budgets are counted from — start of the first year
        NOT covered by the deduction."""
        return self.deduction_end_year + 1

    @property
    def deducted_years(self) -> int:
        return self.deduction_end_year - self.reference_year + 1


def carbon_budget_vintage() -> CarbonBudgetVintage:
    raw = _read_json("carbon_budgets.json")
    return CarbonBudgetVintage(
        reference_year=int(raw["start_year_reference"]),
        deduction_end_year=int(raw["deduction_end_year"]),
        consumed_gt=float(raw["consumed_2020_2024_gt"]),
    )


# ── CO2 → CO2e (Kyoto-gases, GWP100) budget-basis conversion (sourced) ───────
# One METHOD, refitted per temperature target: map a CUMULATIVE-FROM-2020 CO2
# budget x (GtCO2) to the cumulative-from-2020 CO2e budget y (GtCO2e) with an
# affine y = m·x + b regressed over the AR6 scenario category that MATCHES the
# target, then re-baseline to AESA's from-2025 framing by subtracting C, the
# 2020-2024 cumulative CO2e of THAT SAME category set.
#
# The approach is Meinshausen et al. (2018; 2019) as applied by Tilsted, J.P. &
# Bjorn, A. (2023) "Green frontrunner or indebted culprit? ...", Climatic Change
# 176:103, doi:10.1007/s10584-023-03583-4, section 2. Their published 1.5C fit
# (m=1.1614, b=157.27, R=0.80, N=80, domain x∈[223,427]) is recorded below as
# TILSTED_BJORN_2023_PUBLISHED for comparison; it is NOT used in compute. Their
# fit is over the SR15-era IAMC 1.5C Scenario Explorer (Huppmann et al. 2019);
# both legs here are refitted over AR6 so the two targets are treated alike.
#
# THE AFFINE AND THE OFFSET MUST COME FROM THE SAME CATEGORY SET. They used to
# be separate module constants — two affines branched by target, but ONE
# unconditional offset taken over C3+C4 — so 1.5C budgets were re-baselined with
# a 2C ensemble's five years of emissions. Binding them into one object per
# target makes that mismatch unrepresentable: a third target cannot be added
# without supplying both, and `test_no_target_mixes_ensembles` fails if a fit's
# declared ensemble disagrees with the categories in its own data files.
#
# THAT DATA CHECK IS THE MIX-UP GUARD, NOT THE SANITY BAND. The band in
# `test_factor_values_in_sanity_band` ([1.45, 2.20] + the budget ordering)
# catches gross STRUCTURAL errors — a dropped or sign-flipped term, a unit
# error, conflated baselines — but it does NOT catch an ensemble mix-up: the
# mismatch that actually shipped before the refit lands every factor inside the
# band with the ordering intact. Measured, with the full injected-error table,
# in the README's "What the sanity band does and does not catch".
#
# TWO PROPERTIES OF f WORTH KNOWING BEFORE CHANGING ANY OF THIS (README A1/A2):
#   A1  f mixes provenance by construction — x25 carries the OBSERVED 200 GtCO2
#       deduction (GCB 2024) while C is a MODELLED ensemble median. No option is
#       pure, because x20 is an AR6-ASSESSED budget rather than an ensemble
#       statistic. Keeping the ensemble median is a decision; the alternative is
#       quantified (0.53% on the shipped default).
#   A2  `with_basis_applied` scales the budget AND the pathway by the same f, so
#       SR_CO2e = SR_CO2 / f exactly and THE DEPLETION YEAR IS INVARIANT. A true
#       per-year CO2e pathway (mechanism "c") is deliberately unimplemented: the
#       SSP trajectories store CO2 only, and a year-varying ratio would move the
#       depletion year — a methodological change, not a refinement.


@dataclass(frozen=True)
class CO2eBudgetFit:
    """One temperature target's complete CO2→CO2e mapping.

    Affine AND offset together, with the ensemble they were both derived from
    and the shipped files they are reproducible from. Every field is recomputed
    by tests from `pairs_file` / `offset_file` — none is a magic number.
    """
    slope: float                 # m, GtCO2e per GtCO2
    intercept: float             # b, GtCO2e
    offset_2020_2024_gt: float   # C, GtCO2e — the SAME ensemble as the affine
    ensemble: str                # human label, e.g. "AR6 C1+C2"
    categories: tuple[str, ...]  # the AR6 category codes, for the mixing guard
    pairs_file: str              # regression inputs (2020 → net-zero)
    offset_file: str             # offset inputs (2020-2024)
    domain_gt: tuple[float, float]

    def y20(self, x20: float) -> float:
        return self.slope * x20 + self.intercept


# 1.5C — AR6 C1+C2 ("1.5C with no/limited overshoot" + "return to 1.5C after
# high overshoot"). N=214 regression / N=217 offset; R=0.9565.
CO2E_FIT_1P5C = CO2eBudgetFit(
    slope=1.3142, intercept=149.1242, offset_2020_2024_gt=250.665,
    ensemble="AR6 C1+C2", categories=("C1", "C2"),
    pairs_file="ar6_c1c2_pairs.csv",
    offset_file="ar6_c1c2_offset_2020_2024.csv",
    domain_gt=(196.3, 1036.2),
)

# 2C — AR6 C3+C4 ("(likely) below 2C"). N=343 regression / N=427 offset;
# R=0.9444. UNCHANGED: these are the shipped values and must stay byte-identical.
CO2E_FIT_2C = CO2eBudgetFit(
    slope=1.2935, intercept=218.41, offset_2020_2024_gt=257.4,
    ensemble="AR6 C3+C4", categories=("C3", "C4"),
    pairs_file="ar6_2c_analog_pairs.csv",
    offset_file="ar6_c34_offset_2020_2024.csv",
    domain_gt=(292.9, 1568.2),
)

# Tilsted & Bjorn's PUBLISHED 1.5C parameters — the methodological precedent,
# kept for comparison in the README and tests. Never used to compute a factor.
TILSTED_BJORN_2023_PUBLISHED = (1.1614, 157.27)


def co2e_fit_for_budget(option: dict) -> CO2eBudgetFit:
    """The (affine + offset) pair for a budget's temperature target.

    Selecting a FIT rather than coefficients is the point: there is no way to
    take the affine from one ensemble and the offset from another.
    """
    return CO2E_FIT_1P5C if "1p5C" in option.get("id", "") else CO2E_FIT_2C


def co2e_factor_for_budget(option: dict) -> float:
    """Per-budget CO2→CO2e scaling factor ``f = y25 / x25``.

    ``x20`` = from-2020 CO2 budget; ``x25`` = from-2025 CO2 budget.
    ``y20 = m·x20 + b``; ``y25 = y20 − C``; ``f = y25 / x25`` — with m, b and C
    all drawn from the one fit the target selects.
    """
    fit = co2e_fit_for_budget(option)
    x20 = float(option["original_gt_from_2020"])
    x25 = float(option["remaining_gt_from_2025"])
    return (fit.y20(x20) - fit.offset_2020_2024_gt) / x25


def co2e_conversion_for_budget(option: dict) -> RatioCO2eConversion:
    """Build the sourced ``RatioCO2eConversion`` (ratio kind) for a budget option.
    The intercept of the affine is absorbed into the per-budget scalar f by
    construction, so ``with_basis_applied`` can reuse the uniform-scaling ratio
    path (budget×f, pathway×f → climate SR ÷f)."""
    fit = co2e_fit_for_budget(option)
    f = co2e_factor_for_budget(option)
    return RatioCO2eConversion(
        factor=f,
        source=(
            # Names the affine AND the offset set explicitly, each with the file
            # it is reproducible from. The ensemble label alone left a reader of
            # an exported workbook unable to tell WHICH of the two derivation
            # sets a coefficient came from — and pairing an affine with the
            # wrong ensemble's offset is precisely the defect this shape exists
            # to make visible.
            f"CO2→CO2e GWP100 budget factor f={f:.4f} = (m·x20+b−C)/x25. "
            f"Affine m={fit.slope}, b={fit.intercept} from OLS over {fit.ensemble} "
            f"(2020→net-zero CO2), {fit.pairs_file}. "
            f"Offset C={fit.offset_2020_2024_gt} GtCO2e, the median 2020-2024 "
            f"cumulative CO2e over the SAME ensemble {fit.ensemble}, "
            f"{fit.offset_file}. "
            f"Method: Meinshausen et al. 2018/2019 as applied by Tilsted & Bjorn "
            f"2023, doi:10.1007/s10584-023-03583-4. "
            f"x20={option.get('original_gt_from_2020')} GtCO2, "
            f"x25={option.get('remaining_gt_from_2025')} GtCO2. "
            f"See mapper/data/aesa/co2e_ratio/README.md"
        ),
    )


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
    # Fresh-config default: IPCC AR6 2.0°C 50th-pct (1150 Gt from 2025) ×
    # SSP1-2.6 (a temperature-CONSISTENT ~2°C pathway), CO2e_GHG basis (wired
    # factor 1.4846). The temperature default is a UX choice: 2°C/50 × a ~2°C
    # pathway preserves the comparative SR gradient across 2025–2050, whereas the
    # 1.5°C budget (300 Gt) saturates inherently by ~2033–2040 under ANY pathway.
    # The strict 1.5°C view is one click away (budget + pathway are independently
    # selectable). SSP1-2.6 (not SSP2-4.5) avoids a mitigation-gap default pairing
    # (see CLAUDE.md Patch X2).
    # `end_year` is the BUDGET ALLOCATION horizon only —
    # annual_global_allocation(t) = remaining_budget(t) / (end_year - t) — NOT
    # the study/SR-timeline window (that comes from the DSM fleet trajectory's
    # years, `mres.years` in AESAEngine.compute). The remaining budget is framed
    # over the full century, so allocate to 2100; truncating to the 2050 study
    # window (5AO) compressed a ~75-yr budget into ~25 yrs, inflating the
    # per-year safe allocation and collapsing the climate-change SR (5AR fix).
    budget_option_id: str = "IPCC_AR6_2C_50",
    ssp_id: str = "SSP1-2.6",
    # None => the budget data's own base year (`carbon_budget_vintage()`), i.e.
    # the first year NOT covered by the 2020-2024 deduction. DERIVED, not a
    # literal 2025: the vintage is written down once, in carbon_budgets.json.
    start_year: int | None = None,
    end_year: int = 2100,
) -> CarbonBudgetConfig:
    if start_year is None:
        start_year = carbon_budget_vintage().base_year
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
        # Populate the per-budget CO2→CO2e factor so the CO2e_GHG basis is
        # selectable for every budget (no 400). budget_basis stays "CO2" by
        # default → co2e_ratio() is None → with_basis_applied is identity → no
        # SR drift until the basis is flipped to CO2e_GHG (the frontend toggle).
        co2e_conversion=co2e_conversion_for_budget(budget),
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
# The ID is a stable identifier, NOT a citation, and it is deliberately left
# alone even though the display name no longer cites a paper. Saved
# AESAConfigurations bookmark the preset by `sharing_preset_id`, saved
# AESASessions embed that bookmark in their frozen configuration_snapshot, and
# exported AESACFG workbooks write it to the Configuration sheet. Renaming it
# would orphan every one of those — the bookmark would resolve to nothing — for
# a string no user ever sees. The display name is what users read; that is what
# changed.
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


def _layer1_sources_from_sharing(sharing: dict) -> dict[str, str]:
    """Build {principle → source string} from sharing_data.json defaults.

    Provenance is per PRINCIPLE, not per layer: layer 1's AR series is a Global
    Carbon Budget cumulative while its EpC series is a population statistic.
    Missing or blank sources are dropped rather than stored as "", so a preset
    that has no provenance dumps ``{}``.
    """
    return {pid: str(d["source"]).strip()
            for pid, d in sharing.get("layer1_defaults", {}).items()
            if str(d.get("source", "")).strip()}


def build_default_sharing_preset(sharing: dict | None = None) -> SharingPreset:
    """Build the read-only built-in sharing preset (3-layer Multi-D chain)."""
    data = sharing or load_sharing_data()
    # Layers 2 and 3 are the two factors of `layer2.sector_share`: 0.25 x 0.60
    # = 0.15. The one source string in the data file explains both halves
    # ("transport ~25% of national total", "passenger cars ~60% of transport"),
    # so it is attached to both rather than to whichever one it names first.
    layer23_source = str(data.get("layer2", {}).get("source", "")).strip()

    layer1 = DownscalingLayer(
        layer_number=1,
        name="Global → Country",
        principle_mode="category_specific",
        description="Allocates each PB category via its assigned principle.",
        data=_layer1_data_from_sharing(data),
        sources=_layer1_sources_from_sharing(data),
    )
    layer2 = DownscalingLayer(
        layer_number=2,
        name="Country → Sector",
        principle_mode="fixed",
        fixed_principle="AR",
        description="Grandfathering: sector share of the national environmental burden.",
        data={"AR": {_DEFAULT_BASE_YEAR: (_DEFAULT_LAYER2_AR, 1.0)}},
        sources={"AR": layer23_source} if layer23_source else {},
    )
    layer3 = DownscalingLayer(
        layer_number=3,
        name="Sector → Sub-sector",
        principle_mode="fixed",
        fixed_principle="AR",
        description="Grandfathering: sub-sector share of the sector.",
        data={"AR": {_DEFAULT_BASE_YEAR: (_DEFAULT_LAYER3_AR, 1.0)}},
        sources={"AR": layer23_source} if layer23_source else {},
    )
    assignments = [
        CategoryAssignment(pb_id=pb_id, principle_id=principle, justification=just)
        for pb_id, (principle, just) in MULTI_D_DEFAULTS.items()
    ]
    return SharingPreset(
        id=_BUILTIN_PRESET_ID,
        name="Multi-D allocation (default)",
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


# ─── Single-LCA → impact adapter ─────────────────────────────────────────────


def single_product_to_impact_result(
    result: ArchetypeLCACalculateResult,
    *,
    reference_year: int = 2025,
    system_id: str | None = None,
) -> ImpactAssessmentResult:
    """Adapt a STATIC single-product LCA result (scalar score per method) into
    the per-year ``ImpactAssessmentResult`` the AESA engine consumes, so a
    non-fleet single product can be assessed against the planetary boundaries.

    Each method becomes a one-year ``DSMLCAResult`` at ``reference_year`` with
    its scalar ``score`` as that year's ``total_impact`` and EMPTY cohort/material
    dicts (there is no fleet). The engine then emits one SR row per (boundary,
    reference_year).

    **FU / temporal-basis assumption (explicit, not silent):** the LCA's
    functional unit is treated as a SINGLE-YEAR flow placed at ``reference_year``
    — one functional unit's worth of impact assessed against that year's
    per-product Safe-Operating-Space share. ``reference_year`` only sets the
    climate (cumulative-budget) annual-allowance year; flow boundaries are
    year-independent. Prospective single-product sources (per-(iam,ssp,year))
    will extend this adapter with multiple ``DSMLCAResult.years`` later — the
    per-method, cohort-empty shape is forward-compatible.
    """
    sid = system_id or "single-product"
    dsm_results = [
        DSMLCAResult(
            mfa_system_id=sid,
            method=list(m.method),
            method_label=m.method_label,
            scope=result.scope,
            unit=m.unit,
            years=[
                DSMLCAYearResult(
                    year=reference_year,
                    total_impact=m.score,
                    impact_by_cohort={},
                    impact_by_material={},
                    count_by_cohort={},
                    unit=m.unit,
                )
            ],
            summary=DSMLCASummary(
                total_impact=m.score, peak_year=reference_year, peak_impact=m.score
            ),
        )
        for m in result.results
    ]
    return ImpactAssessmentResult(
        # CARRIED THROUGH, not re-stamped. This is an ADAPTER -- it reshapes a
        # result that was already computed -- so stamping ``now()`` here would
        # be the same defect as the exports stamping the export date: the
        # adapted result would claim to have been computed at the moment it was
        # reshaped for AESA, which can be days later.
        computed_at=result.computed_at,
        mapper_version=result.mapper_version,
        task_id="single-product",
        meta=ImpactAssessmentMeta(
            mode="static",
            mfa_system_id=system_id,   # None for a non-fleet source
            scope=result.scope,
            year_start=reference_year,
            year_end=reference_year,
        ),
        results=dsm_results,
    )


def prospective_single_product_to_impact_result(
    points: list[tuple[int, ArchetypeLCACalculateResult]],
    *,
    system_id: str | None = None,
) -> ImpactAssessmentResult:
    """Adapt a PROSPECTIVE single-product LCA trajectory (one LCA result per
    year, each computed against that year's premise database) into the
    multi-year ``ImpactAssessmentResult`` the AESA engine consumes.

    Unlike the static adapter (one functional unit held FLAT at a single
    reference year), here the background already evolved with the SSP, so each
    year carries its own year-resolved per-method scores. Each method becomes a
    ``DSMLCAResult`` with one ``DSMLCAYearResult`` per year — the engine then
    emits one SR row per (boundary, year), and the SR year axis is exactly the
    trajectory's years (intersected with SOS/budget coverage downstream, where
    a year outside the budget horizon yields a non-positive allocation → SR
    None, the engine's existing behaviour). No ``reference_year``: the years
    come from the trajectory.

    ``points`` are ``(year, result)`` tuples. Cohort/material dicts are empty
    (no fleet), mirroring the static adapter's per-method, cohort-empty shape.
    Duplicate years for a method (e.g. if several trajectories were passed) keep
    the FIRST occurrence — the caller is expected to pass a single coherent
    trajectory; this is a deterministic guard, not a merge.
    """
    sid = system_id or "single-product"
    # method tuple (joined) → accumulator preserving first-seen metadata + a
    # year→YearResult map (first occurrence wins per year).
    by_method: dict[str, dict] = {}
    order: list[str] = []
    for year, result in sorted(points, key=lambda p: p[0]):
        for m in result.results:
            key = "|".join(m.method)
            acc = by_method.get(key)
            if acc is None:
                acc = {
                    "method": list(m.method),
                    "method_label": m.method_label,
                    "scope": result.scope,
                    "unit": m.unit,
                    "years": {},  # year -> DSMLCAYearResult
                }
                by_method[key] = acc
                order.append(key)
            if year in acc["years"]:
                continue  # first trajectory wins for this year
            acc["years"][year] = DSMLCAYearResult(
                year=year,
                total_impact=m.score,
                impact_by_cohort={},
                impact_by_material={},
                count_by_cohort={},
                unit=m.unit,
            )

    dsm_results: list[DSMLCAResult] = []
    all_years: list[int] = []
    for key in order:
        acc = by_method[key]
        years = [acc["years"][y] for y in sorted(acc["years"])]
        all_years.extend(y.year for y in years)
        peak = max(years, key=lambda yr: yr.total_impact)
        dsm_results.append(DSMLCAResult(
            mfa_system_id=sid,
            method=acc["method"],
            method_label=acc["method_label"],
            scope=acc["scope"],
            unit=acc["unit"],
            years=years,
            summary=DSMLCASummary(
                total_impact=sum(yr.total_impact for yr in years),
                peak_year=peak.year,
                peak_impact=peak.total_impact,
            ),
        ))

    scope = dsm_results[0].scope if dsm_results else "all"
    # CARRIED THROUGH, not re-stamped -- see the static adapter. A trajectory
    # is N per-year results computed in ONE run, so the earliest stamp is the
    # honest answer for when that run happened.
    _stamps = sorted(r.computed_at for _, r in points if r.computed_at)
    return ImpactAssessmentResult(
        computed_at=_stamps[0] if _stamps else None,
        mapper_version=next(
            (r.mapper_version for _, r in points if r.mapper_version), None
        ),
        task_id="single-product",
        meta=ImpactAssessmentMeta(
            mode="projected",
            mfa_system_id=system_id,   # None for a non-fleet source
            scope=scope,
            year_start=min(all_years) if all_years else None,
            year_end=max(all_years) if all_years else None,
        ),
        results=dsm_results,
    )


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
                    # Patch 2d — apply the CO2/CO2e basis BEFORE the cumulative
                    # math. "CO2" (default) → with_basis_applied returns self
                    # (byte-identical, no drift). "CO2e_GHG" + ratio → a copy
                    # with budget + pathway scaled by the sourced factor, so the
                    # depletion math below runs unchanged on the CO2e pair.
                    cb = config.carbon_budget.with_basis_applied()
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
                    pb_short_name=pb.short_name or pb.name,
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
            # Patch 2b (Option 1) — also resolve FIXED layers to the tested
            # principle P, but only when the layer carries data for P
            # ("has data" = P present in layer.data AND non-empty); otherwise
            # FALL BACK to the layer's fixed_principle. A single-principle fixed
            # layer (the built-in Multi-D shape) therefore stays invariant across
            # the sweep → no SR drift. This mutates only the per-variant chain
            # copy; the primary compute path reads the original config untouched.
            variant_layers = [
                ly.model_copy(update={"fixed_principle": principle.id})
                if (ly.principle_mode == "fixed"
                    and principle.id in ly.data and ly.data[principle.id])
                else ly
                for ly in preset.chain.layers
            ]
            variant_chain = preset.chain.model_copy(update={"layers": variant_layers})
            variant_preset = preset.model_copy(update={
                "category_assignments": variant_assignments,
                "chain": variant_chain,
            })
            variant_cfg = config.model_copy(update={
                "sharing": variant_preset,
                "multi_d": None,  # ensure sharing takes precedence
            })
            var_result = cls.compute(impact_results, variant_cfg, boundary_set)
            sensitivity[principle.id] = var_result.results

        return base.model_copy(update={"sensitivity": sensitivity})
