# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Phase 1 — year-varying parameter resolution (pure function; no LCA calls).

Covers:

* ``resolve_parameter`` — scalar identity across years; keyframe interpolation
  at boundary / between / clamped (outside-range) years; scalar
  ``scenario_overrides`` winning as a flat year-invariant value over the base
  trajectory.
* ``ParameterTable.resolve`` / ``resolve_all`` with the new ``year`` argument —
  mixed scalar + time-varying table; scalar-only backward compatibility.
* ``ParameterTable.has_time_varying`` gating helper.
"""
from __future__ import annotations

import pytest

from mapper.models.parameter_schemas import (
    Parameter,
    ParameterKeyframe,
    ParameterTable,
    resolve_parameter,
)


def _kf(pairs):
    return [ParameterKeyframe(year=y, value=v) for y, v in pairs]


# ── resolve_parameter: scalar identity ──────────────────────────────────────


def test_scalar_parameter_is_year_invariant():
    p = Parameter(name="x", base_value=250.0)
    for year in (2020, 2025, 2035, 2050, 2100):
        assert resolve_parameter(p, year=year) == 250.0
    # No year at all → still the scalar.
    assert resolve_parameter(p) == 250.0


# ── resolve_parameter: keyframe interpolation ───────────────────────────────


def test_keyframes_at_boundary_years():
    p = Parameter(name="p_bp", base_value=1.0, keyframes=_kf([(2025, 1.0), (2035, 0.95), (2050, 0.90)]))
    assert resolve_parameter(p, year=2025) == pytest.approx(1.0)
    assert resolve_parameter(p, year=2035) == pytest.approx(0.95)
    assert resolve_parameter(p, year=2050) == pytest.approx(0.90)


def test_keyframes_between_anchors_linear():
    p = Parameter(name="p_bp", base_value=1.0, keyframes=_kf([(2025, 1.0), (2035, 0.95), (2050, 0.90)]))
    # Midpoint of the first segment: 1.0 → 0.95 over 2025..2035.
    assert resolve_parameter(p, year=2030) == pytest.approx(0.975)
    # Segment 2035..2050: at 2040 (t = 5/15) → 0.95 + (1/3)(-0.05).
    assert resolve_parameter(p, year=2040) == pytest.approx(0.95 - 0.05 / 3.0)


def test_keyframes_clamp_outside_range_no_extrapolation():
    p = Parameter(name="p_bp", base_value=1.0, keyframes=_kf([(2025, 1.0), (2050, 0.90)]))
    # Before first anchor → clamp to first value (not extrapolated upward).
    assert resolve_parameter(p, year=2000) == pytest.approx(1.0)
    assert resolve_parameter(p, year=2024) == pytest.approx(1.0)
    # After last anchor → clamp to last value (not extrapolated downward).
    assert resolve_parameter(p, year=2051) == pytest.approx(0.90)
    assert resolve_parameter(p, year=2100) == pytest.approx(0.90)


def test_keyframes_unsorted_input_is_sorted():
    p = Parameter(name="p_bp", base_value=1.0, keyframes=_kf([(2050, 0.90), (2025, 1.0), (2035, 0.95)]))
    assert resolve_parameter(p, year=2030) == pytest.approx(0.975)
    assert resolve_parameter(p, year=2025) == pytest.approx(1.0)
    assert resolve_parameter(p, year=2050) == pytest.approx(0.90)


def test_single_keyframe_is_flat():
    p = Parameter(name="p_bp", base_value=1.0, keyframes=_kf([(2030, 0.8)]))
    assert resolve_parameter(p, year=2020) == pytest.approx(0.8)
    assert resolve_parameter(p, year=2030) == pytest.approx(0.8)
    assert resolve_parameter(p, year=2050) == pytest.approx(0.8)


def test_empty_keyframes_falls_back_to_base():
    p = Parameter(name="x", base_value=5.0, keyframes=[])
    assert resolve_parameter(p, year=2040) == 5.0
    assert p.is_time_varying is False


def test_keyframes_without_year_falls_back_to_base():
    # A time-varying param resolved with no year (e.g. a caller that has no
    # year context) uses base_value rather than guessing a trajectory point.
    p = Parameter(name="p_bp", base_value=1.0, keyframes=_kf([(2025, 1.0), (2050, 0.9)]))
    assert resolve_parameter(p, year=None) == 1.0


# ── scenario × year interaction (Phase 0 rule 2) ────────────────────────────


def test_scalar_scenario_override_wins_flat_over_trajectory():
    p = Parameter(
        name="p_bp",
        base_value=1.0,
        keyframes=_kf([(2025, 1.0), (2050, 0.90)]),
        scenario_overrides={"Optimistic": 0.7},
    )
    # Optimistic has a flat override → year-invariant 0.7, ignoring keyframes.
    for year in (2025, 2035, 2050):
        assert resolve_parameter(p, year=year, scenario="Optimistic") == pytest.approx(0.7)
    # Base (or a scenario with no override) → follow the trajectory.
    assert resolve_parameter(p, year=2050, scenario="Base") == pytest.approx(0.90)
    assert resolve_parameter(p, year=2050, scenario="Pessimistic") == pytest.approx(0.90)


def test_scalar_scenario_override_on_scalar_param_unchanged():
    # Existing scalar-override behaviour must be untouched.
    p = Parameter(name="x", base_value=10.0, scenario_overrides={"A": 12.0})
    assert resolve_parameter(p, scenario="A") == 12.0
    assert resolve_parameter(p, scenario="B") == 10.0
    assert resolve_parameter(p) == 10.0


# ── ParameterTable.resolve / resolve_all with year ──────────────────────────


def test_table_resolve_all_mixed_scalar_and_time_varying():
    table = ParameterTable(
        parameters={
            "battery_mass_lfp": Parameter(name="battery_mass_lfp", base_value=250.0),
            "p_bp": Parameter(
                name="p_bp",
                base_value=1.0,
                keyframes=_kf([(2025, 1.0), (2035, 0.95), (2050, 0.90)]),
            ),
        },
        scenarios=[],
    )
    assert table.resolve_all(year=2025) == {"battery_mass_lfp": 250.0, "p_bp": pytest.approx(1.0)}
    assert table.resolve_all(year=2030) == {"battery_mass_lfp": 250.0, "p_bp": pytest.approx(0.975)}
    assert table.resolve_all(year=2050) == {"battery_mass_lfp": 250.0, "p_bp": pytest.approx(0.90)}


def test_table_resolve_all_scalar_only_is_year_agnostic():
    # Backward-compat: a scalar-only table resolves identically with or without
    # a year, and identically across years.
    table = ParameterTable(
        parameters={
            "a": Parameter(name="a", base_value=1.0, scenario_overrides={"S": 2.0}),
            "b": Parameter(name="b", base_value=3.0),
        },
        scenarios=["S"],
    )
    base_no_year = table.resolve_all()
    assert base_no_year == {"a": 1.0, "b": 3.0}
    assert table.resolve_all(year=2025) == base_no_year
    assert table.resolve_all(year=2050) == base_no_year
    assert table.resolve_all(scenario="S", year=2040) == {"a": 2.0, "b": 3.0}


def test_table_resolve_year_threads_scenario_and_year():
    table = ParameterTable(
        parameters={
            "p_bp": Parameter(
                name="p_bp",
                base_value=1.0,
                keyframes=_kf([(2025, 1.0), (2050, 0.90)]),
                scenario_overrides={"Flat": 0.5},
            ),
        },
        scenarios=["Flat"],
    )
    assert table.resolve("p_bp", None, 2050) == pytest.approx(0.90)
    assert table.resolve("p_bp", "Base", 2050) == pytest.approx(0.90)
    assert table.resolve("p_bp", "Flat", 2050) == pytest.approx(0.5)


def test_has_time_varying_gate():
    scalar_only = ParameterTable(parameters={"a": Parameter(name="a", base_value=1.0)})
    assert scalar_only.has_time_varying() is False

    mixed = ParameterTable(
        parameters={
            "a": Parameter(name="a", base_value=1.0),
            "p_bp": Parameter(name="p_bp", base_value=1.0, keyframes=_kf([(2025, 1.0), (2050, 0.9)])),
        }
    )
    assert mixed.has_time_varying() is True


def test_existing_resolve_signature_backward_compatible():
    # Old two-arg / one-arg calls must still work unchanged.
    p = Parameter(name="x", base_value=10.0, scenario_overrides={"A": 12.0})
    t = ParameterTable(parameters={"x": p}, scenarios=["A", "B"])
    assert t.resolve("x") == 10.0
    assert t.resolve("x", "A") == 12.0
    assert t.resolve_all("A") == {"x": 12.0}
