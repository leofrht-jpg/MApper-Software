"""Tests for parameter-driven DSM scaling rules and multi-scenario simulate.

Covers:
- Scaling a no-op when no engine or no rules is supplied (backward compat)
- Most-specific-filter-wins precedence (reuses :func:`best_rule_for_cohort`)
- Reserved ``base`` / ``year`` variables in expressions
- Multi-scenario simulate produces distinct trajectories
- Scaling applied to inflows, stock_targets, outflows independently
"""
from __future__ import annotations

import pytest

from mapper.core.dsm_engine import (
    DynamicStockModel,
    best_rule_for_cohort,
)
from mapper.core.parameter_engine import ParameterEngine
from mapper.models.dsm_schemas import (
    DSMScalingRule,
    DSMSystemState,
    DimensionDef,
    InflowData,
    ModeConfig,
    OutflowData,
    StockTargetData,
    SurvivalConfig,
    SystemDefinition,
    TimeHorizon,
    get_base_scenario,
    materialize_scenario,
)
from mapper.models.parameter_schemas import Parameter, ParameterTable


def _base(state: DSMSystemState):
    return get_base_scenario(state)


def _view(state: DSMSystemState):
    return materialize_scenario(state)


# ── Helpers ─────────────────────────────────────────────────────────────────


def _system(start: int = 2026, end: int = 2028) -> SystemDefinition:
    return SystemDefinition(
        id="s",
        name="test",
        time_horizon=TimeHorizon(start_year=start, end_year=end),
        dimensions=[
            DimensionDef(name="fuel_type", display_name="Fuel", labels=["A", "B"]),
        ],
    )


def _state_with_inflows(counts_per_year: dict[int, dict[str, float]]) -> DSMSystemState:
    return DSMSystemState(
        system_id="s",
        mode_configs=[ModeConfig(dimension_filters={}, mode="survival_inflow")],
        inflows=[InflowData(year=y, counts=c) for y, c in counts_per_year.items()],
    )


def _table(params: dict[str, float], scenarios: dict[str, dict[str, float]] | None = None) -> ParameterTable:
    scenario_names: list[str] = list((scenarios or {}).keys())
    built: dict[str, Parameter] = {}
    for name, base in params.items():
        overrides: dict[str, float] = {}
        for scen, values in (scenarios or {}).items():
            if name in values:
                overrides[scen] = values[name]
        built[name] = Parameter(name=name, base_value=base, scenario_overrides=overrides)
    return ParameterTable(parameters=built, scenarios=scenario_names)


# ── 1. No-op when engine or rules absent ────────────────────────────────────


def test_scaling_is_noop_when_no_engine():
    """Without a ParameterEngine, scaling rules are ignored — base flows through."""
    sys_def = _system()
    state = _state_with_inflows({2026: {"A": 100.0, "B": 200.0}})
    _base(state).scaling_rules = [
        DSMScalingRule(id="r1", expression="base * 5", applies_to="inflows"),
    ]
    result = DynamicStockModel(sys_def, _view(state)).simulate()
    year0 = result.years[0]
    assert year0.inflow["A"] == pytest.approx(100.0)
    assert year0.inflow["B"] == pytest.approx(200.0)


def test_scaling_is_noop_when_no_rules():
    """With an engine but no rules, scaling is a no-op."""
    sys_def = _system()
    state = _state_with_inflows({2026: {"A": 100.0, "B": 200.0}})
    engine = ParameterEngine(_table({"factor": 2.0}))
    result = DynamicStockModel(sys_def, _view(state), parameter_engine=engine).simulate()
    assert result.years[0].inflow["A"] == pytest.approx(100.0)
    assert result.years[0].inflow["B"] == pytest.approx(200.0)


# ── 2. Most-specific-filter-wins precedence ─────────────────────────────────


def test_best_rule_picks_most_specific():
    """A rule with more filter keys beats a global rule."""
    global_rule = DSMScalingRule(id="g", expression="base * 2", applies_to="inflows")
    specific = DSMScalingRule(
        id="s", expression="base * 10", applies_to="inflows",
        dimension_filters={"fuel_type": "A"},
    )
    rules = [global_rule, specific]
    picked_a = best_rule_for_cohort({"fuel_type": "A"}, rules, "inflows")
    picked_b = best_rule_for_cohort({"fuel_type": "B"}, rules, "inflows")
    assert picked_a is specific
    assert picked_b is global_rule


def test_scaling_applies_most_specific_rule_per_cohort():
    sys_def = _system()
    state = _state_with_inflows({2026: {"A": 100.0, "B": 200.0}})
    _base(state).scaling_rules = [
        DSMScalingRule(id="g", expression="base * 2", applies_to="inflows"),
        DSMScalingRule(
            id="s", expression="base * 10", applies_to="inflows",
            dimension_filters={"fuel_type": "A"},
        ),
    ]
    engine = ParameterEngine(_table({}))
    result = DynamicStockModel(sys_def, _view(state), parameter_engine=engine).simulate()
    # A hits the specific rule, B hits the global.
    assert result.years[0].inflow["A"] == pytest.approx(1000.0)
    assert result.years[0].inflow["B"] == pytest.approx(400.0)


def test_no_stacking_only_one_rule_per_cohort():
    """Two rules matching the same cohort at the same specificity level: exactly
    one wins — the engine never multiplies their factors together."""
    sys_def = _system()
    state = _state_with_inflows({2026: {"A": 100.0, "B": 200.0}})
    _base(state).scaling_rules = [
        DSMScalingRule(
            id="a1", expression="base * 2", applies_to="inflows",
            dimension_filters={"fuel_type": "A"},
        ),
        DSMScalingRule(
            id="a2", expression="base * 3", applies_to="inflows",
            dimension_filters={"fuel_type": "A"},
        ),
    ]
    engine = ParameterEngine(_table({}))
    result = DynamicStockModel(sys_def, _view(state), parameter_engine=engine).simulate()
    # 100 × 2 or 100 × 3 — never 100 × 6.
    assert result.years[0].inflow["A"] in (pytest.approx(200.0), pytest.approx(300.0))


# ── 3. Reserved variables: base, year ───────────────────────────────────────


def test_reserved_base_variable_in_expression():
    sys_def = _system()
    state = _state_with_inflows({2026: {"A": 100.0, "B": 200.0}})
    _base(state).scaling_rules = [
        DSMScalingRule(id="r", expression="base + 50", applies_to="inflows"),
    ]
    engine = ParameterEngine(_table({}))
    result = DynamicStockModel(sys_def, _view(state), parameter_engine=engine).simulate()
    assert result.years[0].inflow["A"] == pytest.approx(150.0)
    assert result.years[0].inflow["B"] == pytest.approx(250.0)


def test_reserved_year_variable_in_expression():
    """``year`` allows year-dependent ramps."""
    sys_def = _system(start=2026, end=2028)
    state = _state_with_inflows({
        2026: {"A": 100.0},
        2027: {"A": 100.0},
        2028: {"A": 100.0},
    })
    # Ramp: +10% per year starting 2026 → ×1.0, ×1.1, ×1.2.
    _base(state).scaling_rules = [
        DSMScalingRule(
            id="ramp",
            expression="base * (1 + (year - 2026) * ramp_rate)",
            applies_to="inflows",
        ),
    ]
    engine = ParameterEngine(_table({"ramp_rate": 0.1}))
    result = DynamicStockModel(sys_def, _view(state), parameter_engine=engine).simulate()
    assert result.years[0].inflow["A"] == pytest.approx(100.0)
    assert result.years[1].inflow["A"] == pytest.approx(110.0)
    assert result.years[2].inflow["A"] == pytest.approx(120.0)


def test_parameter_reference_in_expression():
    sys_def = _system()
    state = _state_with_inflows({2026: {"A": 100.0}})
    _base(state).scaling_rules = [
        DSMScalingRule(id="r", expression="base * adoption", applies_to="inflows"),
    ]
    engine = ParameterEngine(_table({"adoption": 1.4}))
    result = DynamicStockModel(sys_def, _view(state), parameter_engine=engine).simulate()
    assert result.years[0].inflow["A"] == pytest.approx(140.0)


# ── 4. Scaling targets stock_targets and outflows ───────────────────────────


def test_scaling_applies_to_stock_targets():
    sys_def = _system(start=2026, end=2027)
    state = DSMSystemState(
        system_id="s",
        mode_configs=[ModeConfig(dimension_filters={}, mode="survival_stock")],
        survival_configs=[SurvivalConfig(dimension_filters={}, weibull_shape=4.0, weibull_scale=15.0)],
        initial_stock={"A|0": 100.0, "B|0": 100.0},
        stock_targets=[StockTargetData(year=2027, counts={"A": 200.0, "B": 200.0})],
        scaling_rules=[
            DSMScalingRule(
                id="a_boost", expression="base * 1.5", applies_to="stock_targets",
                dimension_filters={"fuel_type": "A"},
            ),
        ],
    )
    engine = ParameterEngine(_table({}))
    result = DynamicStockModel(sys_def, _view(state), parameter_engine=engine).simulate()
    # Stock for A in 2027 should be ≈ 300 (scaled target), B unchanged ≈ 200.
    year1 = result.years[1]
    assert year1.stock["A"] == pytest.approx(300.0, rel=0.01)
    assert year1.stock["B"] == pytest.approx(200.0, rel=0.01)


def test_scaling_applies_to_outflows_only_its_target():
    """A rule with ``applies_to='outflows'`` does not touch inflows."""
    sys_def = _system(start=2026, end=2027)
    state = DSMSystemState(
        system_id="s",
        mode_configs=[ModeConfig(dimension_filters={}, mode="manual")],
        initial_stock={"A|1": 500.0, "B|1": 500.0},
        inflows=[InflowData(year=2026, counts={"A": 100.0, "B": 100.0})],
        outflows=[OutflowData(year=2027, counts={"A": 50.0, "B": 50.0})],
        scaling_rules=[
            DSMScalingRule(
                id="out_only", expression="base * 4", applies_to="outflows",
            ),
        ],
    )
    engine = ParameterEngine(_table({}))
    result = DynamicStockModel(sys_def, _view(state), parameter_engine=engine).simulate()
    # 2026 inflows untouched (rule targets outflows).
    assert result.years[0].inflow["A"] == pytest.approx(100.0)
    assert result.years[0].inflow["B"] == pytest.approx(100.0)
    # 2027 manual outflow × 4 → 200 each.
    assert result.years[1].manual_outflow["A"] == pytest.approx(200.0)
    assert result.years[1].manual_outflow["B"] == pytest.approx(200.0)


# ── 5. Multi-scenario: distinct trajectories per scenario ───────────────────


def test_multi_scenario_produces_distinct_results():
    """Same config, different scenarios → different fleet sizes via the same
    scaling rule expression resolved under different parameter values."""
    sys_def = _system()
    state = _state_with_inflows({2026: {"A": 100.0, "B": 100.0}})
    _base(state).scaling_rules = [
        DSMScalingRule(id="r", expression="base * adoption", applies_to="inflows"),
    ]
    table = _table(
        {"adoption": 1.0},
        scenarios={"Aggressive": {"adoption": 1.5}, "Moderate": {"adoption": 0.8}},
    )
    base_result = DynamicStockModel(
        sys_def, state, parameter_engine=ParameterEngine(table, scenario=None)
    ).simulate()
    agg_result = DynamicStockModel(
        sys_def, state, parameter_engine=ParameterEngine(table, scenario="Aggressive")
    ).simulate()
    mod_result = DynamicStockModel(
        sys_def, state, parameter_engine=ParameterEngine(table, scenario="Moderate")
    ).simulate()
    assert base_result.years[0].inflow["A"] == pytest.approx(100.0)
    assert agg_result.years[0].inflow["A"] == pytest.approx(150.0)
    assert mod_result.years[0].inflow["A"] == pytest.approx(80.0)
    # Totals diverge.
    assert base_result.summary.total_inflows != pytest.approx(agg_result.summary.total_inflows)
    assert base_result.summary.total_inflows != pytest.approx(mod_result.summary.total_inflows)


def test_missing_parameter_raises():
    sys_def = _system()
    state = _state_with_inflows({2026: {"A": 100.0}})
    _base(state).scaling_rules = [
        DSMScalingRule(id="r", expression="base * unknown_param", applies_to="inflows"),
    ]
    engine = ParameterEngine(_table({}))  # empty table — unknown_param absent
    with pytest.raises(Exception):
        DynamicStockModel(sys_def, _view(state), parameter_engine=engine).simulate()
