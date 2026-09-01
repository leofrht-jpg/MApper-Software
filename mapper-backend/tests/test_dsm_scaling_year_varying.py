"""A keyframed parameter must resolve PER SIMULATION YEAR inside a scaling rule.

``ParameterEngine.__init__`` resolves the whole table EAGERLY into
``self.params`` for ONE year, and ``resolve()`` then evaluates against that
frozen map. Every caller built the engine with ``year=None``, under which
keyframes are ignored and a time-varying parameter silently collapses to its
``base_value`` -- so a rule like ``base * adoption`` applied the SAME adoption
to 2026 and 2050.

The year was never missing. ``_resolve_rule`` already receives it (it injects
it as an expression variable) and both callers are per-year loops. It was
available and unused for parameter RESOLUTION. Note those are two different
things and only the second one was broken: injecting ``year`` into the
expression always worked, which is part of why this looked covered.

``DSMLCAPipeline`` already takes the raw table + scenario for exactly this
reason. This is the DSM half getting the same treatment.

THE ASSERTIONS ARE ABSOLUTE, NOT RELATIVE. Each expected count is computed in
this file from the keyframe anchors, independently of the engine under test.
A test that only checked "the years differ" would pass on any wrong-but-
varying resolution -- e.g. an off-by-one year, or the anchors read in reverse.
"""
from __future__ import annotations

import pytest

from mapper.core.dsm_engine import DynamicStockModel
from mapper.core.parameter_engine import ParameterEngine
from mapper.models.dsm_schemas import (
    DimensionDef,
    DSMScalingRule,
    DSMSystemState,
    InflowData,
    ModeConfig,
    SystemDefinition,
    TimeHorizon,
    get_base_scenario,
    materialize_scenario,
)
from mapper.models.parameter_schemas import (
    Parameter,
    ParameterKeyframe,
    ParameterTable,
)

# Anchors chosen so every interesting case is exercised: a year BEFORE the
# first anchor (clamp), the anchors themselves, an interior year that is not
# an anchor (interpolate), and a year AFTER the last (clamp).
ANCHORS: list[tuple[int, float]] = [(2027, 1.0), (2029, 2.0), (2030, 2.5)]
START, END = 2026, 2031
BASE_COUNT = 100.0


def _expected_adoption(year: int) -> float:
    """Linear interpolation between anchors, clamped outside — computed HERE.

    Deliberately a second implementation rather than a call to
    ``_interpolate_keyframes``: asserting the engine against the very function
    the engine uses would verify nothing.
    """
    ys = [y for y, _ in ANCHORS]
    if year <= ys[0]:
        return ANCHORS[0][1]
    if year >= ys[-1]:
        return ANCHORS[-1][1]
    for (y0, v0), (y1, v1) in zip(ANCHORS, ANCHORS[1:]):
        if y0 <= year <= y1:
            frac = (year - y0) / (y1 - y0)
            return v0 + frac * (v1 - v0)
    raise AssertionError("unreachable")


def _system() -> SystemDefinition:
    return SystemDefinition(
        id="s",
        name="year-varying scaling",
        time_horizon=TimeHorizon(start_year=START, end_year=END),
        dimensions=[DimensionDef(name="fuel_type", display_name="Fuel", labels=["A"])],
    )


def _state() -> DSMSystemState:
    st = DSMSystemState(
        system_id="s",
        mode_configs=[ModeConfig(dimension_filters={}, mode="survival_inflow")],
        inflows=[
            InflowData(year=y, counts={"A": BASE_COUNT})
            for y in range(START, END + 1)
        ],
    )
    get_base_scenario(st).scaling_rules = [
        DSMScalingRule(id="r", expression="base * adoption", applies_to="inflows"),
    ]
    return st


def _table(scenario_override: float | None = None) -> ParameterTable:
    overrides = {"Aggressive": scenario_override} if scenario_override else {}
    return ParameterTable(
        parameters={
            "adoption": Parameter(
                name="adoption",
                base_value=99.0,  # deliberately absurd: if this leaks into a
                                  # result, the keyframes were ignored and the
                                  # number is unmissable.
                keyframes=[ParameterKeyframe(year=y, value=v) for y, v in ANCHORS],
                scenario_overrides=overrides,
            )
        },
        scenarios=list(overrides),
    )


def _run(table: ParameterTable, scenario: str | None = None):
    view = materialize_scenario(_state())
    return DynamicStockModel(
        _system(),
        view,
        parameter_engine=ParameterEngine(table, scenario=scenario),
        parameter_table=table,
        parameter_scenario=scenario,
    ).simulate()


def _inflow(result, year: int) -> float:
    row = next(y for y in result.years if y.year == year)
    return row.inflow["A"]


# ── correctness, absolute ───────────────────────────────────────────────────

@pytest.mark.parametrize("year", list(range(START, END + 1)))
def test_each_year_scales_by_its_own_keyframe_value(year):
    """The whole point: an ABSOLUTE expected value per year."""
    result = _run(_table())
    expected = BASE_COUNT * _expected_adoption(year)
    assert _inflow(result, year) == pytest.approx(expected), (
        f"{year}: expected base {BASE_COUNT} x adoption "
        f"{_expected_adoption(year)} = {expected}"
    )


def test_the_trajectory_is_the_keyframe_trajectory():
    """All six years at once, so a shifted-by-one resolution is visible."""
    result = _run(_table())
    got = [_inflow(result, y) for y in range(START, END + 1)]
    want = [BASE_COUNT * _expected_adoption(y) for y in range(START, END + 1)]
    assert got == pytest.approx(want)
    # Named explicitly, so the intent survives a change to ANCHORS.
    assert want == pytest.approx([100.0, 100.0, 150.0, 200.0, 250.0, 250.0]), (
        "clamp before first anchor, anchors exact, interior interpolated, "
        "clamp after last"
    )


def test_the_base_value_never_appears():
    """``base_value`` is 99.0. If keyframes are ignored every year reads 9900."""
    result = _run(_table())
    for y in range(START, END + 1):
        assert _inflow(result, y) != pytest.approx(BASE_COUNT * 99.0)


def test_a_scenario_override_still_beats_the_keyframes_every_year():
    """Resolution order is unchanged: a scalar override wins over keyframes,
    so an overridden case is year-INVARIANT. Pinning this stops a future
    'make everything year-varying' change from quietly reordering it."""
    result = _run(_table(scenario_override=3.0), scenario="Aggressive")
    for y in range(START, END + 1):
        assert _inflow(result, y) == pytest.approx(BASE_COUNT * 3.0)


# ── no drift on everything that is not keyframes x scaling rules ────────────

def test_a_scalar_table_is_unchanged_by_the_new_path():
    """Byte-identical: same table, with and without the new arguments."""
    table = ParameterTable(
        parameters={"adoption": Parameter(name="adoption", base_value=1.4)}
    )
    view = materialize_scenario(_state())
    engine = ParameterEngine(table)

    legacy = DynamicStockModel(_system(), view, parameter_engine=engine).simulate()
    threaded = DynamicStockModel(
        _system(), view, parameter_engine=engine,
        parameter_table=table, parameter_scenario=None,
    ).simulate()

    for y in range(START, END + 1):
        assert _inflow(legacy, y) == pytest.approx(_inflow(threaded, y))
        assert _inflow(legacy, y) == pytest.approx(BASE_COUNT * 1.4)


def test_no_table_passed_uses_the_single_engine():
    """Every pre-existing caller passes neither new argument."""
    table = ParameterTable(
        parameters={"adoption": Parameter(name="adoption", base_value=2.0)}
    )
    view = materialize_scenario(_state())
    result = DynamicStockModel(
        _system(), view, parameter_engine=ParameterEngine(table)
    ).simulate()
    for y in range(START, END + 1):
        assert _inflow(result, y) == pytest.approx(BASE_COUNT * 2.0)


def test_one_engine_is_built_per_year_not_per_cohort():
    """``resolve_all`` is not free; the cache is what keeps it off the hot path."""
    table = _table()
    view = materialize_scenario(_state())
    model = DynamicStockModel(
        _system(), view,
        parameter_engine=ParameterEngine(table),
        parameter_table=table, parameter_scenario=None,
    )
    # Scaling runs in __init__, so the cache is already populated.
    assert set(model._year_engines) == set(range(START, END + 1))
