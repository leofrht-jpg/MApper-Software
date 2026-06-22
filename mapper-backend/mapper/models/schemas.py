# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

from typing import Annotated, Literal

from pydantic import BaseModel, Field


# ── Phase 0 ──────────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status: str
    brightway2_version: str
    current_project: str


class ProjectResponse(BaseModel):
    name: str
    is_current: bool


class SwitchProjectRequest(BaseModel):
    name: str


class CreateProjectRequest(BaseModel):
    name: str


class DuplicateProjectRequest(BaseModel):
    source_name: str
    new_name: str


class ExportProjectRequest(BaseModel):
    name: str


class DeleteProjectResponse(BaseModel):
    deleted: bool
    current_project: str


class DatabaseResponse(BaseModel):
    name: str
    records: int
    modified: str | None
    is_prospective: bool = False
    prospective_meta: dict | None = None


# ── Phase 1A: Activities ──────────────────────────────────────────────────────

class ActivitySummary(BaseModel):
    key: str           # string repr of bw2 tuple key, e.g. "('db', 'abc')"
    code: str
    name: str
    location: str
    unit: str
    product: str
    database: str


class ActivityPage(BaseModel):
    items: list[ActivitySummary]
    total: int
    offset: int
    limit: int


class ActivityDistinctValues(BaseModel):
    locations: list[str]
    units: list[str]


class ExchangeDetail(BaseModel):
    input_key: str
    input_name: str
    input_location: str
    input_unit: str
    input_database: str
    amount: float
    type: str


class ActivityDetail(BaseModel):
    key: str
    code: str
    name: str
    location: str
    unit: str
    product: str
    database: str
    exchanges: list[ExchangeDetail]
    metadata: dict


class ActivityExportDetail(BaseModel):
    database: str
    code: str
    name: str
    reference_product: str
    location: str
    unit: str
    classifications: str
    comment: str
    production_amount: float
    technosphere_count: int
    biosphere_count: int
    activity_type: str


class ActivityExportRequest(BaseModel):
    codes: list[str]


class ActivityExportSelectionRequest(BaseModel):
    codes: list[str]
    format: str = "xlsx"


class MethodIndicator(BaseModel):
    indicator: str
    tuple: list[str]


class MethodCategory(BaseModel):
    category: str
    indicators: list[MethodIndicator]


class MethodFamily(BaseModel):
    family: str
    categories: list[MethodCategory]


# ── Phase 1B: Ecoinvent Import ────────────────────────────────────────────────

class ValidateCredentialsRequest(BaseModel):
    username: str
    password: str


class ValidateCredentialsResponse(BaseModel):
    valid: bool
    versions: list[str]
    message: str


class ImportEcoinventRequest(BaseModel):
    username: str
    password: str
    version: str
    system_model: str


class BrowseFolderRequest(BaseModel):
    path: str


class BrowseFolderResponse(BaseModel):
    valid: bool
    spold_count: int
    path: str
    message: str = ""


class ImportLocalEcoinventRequest(BaseModel):
    db_name: str
    dirpath: str


class TaskStartedResponse(BaseModel):
    task_id: str
    status: str


class TaskProgressMessage(BaseModel):
    step: str
    progress: float
    message: str


# ── Phase 1C: LCA ─────────────────────────────────────────────────────────────

class FunctionalUnit(BaseModel):
    key: str
    amount: float


class LCACalculateRequest(BaseModel):
    functional_unit: FunctionalUnit
    method: list[str]


class LCAResult(BaseModel):
    task_id: str
    method: list[str]
    functional_unit_name: str
    functional_unit_amount: float
    score: float
    unit: str
    calculated_at: str


class ContributionItem(BaseModel):
    activity_name: str
    activity_key: str
    location: str
    amount: float
    unit: str
    percentage: float


class ContributionsResponse(BaseModel):
    items: list[ContributionItem]
    rest_amount: float
    rest_percentage: float


class SankeyNode(BaseModel):
    id: str
    name: str
    location: str


class SankeyLink(BaseModel):
    source: str
    target: str
    value: float


class SankeyData(BaseModel):
    nodes: list[SankeyNode]
    links: list[SankeyLink]
    # Total nodes the cycle-safe BFS discovered before applying the node-budget
    # cap. ``truncated`` is True when ``total_nodes_discovered > max_nodes`` and
    # the returned ``nodes``/``links`` have been pruned (best-first by edge
    # value from the root). The UI uses these to render a banner like
    # "Showing top N of M nodes by impact contribution."
    total_nodes_discovered: int = 0
    truncated: bool = False


# ── Multi-Activity LCA Calculator ──────────────────────────────────────────────


class ActivityDemandItem(BaseModel):
    database: str
    code: str
    amount: float = 1.0


class ActivityLCARequest(BaseModel):
    activities: list[ActivityDemandItem]
    methods: list[list[str]]


class ActivityContribution(BaseModel):
    name: str
    location: str
    database: str
    code: str
    demand_amount: float
    demand_unit: str
    impact: float
    percentage: float


class ActivityLCAMethodResult(BaseModel):
    method: list[str]
    method_label: str
    score: float
    unit: str
    contributions: list[ActivityContribution]


class ActivityLCAResult(BaseModel):
    results: list[ActivityLCAMethodResult]
    elapsed_seconds: float = 0.0


# ── Archetype LCA Calculator ────────────────────────────────────────────────


class ArchetypeLCACalculateRequest(BaseModel):
    archetype_id: str
    scope: str = "all"  # "inflows" | "stock" | "outflows" | "all"
    amount: float = 1.0  # legacy fallback when stage_amounts is empty
    stage_amounts: dict[str, float] | None = None  # {"Manufacturing": 1, "Use Phase": 15, ...}
    methods: list[list[str]]
    # Optional prospective LCI database to compute against (e.g. premise-
    # generated `<base>_<iam>_<ssp>_<year>`). When None, runs against base
    # ecoinvent. Demand is re-keyed via `_translate_demand_to_database` —
    # activities not present in `compute_database` fall back to source DB
    # and surface warnings on the result.
    compute_database: str | None = None
    # Optional named parameter scenario from the active project's
    # ParameterTable. When set, BOM `quantity_expression` strings are
    # resolved against that scenario's overrides; when None, the table's
    # base values are used (matches today's behavior).
    parameter_scenario: str | None = None


class MaterialContribution(BaseModel):
    name: str
    stage: str
    component: str
    quantity: float
    unit: str
    impact: float
    percentage: float


class ArchetypeLCAMethodResult(BaseModel):
    method: list[str]
    method_label: str
    score: float
    unit: str
    contributions: list[MaterialContribution]


class ArchetypeLCACalculateResult(BaseModel):
    archetype_id: str
    archetype_name: str
    scope: str
    amount: float
    stage_amounts: dict[str, float] = {}
    stages_included: list[str]
    results: list[ArchetypeLCAMethodResult]
    elapsed_seconds: float = 0.0
    # Echoed back from the request — let callers tag results with the
    # prospective DB and parameter scenario they ran against (used by the
    # Impact Assessment Single-product mode to assemble multi-axis envelopes
    # client-side without round-tripping back to the request).
    compute_database: str | None = None
    parameter_scenario: str | None = None
    # Translation warnings from `_translate_demand_to_database` (e.g. an
    # activity carried by base ecoinvent but missing from a premise-generated
    # variant). Empty when `compute_database` is None or every key resolved.
    warnings: list[str] = []
    # Per-method, per-stage subtotal of impact (Patch 4B). Populated only
    # when `scope == "all"` — for specific-stage scopes the result is
    # already that one stage and a breakdown would be redundant.
    # Shape: {method_label: {stage_name: score}}. Per-method invariant:
    # sum of stage values equals method.score within float epsilon.
    stage_breakdown: dict[str, dict[str, float]] | None = None


class ArchetypeLCAExportRequest(BaseModel):
    results: list[ArchetypeLCACalculateResult]


# ── Single-product continuous-horizon trajectory (Stage B.1) ───────────────────
# Computes ONE archetype year-by-year across a prospective trajectory's anchor
# span (the single-product analogue of the system-level ProjectedImpactPanel),
# so the frontend can render a smooth full-horizon curve instead of only the
# discrete premise-anchor vintages. TOTALS ONLY per year — per-activity stage /
# material breakdown stays single-year (computed via calculate_archetype_lca).
class ArchetypeTrajectoryRequest(BaseModel):
    archetype_id: str
    scope: Literal["inflows", "stock", "outflows", "all"] = "all"
    amount: float = 1.0
    stage_amounts: dict[str, float] = {}
    methods: list[list[str]]
    parameter_scenario: str | None = None
    # Prospective trajectory: every premise DB matching this triple becomes an
    # anchor; the per-year loop spans min..max anchor year (annual step).
    base_db: str
    iam: str
    ssp: str
    # block = nearest-earlier anchor DB (step); interpolate = linear blend of
    # the two bracketing anchors' per-method scores (default).
    temporal_mode: Literal["block", "interpolate"] = "interpolate"
    # Optional narrowing of the rendered horizon to [year_start, year_end].
    # Clamped to the anchor span — no extrapolation outside it.
    year_start: int | None = None
    year_end: int | None = None


class ArchetypeTrajectoryMethodScore(BaseModel):
    method: list[str]
    method_label: str
    score: float
    unit: str


class ArchetypeTrajectoryYear(BaseModel):
    year: int
    method_scores: list[ArchetypeTrajectoryMethodScore]


class ArchetypeTrajectoryResult(BaseModel):
    archetype_id: str
    archetype_name: str
    scope: str
    base_db: str
    iam: str
    ssp: str
    temporal_mode: str
    parameter_scenario: str | None = None
    # Premise-anchor years backing the trajectory (sorted). The curve passes
    # through the discrete single-DB values at these years.
    anchor_years: list[int]
    years: list[ArchetypeTrajectoryYear]
    elapsed_seconds: float = 0.0
    warnings: list[str] = []


# ── Multi-Product LCA Comparison (Patch 4AG.1) ─────────────────────────────────
#
# Computes N independent LCAs (mixed archetype + activity items) for
# side-by-side comparison. Distinct from the existing
# `/lca/calculate-activities` endpoint, which treats N activities as a
# SINGLE combined demand (one LCA, contributions sum to the total) —
# the multi-product endpoint treats N items as N SEPARATE LCAs (one
# LCA per item, results compared side-by-side).
#
# Architecture: single endpoint with a discriminated-union item type.
# Backend dispatches each item to the existing single-product compute
# path (`calculate_archetype_lca` / `calculate_activity_lca`); per-item
# errors are isolated — one item's failure doesn't abort the others.
#
# Out of scope (deferred per Patch 4AG plan):
#   - Configuration template save for multi-item selections
#   - Saved sessions for multi-item comparisons
#   - Cross-database direct comparison
#   - Static→Projected multi-item inheritance
#   - Multi-item AESA characterization


class ArchetypeProductItem(BaseModel):
    """One archetype in a multi-product compute request."""
    type: Literal["archetype"] = "archetype"
    archetype_id: str
    # Optional per-item overrides; when None the request-level defaults
    # (or the archetype's own defaults) apply.
    stage_amounts: dict[str, float] | None = None
    parameter_scenario: str | None = None


class ActivityProductItem(BaseModel):
    """One technosphere activity in a multi-product compute request.

    Per-item-vintage model: an activity can appear as several items, one
    per database `vintage` — the base ecoinvent (static) and/or premise
    SSP×year databases. Each item names its own `database`; the existing
    activity compute path resolves the activity in that DB by `code`
    (premise preserves codes) and computes against it. No prospective
    re-resolution is reimplemented here — the frontend picks the concrete
    premise DB name from the pLCA registry (the same registry
    `_resolve_prospective_dbs` reads).
    """
    type: Literal["activity"] = "activity"
    database: str
    code: str
    amount: float = 1.0
    # Per-item vintage label for charts / tables, composed into the result
    # label so two vintages of one activity don't collide on a chart axis
    # (e.g. "ecoinvent", "SSP1 2040"). Frontend-owned display concept; None
    # for plain single-vintage callers (backward compat).
    vintage_label: str | None = None


# Discriminated union — Pydantic 2 picks the right model based on `type`.
ProductItem = Annotated[
    ArchetypeProductItem | ActivityProductItem,
    Field(discriminator="type"),
]


class MultiProductLCARequest(BaseModel):
    """Request body for `POST /lca/calculate-multi-product`."""
    items: list[ProductItem]
    methods: list[list[str]]
    # `scope` applies to ARCHETYPE items only — activity items have no
    # lifecycle stages, so the field is ignored when dispatching to the
    # activity compute path. Accepts the same values as
    # `ArchetypeLCACalculateRequest.scope`.
    scope: Literal["inflows", "stock", "outflows", "all"] = "all"
    # Optional shared prospective LCI database; threaded through to
    # archetype items. Activity items ignore the field today (the
    # activity compute path doesn't accept `compute_database`); a
    # future patch may add it.
    compute_database: str | None = None


class MultiProductItemResult(BaseModel):
    """One item's result in the multi-product fan-out envelope.

    Status discriminator + optional payload — the response is
    self-describing per item: a successful entry carries one of
    `archetype_result` / `activity_result`; a failed entry carries
    `error_message` and both payload fields are None.
    """
    type: Literal["archetype", "activity"]
    # Stable identifier for the UI to key per-item state. Archetype:
    # `archetype_id`. Activity: `"{database}|{code}"`.
    item_id: str
    # Human-readable label for chart axes / table headers. Archetype:
    # `archetype_name`. Activity: ecoinvent reference product or name.
    label: str
    status: Literal["success", "error"]
    error_message: str | None = None
    # Discriminated payload. Exactly one is non-null when status="success";
    # both are None when status="error".
    archetype_result: ArchetypeLCACalculateResult | None = None
    activity_result: ActivityLCAResult | None = None


class MultiProductLCAResult(BaseModel):
    """Response envelope for the multi-product fan-out."""
    items: list[MultiProductItemResult]
    elapsed_seconds: float = 0.0
    # Aggregate counters for at-a-glance status. `success_count +
    # error_count == len(items)`.
    success_count: int = 0
    error_count: int = 0


class StageAmountsMeta(BaseModel):
    """Per-item stage-amount provenance for the multi-product export
    (Patch 5J). The compute result echoes only the resolved per-stage
    ``amounts`` map; ``preset`` ('1year'/'lifetime'/'custom') and
    ``lifetime`` are frontend-only concepts the user picked, so they're
    threaded through the export request to make the run reproducible from
    the export alone."""
    preset: str = "custom"  # "1year" | "lifetime" | "custom"
    lifetime: float = 1.0
    amounts: dict[str, float] = {}


class ActivityVintageMeta(BaseModel):
    """Per-item vintage provenance for the multi-product export (activity
    mode). Each activity item is computed against ITS OWN database — base
    ecoinvent (static) or a premise SSP×year vintage. The result echoes only
    the database name; ``base_database`` / ``iam`` / ``ssp`` / ``year`` are
    frontend-resolved (from the pLCA registry) display/provenance concepts, so
    they're threaded through the export to make the run reproducible (which DB
    each item used). Mirrors the StageAmountsMeta pattern (5J)."""
    label: str = ""                 # e.g. "ecoinvent", "SSP1 2040"
    database: str = ""              # the concrete DB the item computed against
    base_database: str | None = None
    iam: str | None = None
    ssp: str | None = None
    year: int | None = None


class MultiProductExportRequest(BaseModel):
    """Body for ``POST /impact/export-multi-product`` (Patch 4AG.4).

    The frontend assembles this envelope from the in-memory
    ``MultiProductLCAResult`` plus the configuration metadata that the
    user picked at compute time (scope, compute_database). Backend
    re-uses these to build the Configuration sheet in the workbook.
    """
    result: MultiProductLCAResult
    scope: str = "all"
    compute_database: str | None = None
    # Optional ISO-8601 timestamp the frontend captures at compute
    # time. When None, the workbook builder uses the request-handling
    # time instead.
    computed_at: str | None = None
    # Patch 5J — per-item stage-amount provenance, keyed by item_id (which is
    # the archetype_id for archetype items). Captures preset + lifetime +
    # resolved amounts so the "Stage amounts" sheet can reproduce the run.
    # Optional for backward compatibility: when absent, the builder falls back
    # to the per-stage amounts the result already echoes.
    stage_amounts_meta: dict[str, StageAmountsMeta] | None = None
    # Per-item vintage provenance (activity mode), keyed by item_id
    # ("{database}|{code}"). Records which database/SSP/year each activity item
    # used. Optional for backward compat: absent → no Vintage sheet (the wide
    # sheet still shows the DB via item labels).
    activity_vintage_meta: dict[str, ActivityVintageMeta] | None = None


# ── Contribution Analysis (Single-Product LCA) ──────────────────────────────


class ContributionAnalysisRequest(BaseModel):
    """Run contribution analysis on either a single ecoinvent activity or an
    archetype BOM (scope-filtered)."""
    target_type: str  # "activity" | "archetype"
    # Activity target — ``database`` here is the activity's *source* database
    # (where the (db, code) key is canonically defined, typically base ecoinvent).
    database: str | None = None
    code: str | None = None
    amount: float = 1.0
    # Archetype target
    archetype_id: str | None = None
    scope: str = "all"  # "inflows" | "stock" | "outflows" | "all"
    stage_amounts: dict[str, float] | None = None
    year: int | None = None  # informational; part of cache key
    # Database to compute *against*. When set and different from the activity's
    # source database, keys are translated (db, code) → (compute_database, code)
    # to run against a premise-generated prospective database. When None or
    # equal to the source DB, the source DB is used (current behavior).
    compute_database: str | None = None
    # Method + presentation
    method: list[str]
    limit: int = 10
    cutoff: float = 0.005
    max_depth: int = 6
    # Maximum nodes returned by the Sankey supply-chain graph. The cycle-safe
    # BFS discovers the full forward DAG up to ``max_depth``; if the result
    # exceeds this cap, the response is pruned by edge value (best-first from
    # the root). 200 is enough for almost every non-market activity; bump to
    # ~600 for markets with high regional branching. Hard upper bound is 1000
    # to keep payloads reasonable and the d3-sankey layout responsive.
    max_nodes: int = Field(default=200, ge=10, le=1000)


class TechnosphereContributionItem(BaseModel):
    activity_name: str
    activity_key: str
    location: str
    amount: float
    unit: str
    percentage: float


class BiosphereContributionItem(BaseModel):
    flow_name: str
    flow_key: str
    categories: list[str] = []
    compartment: str = ""
    subcompartment: str = ""
    inventory_amount: float
    inventory_unit: str
    amount: float
    unit: str
    percentage: float


class ContributionTreeNode(BaseModel):
    name: str
    key: str
    location: str = ""
    amount: float
    unit: str
    score: float
    unit_score: str
    percentage: float
    children: list["ContributionTreeNode"] = []


class StageContribution(BaseModel):
    """Per-lifecycle-stage characterised score for an archetype contribution
    analysis. Sum of ``score`` across stages equals the aggregate result score
    to within numerical precision (LCA is linear in the demand vector)."""
    stage: str
    score: float
    unit: str = ""
    percentage: float = 0.0


class ContributionAnalysisResult(BaseModel):
    # Discriminator — explicit so future product-based AESA can dispatch on
    # ``result_type`` rather than duck-typing the shape. Mirrors
    # ``ImpactAssessmentResult.result_type = "system_level"``.
    result_type: Literal["single_product"] = "single_product"

    target_type: str
    target_label: str
    method: list[str]
    method_unit: str
    score: float
    scope: str = "all"
    year: int | None = None
    # Database the result was computed against (None when the request didn't
    # specify one — e.g. archetype targets that compute through whichever
    # databases the BOM activities point to).
    compute_database: str | None = None
    top_technosphere: ContributionsResponse
    top_biosphere: list[BiosphereContributionItem]
    biosphere_rest_amount: float = 0.0
    biosphere_rest_percentage: float = 0.0
    supply_chain_sankey: SankeyData
    supply_chain_tree: ContributionTreeNode
    # Per-stage breakdown for archetype targets (Manufacturing / Use Phase /
    # Maintenance / End of Life, etc., scaled by ``stage_amounts``). Empty for
    # activity targets, which have no inherent stages.
    by_stage: list[StageContribution] = Field(default_factory=list)
    cutoff: float
    max_depth: int
    elapsed_seconds: float = 0.0
    # Non-fatal warnings collected during computation (e.g. fell back to base
    # DB for activities not present in the requested compute_database).
    warnings: list[str] = Field(default_factory=list)
    # Reproducibility fields — must be readable in isolation 6+ months later.
    computed_at: str | None = None  # ISO-8601 UTC
    mapper_version: str | None = None

    def to_persistable_dict(self) -> dict:
        """Session-independent serialization. Strips ephemeral cache/task ids
        if any are added later (none today). Use this when archiving a result
        for paper reproducibility — its shape stays meaningful even if the
        in-memory cache or task registry no longer exists."""
        return self.model_dump(exclude={"cache_key", "task_id"})


class ContributionAnalysisExportRequest(BaseModel):
    result: ContributionAnalysisResult


# ── Multi-year contribution analysis ──────────────────────────────────────


class MultiYearContributionRequest(BaseModel):
    """Run contribution analysis for the same target across multiple years
    against a prospective-database family. The fully-qualified DB for each
    year is built as ``f"{compute_database_pattern}_{year}"``."""
    target_type: str  # "activity" | "archetype"
    database: str | None = None
    code: str | None = None
    amount: float = 1.0
    archetype_id: str | None = None
    scope: str = "all"
    stage_amounts: dict[str, float] | None = None
    # IAM × pathway pattern WITHOUT trailing year (e.g.
    # ``ecoinvent-3.10-cutoff_premise_remind_ssp2-pkbudg1150``). The endpoint
    # builds ``f"{pattern}_{year}"`` for each year. When None, every year
    # computes against the source DB (useful for static-DB trajectories where
    # only BOM expressions vary across years).
    compute_database_pattern: str | None = None
    years: list[int] = Field(default_factory=list)
    method: list[str]
    limit: int = 10
    # Multi-year is for trajectory comparison; single-year is for deep
    # contribution analysis. Different defaults, same code path. Depth-by-depth
    # impact accounting on ICEV-Petrol × REMIND SSP2-PkBudg1150 2025 showed:
    #   - Climate (GWP100): tree converges by depth=4 — largest hidden
    #     depth-5/6 node is 8.5% of root, median 1.1%.
    #   - Ecotoxicity (CTUe freshwater): long-tailed — largest hidden
    #     depth-5/6 node is 25.5% of root. Depth=4 hides too much.
    # Depth=5 is the conservative middle ground: still cheaper than depth=6
    # (which costs ~9 min on a 6-year ecoinvent 3.10 run), captures convergence
    # on long-tailed methods, and only loses the deepest tier of attribution.
    # For deeper analysis on toxicity-class methods, users should switch to
    # the single-year tab (depth=6, cutoff=0.005).
    cutoff: float = 0.01
    max_depth: int = 5
    max_nodes: int = Field(default=200, ge=10, le=1000)


class MultiYearTrajectoryPoint(BaseModel):
    year: int
    score: float
    compute_database: str | None = None
    # True when the per-year computation produced any warnings (e.g. partial
    # translation fallbacks). Used by the frontend to flag points on the
    # trajectory chart with a warning marker.
    has_warnings: bool = False


class MultiYearEvolutionItem(BaseModel):
    """One contributor tracked across years. ``activity_key`` is the union
    over all years' top contributors — a key may be in the top-N for some
    years and not others; missing-year entries get amount=0/score=0."""
    activity_key: str
    activity_name: str
    location: str = ""
    unit: str = ""
    # Year → score contribution. Years without an entry get 0.
    by_year: dict[str, float] = Field(default_factory=dict)


class MultiYearContributionResult(BaseModel):
    """Result of a multi-year single-product contribution analysis. Carries
    the per-year ContributionAnalysisResult dict plus pre-computed trajectory
    + evolution views ready for charting."""
    result_type: Literal["multi_year_single_product"] = "multi_year_single_product"

    target_type: str
    target_label: str
    method: list[str]
    method_unit: str
    compute_database_pattern: str | None = None
    years: list[int]
    # Year (str) → full per-year ContributionAnalysisResult. Keyed by
    # str(year) so the JSON payload is well-formed (Pydantic refuses int keys
    # at the model boundary).
    results: dict[str, ContributionAnalysisResult] = Field(default_factory=dict)
    trajectory: list[MultiYearTrajectoryPoint] = Field(default_factory=list)
    evolution: list[MultiYearEvolutionItem] = Field(default_factory=list)
    cutoff: float
    max_depth: int
    elapsed_seconds: float = 0.0
    # Aggregated warnings across years (deduplicated, year-prefixed).
    warnings: list[str] = Field(default_factory=list)
    computed_at: str | None = None
    mapper_version: str | None = None

    def to_persistable_dict(self) -> dict:
        return self.model_dump(exclude={"cache_key", "task_id"})


class CancelledTaskResponse(BaseModel):
    """Body discriminator returned by result-fetch endpoints when a task
    ended via cancellation. HTTP 200 (cancellation is an expected outcome
    of a long-running task, not a server error). The frontend keys off
    ``cancelled: true`` to render a Stopped state without parsing the
    success-shaped result."""
    cancelled: Literal[True] = True
    task_id: str


class MultiYearContributionTaskStarted(BaseModel):
    task_id: str
    planned_years: list[int]
    compute_databases: list[str]


class MultiYearContributionExportRequest(BaseModel):
    result: MultiYearContributionResult


# ── Single-product Impact Assessment exports (Patch 4G) ─────────────────────
# The single-product tab in Impact Assessment has its own three sub-tabs
# (Static Background / Prospective Background / Comparison). Each sub-tab
# gets its own export builder, paralleling the per-axis builders for
# system-mode (multi-LCI / multi-DSM / multi-paired / multi-param).
# Frontend assembles the full payload (including any multi-parameter
# sensitivity scenarios that live in panel-local state) and POSTs it to
# the matching endpoint. Stage amounts and computation metadata travel
# inside `ArchetypeLCACalculateResult`; the request envelope adds only
# the cross-result framing the builder needs.


class SingleProductStaticScenarioPayload(BaseModel):
    """One sensitivity case worth of Static Background results. ``label``
    is what the user sees on the in-app scenario tab bar (``Base`` for the
    default scenario, otherwise the parameter-set name)."""
    label: str
    result: ArchetypeLCACalculateResult


class SingleProductStaticExportRequest(BaseModel):
    archetype_name: str
    scope: str  # "all" | "inflows" | "stock" | "outflows"
    scenarios: list[SingleProductStaticScenarioPayload]
    # Patch 5K+ — stage-amount provenance (preset + lifetime). Single archetype,
    # so a single instance (not a dict like the multi-item export). Optional;
    # when absent the Configuration block shows preset/lifetime as "—" and the
    # per-stage amounts still come from the result echo. Reuses 5J's type.
    stage_amounts_meta: StageAmountsMeta | None = None


class SingleProductProspectiveRunPayload(BaseModel):
    """Mirrors the frontend ``ProjectedRun`` slot in
    ``useSingleProductImpactStore``. ``year`` may be None when premise
    couldn't tag the database with a year (rare; surfaces as ``—`` in the
    workbook)."""
    db_name: str
    year: int | None = None
    iam: str
    ssp: str
    result: ArchetypeLCACalculateResult


class SingleProductProspectiveExportRequest(BaseModel):
    archetype_name: str
    scope: str
    runs: list[SingleProductProspectiveRunPayload]
    # Patch 5K+ — see SingleProductStaticExportRequest.
    stage_amounts_meta: StageAmountsMeta | None = None


class SingleProductComparisonExportRequest(BaseModel):
    archetype_name: str
    scope: str
    static_result: ArchetypeLCACalculateResult
    projected_runs: list[SingleProductProspectiveRunPayload]
    # Patch 5K+ — see SingleProductStaticExportRequest.
    stage_amounts_meta: StageAmountsMeta | None = None
