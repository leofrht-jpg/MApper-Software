"""Pydantic schemas for the parameter table + scenarios.

A ``Parameter`` is a named numeric variable (e.g. ``battery_mass_lfp = 250``).
Every parameter has a single ``base_value`` plus an optional
``scenario_overrides`` map keyed by scenario name. A missing or empty override
entry means "inherit from base" — this is how the frontend's "empty cell"
inheritance works end-to-end.

A ``ParameterTable`` is a project-scoped collection of parameters plus the
ordered list of scenario names. It replaces the former ``ParameterSet``-per-
variant model: instead of N sets with overlapping parameters, there is a
single table whose rows are parameters and whose columns are scenarios.

BOM quantity fields reference parameters via expressions (see
``mapper.core.parameter_engine``); expressions resolve against a *single*
scenario at a time, picked per pipeline run.

Backward compatibility:

* ``Parameter.value`` is kept as a property alias of ``base_value`` so older
  code (parameter_engine, tests) that reads ``p.value`` keeps working.
* ``ParameterSet`` remains importable and is used by ``parameter_storage``
  during migration from the old on-disk format. New code should prefer
  ``ParameterTable``.
"""
from __future__ import annotations

from typing import ClassVar

from pydantic import BaseModel, Field, model_validator


class Parameter(BaseModel):
    name: str  # unique within the table; snake_case
    base_value: float = 0.0
    unit: str | None = None
    description: str | None = None
    category: str | None = None
    # Scenario name -> override value. Entries missing from this map inherit
    # from ``base_value``. Scenarios not listed here use the base value.
    scenario_overrides: dict[str, float] = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def _accept_legacy_value(cls, data):
        # Legacy callers pass ``value=…`` (the old single-value schema). Map it
        # onto ``base_value`` so existing tests and parameter_engine calls keep
        # constructing ``Parameter`` successfully.
        if isinstance(data, dict) and "value" in data and "base_value" not in data:
            data = {**data, "base_value": data.pop("value")}
        return data

    @property
    def value(self) -> float:
        """Alias for ``base_value`` — kept so legacy code reading ``p.value``
        (parameter_engine, tests) continues to work."""
        return self.base_value


class ParameterTable(BaseModel):
    """Single source of truth for all parameters in a project.

    ``scenarios`` is the ordered list of scenario column names. ``"Base"`` is
    an implicit always-present first scenario and is *not* included in
    ``scenarios``.
    """

    parameters: dict[str, Parameter] = Field(default_factory=dict)
    scenarios: list[str] = Field(default_factory=list)
    # Explicit category declarations — lets users define an empty category
    # (no parameters yet) and have it persist. The effective category list
    # shown in the UI is the union of this field and every distinct
    # ``Parameter.category`` value across ``parameters``.
    categories: list[str] = Field(default_factory=list)
    created_at: str | None = None
    updated_at: str | None = None

    BASE_SCENARIO: ClassVar[str] = "Base"

    def resolve(self, param_name: str, scenario: str | None = None) -> float:
        """Return the effective value of ``param_name`` under ``scenario``.

        ``None`` or ``"Base"`` returns the base value. Unknown scenarios fall
        back to base.
        """
        p = self.parameters.get(param_name)
        if p is None:
            raise KeyError(f"Unknown parameter: '{param_name}'")
        if scenario is None or scenario == self.BASE_SCENARIO:
            return float(p.base_value)
        override = p.scenario_overrides.get(scenario)
        if override is None:
            return float(p.base_value)
        return float(override)

    def resolve_all(self, scenario: str | None = None) -> dict[str, float]:
        """Return the full ``{name: value}`` map for ``scenario``."""
        return {
            name: self.resolve(name, scenario)
            for name in self.parameters
        }

    def list_scenarios(self) -> list[str]:
        """All scenarios including the implicit Base column first."""
        return [self.BASE_SCENARIO, *self.scenarios]


class ParameterTableUpdate(BaseModel):
    """Partial update payload for ``PUT /api/parameters/table``."""

    parameters: dict[str, Parameter] | None = None
    scenarios: list[str] | None = None
    categories: list[str] | None = None


class ScenarioCreate(BaseModel):
    name: str
    # Optional: seed the new scenario by copying an existing one's overrides.
    copy_from: str | None = None


class ScenarioRename(BaseModel):
    old_name: str
    new_name: str


# ── Legacy ParameterSet (kept for migration + back-compat) ──────────────────


class ParameterSet(BaseModel):
    """Legacy per-project, per-variant parameter bundle.

    Superseded by :class:`ParameterTable`. ``parameter_storage`` still loads
    old ``.json`` files into this shape before migrating them into a single
    ``ParameterTable`` per project at startup.
    """

    id: str | None = None
    name: str
    parameters: list[Parameter] = Field(default_factory=list)
    created_at: str | None = None
    updated_at: str | None = None


class ParameterSetSummary(BaseModel):
    id: str
    name: str
    parameter_count: int
    categories: list[str] = Field(default_factory=list)
    created_at: str
    updated_at: str


class ParameterSetCreate(BaseModel):
    name: str
    parameters: list[Parameter] = Field(default_factory=list)


class ParameterSetUpdate(BaseModel):
    name: str | None = None
    parameters: list[Parameter] | None = None


# ── Expression resolution ───────────────────────────────────────────────────


class ResolveRequest(BaseModel):
    expression: str
    scenario: str | None = None  # None => Base
    # Legacy field — still accepted by the API handler so old clients that
    # send ``parameter_set_id`` don't break during the transition.
    parameter_set_id: str | None = None


class ResolveResult(BaseModel):
    expression: str
    value: float | None = None
    error: str | None = None
    references: list[str] = Field(default_factory=list)


class ValidateRequest(BaseModel):
    expressions: list[str]
    scenario: str | None = None
    parameter_set_id: str | None = None


class ValidateResult(BaseModel):
    results: list[ResolveResult]
