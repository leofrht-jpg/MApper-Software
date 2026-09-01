"""A keyframed parameter must resolve PER YEAR inside a DEPENDENCY RULE.

This is the SECOND channel from parameters into DSM output. The first --
``DSMScalingRule`` -- was fixed by threading the raw table into
``DynamicStockModel``; this one was left, on the reasoning that the subsystem
path's synthetic state sets no ``scaling_rules``. That was true and beside the
point: dependency-rule EXPRESSIONS are their own channel, and unlike scaling
rules the editor for them is live in the UI.

Keyframes collapsed TWICE on the way in. ``get_parameter_set`` calls
``table.resolve_all(scenario)`` with no year, so a time-varying parameter was
already flattened to its ``base_value`` before the engine existed; and
``ParameterEngine(pset.parameters)`` is the legacy pre-resolved shape, which
ignores ``year`` outright.

The year was never missing -- the loop is per-year and already injects ``year``
as an EXPRESSION variable. That is a different thing from resolving a
parameter's VALUE for that year, and only the second was broken.

ASSERTIONS ARE ABSOLUTE. Each expected stock is computed here from the
keyframe anchors, independently of the engine under test. A test that only
checked "the years differ" would pass on any wrong-but-varying resolution.
"""
from __future__ import annotations

import pathlib

import pytest

from mapper.core.subsystem_engine import compute_dependent_subsystem
from mapper.core.parameter_engine import ParameterEngine
from mapper.models.dsm_schemas import (
    DimensionDef,
    SimulationResult,
    SimulationSummary,
    SystemDefinition,
    TimeHorizon,
    YearResult,
)
from mapper.models.parameter_schemas import (
    Parameter,
    ParameterKeyframe,
    ParameterTable,
)
from mapper.models.subsystem_schemas import DependencyRule, Subsystem

# Anchors cover every case in one run: a year BEFORE the first (clamp), the
# anchors themselves, an interior interpolated year, and a year AFTER the last.
ANCHORS: list[tuple[int, float]] = [(2021, 0.50), (2023, 1.00), (2024, 1.25)]
YEARS = [2020, 2021, 2022, 2023, 2024, 2025]
BEV_STOCK = 100.0


def _expected_ratio(year: int) -> float:
    """Clamp-and-interpolate, computed HERE.

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
            return v0 + (year - y0) / (y1 - y0) * (v1 - v0)
    raise AssertionError("unreachable")


def _primary_system() -> SystemDefinition:
    return SystemDefinition(
        id="sys1", name="primary",
        time_horizon=TimeHorizon(start_year=YEARS[0], end_year=YEARS[-1]),
        dimensions=[DimensionDef(name="fuel_type", display_name="Fuel",
                                 labels=["bev", "ice"])],
    )


def _primary_result() -> SimulationResult:
    years = [
        YearResult(year=y, stock={"bev": BEV_STOCK, "ice": 50.0},
                   inflow={}, outflow={}, stock_by_age={}, outflow_by_age={})
        for y in YEARS
    ]
    return SimulationResult(
        system_id="sys1", years=years,
        summary=SimulationSummary(
            total_stock_start=150.0, total_stock_end=150.0,
            total_inflows=0.0, total_outflows=0.0,
        ),
    )


def _subsystem() -> Subsystem:
    return Subsystem(
        id="sub_infra", name="Charging Infra", type="dependent",
        dimensions=[DimensionDef(name="infra_type", display_name="Infra",
                                 labels=["charger"])],
        depends_on="sys1",
        dependency_rules=[DependencyRule(
            id="r1", dependent_archetype_id="charger",
            driver_filter={"fuel_type": ["bev"]},
            # The rule references the PARAMETER. Before the fix this resolved
            # to base_value for every year.
            expression="filtered_stock * chargers_per_bev",
        )],
    )


def _table(base: float = 99.0) -> ParameterTable:
    """``base_value`` is deliberately absurd: if it leaks, the result is
    100 x 99 = 9900 per year -- unmissable rather than plausible."""
    return ParameterTable(parameters={
        "chargers_per_bev": Parameter(
            name="chargers_per_bev", base_value=base,
            keyframes=[ParameterKeyframe(year=y, value=v) for y, v in ANCHORS],
        )
    })


def _run(table: ParameterTable | None, scenario: str | None = None):
    engine = ParameterEngine(table) if table is not None else None
    return compute_dependent_subsystem(
        _subsystem(), _primary_system(), _primary_result(), engine,
        parameter_table=table, parameter_scenario=scenario,
    )


def _stock(result, year: int) -> float:
    return next(y for y in result.years if y.year == year).stock.get("charger", 0.0)


# ── correctness, absolute ───────────────────────────────────────────────────

@pytest.mark.parametrize("year", YEARS)
def test_each_year_uses_its_own_keyframe_value(year):
    result = _run(_table())
    expected = BEV_STOCK * _expected_ratio(year)
    assert _stock(result, year) == pytest.approx(expected), (
        f"{year}: expected {BEV_STOCK} bev x {_expected_ratio(year)} = {expected}"
    )


def test_the_whole_trajectory_is_the_keyframe_trajectory():
    """All six years at once, so a shifted-by-one resolution is visible."""
    got = [_stock(_run(_table()), y) for y in YEARS]
    want = [BEV_STOCK * _expected_ratio(y) for y in YEARS]
    assert got == pytest.approx(want)
    assert want == pytest.approx([50.0, 50.0, 75.0, 100.0, 125.0, 125.0]), (
        "clamp before first anchor, anchors exact, interior interpolated, "
        "clamp after last"
    )


def test_the_absurd_base_value_never_appears():
    result = _run(_table(base=99.0))
    for y in YEARS:
        assert _stock(result, y) != pytest.approx(BEV_STOCK * 99.0), (
            f"{y}: keyframes were ignored and base_value leaked through"
        )


def test_a_scalar_table_is_unchanged():
    """No keyframes -> the single pre-built engine, byte-identical."""
    flat = ParameterTable(parameters={
        "chargers_per_bev": Parameter(name="chargers_per_bev", base_value=0.4)
    })
    with_table = _run(flat)
    legacy = compute_dependent_subsystem(
        _subsystem(), _primary_system(), _primary_result(), ParameterEngine(flat),
    )
    for y in YEARS:
        assert _stock(with_table, y) == pytest.approx(BEV_STOCK * 0.4)
        assert _stock(legacy, y) == pytest.approx(_stock(with_table, y))


def test_no_table_passed_is_the_legacy_path():
    """Every pre-existing caller passes neither new argument."""
    flat = ParameterTable(parameters={
        "chargers_per_bev": Parameter(name="chargers_per_bev", base_value=0.4)
    })
    result = compute_dependent_subsystem(
        _subsystem(), _primary_system(), _primary_result(), ParameterEngine(flat),
    )
    assert _stock(result, 2020) == pytest.approx(40.0)


def test_the_reserved_name_check_runs_ONCE_and_names_no_year():
    """Parameter NAMES do not vary by year, so a per-year check would repeat
    the work and -- worse -- name a year that has nothing to do with the
    collision."""
    from mapper.core.parameter_engine import ParameterError

    clashing = ParameterTable(parameters={
        "year": Parameter(name="year", base_value=1.0),
        "chargers_per_bev": Parameter(name="chargers_per_bev", base_value=0.4),
    })
    with pytest.raises(ParameterError) as e:
        _run(clashing)
    assert "collide" in str(e.value)
    assert not any(str(y) in str(e.value) for y in YEARS), (
        f"the collision message names a year: {e.value}"
    )


# ── the boundary between the two channels ───────────────────────────────────

def test_the_scaling_rules_fixture_does_NOT_cover_this_channel():
    """The reason this survived.

    ``test_dsm_scaling_year_varying.py`` exercises ``DSMScalingRule`` through
    ``DynamicStockModel``. It never touches the subsystem path, so it LOOKED
    like it covered both channels and covered one. Pinning the boundary stops
    the next reader making the same inference.
    """
    other = pathlib.Path(__file__).with_name("test_dsm_scaling_year_varying.py")
    assert other.exists(), "the scaling-rules fixture is gone -- was it renamed?"
    src = other.read_text(encoding="utf-8")
    assert "DSMScalingRule" in src, "that file no longer covers scaling rules"
    for marker in ("compute_dependent_subsystem", "compute_subsystem_result",
                   "DependencyRule"):
        assert marker not in src, (
            f"{other.name} now references {marker!r}. If it genuinely covers "
            "the dependency-rule channel too, say so THERE and delete this "
            "test -- do not leave two files each assuming the other covers it."
        )
