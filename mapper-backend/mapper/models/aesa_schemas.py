"""Pydantic schemas for Absolute Environmental Sustainability Assessment (AESA).

Implements the Multi-Dimensional (Multi-D) allocation model (Ferhati et al.,
SETAC 36th) layered on Planetary Boundaries expressed in EF v3.1-compatible
units (Sala et al. 2020).

Pipeline:
    Fleet impact (from Impact Assessment)
         ÷
    Allocated Safe Operating Space (SOS)
         =
    Sustainability Ratio (SR)   → zone: safe / uncertainty / high-risk

Allocated SOS = PB_value × layer1_factor(category, year) × layer2_sector_share
where layer1_factor depends on the sharing principle (SP-I) chosen per
category (EpC, IN, AGR, LA, AR) and layer2_sector_share is fixed
grandfathering (entity → sector).
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from mapper.models.bom_schemas import ImpactAssessmentResult


SHARING_PRINCIPLE = Literal["EpC", "IN", "AGR", "LA", "AR"]
BOUNDARY_TYPE = Literal["cumulative", "flow"]
PB_STATUS_2023 = Literal["safe", "exceeded", "increasing_risk", "regional"]
ZONE = Literal["safe", "zone_of_uncertainty", "high_risk"]


# ── Planetary Boundary Definition ────────────────────────────────────────────


class PlanetaryBoundary(BaseModel):
    """Single planetary boundary, expressed in EF-compatible units (PB-EF)."""
    id: str                                       # e.g. "climate_change"
    name: str                                     # "Climate change"
    control_variable: str                         # "CO2 concentration"
    ef_indicator: str                             # matches method[1] in LCA results
    pb_value: float                               # global absolute boundary
    unit: str                                     # EF-indicator unit
    zone_of_uncertainty: tuple[float, float]      # (lower, upper) multipliers or values
    boundary_type: BOUNDARY_TYPE                  # "cumulative" | "flow"
    status_2023: PB_STATUS_2023
    provisional: bool = False


class BoundarySet(BaseModel):
    """Named collection of PB values. Built-in: 'Sala2020_EF'."""
    id: str
    name: str
    source: str
    boundaries: dict[str, PlanetaryBoundary]


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


# ── Dynamic Carbon Budget ────────────────────────────────────────────────────


class CarbonBudgetConfig(BaseModel):
    """Dynamic carbon budget that depletes year-over-year.

    remaining_budget(t) = initial_budget_gt - sum(projected_emissions[t0..t-1])
    annual_global_allocation(t) = remaining_budget(t) / (end_year - t)
    """
    initial_budget_gt: float              # Gt CO2
    budget_source: str                    # "IPCC AR6 1.5C 67th pct"
    start_year: int
    end_year: int
    projected_emissions: dict[int, float] # Gt CO2/yr, year → global emissions
    ssp_scenario: str                     # e.g. "SSP2-4.5"
    provisional: bool = False

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
        """Fleet annual carbon budget after Multi-D downscaling (climate_change)."""
        # Climate change uses the EpC factor by Multi-D defaults. We multiply by
        # the layer1 factor for climate_change (whatever principle the user
        # picked) and the fixed layer2 share. Gt → kg conversion so the result
        # is in the same unit as LCA CO2-eq scores.
        gt_per_year = self.annual_global_allocation(year)
        factor_l1 = multi_d.layer1_factor("climate_change", year)
        kg_per_year = gt_per_year * 1e12  # 1 Gt = 1e12 kg
        return kg_per_year * factor_l1 * multi_d.layer2_sector_share


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
    zone: ZONE
    sharing_principle: SHARING_PRINCIPLE
    sharing_factor_l1: float
    sharing_factor_l2: float
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
    mfa_system_id: str
    impact_mode: Literal["static", "projected"] = "static"
    boundary_set_id: str = "Sala2020_EF"
    multi_d: MultiDConfig
    carbon_budget: CarbonBudgetConfig | None = None
    method_mapping: list[MethodPBMapping] = Field(default_factory=list)
    created_at: str


class AESAConfigurationCreate(BaseModel):
    name: str
    mfa_system_id: str
    impact_mode: Literal["static", "projected"] = "static"
    boundary_set_id: str = "Sala2020_EF"
    multi_d: MultiDConfig
    carbon_budget: CarbonBudgetConfig | None = None
    method_mapping: list[MethodPBMapping] = Field(default_factory=list)


# ── Compute / export bodies ──────────────────────────────────────────────────


class AESAComputeRequest(BaseModel):
    """Either ``config_id`` (loads stored config) OR ``config`` (inline).
    Either ``impact_task_id`` (backend task) OR ``impact_result`` (inline)."""
    config_id: str | None = None
    config: AESAConfiguration | None = None
    impact_task_id: str | None = None
    impact_result: ImpactAssessmentResult | None = None
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
    sensitivity: dict[SHARING_PRINCIPLE, list[SustainabilityRatioResult]] | None = None


class AESAExportRequest(BaseModel):
    config: AESAConfiguration
    result: AESAComputeResult
