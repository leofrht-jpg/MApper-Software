"""Pydantic schemas for Absolute Environmental Sustainability Assessment
(AESA). Compares Impact Assessment results against planetary-boundary
thresholds allocated to the assessed system via a sharing principle."""
from __future__ import annotations

from pydantic import BaseModel, Field

from mapper.models.bom_schemas import ImpactAssessmentResult


# ── Reference data ───────────────────────────────────────────────────────────


class PlanetaryBoundary(BaseModel):
    """A single planetary boundary indicator (reference/context only)."""
    id: str
    name: str
    description: str
    global_limit: float | None = None  # None = not yet quantified
    global_limit_unit: str
    control_variable: str
    status: str  # "safe" | "increasing_risk" | "high_risk" | "beyond_boundary"
    source: str


class SharingPrinciple(BaseModel):
    id: str
    name: str
    description: str


# ── Per-configuration data ───────────────────────────────────────────────────


class BoundaryAllocation(BaseModel):
    """A user-defined allocated threshold for one boundary. Unit must match
    the LCA-result unit of the mapped method (kg CO2-eq/yr, etc.). Leave
    year=None for constant thresholds; year-varying thresholds supply one
    entry per year."""
    boundary_id: str
    sharing_principle_id: str
    allocated_threshold: float
    allocated_unit: str
    year: int | None = None
    notes: str | None = None


class MethodBoundaryMapping(BaseModel):
    method_tuple: list[str]
    boundary_id: str
    conversion_factor: float = 1.0


class AESAConfiguration(BaseModel):
    id: str
    name: str
    mfa_system_id: str
    impact_mode: str = "static"  # "static" | "projected"
    sharing_principle_id: str
    sharing_params: dict = Field(default_factory=dict)
    # Free-form bag: e.g., {"system_population": 5900000, "world_population": 8e9}
    method_mapping: list[MethodBoundaryMapping]
    custom_thresholds: list[BoundaryAllocation]
    created_at: str


class AESAConfigurationCreate(BaseModel):
    """Body for POST /aesa/configurations — same as AESAConfiguration but
    without ``id`` / ``created_at`` (server generates both)."""
    name: str
    mfa_system_id: str
    impact_mode: str = "static"
    sharing_principle_id: str
    sharing_params: dict = Field(default_factory=dict)
    method_mapping: list[MethodBoundaryMapping]
    custom_thresholds: list[BoundaryAllocation]


# ── Results ──────────────────────────────────────────────────────────────────


class AESAIndicatorResult(BaseModel):
    boundary_id: str
    boundary_name: str
    method_label: str
    impact_value: float
    threshold_value: float
    ratio: float
    unit: str
    status: str  # "safe" | "caution" | "exceeded"


class AESAYearResult(BaseModel):
    year: int
    indicators: list[AESAIndicatorResult]


class AESASummary(BaseModel):
    boundaries_assessed: int
    boundaries_safe: int
    boundaries_caution: int
    boundaries_exceeded: int
    worst_indicator: str = ""
    best_indicator: str = ""
    trend: str = "stable"  # "improving" | "stable" | "worsening"


class AESAResult(BaseModel):
    config_id: str
    years: list[AESAYearResult]
    summary: AESASummary


# ── Request / export bodies ──────────────────────────────────────────────────


class AESAAssessRequest(BaseModel):
    """POST /aesa/assess. Either pass ``impact_task_id`` (real backend task)
    or the inline ``impact_result`` (for synthetic Static runs mirrored from
    MFA×LCA). ``mode`` is optional context for the summary metadata."""
    config_id: str
    impact_task_id: str | None = None
    impact_result: ImpactAssessmentResult | None = None


class AESAExportRequest(BaseModel):
    config_id: str
    result: AESAResult
