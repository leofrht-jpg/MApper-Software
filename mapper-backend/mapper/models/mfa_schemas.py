"""Pydantic schemas for the MFA dynamic stock module (Phase 2A).

The MFA module is a system-agnostic dynamic stock-flow model with cohort
tracking. The user defines arbitrary dimensions (e.g., fuel_type, size); the
``age`` dimension is auto-generated from the time horizon and is implicit in
every system. All quantities are floats so users can express partial counts
(e.g., regional shares, fractional fleets).
"""
from __future__ import annotations

from pydantic import BaseModel, Field


# ── System definition ────────────────────────────────────────────────────────


class TimeHorizon(BaseModel):
    start_year: int
    end_year: int

    @property
    def years(self) -> list[int]:
        return list(range(self.start_year, self.end_year + 1))

    @property
    def length(self) -> int:
        return self.end_year - self.start_year + 1


class DimensionDef(BaseModel):
    name: str  # machine name, e.g. "fuel_type"
    display_name: str  # e.g. "Fuel Type"
    labels: list[str] = Field(default_factory=list)
    is_age: bool = False


class SystemDefinition(BaseModel):
    id: str | None = None  # set by server
    name: str
    description: str | None = None
    time_horizon: TimeHorizon
    dimensions: list[DimensionDef]
    created_at: str | None = None  # ISO datetime, set by server


class SystemSummary(BaseModel):
    id: str
    name: str
    description: str | None
    time_horizon: TimeHorizon
    dimension_count: int
    cohort_count: int
    created_at: str


# ── Survival configuration ───────────────────────────────────────────────────


class CustomSurvivalPoint(BaseModel):
    age: int
    survival_rate: float


class SurvivalConfig(BaseModel):
    """Survival function for a cohort selected by ``dimension_filters``.

    A filter is a dict mapping dimension name → label. Empty filters apply
    as a default to every cohort that has no more specific match.
    """
    dimension_filters: dict[str, str] = Field(default_factory=dict)
    method: str = "weibull"  # "weibull" | "custom"
    weibull_shape: float | None = None
    weibull_scale: float | None = None
    custom_curve: list[CustomSurvivalPoint] | None = None


# ── Stock & inflow data ──────────────────────────────────────────────────────


class InflowData(BaseModel):
    year: int
    counts: dict[str, float]  # cohort_key -> count


class MFASystemState(BaseModel):
    system_id: str
    survival_configs: list[SurvivalConfig] = Field(default_factory=list)
    # initial_stock keyed by f"{cohort_key}|{age}"; values are counts
    initial_stock: dict[str, float] = Field(default_factory=dict)
    inflows: list[InflowData] = Field(default_factory=list)


# ── Simulation results ───────────────────────────────────────────────────────


class YearResult(BaseModel):
    year: int
    stock: dict[str, float]
    stock_by_age: dict[str, dict[int, float]]
    inflow: dict[str, float]
    outflow: dict[str, float]
    outflow_by_age: dict[str, dict[int, float]]


class SimulationSummary(BaseModel):
    total_stock_start: float
    total_stock_end: float
    total_inflows: float
    total_outflows: float


class SimulationResult(BaseModel):
    system_id: str
    years: list[YearResult]
    summary: SimulationSummary


# ── Upload / preview responses ──────────────────────────────────────────────


class StockUploadResult(BaseModel):
    rows_parsed: int
    cohorts_found: int
    total_items: float


class InflowUploadResult(BaseModel):
    years_parsed: int
    rows_parsed: int
    total_inflows: float


class SurvivalSetResult(BaseModel):
    configs_set: int


class SurvivalPreviewPoint(BaseModel):
    age: int
    survival_rate: float
    hazard_rate: float


class SurvivalConfigList(BaseModel):
    configs: list[SurvivalConfig]


class SystemUpdateResponse(BaseModel):
    system: SystemDefinition
    warnings: list[str] = Field(default_factory=list)
