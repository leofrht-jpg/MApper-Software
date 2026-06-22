# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Pydantic schemas for Absolute Environmental Sustainability Assessment (AESA).

Implements an N-layer downscaling chain (generalization of the Multi-D model,
Ferhati et al., SETAC 36th) layered on Planetary Boundaries expressed in
EF v3.1-compatible units (Sala et al. 2020).

Pipeline:
    System impact (from Impact Assessment)
         ÷
    Allocated Safe Operating Space (SOS)
         =
    Sustainability Ratio (SR)   → zone: safe / uncertainty / high-risk

Allocated SOS = PB_value × ∏ layer_factor(layer, pb_id, year)
where each layer applies either a category-specific principle (per pb_id)
or a fixed principle across all categories.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from mapper.core.compute_metrics import ComputeMetrics

from mapper.models.bom_schemas import ImpactAssessmentResult
from mapper.models.schemas import ArchetypeLCACalculateResult


SHARING_PRINCIPLE = Literal["EpC", "IN", "AGR", "LA", "AR"]
BOUNDARY_TYPE = Literal["cumulative", "flow"]
PB_STATUS_2023 = Literal["safe", "exceeded", "increasing_risk", "regional"]
ZONE = Literal["safe", "zone_of_uncertainty", "high_risk"]
PRINCIPLE_MODE = Literal["category_specific", "fixed"]

# Built-in principle IDs. User-defined principles are allowed — validation
# happens against the active preset's principle list, not this literal.
BUILT_IN_PRINCIPLES: tuple[str, ...] = ("EpC", "IN", "AGR", "LA", "AR")


# ── Planetary Boundary Definition ────────────────────────────────────────────


class PlanetaryBoundary(BaseModel):
    """Single planetary boundary, expressed in EF-compatible units (PB-EF).

    Patch 2c — ``pb_value`` (the SOS), ``ef_indicator`` (the LCA-method link),
    ``zone_of_uncertainty`` and ``status_2023`` are OPTIONAL so a *structure-only*
    boundary set (e.g. ``Ryberg2018_PBLCIA``) can be scaffolded WITHOUT fabricating
    SOS / control-factor numbers or asserting an assessment status. A boundary
    with ``pb_value is None`` (or its set marked ``computable=False``) is rejected
    by compute with a clear message — never characterised against a null SOS.
    ``Sala2020_EF`` supplies real values and is unaffected.
    """
    id: str                                       # e.g. "climate_change"
    name: str                                     # "Climate change"
    control_variable: str                         # "CO2 concentration"
    ef_indicator: str | None = None               # matches method[1]; null = no EF-method link yet
    pb_value: float | None = None                 # global absolute boundary (SOS); null = not fabricated
    unit: str                                     # EF-indicator unit
    zone_of_uncertainty: tuple[float, float] | None = None  # (lower, upper); null when SOS absent
    boundary_type: BOUNDARY_TYPE                  # "cumulative" | "flow" (structural)
    status_2023: PB_STATUS_2023 | None = None     # 2023 assessment status; null when not sourced
    provisional: bool = False


class BoundarySet(BaseModel):
    """Named collection of PB values. Built-in: 'Sala2020_EF'.

    Patch 2c — ``computable`` marks whether the set is ready for SR compute.
    A scaffold set (null SOS / no PB-LCIA method) sets ``computable=False`` and
    compute rejects it with a clear message. Defaults True (back-compat: Sala
    and any pre-2c set load as computable)."""
    id: str
    name: str
    source: str
    boundaries: dict[str, PlanetaryBoundary]
    computable: bool = True


# ── Multi-D Sharing Principles ───────────────────────────────────────────────


class SharingPrincipleConfig(BaseModel):
    """Configuration for one sharing principle applied to one PB category.

    factor(year) = system_value(year) / global_value(year)
    Falls back to the scalar fields when no time series is provided or the
    requested year is missing from the series.
    """
    principle: SHARING_PRINCIPLE
    justification: str
    system_value: float
    global_value: float
    system_time_series: dict[int, float] | None = None
    global_time_series: dict[int, float] | None = None

    def compute_factor(self, year: int) -> float:
        sys_val = self.system_value
        glob_val = self.global_value
        if self.system_time_series and year in self.system_time_series:
            sys_val = self.system_time_series[year]
        if self.global_time_series and year in self.global_time_series:
            glob_val = self.global_time_series[year]
        if glob_val == 0:
            return 0.0
        return sys_val / glob_val


class MultiDConfig(BaseModel):
    """Full Multi-D sharing configuration.

    Two-layer downscaling:
      Layer 1 (SP-I): Global → Entity (e.g. Denmark) — per category.
      Layer 2:        Entity → Sector (e.g. passenger cars) — fixed grandfathering.
    """
    layer1: dict[str, SharingPrincipleConfig]  # keyed by PB id
    layer2_sector_share: float                 # e.g. 0.12
    layer2_source: str

    def compute_allocated_sos(self, pb_id: str, pb_value: float, year: int) -> float:
        cfg = self.layer1.get(pb_id)
        if cfg is None:
            # Fallback: EpC-style global mean (no downscale) * layer2
            return pb_value * self.layer2_sector_share
        return pb_value * cfg.compute_factor(year) * self.layer2_sector_share

    def layer1_factor(self, pb_id: str, year: int) -> float:
        cfg = self.layer1.get(pb_id)
        return cfg.compute_factor(year) if cfg else 0.0

    def layer1_principle(self, pb_id: str) -> SHARING_PRINCIPLE:
        cfg = self.layer1.get(pb_id)
        return cfg.principle if cfg else "EpC"


# ── N-Layer Downscaling Chain ────────────────────────────────────────────────


class PrincipleDefinition(BaseModel):
    """A sharing principle that can be referenced by layers and assignments.

    Built-in IDs are ``EpC``, ``IN``, ``AGR``, ``LA``, ``AR``. Users may
    define additional principles (e.g. ``GDP``, ``HDI``) — the id is an
    arbitrary short string, unique within a ``SharingPreset``."""
    id: str
    name: str
    description: str = ""


class CategoryAssignment(BaseModel):
    """Which principle applies to one impact category at the category-specific
    layer of the chain."""
    pb_id: str
    principle_id: str
    justification: str = ""


def _resolve_year(
    year_data: dict[int, tuple[float, float]] | None,
    year: int,
) -> tuple[float, float] | None:
    """Look up (system, global) for ``year`` in a sparse yearly dict.

    Rules: exact match wins; else nearest (min |Δyear|, ties favour older);
    else None. Single-entry series act as a constant across all years.
    """
    if not year_data:
        return None
    if year in year_data:
        return year_data[year]
    years = sorted(year_data.keys())
    if len(years) == 1:
        return year_data[years[0]]
    nearest = min(years, key=lambda y: (abs(y - year), y))
    return year_data[nearest]


class DownscalingLayer(BaseModel):
    """One step in the downscaling chain.

    ``data[principle_id][year] = (system_value, global_value)``. The layer
    factor for a given (pb_id, year) is::

        principle = assignments[pb_id] if mode == category_specific
                    else fixed_principle
        sys, glob = resolve_year(data[principle], year)
        factor    = sys / glob  (or 0 if missing / glob <= 0)
    """
    layer_number: int
    name: str
    principle_mode: PRINCIPLE_MODE
    fixed_principle: str | None = None
    description: str = ""
    # Principle id → year → (system_value, global_value). Tuples are
    # (de)serialized as 2-lists by pydantic, which matches JSON convention.
    data: dict[str, dict[int, tuple[float, float]]] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _check_fixed(self) -> DownscalingLayer:
        if self.principle_mode == "fixed" and not self.fixed_principle:
            raise ValueError(
                "fixed_principle is required when principle_mode == 'fixed'"
            )
        return self

    def resolve_principle(self, pb_id: str, assignments: dict[str, str]) -> str | None:
        if self.principle_mode == "fixed":
            return self.fixed_principle
        return assignments.get(pb_id)

    def compute_factor(self, pb_id: str, year: int, assignments: dict[str, str]) -> float:
        principle = self.resolve_principle(pb_id, assignments)
        if not principle:
            return 0.0
        pair = _resolve_year(self.data.get(principle), year)
        if pair is None:
            return 0.0
        sys_val, glob_val = pair
        if glob_val <= 0:
            return 0.0
        return sys_val / glob_val


class DownscalingChain(BaseModel):
    """Ordered sequence of downscaling layers. Minimum 1."""
    layers: list[DownscalingLayer] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_layers(self) -> DownscalingChain:
        if not self.layers:
            raise ValueError("DownscalingChain requires at least one layer")
        # Sort by layer_number (tolerant of unordered input)
        self.layers.sort(key=lambda ly: ly.layer_number)
        return self

    def compute_factor(
        self, pb_id: str, year: int, assignments: dict[str, str],
    ) -> float:
        """Product of all layer factors for a given (pb_id, year)."""
        factor = 1.0
        for layer in self.layers:
            factor *= layer.compute_factor(pb_id, year, assignments)
        return factor

    def per_layer_factors(
        self, pb_id: str, year: int, assignments: dict[str, str],
    ) -> list[float]:
        return [ly.compute_factor(pb_id, year, assignments) for ly in self.layers]

    def category_layer_principle(self, pb_id: str, assignments: dict[str, str]) -> str | None:
        """Principle used at whichever layer is ``category_specific`` (first wins).
        Returns None if no category-specific layer exists."""
        for layer in self.layers:
            if layer.principle_mode == "category_specific":
                return assignments.get(pb_id)
        return None


class SharingPreset(BaseModel):
    """A reusable Carrying-Capacity template: the whole DENOMINATOR of SR.

    Holds the sharing config (principles + assignments + chain) AND — as of
    Patch 2a — the planetary-boundary set and carbon budget, so one saved
    template captures the complete carrying capacity. (Class name + storage keys
    are kept stable; the "Carrying Capacity template" label is a Phase-3 UI
    concern.)

    Stored globally (not per-project). A built-in template ships with MApper
    and is read-only; users duplicate to customize. ``AESAConfiguration``
    references a template by id (``sharing_preset_id``) and carries an inline
    snapshot of the resolved values (``sharing`` + ``boundary_set_id`` +
    ``carbon_budget``) so COMPUTE READS THE CONFIG SNAPSHOT, never the template —
    the template's fields are creation-time defaults for new configs, never a
    retroactive override (identical semantics to how ``sharing`` already works).
    """
    id: str
    name: str
    description: str = ""
    built_in: bool = False
    principles: list[PrincipleDefinition] = Field(default_factory=list)
    category_assignments: list[CategoryAssignment] = Field(default_factory=list)
    chain: DownscalingChain
    # Patch 2a — Carrying-Capacity additions. OPTIONAL with back-compat defaults
    # so presets/templates saved before 2a load unchanged. `boundary_set_id`
    # defaults to the built-in Sala 2020 PB-EF set; `carbon_budget = None` means
    # "inherit the build_carbon_budget() default at apply time" (get_defaults
    # serves that default separately for seeding). Compute never reads these
    # off the template — they seed an AESAConfiguration's snapshot.
    boundary_set_id: str = "Sala2020_EF"
    carbon_budget: CarbonBudgetConfig | None = None
    created_at: str = ""
    updated_at: str = ""

    def assignments_map(self) -> dict[str, str]:
        return {a.pb_id: a.principle_id for a in self.category_assignments}

    def principles_map(self) -> dict[str, PrincipleDefinition]:
        return {p.id: p for p in self.principles}


# ── Dynamic Carbon Budget ────────────────────────────────────────────────────


class RatioCO2eConversion(BaseModel):
    """Patch 2d — CO2→CO2e conversion, mechanism (b): a single per-scenario
    ratio. ``budget_e = factor·budget`` and ``pe_e[y] = factor·pe[y]`` (the same
    factor scales the budget AND the depletion pathway), so the whole climate SR
    timeline scales by ``1/factor`` — internally consistent, no pathway wrinkle.

    ``factor`` and ``source`` are SOURCED inputs (per-SSP, target-specific) —
    NEVER a bundled default or a fabricated number. A non-positive factor is
    treated as "no usable conversion" (inert)."""
    kind: Literal["ratio"] = "ratio"
    factor: float
    source: str


# Discriminated-union alias on ``kind``. Patch 2d implements ONLY "ratio";
# the design's "linear" (mechanism a) and "pathway" (mechanism c) can be added
# later as members — switch to
# ``Annotated[RatioCO2eConversion | LinearCO2eConversion | PathwayCO2eConversion,
# Field(discriminator="kind")]`` without touching call sites. Their COMPUTE is
# intentionally not implemented now; the inert guard rejects any CO2e basis whose
# conversion isn't a usable ratio.
CO2eConversion = RatioCO2eConversion


class CarbonBudgetConfig(BaseModel):
    """Dynamic carbon budget that depletes year-over-year.

    remaining_budget(t) = initial_budget_gt - sum(projected_emissions[t0..t-1])
    annual_global_allocation(t) = remaining_budget(t) / (end_year - t)

    Patch 2d — ``budget_basis`` selects the GHG scope of the DENOMINATOR so it
    matches the EF GWP100 (CO2e) numerator. ``"CO2"`` (default) is today's
    behaviour, byte-identical (no drift). ``"CO2e_GHG"`` is opt-in and INERT
    until a sourced ``co2e_conversion`` is supplied — compute rejects a CO2e
    basis with no usable conversion rather than fabricating a factor. The fix is
    denominator-only; the numerator (EF GWP100 CO2e) is unchanged.
    """
    initial_budget_gt: float              # Gt CO2 (or Gt CO2e once basis-applied)
    budget_source: str                    # "IPCC AR6 1.5C 67th pct"
    start_year: int
    end_year: int
    projected_emissions: dict[int, float] # Gt CO2/yr, year → global emissions
    ssp_scenario: str                     # e.g. "SSP2-4.5"
    provisional: bool = False
    # Patch 2d — CO2 vs CO2e/GHG basis. Default "CO2" → no drift. Back-compat:
    # configs saved before 2d lack these and default to CO2 / None (per the 2a
    # snapshot model). The conversion is per-scenario and sourced separately.
    budget_basis: Literal["CO2", "CO2e_GHG"] = "CO2"
    co2e_conversion: CO2eConversion | None = None

    def co2e_ratio(self) -> float | None:
        """The usable CO2e ratio factor, or ``None`` (inert). Returns a factor
        ONLY when ``budget_basis == "CO2e_GHG"`` AND ``co2e_conversion`` is a
        positive "ratio". Never fabricates; "CO2" basis always returns None."""
        if self.budget_basis != "CO2e_GHG":
            return None
        conv = self.co2e_conversion
        if conv is not None and getattr(conv, "kind", None) == "ratio" and conv.factor > 0:
            return conv.factor
        return None

    def with_basis_applied(self) -> "CarbonBudgetConfig":
        """Denominator-only: return a CO2e-scaled copy when a usable ratio is
        present, else ``self`` unchanged (CO2 basis → byte-identical, no drift).
        Scales ``initial_budget_gt`` + ``projected_emissions`` by the sourced
        ratio so ``remaining_budget`` / ``annual_global_allocation`` /
        ``annual_system_allocation`` run UNCHANGED on the CO2e pair. (Mechanism
        (b) ratio only; linear/pathway are not implemented here.)"""
        f = self.co2e_ratio()
        if f is None:
            return self
        return self.model_copy(update={
            "initial_budget_gt": self.initial_budget_gt * f,
            "projected_emissions": {y: v * f for y, v in self.projected_emissions.items()},
        })

    def remaining_budget(self, year: int) -> float:
        consumed = sum(
            self.projected_emissions.get(y, 0.0)
            for y in range(self.start_year, year)
        )
        return max(0.0, self.initial_budget_gt - consumed)

    def annual_global_allocation(self, year: int) -> float:
        remaining = self.remaining_budget(year)
        years_left = max(1, self.end_year - year)
        return remaining / years_left

    def annual_fleet_allocation(self, year: int, multi_d: MultiDConfig) -> float:
        """Legacy: Fleet annual carbon budget via 2-layer Multi-D (climate_change).
        Kept for backward compatibility; prefer ``annual_system_allocation``."""
        gt_per_year = self.annual_global_allocation(year)
        factor_l1 = multi_d.layer1_factor("climate_change", year)
        kg_per_year = gt_per_year * 1e12  # 1 Gt = 1e12 kg
        return kg_per_year * factor_l1 * multi_d.layer2_sector_share

    def annual_system_allocation(
        self,
        year: int,
        chain: DownscalingChain,
        assignments: dict[str, str],
    ) -> float:
        """System annual carbon budget after N-layer downscaling (climate_change)."""
        gt_per_year = self.annual_global_allocation(year)
        kg_per_year = gt_per_year * 1e12  # 1 Gt = 1e12 kg
        factor = chain.compute_factor("climate_change", year, assignments)
        return kg_per_year * factor


# ── Sustainability Ratio (SR) Result ─────────────────────────────────────────


class SustainabilityRatioResult(BaseModel):
    year: int
    pb_id: str
    pb_name: str
    ef_indicator: str
    impact: float
    allocated_sos: float
    # null when allocated_sos <= 0 (e.g. carbon budget depleted). Treat as +∞;
    # zone is still 'high_risk'. Nullable so compute→export round-trips cleanly.
    sr: float | None
    # Patch 5AS — climate (cumulative) allocation-chain intermediates, surfaced
    # so the Excel export shows the full per-year chain (remaining budget →
    # global allocation → × system share = allocated_sos) from ONE authoritative
    # row, with no recompute. None for non-cumulative boundaries. These are the
    # values `annual_system_allocation` already computes internally — exposing
    # them is NOT a methodology change.
    remaining_budget_gt: float | None = None   # global remaining budget at `year` (Gt CO2)
    global_allocation_gt: float | None = None  # remaining_budget(year) / (end_year − year) (Gt CO2/yr)
    zone: ZONE
    # Principle chosen at the (first) category_specific layer; None if the
    # chain has no category_specific layer (e.g. a single fixed layer).
    # Open string — users may define custom principle ids.
    sharing_principle: str | None = None
    # One factor per chain layer, in order, and their product.
    layer_factors: list[float] = Field(default_factory=list)
    total_sharing_factor: float = 0.0
    # ─ Legacy fields (deprecated) ─ populated for backward-compatible readers.
    # sharing_factor_l1 = layer_factors[0]; sharing_factor_l2 = product of the
    # remaining layers (1.0 for a 1-layer chain).
    sharing_factor_l1: float = 0.0
    sharing_factor_l2: float = 1.0
    boundary_type: BOUNDARY_TYPE
    confidence: Literal["high", "medium", "low"] = "high"
    unit: str = ""
    impact_by_cohort: dict[str, float] = Field(default_factory=dict)
    method_label: str = ""


# ── Per-configuration bundle ─────────────────────────────────────────────────


class MethodPBMapping(BaseModel):
    """Maps an LCA method tuple to a PB id. Auto-suggested from ef_indicator
    token match; user can override."""
    method_tuple: list[str]
    pb_id: str
    conversion_factor: float = 1.0


class AESAConfiguration(BaseModel):
    id: str
    name: str
    # Optional — None for a single-LCA (non-fleet) AESA config. The fleet path
    # always sets it; the compute match-check only fires when BOTH the config
    # and the impact carry a system id.
    mfa_system_id: str | None = None
    # Patch 4O — explicit DSM scenario id for the compute source cascade.
    # ``None`` keeps the legacy "use whatever's active when this config
    # is loaded" semantic. Saved configs from before Patch 4O default
    # to ``None``; the UI surfaces an inline note when the active
    # scenario differs from the one originally saved.
    dsm_scenario_id: str | None = None
    impact_mode: Literal["static", "projected"] = "static"
    boundary_set_id: str = "Sala2020_EF"
    # Legacy 2-layer Multi-D config. Optional — kept for backwards reading of
    # configs saved before the N-layer refactor. On compute, if ``sharing``
    # is None this gets migrated to a 2-layer chain.
    multi_d: MultiDConfig | None = None
    # Preset snapshot: principles + category assignments + downscaling chain.
    # Takes precedence over ``multi_d`` when present.
    sharing: SharingPreset | None = None
    # Optional bookmark to the global preset this config was cloned from
    # (used by the UI to show "active preset"; compute ignores it).
    sharing_preset_id: str | None = None
    carbon_budget: CarbonBudgetConfig | None = None
    method_mapping: list[MethodPBMapping] = Field(default_factory=list)
    created_at: str


class SharingPresetCreate(BaseModel):
    """Body for POST /sharing-presets. Server assigns id/timestamps."""
    name: str
    description: str = ""
    principles: list[PrincipleDefinition] = Field(default_factory=list)
    category_assignments: list[CategoryAssignment] = Field(default_factory=list)
    chain: DownscalingChain


class AESAConfigurationCreate(BaseModel):
    name: str
    mfa_system_id: str | None = None   # None for single-LCA (non-fleet) configs
    dsm_scenario_id: str | None = None
    impact_mode: Literal["static", "projected"] = "static"
    boundary_set_id: str = "Sala2020_EF"
    multi_d: MultiDConfig | None = None
    sharing: SharingPreset | None = None
    sharing_preset_id: str | None = None
    carbon_budget: CarbonBudgetConfig | None = None
    method_mapping: list[MethodPBMapping] = Field(default_factory=list)


# ── Compute / export bodies ──────────────────────────────────────────────────


class ProspectiveSingleProductPoint(BaseModel):
    """One year-point of a PROSPECTIVE single-product LCA trajectory: the LCA
    result computed against a year-matched premise database. The background
    already evolved with the SSP, so the per-method scores are year-resolved —
    no flat adapter; ``year`` is the trajectory year this result belongs to."""
    year: int
    result: ArchetypeLCACalculateResult


class AESAComputeRequest(BaseModel):
    """Either ``config_id`` (loads stored config) OR ``config`` (inline).
    Either ``impact_task_id`` (backend task) OR ``impact_result`` (inline)."""
    config_id: str | None = None
    config: AESAConfiguration | None = None
    impact_task_id: str | None = None
    impact_result: ImpactAssessmentResult | None = None
    # ── Single-LCA (non-fleet) sources ──────────────────────────────────────
    # Explicit discriminator (NOT overloading one field): which single-product
    # basis the request carries. "static" → flat-adapt `single_product_result`
    # at `reference_year` (Part A/B, byte-for-byte). "prospective" → use the
    # year-resolved `prospective_single_product` series directly. Fleet requests
    # leave both single-product fields None and ignore this discriminator.
    single_product_basis: Literal["static", "prospective"] = "static"
    # STATIC basis: a single scalar-per-method LCA result, flat-adapted into the
    # per-year ImpactAssessmentResult the engine consumes. Takes precedence over
    # impact_task_id / impact_result when set. `reference_year` sets the
    # climate-budget annual-allowance year (the functional unit is assessed as a
    # single-year flow at that year).
    single_product_result: ArchetypeLCACalculateResult | None = None
    reference_year: int = 2025
    # PROSPECTIVE basis: the year-resolved trajectory (one point per year). Fed
    # directly to the engine (no flat adapter); the SR year axis is these years
    # intersected with SOS/budget coverage. Takes precedence over the static
    # field + impact_task_id / impact_result when non-empty.
    prospective_single_product: list[ProspectiveSingleProductPoint] | None = None
    run_sensitivity: bool = False  # if True, also run 5 uniform-principle configs


class AESAYearSummary(BaseModel):
    year: int
    safe: int
    zone_of_uncertainty: int
    high_risk: int
    total_assessed: int


class AESAComputeResult(BaseModel):
    config_id: str | None
    results: list[SustainabilityRatioResult]
    summary_by_year: list[AESAYearSummary]
    missing_categories: list[str] = Field(default_factory=list)  # PBs with no matching method
    sensitivity: dict[str, list[SustainabilityRatioResult]] | None = None
    compute_metrics: ComputeMetrics | None = None


class AESAExportRequest(BaseModel):
    config: AESAConfiguration
    result: AESAComputeResult


# ── Saved sessions (Patch 4R) ────────────────────────────────────────────────
#
# A session is one historical compute event: the configuration snapshot
# at compute time + the result that came out + a traceability reference
# to the upstream Impact Assessment task. Distinct from ``AESAConfiguration``,
# which is a reusable input template. Sessions are immutable historical
# records (rename only — no recompute, no in-place edit).


class AESASession(BaseModel):
    id: str
    name: str
    project: str
    # ISO-8601 UTC timestamps. Lexicographic sort matches chronological
    # order, used by ``load_all`` to return newest-first.
    created_at: str
    modified_at: str
    # Frozen snapshot of the configuration at compute time. The user may
    # edit the live cascade afterward; the session keeps what was
    # actually computed against. Stored as a full ``AESAConfiguration``
    # rather than a reference id because the source config may be
    # deleted later — sessions stay valid regardless.
    configuration_snapshot: AESAConfiguration
    # Frozen result. Self-contained for the radar / timeline / box-plot /
    # detail-table renderers, which read ``results`` /
    # ``summary_by_year`` / ``sensitivity`` directly.
    result: AESAComputeResult
    # Traceability breadcrumb to the upstream Impact Assessment task
    # the result was derived from. ``None`` for inline-result computes
    # (no task_id) or when the original task has aged out of the
    # in-memory registry. Doesn't gate session render — the saved
    # AESA result is self-contained.
    upstream_ia_task_id: str | None = None
    # Patch 4T — view-state filter restored on session load. ``None``
    # means "show all computed indicators" (the default and the
    # backward-compat shape for sessions saved before Patch 4T).
    # Compute is unaffected; the filter only narrows which indicators
    # the charts render and which Excel rows the per-row export emits
    # by default. See ``CLAUDE.md`` § AESA display filter (Patch 4T).
    displayed_indicators: list[str] | None = None


class AESASessionCreate(BaseModel):
    """Body for ``POST /aesa/sessions``. Server assigns id + timestamps;
    project is resolved server-side from the active project."""
    name: str
    configuration_snapshot: AESAConfiguration
    result: AESAComputeResult
    upstream_ia_task_id: str | None = None
    displayed_indicators: list[str] | None = None


class AESASessionRename(BaseModel):
    """Body for ``PATCH /aesa/sessions/{id}``. Rename-only; the
    configuration snapshot and result are immutable."""
    name: str
