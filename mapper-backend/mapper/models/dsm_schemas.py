"""Pydantic schemas for the DSM dynamic stock module (Phase 2A).

The DSM module is a system-agnostic dynamic stock-flow model with cohort
tracking. The user defines arbitrary dimensions (e.g., fuel_type, size); the
``age`` dimension is auto-generated from the time horizon and is implicit in
every system. All quantities are floats so users can express partial counts
(e.g., regional shares, fractional fleets).
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from mapper.core.compute_metrics import ComputeMetrics


DSMMode = Literal["manual", "survival_inflow", "survival_stock"]

# Maps legacy enum values (≤ v0.1) to their current equivalents. Applied by the
# ``ModeConfig.mode`` validator so existing state.json files keep loading.
_LEGACY_MODE_ALIASES: dict[str, DSMMode] = {
    "inflow_driven": "survival_inflow",
    "stock_driven": "survival_stock",
}


def _coerce_mode(value: Any) -> Any:
    if isinstance(value, str) and value in _LEGACY_MODE_ALIASES:
        return _LEGACY_MODE_ALIASES[value]
    return value


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
    # Human label for one countable product in this system (e.g. "vehicles",
    # "turbines", "buildings"). Used as secondary context alongside kg in
    # Material Flows views. Defaults to "units" for generic systems.
    unit_name: str = "units"


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


class ModeConfig(BaseModel):
    """DSM mode assignment for cohorts selected by ``dimension_filters``.

    Same selection semantics as :class:`SurvivalConfig` — most-specific filter
    wins for a given cohort; an empty filter acts as a default. Cohorts with no
    matching config fall back to ``"survival_inflow"``.

    Legacy mode values (``inflow_driven`` / ``stock_driven``) written by
    v0.1 are silently migrated to ``survival_inflow`` / ``survival_stock``
    so existing ``state.json`` files keep loading.
    """
    dimension_filters: dict[str, str] = Field(default_factory=dict)
    mode: DSMMode = "survival_inflow"

    @field_validator("mode", mode="before")
    @classmethod
    def _migrate_legacy_mode(cls, v: Any) -> Any:
        return _coerce_mode(v)


# ── Scaling rules (scenario-driven DSM) ──────────────────────────────────────

ScalingTarget = Literal["inflows", "stock_targets", "outflows"]


class DSMScalingRule(BaseModel):
    """Parameter-driven scaling applied to base DSM data before simulation.

    Selection uses the same most-specific-filter semantics as
    :class:`ModeConfig` and :class:`SurvivalConfig`: one rule matches per
    cohort (first most-specific match wins, no stacking). If users want two
    factors combined, they put both in one expression (e.g.
    ``adoption_rate * growth_rate``).

    The expression is evaluated by :class:`mapper.core.parameter_engine.ParameterEngine`
    once per (cohort, year). Two reserved variables are injected in addition
    to the user's parameters:

    * ``base`` — the uploaded base value for the (cohort, year) cell
    * ``year`` — the year being resolved (int)

    Examples: ``base * bev_adoption_rate``,
    ``base * (1 + (year - 2026) * ramp)``, ``base + flat_subsidy``.
    """
    id: str
    dimension_filters: dict[str, str] = Field(default_factory=dict)
    applies_to: ScalingTarget = "inflows"
    expression: str
    description: str | None = None


class DSMScalingRuleList(BaseModel):
    rules: list[DSMScalingRule]


class ScalingRuleSetResult(BaseModel):
    rules_set: int


# ── Stock & inflow data ──────────────────────────────────────────────────────


class InflowData(BaseModel):
    year: int
    counts: dict[str, float]  # cohort_key -> count


class StockTargetData(BaseModel):
    """Target stock per cohort for a given year (survival/stock-driven mode)."""
    year: int
    counts: dict[str, float]  # cohort_key -> target stock


class OutflowData(BaseModel):
    """User-provided outflow counts for manual mode.

    ``counts`` maps ``cohort_key`` → total outflow for the year (allocated FIFO
    across ages at simulation time). ``cohort_age_counts`` optionally supplies
    a per-age breakdown when the upload included an ``age`` or ``birth_year``
    column; keys are ``"{cohort_key}|{age}"``. When present, the engine uses it
    instead of FIFO.
    """
    year: int
    counts: dict[str, float] = Field(default_factory=dict)
    cohort_age_counts: dict[str, float] = Field(default_factory=dict)


BASE_SCENARIO_ID = "base"


class DSMScenario(BaseModel):
    """A named data slot on a DSM system.

    Each scenario holds its own copy of the cohort-level inputs (initial stock,
    inflows, stock targets, outflows) and scenario-level config overrides
    (mode_configs, scaling_rules). A scenario with ``is_base=True`` is the
    inheritance root. Non-base scenarios leave slots as ``None`` to inherit the
    Base value; an explicit (possibly empty) list/dict means "override Base
    with nothing here". Exactly one Base scenario exists per system.
    """
    id: str
    name: str
    description: str | None = None
    is_base: bool = False
    # Data slots. ``None`` on non-base = inherit from Base. On Base, ``None`` is
    # treated as "empty" by the resolver.
    initial_stock: dict[str, float] | None = None  # "{cohort_key}|{age}" -> count
    inflows: list[InflowData] | None = None
    stock_targets: list[StockTargetData] | None = None
    outflows: list[OutflowData] | None = None
    mode_configs: list[ModeConfig] | None = None
    scaling_rules: list[DSMScalingRule] | None = None
    created_at: str | None = None
    updated_at: str | None = None


class DSMSystemState(BaseModel):
    """Persisted state for a DSM system.

    Cohort-level data is stored per :class:`DSMScenario` (see ``scenarios``).
    System-wide config — survival curves and the integer-units flag — lives
    at the top level because it doesn't vary between scenarios in this design.

    Legacy state files (pre-scenarios) are auto-migrated by
    ``_migrate_legacy_to_base_scenario``: top-level data fields are wrapped
    into a single Base scenario, and the legacy keys are dropped.
    """
    system_id: str
    survival_configs: list[SurvivalConfig] = Field(default_factory=list)
    # When true, stock/inflow/outflow counts are rounded to integers after each
    # simulation step using largest-remainder allocation. For discrete products
    # (vehicles, buildings). Default off for backward compatibility.
    integer_units: bool = False
    scenarios: list[DSMScenario] = Field(default_factory=list)
    active_scenario_id: str | None = None

    @model_validator(mode="before")
    @classmethod
    def _migrate_legacy_to_base_scenario(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        legacy_keys = (
            "initial_stock",
            "inflows",
            "stock_targets",
            "outflows",
            "mode_configs",
            "scaling_rules",
        )
        has_scenarios = bool(data.get("scenarios"))
        has_legacy = any(k in data for k in legacy_keys)
        if has_scenarios and not has_legacy:
            return data
        base: dict[str, Any] = {
            "id": BASE_SCENARIO_ID,
            "name": "Base",
            "is_base": True,
        }
        for key in legacy_keys:
            if key in data:
                base[key] = data.pop(key)
        if has_scenarios:
            # Merge legacy fields into existing Base (if one exists) without
            # clobbering already-set scenario slots.
            scenarios = list(data["scenarios"])
            idx = next(
                (i for i, s in enumerate(scenarios)
                 if isinstance(s, dict) and s.get("is_base")),
                None,
            )
            if idx is not None:
                existing = scenarios[idx]
                for k, v in base.items():
                    existing.setdefault(k, v)
                scenarios[idx] = existing
            else:
                scenarios.insert(0, base)
            data["scenarios"] = scenarios
        else:
            data["scenarios"] = [base]
        if not data.get("active_scenario_id"):
            data["active_scenario_id"] = BASE_SCENARIO_ID
        return data


class MaterializedDSMState(BaseModel):
    """Engine-facing view of a single scenario with Base inheritance resolved.

    Not persisted. Produced by :func:`materialize_scenario` and consumed by
    :class:`mapper.core.dsm_engine.DynamicStockModel`. Mirrors the pre-scenarios
    ``DSMSystemState`` shape so the engine reads fields directly as before.
    """
    system_id: str
    survival_configs: list[SurvivalConfig] = Field(default_factory=list)
    integer_units: bool = False
    initial_stock: dict[str, float] = Field(default_factory=dict)
    inflows: list[InflowData] = Field(default_factory=list)
    stock_targets: list[StockTargetData] = Field(default_factory=list)
    outflows: list[OutflowData] = Field(default_factory=list)
    mode_configs: list[ModeConfig] = Field(default_factory=list)
    scaling_rules: list[DSMScalingRule] = Field(default_factory=list)
    # Identifier of the resolved scenario — useful for logging and result dedup.
    scenario_id: str = BASE_SCENARIO_ID


_SLOT_DEFAULTS: dict[str, Any] = {
    "initial_stock": dict,
    "inflows": list,
    "stock_targets": list,
    "outflows": list,
    "mode_configs": list,
    "scaling_rules": list,
}


def get_base_scenario(state: DSMSystemState) -> DSMScenario:
    """Return the Base scenario, creating one if somehow missing.

    The migration validator guarantees a Base exists for any state loaded from
    disk, so this fallback is purely defensive for in-memory states that skip
    validation.
    """
    for s in state.scenarios:
        if s.is_base:
            return s
    if state.scenarios:
        return state.scenarios[0]
    base = DSMScenario(id=BASE_SCENARIO_ID, name="Base", is_base=True)
    state.scenarios.append(base)
    state.active_scenario_id = state.active_scenario_id or BASE_SCENARIO_ID
    return base


def get_scenario(state: DSMSystemState, scenario_id: str | None = None) -> DSMScenario:
    """Resolve ``scenario_id`` (falls back to active, then Base) or raise."""
    sid = scenario_id or state.active_scenario_id
    if sid is None:
        return get_base_scenario(state)
    for s in state.scenarios:
        if s.id == sid:
            return s
    raise KeyError(f"Scenario not found: {sid!r}")


def materialize_scenario(
    state: DSMSystemState, scenario_id: str | None = None
) -> MaterializedDSMState:
    """Flatten a scenario + Base inheritance into an engine-ready view.

    For each data slot, the scenario's own value wins when not ``None``;
    otherwise the Base value is used; otherwise the slot's empty default.
    """
    base = get_base_scenario(state)
    target = get_scenario(state, scenario_id)

    def resolve(slot: str) -> Any:
        own = getattr(target, slot)
        if own is not None:
            return own
        if target is not base:
            base_val = getattr(base, slot)
            if base_val is not None:
                return base_val
        return _SLOT_DEFAULTS[slot]()

    return MaterializedDSMState(
        system_id=state.system_id,
        survival_configs=state.survival_configs,
        integer_units=state.integer_units,
        initial_stock=resolve("initial_stock"),
        inflows=resolve("inflows"),
        stock_targets=resolve("stock_targets"),
        outflows=resolve("outflows"),
        mode_configs=resolve("mode_configs"),
        scaling_rules=resolve("scaling_rules"),
        scenario_id=target.id,
    )


# ── Simulation results ───────────────────────────────────────────────────────


class YearResult(BaseModel):
    year: int
    stock: dict[str, float]
    stock_by_age: dict[str, dict[int, float]]
    inflow: dict[str, float]
    # Total outflow = natural_outflow + forced_retirement. Kept as the primary
    # surface the LCA pipeline reads so Mode A behavior is unchanged.
    outflow: dict[str, float]
    outflow_by_age: dict[str, dict[int, float]]
    # Survival-mode breakdown. In ``survival_inflow`` ``natural_outflow ==
    # outflow`` and the forced/manual fields are empty. Defaults let older
    # result files deserialize cleanly.
    natural_outflow: dict[str, float] = Field(default_factory=dict)
    forced_retirement: dict[str, float] = Field(default_factory=dict)
    forced_retirement_by_age: dict[str, dict[int, float]] = Field(default_factory=dict)
    # Manual-mode outflows (only populated for cohorts in ``manual`` mode).
    manual_outflow: dict[str, float] = Field(default_factory=dict)


class SimulationSummary(BaseModel):
    total_stock_start: float
    total_stock_end: float
    total_inflows: float
    total_outflows: float
    warnings: list[str] = Field(default_factory=list)


class SimulationResult(BaseModel):
    system_id: str
    years: list[YearResult]
    summary: SimulationSummary
    compute_metrics: ComputeMetrics | None = None


class SimulateScenariosRequest(BaseModel):
    """Request body for multi-scenario DSM simulation.

    ``scenario_ids`` names DSM data-slot scenarios (see :class:`DSMScenario`);
    ``cases`` names parameter-table sensitivity cases used to resolve scaling
    expressions. The engine runs the cross-product and keys each result by
    ``f"{scenario_id}|{case}"``. An empty ``scenario_ids`` defaults to the
    active DSM scenario; an empty ``cases`` defaults to ``["Base"]``.

    Legacy bodies that sent ``scenarios: [...]`` are accepted: the list is
    routed to ``cases`` and the active DSM scenario is used so old callers
    keep working.
    """
    scenario_ids: list[str] = Field(default_factory=list)
    cases: list[str] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _migrate_legacy_scenarios_key(cls, data: Any) -> Any:
        if isinstance(data, dict) and "scenarios" in data and "cases" not in data:
            data["cases"] = data.pop("scenarios")
        return data


class MultiScenarioSimulationResult(BaseModel):
    """Per-(scenario, case) simulation results.

    ``scenarios`` is keyed by ``f"{scenario_id}|{case}"`` to preserve the
    cross-product. For single-dimension compatibility with older clients,
    the key degrades to just ``scenario_id`` when only DSM scenarios are
    varied (all cases == "Base") or just ``case`` when only cases vary
    (single DSM scenario).
    """
    system_id: str
    scenarios: dict[str, SimulationResult]
    warnings: list[str] = Field(default_factory=list)


# ── Upload / preview responses ──────────────────────────────────────────────


class StockUploadResult(BaseModel):
    rows_parsed: int
    cohorts_found: int
    total_items: float


class InflowUploadResult(BaseModel):
    years_parsed: int
    rows_parsed: int
    total_inflows: float


class StockTargetUploadResult(BaseModel):
    years_parsed: int
    rows_parsed: int
    total_targets: float


class OutflowUploadResult(BaseModel):
    years_parsed: int
    rows_parsed: int
    total_outflows: float
    cohort_specific: bool  # True when an age / birth_year column was provided


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
