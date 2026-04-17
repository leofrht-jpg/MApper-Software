"""Pydantic schemas for the BOM / Archetype module (Phase 2B).

An Archetype represents a representative product model (e.g., "BEV-LFP") with
a hierarchical Bill of Materials. Stages → components → materials. Material
leaves link to ecoinvent activities. The MFA × LCA pipeline maps each MFA
cohort to an archetype (with a scaling factor), multiplies the BOM by
per-year cohort counts × scale, and aggregates demand into a single LCA call
per year.
"""
from __future__ import annotations

from pydantic import BaseModel, Field


# ── Ecoinvent link ────────────────────────────────────────────────────────────


class EcoinventLink(BaseModel):
    database: str
    code: str
    name: str
    location: str = ""
    unit: str = ""
    reference_product: str = ""


# ── BOM tree ─────────────────────────────────────────────────────────────────


class QuantityMilestone(BaseModel):
    year: int
    quantity: float


class MaterialEvolution(BaseModel):
    """How a material's quantity changes over time.

    ``method == "fixed"`` (or model absent) → node.quantity is used as-is, every year.
    ``method == "learning_rate"`` → compounding annual change relative to ``base_year``
        (efficiency gains typically reduce the per-unit material demand).
    ``method == "rebound_effect"`` → compounding annual *increase* in consumption
        relative to ``base_year`` (efficiency gains trigger more use — direct
        rebound on vehicle use, appliance operation, lighting, heating, etc.).
        Math is identical to learning_rate; the distinction is semantic so the
        UI and exports can label it separately.
    ``method == "milestones"`` → linear interpolation between ``(year, quantity)`` pairs.
    """
    method: str = "fixed"  # "fixed" | "learning_rate" | "rebound_effect" | "milestones"
    learning_rate: float | None = None
    rebound_rate: float | None = None
    milestones: list[QuantityMilestone] | None = None
    base_year: int = 2025
    # Optional hint: constrain a rebound to specific life cycle stages. Purely
    # informational at the engine level (resolve_quantity ignores it) — used by
    # the bulk-apply UI to pre-filter materials and preserved in round-trip.
    applies_to_stages: list[str] | None = None


class BOMNode(BaseModel):
    """Recursive BOM tree node.

    ``node_type == "component"`` → has ``children`` (no ecoinvent link).
    ``node_type == "material"`` → leaf, must have ``ecoinvent_activity`` to
    contribute to LCA. Quantities cascade multiplicatively through the tree.
    """
    id: str | None = None  # set by server
    name: str
    node_type: str  # "component" | "material"
    quantity: float = 1.0
    unit: str = "unit"
    children: list["BOMNode"] | None = None
    ecoinvent_activity: EcoinventLink | None = None
    evolution: MaterialEvolution | None = None


BOMNode.model_rebuild()


# ── Archetype ────────────────────────────────────────────────────────────────


class Archetype(BaseModel):
    id: str | None = None  # set by server
    name: str
    description: str | None = None
    category: str | None = None
    folder: str | None = None  # forward-slash path, None = root
    bom: list[BOMNode] = Field(default_factory=list)  # list of life cycle stages (root components)
    created_at: str | None = None
    updated_at: str | None = None


class ArchetypeSummary(BaseModel):
    id: str
    name: str
    description: str | None
    category: str | None
    folder: str | None = None
    material_count: int
    unlinked_count: int
    created_at: str
    updated_at: str


class ArchetypeCreate(BaseModel):
    name: str
    description: str | None = None
    category: str | None = None
    folder: str | None = None
    bom: list[BOMNode] = Field(default_factory=list)


class BOMNodeCreate(BaseModel):
    parent_node_id: str | None = None  # None → append as a new root (life cycle stage)
    node: BOMNode


class BOMNodeUpdate(BaseModel):
    name: str | None = None
    quantity: float | None = None
    unit: str | None = None
    ecoinvent_activity: EcoinventLink | None = None
    evolution: MaterialEvolution | None = None


# ── Flatten / standalone LCA ─────────────────────────────────────────────────


class FlattenedMaterial(BaseModel):
    node_id: str
    name: str
    quantity: float
    unit: str
    ecoinvent_activity: EcoinventLink | None = None
    path: list[str] = Field(default_factory=list)  # parent component names down to material


class FlattenedBOM(BaseModel):
    archetype_id: str
    materials: list[FlattenedMaterial]
    total_mass_kg: float
    unlinked_count: int


class ArchetypeTimelineRow(BaseModel):
    node_id: str
    name: str
    unit: str
    path: list[str] = Field(default_factory=list)
    quantities: dict[int, float] = Field(default_factory=dict)  # year → quantity
    has_evolution: bool = False


class ArchetypeTimeline(BaseModel):
    archetype_id: str
    years: list[int]
    rows: list[ArchetypeTimelineRow]
    total_mass_by_year: dict[int, float] = Field(default_factory=dict)


class ArchetypeLCARequest(BaseModel):
    method: list[str]
    amount: float = 1.0


class ArchetypeLCAResult(BaseModel):
    archetype_id: str
    method: list[str]
    score: float
    unit: str
    amount: float
    impact_by_material: dict[str, float]


# ── Cohort mapping ───────────────────────────────────────────────────────────


class CohortMappingEntry(BaseModel):
    cohort_key: str
    archetype_id: str
    scaling_factor: float = 1.0


class CohortMapping(BaseModel):
    mfa_system_id: str
    mappings: list[CohortMappingEntry] = Field(default_factory=list)


class CohortMappingResult(BaseModel):
    mapped_cohorts: int
    unmapped_cohorts: list[str]
    invalid_cohorts: list[str]
    invalid_archetypes: list[str]


# ── MFA × LCA combined ───────────────────────────────────────────────────────


class MFALCARequest(BaseModel):
    # Either ``method`` (single, legacy) or ``methods`` (list) must be set.
    # If both are provided, ``methods`` wins.
    method: list[str] | None = None
    methods: list[list[str]] | None = None
    scope: str = "stock"  # "inflows" | "outflows" | "stock" | "all"
    year_start: int | None = None
    year_end: int | None = None


class MFALCAYearResult(BaseModel):
    year: int
    total_impact: float
    impact_by_cohort: dict[str, float]
    impact_by_material: dict[str, float]
    count_by_cohort: dict[str, float] = Field(default_factory=dict)
    unit: str


class MFALCASummary(BaseModel):
    total_impact: float
    peak_year: int
    peak_impact: float


class MFALCAResult(BaseModel):
    mfa_system_id: str
    method: list[str]
    method_label: str = ""
    scope: str
    unit: str
    years: list[MFALCAYearResult]
    summary: MFALCASummary
    # Stage names (root BOM nodes) that actually contributed — empty on legacy
    # results saved before stage-scoping was added.
    stages_included: list[str] = Field(default_factory=list)


class MFALCABatchResult(BaseModel):
    results: list[MFALCAResult]
    methods_calculated: int
    year_start: int | None = None
    year_end: int | None = None


# ── Impact Assessment (unified pipeline) ─────────────────────────────────────


class ProspectiveScenarioRef(BaseModel):
    """Points at a generated scenario in plca_storage (iam, ssp, base_db). The
    impact endpoint looks up every year's matching prospective DB at
    calculation time."""
    base_db: str
    iam: str
    ssp: str


class ImpactAssessmentRequest(BaseModel):
    mode: str  # "static" | "projected"
    mfa_system_id: str
    scope: str = "stock"  # "inflows" | "outflows" | "stock" | "all"
    methods: list[list[str]]
    year_start: int | None = None
    year_end: int | None = None
    # Static mode only: the base ecoinvent database used (informational — the
    # BOMs already reference their own databases; this is used for labeling).
    base_db: str | None = None
    # Projected mode only: scenario to match per-year.
    scenario: ProspectiveScenarioRef | None = None


class ImpactAssessmentMeta(BaseModel):
    mode: str
    mfa_system_id: str
    scope: str
    year_start: int | None = None
    year_end: int | None = None
    base_db: str | None = None
    scenario: ProspectiveScenarioRef | None = None
    # Projected mode: which (year → database) was actually resolved, so the UI
    # can flag fallbacks (e.g. 2024 → 2025 earliest-available).
    year_to_database: dict[int, str] = Field(default_factory=dict)


class ImpactAssessmentResult(BaseModel):
    task_id: str
    meta: ImpactAssessmentMeta
    results: list[MFALCAResult]
    elapsed_seconds: float | None = None


class ImpactCompareRequest(BaseModel):
    static_task_id: str
    projected_task_id: str


class ImpactExportRequest(BaseModel):
    """Export an Impact Assessment run to XLSX. Accepts EITHER a backend
    ``task_id`` (registered run) OR an inline ``result`` payload (used for
    synthetic Static runs mirrored from the MFA×LCA panel, which never hit
    /impact/calculate). Optional ``compare_with`` adds a Static-vs-Projected
    sheet computed client-or-server-side."""
    task_id: str | None = None
    result: ImpactAssessmentResult | None = None
    year: int | None = None
    # Optional second run for Static vs Projected sheet.
    compare_task_id: str | None = None
    compare_result: ImpactAssessmentResult | None = None


class ImpactComparePoint(BaseModel):
    year: int
    static_impact: float
    projected_impact: float
    delta: float
    delta_pct: float | None = None


class ImpactCompareMethodResult(BaseModel):
    method: list[str]
    method_label: str
    unit: str
    points: list[ImpactComparePoint]
    total_static: float
    total_projected: float
    total_delta: float
    total_delta_pct: float | None = None


class ImpactCompareResult(BaseModel):
    mfa_system_id: str
    scope: str
    methods: list[ImpactCompareMethodResult]


# ── Material Flows ──────────────────────────────────────────────────────────


class MaterialFlowRequest(BaseModel):
    scope: str = "stock"  # "inflows" | "outflows" | "stock" | "all"
    year_start: int | None = None
    year_end: int | None = None
    group_by: str = "material"  # "material" | "component" | "stage" | "archetype"


class MaterialSeries(BaseModel):
    name: str
    unit: str
    ecoinvent_name: str = ""
    ecoinvent_code: str = ""
    stage: str = ""
    component: str = ""
    values: dict[int, float] = Field(default_factory=dict)
    by_archetype: dict[str, dict[int, float]] = Field(default_factory=dict)
    evolution_method: str | None = None
    evolution_rate: float | None = None


class MaterialFlowResult(BaseModel):
    scope: str
    stages_included: list[str]
    year_start: int
    year_end: int
    group_by: str
    materials: list[MaterialSeries]
    elapsed_seconds: float
