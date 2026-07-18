# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

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


class ParameterKeyframe(BaseModel):
    """One ``(year, value)`` anchor of a year-varying parameter trajectory.

    Mirrors :class:`mapper.models.bom_schemas.QuantityMilestone` on purpose —
    the interpolation rule (linear between anchors, clamp outside the range,
    no extrapolation) is shared with ``bom_engine.resolve_quantity``.
    """

    year: int
    value: float


class Parameter(BaseModel):
    name: str  # unique within the table; snake_case
    base_value: float = 0.0
    unit: str | None = None
    description: str | None = None
    category: str | None = None
    # Scenario name -> override value. Entries missing from this map inherit
    # from ``base_value``. Scenarios not listed here use the base value.
    scenario_overrides: dict[str, float] = Field(default_factory=dict)
    # Optional year-varying trajectory. ``None``/empty => scalar parameter
    # (``base_value`` for every year, identical to pre-keyframe behaviour).
    # When present, the Base value at year Y is the linear interpolation of the
    # keyframes (clamped, no extrapolation). Scalar ``scenario_overrides`` still
    # win as a flat, year-invariant value when a scenario override is set — see
    # :func:`resolve_parameter`.
    keyframes: list[ParameterKeyframe] | None = None

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

    @property
    def is_time_varying(self) -> bool:
        """True when this parameter carries a non-empty keyframe trajectory."""
        return bool(self.keyframes)


def _interpolate_keyframes(keyframes: list[ParameterKeyframe], year: int) -> float:
    """Linear interpolation between keyframe anchors, clamped outside the range.

    Same rule as ``bom_engine.resolve_quantity`` for milestones: years at or
    before the first anchor / at or after the last anchor return the endpoint
    value (no extrapolation); interior years interpolate linearly.
    """
    kf = sorted(keyframes, key=lambda k: k.year)
    if year <= kf[0].year:
        return float(kf[0].value)
    if year >= kf[-1].year:
        return float(kf[-1].value)
    for a, b in zip(kf, kf[1:]):
        if a.year <= year <= b.year:
            span = b.year - a.year
            if span == 0:
                return float(a.value)
            t = (year - a.year) / span
            return float(a.value) + t * (float(b.value) - float(a.value))
    # Unreachable given the clamp guards above, but keep callers NaN-free.
    return float(kf[-1].value)


def resolve_parameter(
    param: Parameter,
    year: int | None = None,
    scenario: str | None = None,
    base_scenario: str = "Base",
) -> float:
    """Return the scalar value of ``param`` under ``scenario`` at ``year``.

    Resolution order (confirmed Phase 0 design):

    1. A scalar ``scenario_overrides`` entry, when present for a non-Base
       ``scenario``, wins as a **flat, year-invariant** value.
    2. Otherwise, if ``param`` is time-varying and ``year`` is given, the Base
       trajectory is interpolated at ``year`` (clamped, no extrapolation).
    3. Otherwise ``base_value`` (scalar behaviour — identical to pre-keyframe).

    Pure function: no I/O, no mutation. For a plain scalar parameter this is an
    identity across all years.
    """
    if scenario is not None and scenario != base_scenario:
        override = param.scenario_overrides.get(scenario)
        if override is not None:
            return float(override)
    if param.keyframes and year is not None:
        return _interpolate_keyframes(param.keyframes, int(year))
    return float(param.base_value)


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

    def resolve(
        self,
        param_name: str,
        scenario: str | None = None,
        year: int | None = None,
    ) -> float:
        """Return the effective value of ``param_name`` under ``scenario`` / ``year``.

        ``scenario`` ``None`` or ``"Base"`` uses the base trajectory; unknown
        scenarios fall back to base. ``year`` is only consulted for time-varying
        (keyframe) parameters — scalar parameters resolve identically regardless
        of ``year``. See :func:`resolve_parameter` for the full precedence rule.
        """
        p = self.parameters.get(param_name)
        if p is None:
            raise KeyError(f"Unknown parameter: '{param_name}'")
        return resolve_parameter(
            p, year=year, scenario=scenario, base_scenario=self.BASE_SCENARIO
        )

    def resolve_all(
        self, scenario: str | None = None, year: int | None = None
    ) -> dict[str, float]:
        """Return the full ``{name: value}`` map for ``scenario`` at ``year``.

        This is the per-simulation-year scalar dict the LCA engine consumes.
        With ``year=None`` (scalar-only tables) it is byte-identical to the
        pre-keyframe ``resolve_all(scenario)``.
        """
        return {
            name: self.resolve(name, scenario, year)
            for name in self.parameters
        }

    def has_time_varying(self) -> bool:
        """True when any parameter carries a keyframe trajectory.

        Lets callers gate the per-year re-resolution path (analogous to
        ``bom_engine.has_evolution``): scalar-only tables keep the resolve-once
        fast path and stay byte-identical.
        """
        return any(p.is_time_varying for p in self.parameters.values())

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
