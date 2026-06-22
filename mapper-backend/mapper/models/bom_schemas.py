# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Pydantic schemas for the BOM / Archetype module (Phase 2B).

An Archetype represents a representative product model (e.g., "BEV-LFP") with
a hierarchical Bill of Materials. Stages → components → materials. Material
leaves link to ecoinvent activities. The DSM × LCA pipeline maps each DSM
cohort to an archetype (with a scaling factor), multiplies the BOM by
per-year cohort counts × scale, and aggregates demand into a single LCA call
per year.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from mapper.core.compute_metrics import ComputeMetrics


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
    # Optional parameter expression that resolves to ``quantity`` (e.g.
    # "battery_mass_lfp * 0.35"). When set, ``quantity`` is the last-resolved
    # numeric value; the pipeline re-resolves from this string against the
    # active ParameterSet before computation. ``None`` = plain number workflow.
    quantity_expression: str | None = None
    unit: str = "unit"
    # Explicit DSM scope. Only meaningful on root-level stage nodes; materials
    # and sub-components inherit their parent stage's scope. ``None`` falls
    # back to keyword-matching on the stage name for backward compatibility.
    scope: str | None = None  # "inflows" | "stock" | "outflows"
    is_annual: bool = False  # True → quantities are per-year (Use Phase, Maintenance)
    children: list["BOMNode"] | None = None
    ecoinvent_activity: EcoinventLink | None = None
    evolution: MaterialEvolution | None = None
    # Upload-time validation status (Patch 2). "ok" | "warning" | "error".
    # Errors block LCA computation; warnings are surfaced but allowed.
    # Default "ok" so legacy persisted archetypes (no field) deserialise fine.
    validation_status: Literal["ok", "warning", "error"] = "ok"
    validation_message: str | None = None


BOMNode.model_rebuild()


# ── Validation report (upload-time, Patch 2) ─────────────────────────────────


# Error type enumeration. Frontend groups by (severity, error_type, bad_value)
# so the choice of stable string identifiers matters more than the message text.
ValidationErrorType = Literal[
    "code_truncated",      # error: code length != 32
    "code_not_found",      # error: (db, code) not in bw2data
    "database_missing",    # error: database not in current bw2 project
    "code_no_database",    # error: code set but database empty
    "database_no_code",    # error: database set but code empty
    "name_mismatch",       # warning: BOM name != ecoinvent activity name
    "location_mismatch",   # warning: BOM location != ecoinvent activity location
]


class ValidationIssue(BaseModel):
    severity: Literal["error", "warning"]
    error_type: ValidationErrorType
    archetype: str
    stage: str
    row_idx: int  # 1-indexed Excel row, or synthetic row number
    name: str  # BOM material name
    bad_value: str  # the value that triggered the issue (truncated code, mismatched name, …)
    message: str  # human-readable explanation
    # The BOM-recorded "Ecoinvent Name" cell, when present. Lets the frontend
    # show "your BOM called this 'aluminum sheet'" alongside a bad code.
    bom_ecoinvent_name: str = ""


class ValidationGroupAffected(BaseModel):
    archetype: str
    stage: str
    row_idx: int
    name: str


class ValidationGroup(BaseModel):
    """Pre-grouped view: one entry per (severity, error_type, bad_value).

    The frontend renders these as collapsible sections — a single grouped
    "6 unique truncated codes affecting 41 rows" line beats 41 individual
    error rows when a workbook has systematic issues.
    """
    severity: Literal["error", "warning"]
    error_type: ValidationErrorType
    bad_value: str
    bom_name: str = ""  # the BOM-recorded name for this code, when applicable
    count: int
    affected: list[ValidationGroupAffected]


class ValidationReport(BaseModel):
    total_rows: int  # rows that carried a code (non-LCA rows are skipped)
    valid_rows: int
    error_rows: int
    warning_rows: int
    issues: list[ValidationIssue] = Field(default_factory=list)
    groups: list[ValidationGroup] = Field(default_factory=list)
    project_name: str = ""
    # Diagnostic counters — useful for verifying the per-(db,code) cache.
    bw2_lookups: int = 0
    cache_hits: int = 0


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
    # Last upload-time validation outcome (Patch 2). ``None`` for legacy
    # archetypes that were imported before validation existed.
    validation_report: "ValidationReport | None" = None


Archetype.model_rebuild()


class ArchetypeSummary(BaseModel):
    id: str
    name: str
    description: str | None
    category: str | None
    folder: str | None = None
    material_count: int
    unlinked_count: int
    stages: list[str] = Field(default_factory=list)
    stage_annual: dict[str, bool] = Field(default_factory=dict)  # stage_name → is_annual
    created_at: str
    updated_at: str
    # Patch 2: per-archetype validation roll-up. Lets the archetype list page
    # mark error/warning archetypes without fetching the full report for each.
    validation_error_rows: int = 0
    validation_warning_rows: int = 0


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
    quantity_expression: str | None = None
    unit: str | None = None
    is_annual: bool | None = None
    scope: str | None = None
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
    # Patch 4AK — per-cohort-row color override. Keyed by cohort_key
    # (e.g. ``BEV-LFP|Small``); value is a ``#RRGGBB`` hex string. When
    # set, both pills of that row in the Cohort Mapping table render in
    # this color AND the cohort-key stacked charts use it. Empty when
    # the user hasn't picked anything.
    row_colors: dict[str, str] = Field(default_factory=dict)


class CohortMappingResult(BaseModel):
    mapped_cohorts: int
    unmapped_cohorts: list[str]
    invalid_cohorts: list[str]
    invalid_archetypes: list[str]
    # Patch 4AK — colors parsed from the Color column (row-level errors
    # for invalid hex are surfaced here separately from cohort/archetype
    # invalids so the upload-result UI can show them inline).
    invalid_row_colors: list[str] = Field(default_factory=list)


# ── DSM × LCA combined ───────────────────────────────────────────────────────


class DSMLCARequest(BaseModel):
    # Either ``method`` (single, legacy) or ``methods`` (list) must be set.
    # If both are provided, ``methods`` wins.
    method: list[str] | None = None
    methods: list[list[str]] | None = None
    scope: str = "stock"  # "inflows" | "outflows" | "stock" | "all"
    year_start: int | None = None
    year_end: int | None = None
    # Optional parameter set to resolve BOM quantity expressions against.
    # When ``None``, the archetype's pre-resolved ``node.quantity`` values are
    # used as-is (backward compat for BOMs without expressions).
    parameter_set_id: str | None = None


class DSMLCAYearResult(BaseModel):
    year: int
    total_impact: float
    impact_by_cohort: dict[str, float]
    impact_by_material: dict[str, float]
    count_by_cohort: dict[str, float] = Field(default_factory=dict)
    unit: str


class DSMLCASummary(BaseModel):
    total_impact: float
    peak_year: int
    peak_impact: float


class DSMLCAResult(BaseModel):
    mfa_system_id: str
    method: list[str]
    method_label: str = ""
    scope: str
    unit: str
    years: list[DSMLCAYearResult]
    summary: DSMLCASummary
    # Stage names (root BOM nodes) that actually contributed — empty on legacy
    # results saved before stage-scoping was added.
    stages_included: list[str] = Field(default_factory=list)


class DSMLCABatchResult(BaseModel):
    results: list[DSMLCAResult]
    methods_calculated: int
    year_start: int | None = None
    year_end: int | None = None
    warnings: list[str] = Field(default_factory=list)
    compute_metrics: ComputeMetrics | None = None


# ── Impact Assessment (unified pipeline) ─────────────────────────────────────


class ProspectiveScenarioRef(BaseModel):
    """Points at a generated scenario in plca_storage (iam, ssp, base_db). The
    impact endpoint looks up every year's matching prospective DB at
    calculation time."""
    base_db: str
    iam: str
    ssp: str


class PairedDSMLCIRef(BaseModel):
    """One pair of (DSM scenario, LCI scenario) for paired fan-out (Patch 2F).

    The frontend sends a list of these on
    :attr:`ImpactAssessmentRequest.paired_scenarios`; the orchestrator spawns
    one task per pair, threading each per-task body with both
    ``dsm_scenario_id`` (singular) and ``scenario`` (singular). The pair key
    used for response shape and as the per-pair task lookup is
    ``"<dsm_scenario_id>::<base_db>::<iam>::<ssp>"`` — deterministic, frontend
    can compute it without round-tripping.
    """
    dsm_scenario_id: str
    lci_scenario: ProspectiveScenarioRef


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
    # Projected mode only: multi-scenario LCI sweep. When set with len ≥ 1 this
    # supersedes ``scenario`` — the worker runs the full pipeline once per
    # ``(base_db, iam, ssp)`` entry sequentially under a single ``task_id`` and
    # returns a :class:`MultiScenarioProjectedImpactResult`. ``len == 1``
    # collapses to single-scenario semantics (still wrapped, frontend narrows
    # on the ``result_type`` discriminator).
    lci_scenarios: list[ProspectiveScenarioRef] | None = None
    # Optional parameter set to resolve BOM quantity expressions against.
    # Legacy single-scenario field — ``scenarios`` below takes precedence when
    # set. Kept so older clients keep working during the scenarios rollout.
    parameter_set_id: str | None = None
    # Optional list of parameter-table scenario names to sweep. When set the
    # pipeline runs once per scenario and the results are wrapped in a
    # :class:`MultiScenarioImpactResult`. ``None``/empty → single-scenario
    # behaviour controlled by ``parameter_set_id``.
    scenarios: list[str] | None = None
    # Optional DSM scenario id (single). When set the worker simulates that
    # scenario fresh (rather than reading the cached active-scenario sim) and
    # stamps ``meta.dsm_scenario_id`` on the result. Defaults to ``None`` →
    # legacy behaviour: use the cached sim from the active scenario.
    dsm_scenario_id: str | None = None
    # Optional list of DSM scenario ids to sweep — multi-DSM-axis fan-out.
    # Consumed by ``/impact/calculate-scenarios``. Mutually exclusive with
    # ``scenarios`` (the 3-way axisConflict rule is mirrored server-side).
    # ``None``/empty → no fan-out.
    dsm_scenario_ids: list[str] | None = None
    # Paired DSM × LCI fan-out (Patch 2F): N tasks total, one per
    # ``(dsm_scenario_id, lci_scenario)`` pair. Distinct from the cartesian
    # product of ``dsm_scenario_ids × lci_scenarios`` — pairs are explicit,
    # not auto-inferred. Mutually exclusive with ``scenarios``,
    # ``dsm_scenario_ids``, and ``lci_scenarios`` (length > 1) — the
    # axisConflict rule on the frontend prevents the combination, and the
    # orchestrator 400s as defence in depth. Methodology: each pair
    # represents one coherent socioeconomic future (e.g. SSP1 stock
    # evolution under SSP1 LCI conditions); the cartesian product would
    # mix incoherent combinations (e.g. SSP1 stock under SSP5 LCI) which
    # is rarely what users want.
    paired_scenarios: list[PairedDSMLCIRef] | None = None
    # Projected mode only — prospective-LCA temporal handling:
    #   "block" (default): each fleet year takes its nearest-earlier premise
    #     anchor db, held constant within the 5-year block → STEP at each
    #     anchor. Byte-identical to pre-interpolation behaviour.
    #   "interpolate": for a non-anchor year bracketed by anchors a < Y < b,
    #     solve the SAME year-Y demand against db_a AND db_b and linearly blend
    #     the scalar scores per category (frac = (Y−a)/(b−a)) → smooth
    #     piecewise-linear profile. Rigorous because the LCIA CFs are
    #     year-invariant. Exact-anchor / clamped (before-first / after-last)
    #     years do a SINGLE solve (no blend).
    #
    # Default is "interpolate" (Stage 2) — smooth piecewise-linear profile is
    # the methodologically-preferred prospective behaviour. The toggle retains
    # "block" for reproducibility of pre-interpolation / stepped results.
    temporal_mode: Literal["block", "interpolate"] = "interpolate"


class ImpactAssessmentMeta(BaseModel):
    mode: str
    # Optional — None for a non-fleet single-LCA source adapted into AESA
    # (no DSM system). The fleet pipeline always sets it (back-compat).
    mfa_system_id: str | None = None
    scope: str
    year_start: int | None = None
    year_end: int | None = None
    base_db: str | None = None
    scenario: ProspectiveScenarioRef | None = None
    # Name of the parameter-table scenario resolved for this run (``"Base"`` or
    # a user-defined scenario). Echoed back so the UI can tag outputs.
    parameter_set_id: str | None = None
    # DSM scenario id resolved for this run (``"base"`` or a user-defined id).
    # Echoed back so the UI can tag outputs and the multi-DSM Excel builder
    # can label rows.
    dsm_scenario_id: str | None = None
    # Projected mode: which (year → database) was actually resolved, so the UI
    # can flag fallbacks (e.g. 2024 → 2025 earliest-available).
    year_to_database: dict[int, str] = Field(default_factory=dict)
    # Non-fatal warnings collected during setup (e.g. dependent-subsystem
    # archetypes that had no cohort mapping and were excluded from the run).
    warnings: list[str] = Field(default_factory=list)


class ImpactAssessmentResult(BaseModel):
    # Discriminator — paired with ``ContributionAnalysisResult.result_type``.
    # Lets future AESA code dispatch system-level vs product-level results
    # explicitly without duck-typing the shape.
    result_type: Literal["system_level"] = "system_level"
    task_id: str
    meta: ImpactAssessmentMeta
    results: list[DSMLCAResult]
    elapsed_seconds: float | None = None


class ScenarioImpactResult(BaseModel):
    """One entry of a multi-scenario impact run."""
    scenario: str
    task_id: str
    result: ImpactAssessmentResult


class MultiScenarioImpactResult(BaseModel):
    """Wraps per-scenario impact results for a single multi-scenario compute.

    ``comparison`` is reserved for summary deltas computed by the frontend
    (e.g. % change vs Base per year per method) — kept opaque here so the
    shape can evolve without a schema version bump.
    """
    scenarios: list[ScenarioImpactResult]
    comparison: dict = Field(default_factory=dict)


class ScenarioProjectedResult(BaseModel):
    """One LCI-scenario entry in a multi-scenario projected run.

    ``scenario`` is the originating ``(base_db, iam, ssp)`` triple; the inner
    ``result.meta.scenario`` is also stamped with the same triple so each
    nested result is self-contained for downstream consumers (export, AESA).
    """
    scenario: ProspectiveScenarioRef
    result: ImpactAssessmentResult


class MultiScenarioProjectedImpactResult(BaseModel):
    """Result envelope for projected runs with ``len(lci_scenarios) > 1``.

    Discriminator ``result_type`` lets the frontend narrow on the response
    shape without inspecting fields. The single-scenario response keeps the
    existing ``ImpactAssessmentResult`` shape (``result_type='system_level'``).
    """
    result_type: Literal["multi_scenario_projected"] = "multi_scenario_projected"
    task_id: str
    # Meta from the request (mfa_system_id, scope, year window, parameter set,
    # etc). ``scenario`` is None on the wrapper since each entry carries its
    # own; ``year_to_database`` is also empty here — per-scenario maps are on
    # each ``ScenarioProjectedResult.result.meta``.
    meta: ImpactAssessmentMeta
    scenarios: list[ScenarioProjectedResult]
    elapsed_seconds: float | None = None


class ImpactCompareRequest(BaseModel):
    static_task_id: str
    projected_task_id: str


class ParamScenarioImpactResult(BaseModel):
    """One parameter-scenario entry in a multi-parameter export envelope.

    ``scenario`` is the parameter-table scenario name (``"Base"`` or a
    user-defined name); ``result`` is the full per-scenario impact result as
    returned by ``/impact/calculate`` for that scenario's task.
    """
    scenario: str
    result: ImpactAssessmentResult


class MultiParamImpactResult(BaseModel):
    """Frontend-assembled envelope for multi-parameter Excel export.

    Unlike :class:`MultiScenarioProjectedImpactResult` (returned by the
    backend for multi-LCI runs under one ``task_id``), multi-parameter
    fan-out runs as N parallel single-scenario tasks under
    ``/impact/calculate-scenarios``. The frontend assembles this envelope
    client-side from the per-scenario task results before POSTing to
    ``/impact/export``; the envelope itself has no backend ``task_id``.

    ``result_type`` is the discriminator that routes the export to
    ``_build_multi_param_workbook``. ``meta`` is taken from the first
    scenario as a representative — per-scenario meta is on each entry's
    ``result.meta``.
    """
    result_type: Literal["multi_param"] = "multi_param"
    meta: ImpactAssessmentMeta
    scenarios: list[ParamScenarioImpactResult]
    elapsed_seconds: float | None = None


class DSMScenarioImpactResult(BaseModel):
    """One DSM-scenario entry in a multi-DSM impact envelope.

    ``scenario_id`` is the DSM scenario id (``"base"`` or a user-defined id);
    ``scenario_name`` is the human-readable label for UI / Excel display
    (echoed from ``DSMScenario.name`` at fan-out time so the envelope is
    self-contained for downstream consumers). ``result`` is the full
    per-scenario impact result as returned by ``/impact/calculate``.
    """
    scenario_id: str
    scenario_name: str
    result: ImpactAssessmentResult


class MultiDSMImpactResult(BaseModel):
    """Frontend-assembled envelope for multi-DSM Excel export.

    Mirrors :class:`MultiParamImpactResult` topology — multi-DSM fan-out runs
    as N parallel single-scenario tasks under ``/impact/calculate-scenarios``
    (one task per DSM scenario id), and the frontend assembles this envelope
    client-side from the per-scenario task results before POSTing to
    ``/impact/export``. The envelope itself has no backend ``task_id``.

    ``result_type`` is the discriminator that routes the export to
    ``_build_multi_dsm_workbook`` (Patch 2E.3, deferred). ``meta`` is taken
    from the first scenario as a representative — per-scenario meta is on
    each entry's ``result.meta`` and includes the resolved
    ``dsm_scenario_id``.
    """
    result_type: Literal["multi_dsm"] = "multi_dsm"
    meta: ImpactAssessmentMeta
    scenarios: list[DSMScenarioImpactResult]
    elapsed_seconds: float | None = None


class PairedScenarioImpactResult(BaseModel):
    """One paired-scenario entry in a multi-paired DSM×LCI envelope (Patch 2F).

    ``dsm_scenario_id`` / ``dsm_scenario_name`` and ``lci_scenario`` /
    ``lci_scenario_label`` carry both the stable identifiers (used as keys)
    and human-readable labels (used in chart legends, tab bar, Excel index
    sheets). Mirrors the topology of :class:`DSMScenarioImpactResult` but
    with both axes' coordinates so the envelope is self-contained for export
    without round-tripping back to the DSM/PLCA stores.
    """
    dsm_scenario_id: str
    dsm_scenario_name: str
    lci_scenario: ProspectiveScenarioRef
    lci_scenario_label: str
    result: ImpactAssessmentResult


class MultiPairedImpactResult(BaseModel):
    """Frontend-assembled envelope for paired DSM×LCI Excel export (Patch 2F).

    Topology parallels :class:`MultiDSMImpactResult` and
    :class:`MultiParamImpactResult`: paired runs spawn N parallel
    single-pair tasks under ``/impact/calculate-scenarios`` (one task per
    pair), and the frontend assembles this envelope client-side from the
    per-pair task results before POSTing to ``/impact/export``. The
    envelope itself has no backend ``task_id``.

    ``result_type`` is the discriminator that routes the export to
    ``_build_multi_paired_workbook``. ``meta`` is taken from the first
    pair as a representative — per-pair meta (with the resolved
    ``dsm_scenario_id`` AND ``scenario`` triple) is on each entry's
    ``result.meta``.
    """
    result_type: Literal["multi_paired_dsm_lci"] = "multi_paired_dsm_lci"
    meta: ImpactAssessmentMeta
    scenarios: list[PairedScenarioImpactResult]
    elapsed_seconds: float | None = None


class ImpactExportRequest(BaseModel):
    """Export an Impact Assessment run to XLSX. Accepts EITHER a backend
    ``task_id`` (registered run) OR an inline ``result`` payload (used for
    synthetic Static runs mirrored from the DSM×LCA panel, which never hit
    /impact/calculate). Optional ``compare_with`` adds a Static-vs-Projected
    sheet computed client-or-server-side."""
    task_id: str | None = None
    result: ImpactAssessmentResult | None = None
    # Inline multi-scenario projected payload. When provided the Excel writer
    # adds an ``LCI Scenario`` column on every data sheet and unfolds rows
    # across scenarios.
    multi_result: MultiScenarioProjectedImpactResult | None = None
    # Inline multi-parameter envelope (frontend-assembled). When provided the
    # Excel writer routes through ``_build_multi_param_workbook`` with a
    # ``Sensitivity case`` column on every data sheet and a Parameter
    # Scenarios index. Mutually exclusive with ``multi_result`` — the 3-way
    # axisConflict rule prevents both from being set simultaneously.
    multi_param_result: MultiParamImpactResult | None = None
    # Inline multi-DSM envelope (frontend-assembled, Patch 2E.1). The Excel
    # builder for this shape is part of Patch 2E.3 (deferred). The schema is
    # accepted now so the frontend (Patch 2E.2) can post envelopes
    # immediately; until 2E.3 ships the export route 400s explicitly when
    # this field is set.
    multi_dsm_result: MultiDSMImpactResult | None = None
    # Inline multi-paired DSM×LCI envelope (Patch 2F, frontend-assembled).
    # Routes through ``_build_multi_paired_workbook`` with a ``Pair`` column
    # on every data sheet and a Pairs index. Mutually exclusive with the
    # other multi-axis envelopes — the axisConflict rule on the frontend
    # prevents the combination, the route 400s as defence in depth.
    multi_paired_result: MultiPairedImpactResult | None = None
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
    # Patch 4M — in-task scenario fields. When ``dsm_scenario_id`` is set,
    # the handler runs a fresh simulate via ``simulate_for_scenario``
    # (Patch 2E.1) instead of reading the cached active-scenario sim;
    # ``None`` keeps the legacy behavior. ``parameter_scenario`` resolves
    # BOM ``quantity_expression`` strings against a named scenario from
    # the active project's ``ParameterTable`` (mirrors single-product
    # LCA's pattern); ``None`` uses base values.
    dsm_scenario_id: str | None = None
    parameter_scenario: str | None = None


class MaterialFlowMultiRequest(BaseModel):
    """Patch 4M — fan-out sibling to ``MaterialFlowRequest``. Server-side
    loop, returns a ``MultiMaterialFlowResult`` envelope. The
    axisConflict rule applies: at most one of ``dsm_scenario_ids`` /
    ``parameter_scenarios`` may be non-empty (cartesian product is out
    of scope; matrix UI would need its own design)."""
    scope: str = "stock"
    year_start: int | None = None
    year_end: int | None = None
    group_by: str = "material"
    dsm_scenario_ids: list[str] | None = None
    parameter_scenarios: list[str] | None = None


class MaterialFlowScenarioRun(BaseModel):
    """One scenario's worth of MFA results inside a multi-axis envelope.
    ``axis`` discriminates which dimension this run was generated along
    so the frontend can label scenario tabs without reverse-engineering
    the request body."""
    axis: str  # "dsm" | "parameter"
    scenario_id: str  # DSM scenario id or parameter scenario name
    scenario_label: str  # human-readable label for tab bar / Excel
    result: "MaterialFlowResult"


class MultiMaterialFlowResult(BaseModel):
    """Envelope returned by the multi-MFA fan-out endpoint. Mirrors the
    shape of multi-DSM Impact Assessment (``MultiDSMImpactResult``) but
    flat — there is no per-side or per-mode discriminator because MFA
    is one tab on one system."""
    axis: str  # "dsm" | "parameter" — the axis that was fanned out
    runs: list[MaterialFlowScenarioRun]
    elapsed_seconds: float = 0.0


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
    # Empty = primary subsystem (the DSM system itself). Non-empty =
    # dependent subsystem contributing this series.
    subsystem_id: str = ""
    subsystem_name: str = ""


class SubsystemRef(BaseModel):
    id: str
    name: str


class MaterialFlowResult(BaseModel):
    scope: str
    stages_included: list[str]
    year_start: int
    year_end: int
    group_by: str
    materials: list[MaterialSeries]
    elapsed_seconds: float
    # Empty subsystems list = no dependents (primary only). When populated, the
    # first entry is always the primary system; subsequent entries are
    # dependent subsystems whose BOMs contributed rows.
    subsystems: list[SubsystemRef] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    compute_metrics: ComputeMetrics | None = None
    # Secondary context: product-unit counts from the DSM simulation, aligned
    # to the selected ``scope`` (Manufacturing=inflows, Operation=stock,
    # End of Life=outflows). ``system_units_by_year`` is the system-wide total
    # for each year in ``[year_start, year_end]``. ``archetype_units_by_year``
    # is keyed by cohort_key → {year: count}. Empty dicts for systems without
    # a simulation result yet.
    unit_name: str = "units"
    system_units_by_year: dict[int, float] = Field(default_factory=dict)
    archetype_units_by_year: dict[str, dict[int, float]] = Field(default_factory=dict)
