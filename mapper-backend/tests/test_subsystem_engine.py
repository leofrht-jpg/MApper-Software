"""Tests for the dependent-subsystem engine and ParameterEngine.extra_vars.

Run with: python -m pytest mapper-backend/tests/test_subsystem_engine.py -v
"""
from __future__ import annotations

import pytest

from mapper.core.parameter_engine import ParameterEngine, ParameterError
from mapper.core.subsystem_engine import (
    compute_dependent_subsystem,
    filter_primary_stock,
    stock_to_flows,
    validate_dependency_rule,
)
from mapper.models.dsm_schemas import (
    DimensionDef,
    SimulationResult,
    SimulationSummary,
    SystemDefinition,
    TimeHorizon,
    YearResult,
)
from mapper.models.parameter_schemas import Parameter
from mapper.models.subsystem_schemas import DependencyRule, Subsystem


# ── Fixtures / helpers ──────────────────────────────────────────────────────


def _primary_dims() -> list[DimensionDef]:
    return [
        DimensionDef(name="fuel_type", display_name="Fuel", labels=["bev", "ice"]),
        DimensionDef(name="size", display_name="Size", labels=["small", "large"]),
        DimensionDef(name="age", display_name="Age", labels=[], is_age=True),
    ]


def _primary_system() -> SystemDefinition:
    return SystemDefinition(
        id="sys1",
        name="Vehicles",
        time_horizon=TimeHorizon(start_year=2020, end_year=2022),
        dimensions=_primary_dims(),
    )


def _year(year: int, stock: dict[str, float]) -> YearResult:
    return YearResult(
        year=year,
        stock=stock,
        stock_by_age={k: {0: v} for k, v in stock.items()},
        inflow={},
        outflow={},
        outflow_by_age={},
    )


def _primary_result() -> SimulationResult:
    # Cohort keys: "fuel_type|size"
    years = [
        _year(2020, {"bev|small": 10.0, "bev|large": 20.0, "ice|small": 30.0, "ice|large": 40.0}),
        _year(2021, {"bev|small": 15.0, "bev|large": 25.0, "ice|small": 25.0, "ice|large": 35.0}),
        _year(2022, {"bev|small": 25.0, "bev|large": 35.0, "ice|small": 15.0, "ice|large": 25.0}),
    ]
    total_start = sum(years[0].stock.values())
    total_end = sum(years[-1].stock.values())
    return SimulationResult(
        system_id="sys1",
        years=years,
        summary=SimulationSummary(
            total_stock_start=total_start,
            total_stock_end=total_end,
            total_inflows=0.0,
            total_outflows=0.0,
        ),
    )


# ── filter_primary_stock ────────────────────────────────────────────────────


def test_filter_primary_stock_empty_filter_returns_total():
    yr = _primary_result().years[0]
    total = filter_primary_stock(yr, {}, _primary_dims())
    assert total == 100.0


def test_filter_primary_stock_empty_values_returns_total():
    # Filter with empty value lists is treated as no filter.
    yr = _primary_result().years[0]
    total = filter_primary_stock(yr, {"fuel_type": []}, _primary_dims())
    assert total == 100.0


def test_filter_primary_stock_single_dimension():
    yr = _primary_result().years[0]
    total = filter_primary_stock(yr, {"fuel_type": ["bev"]}, _primary_dims())
    assert total == 30.0  # 10 + 20


def test_filter_primary_stock_multi_dimension():
    yr = _primary_result().years[0]
    total = filter_primary_stock(
        yr, {"fuel_type": ["bev"], "size": ["small"]}, _primary_dims()
    )
    assert total == 10.0


def test_filter_primary_stock_multi_value_in_one_dim():
    yr = _primary_result().years[0]
    total = filter_primary_stock(yr, {"size": ["small", "large"]}, _primary_dims())
    assert total == 100.0


def test_filter_primary_stock_no_matches():
    yr = _primary_result().years[0]
    total = filter_primary_stock(yr, {"fuel_type": ["hydrogen"]}, _primary_dims())
    assert total == 0.0


# ── stock_to_flows ──────────────────────────────────────────────────────────


def test_stock_to_flows_first_year_all_inflow():
    flows = stock_to_flows({2020: {"a": 10.0}}, [2020])
    inflows, outflows = flows[2020]
    assert inflows == {"a": 10.0}
    assert outflows == {}


def test_stock_to_flows_increasing():
    flows = stock_to_flows(
        {2020: {"a": 10.0}, 2021: {"a": 15.0}, 2022: {"a": 25.0}},
        [2020, 2021, 2022],
    )
    assert flows[2021] == ({"a": 5.0}, {})
    assert flows[2022] == ({"a": 10.0}, {})


def test_stock_to_flows_decreasing():
    flows = stock_to_flows(
        {2020: {"a": 30.0}, 2021: {"a": 20.0}, 2022: {"a": 5.0}},
        [2020, 2021, 2022],
    )
    assert flows[2021] == ({}, {"a": 10.0})
    assert flows[2022] == ({}, {"a": 15.0})


def test_stock_to_flows_flat_has_no_flows():
    flows = stock_to_flows(
        {2020: {"a": 10.0}, 2021: {"a": 10.0}}, [2020, 2021]
    )
    assert flows[2021] == ({}, {})


def test_stock_to_flows_mixed_keys():
    flows = stock_to_flows(
        {2020: {"a": 10.0, "b": 5.0}, 2021: {"a": 7.0, "b": 9.0, "c": 2.0}},
        [2020, 2021],
    )
    inflows, outflows = flows[2021]
    assert inflows == {"b": 4.0, "c": 2.0}
    assert outflows == {"a": 3.0}


def test_stock_to_flows_missing_year_is_zero():
    # A year absent from stock_by_year behaves as all-zero stock.
    flows = stock_to_flows({2020: {"a": 10.0}}, [2020, 2021])
    assert flows[2021] == ({}, {"a": 10.0})


# ── compute_dependent_subsystem ─────────────────────────────────────────────


def _rule(
    archetype_id: str,
    expression: str,
    driver_filter: dict[str, list[str]] | None = None,
    rid: str = "r1",
) -> DependencyRule:
    return DependencyRule(
        id=rid,
        dependent_archetype_id=archetype_id,
        driver_filter=driver_filter or {},
        expression=expression,
    )


def _dep_subsystem(rules: list[DependencyRule]) -> Subsystem:
    return Subsystem(
        id="sub_infra",
        name="Charging Infra",
        type="dependent",
        dimensions=[
            DimensionDef(
                name="infra_type",
                display_name="Infra",
                labels=["home_charger", "public_charger"],
            )
        ],
        depends_on="sys1",
        dependency_rules=rules,
    )


def test_compute_dependent_happy_path():
    # One home charger per 2 BEVs.
    sub = _dep_subsystem(
        [_rule("home_charger", "filtered_stock * 0.5", {"fuel_type": ["bev"]})]
    )
    result = compute_dependent_subsystem(sub, _primary_system(), _primary_result())
    assert result.system_id == "sub_infra"
    assert [yr.year for yr in result.years] == [2020, 2021, 2022]
    # 2020: bev stock = 30 → 15.0 home chargers.
    assert result.years[0].stock == {"home_charger": 15.0}
    # All first-year stock reported as inflow.
    assert result.years[0].inflow == {"home_charger": 15.0}
    assert result.years[0].outflow == {}
    # 2021: bev stock = 40 → 20.0 chargers → +5 inflow.
    assert result.years[1].stock == {"home_charger": 20.0}
    assert result.years[1].inflow == {"home_charger": 5.0}
    # 2022: bev stock = 60 → 30.0 chargers → +10 inflow.
    assert result.years[2].stock == {"home_charger": 30.0}
    assert result.years[2].inflow == {"home_charger": 10.0}
    # stock_by_age exposes age 0 only.
    assert result.years[0].stock_by_age == {"home_charger": {0: 15.0}}
    assert result.summary.total_stock_start == 15.0
    assert result.summary.total_stock_end == 30.0
    assert result.summary.total_inflows == 30.0
    assert result.summary.total_outflows == 0.0


def test_compute_dependent_multi_rule_sums_to_same_archetype():
    # Two rules both feeding "home_charger" — contributions should sum.
    sub = _dep_subsystem(
        [
            _rule("home_charger", "filtered_stock * 0.5", {"fuel_type": ["bev"]}, rid="r1"),
            _rule("home_charger", "filtered_stock * 0.1", {"fuel_type": ["ice"]}, rid="r2"),
        ]
    )
    result = compute_dependent_subsystem(sub, _primary_system(), _primary_result())
    # 2020: 30*0.5 + 70*0.1 = 15 + 7 = 22.
    assert result.years[0].stock == {"home_charger": 22.0}


def test_compute_dependent_uses_year_variable():
    sub = _dep_subsystem([_rule("home_charger", "year - 2020")])
    result = compute_dependent_subsystem(sub, _primary_system(), _primary_result())
    # Stock trajectory: 0, 1, 2.
    assert result.years[0].stock == {"home_charger": 0.0}
    assert result.years[1].stock == {"home_charger": 1.0}
    assert result.years[2].stock == {"home_charger": 2.0}
    # stock_by_age filters zero values.
    assert result.years[0].stock_by_age == {}
    assert result.years[1].stock_by_age == {"home_charger": {0: 1.0}}


def test_compute_dependent_uses_total_primary_stock():
    sub = _dep_subsystem([_rule("public_charger", "total_primary_stock * 0.01")])
    result = compute_dependent_subsystem(sub, _primary_system(), _primary_result())
    # Totals: 100, 100, 100 → stock 1.0 each year; no flow changes after year 0.
    assert result.years[0].stock == {"public_charger": 1.0}
    assert result.years[1].stock == {"public_charger": 1.0}
    assert result.years[1].inflow == {}


def test_compute_dependent_uses_user_parameters():
    sub = _dep_subsystem(
        [_rule("home_charger", "filtered_stock * ratio", {"fuel_type": ["bev"]})]
    )
    engine = ParameterEngine([Parameter(name="ratio", value=0.25)])
    result = compute_dependent_subsystem(sub, _primary_system(), _primary_result(), engine)
    # 2020: 30 * 0.25 = 7.5
    assert result.years[0].stock == {"home_charger": 7.5}


def test_compute_dependent_clips_negative_stock():
    # Expression can go negative for some years; must clip at zero.
    sub = _dep_subsystem([_rule("home_charger", "filtered_stock - 50", {"fuel_type": ["bev"]})])
    result = compute_dependent_subsystem(sub, _primary_system(), _primary_result())
    # 2020: 30-50 = -20 → 0; 2021: 40-50 = -10 → 0; 2022: 60-50 = 10 → 10.
    assert result.years[0].stock == {"home_charger": 0.0}
    assert result.years[1].stock == {"home_charger": 0.0}
    assert result.years[2].stock == {"home_charger": 10.0}
    # Inflow only appears when stock goes positive.
    assert result.years[0].inflow == {}
    assert result.years[1].inflow == {}
    assert result.years[2].inflow == {"home_charger": 10.0}


def test_compute_dependent_rejects_primary_type():
    primary_sub = Subsystem(
        id="sub_p", name="Primary", type="primary", dimensions=[], dependency_rules=[]
    )
    with pytest.raises(ValueError, match="dependent"):
        compute_dependent_subsystem(primary_sub, _primary_system(), _primary_result())


def test_compute_dependent_unknown_parameter_errors():
    sub = _dep_subsystem([_rule("home_charger", "filtered_stock * missing_param")])
    with pytest.raises(ParameterError, match="missing_param"):
        compute_dependent_subsystem(sub, _primary_system(), _primary_result())


def test_compute_dependent_reports_rule_context_on_error():
    sub = _dep_subsystem(
        [_rule("home_charger", "1/0", rid="rule_xyz")]
    )
    with pytest.raises(ParameterError, match="rule_xyz"):
        compute_dependent_subsystem(sub, _primary_system(), _primary_result())


def test_compute_dependent_reserved_var_collision():
    sub = _dep_subsystem([_rule("home_charger", "filtered_stock")])
    engine = ParameterEngine([Parameter(name="filtered_stock", value=1.0)])
    with pytest.raises(ParameterError, match="built-in"):
        compute_dependent_subsystem(sub, _primary_system(), _primary_result(), engine)


def test_compute_dependent_no_rules_yields_empty_stock():
    sub = _dep_subsystem([])
    result = compute_dependent_subsystem(sub, _primary_system(), _primary_result())
    assert all(yr.stock == {} for yr in result.years)
    assert result.summary.total_inflows == 0.0
    assert result.summary.total_outflows == 0.0


# ── ParameterEngine.extra_vars extension ────────────────────────────────────


def test_extra_vars_basic():
    engine = ParameterEngine([Parameter(name="ratio", value=0.5)])
    out = engine.resolve("x * ratio", extra_vars={"x": 100.0})
    assert out == 50.0


def test_extra_vars_shadows_params():
    # Extra vars should override same-named params for this call only.
    engine = ParameterEngine([Parameter(name="x", value=1.0)])
    assert engine.resolve("x", extra_vars={"x": 42.0}) == 42.0
    # Param value not mutated.
    assert engine.resolve("x") == 1.0


def test_extra_vars_does_not_mutate_engine():
    engine = ParameterEngine([Parameter(name="a", value=2.0)])
    engine.resolve("a + b", extra_vars={"b": 3.0})
    assert "b" not in engine.params
    with pytest.raises(ParameterError, match="Undefined parameter: 'b'"):
        engine.resolve("a + b")


def test_extra_vars_reserved_function_collision():
    engine = ParameterEngine()
    with pytest.raises(ParameterError, match="reserved function"):
        engine.resolve("1 + 2", extra_vars={"max": 5.0})


def test_extra_vars_none_leaves_params_only():
    engine = ParameterEngine([Parameter(name="a", value=7.0)])
    assert engine.resolve("a + 1", extra_vars=None) == 8.0


# ── validate_dependency_rule ────────────────────────────────────────────────


def test_validate_rule_happy_path():
    rule = _rule("home_charger", "filtered_stock * 0.5", {"fuel_type": ["bev"]})
    errors = validate_dependency_rule(rule, _primary_dims())
    assert errors == []


def test_validate_rule_empty_archetype():
    rule = DependencyRule(id="r", dependent_archetype_id="", expression="1")
    errors = validate_dependency_rule(rule, _primary_dims())
    assert any("dependent_archetype_id" in e for e in errors)


def test_validate_rule_empty_expression():
    rule = DependencyRule(id="r", dependent_archetype_id="a", expression="   ")
    errors = validate_dependency_rule(rule, _primary_dims())
    assert any("expression" in e for e in errors)


def test_validate_rule_unknown_dimension():
    rule = _rule("a", "1", {"not_a_dim": ["x"]})
    errors = validate_dependency_rule(rule, _primary_dims())
    assert any("unknown primary dimension" in e for e in errors)


def test_validate_rule_unknown_label():
    rule = _rule("a", "1", {"fuel_type": ["hydrogen"]})
    errors = validate_dependency_rule(rule, _primary_dims())
    assert any("hydrogen" in e for e in errors)


def test_validate_rule_age_dimension_rejected():
    # Age is not a valid filter key — it's excluded from the dim map.
    rule = _rule("a", "1", {"age": ["0"]})
    errors = validate_dependency_rule(rule, _primary_dims())
    assert any("unknown primary dimension" in e for e in errors)


# ── initial_stock floor ─────────────────────────────────────────────────────


def _dependent_sub_with_initial(
    rules: list[DependencyRule], initial_stock: dict[str, float]
) -> Subsystem:
    return Subsystem(
        id="sub1",
        name="Infra",
        type="dependent",
        dimensions=[DimensionDef(name="infra_type", display_name="Type", labels=["home_charger", "public_charger"])],
        depends_on="sys1",
        dependency_rules=rules,
        initial_stock=initial_stock,
    )


def test_initial_stock_raises_base_year_when_rule_below():
    # Rule says 10 at t0 (total=100 * 0.1); initial_stock says 100 → first year = 100.
    rules = [DependencyRule(id="r1", dependent_archetype_id="home_charger",
                            expression="filtered_stock * 0.1")]
    sub = _dependent_sub_with_initial(rules, {"home_charger": 100.0})
    result = compute_dependent_subsystem(sub, _primary_system(), _primary_result())
    assert result.years[0].stock["home_charger"] == 100.0
    # 2021 rule = 10, no floor → stock drops, decommissioned flow appears.
    assert result.years[1].stock["home_charger"] == pytest.approx(10.0)
    assert result.years[1].outflow["home_charger"] == pytest.approx(90.0)


def test_initial_stock_below_rule_does_not_reduce():
    # Rule says 30 at t0; initial_stock says 10 → use 30 (max).
    rules = [DependencyRule(id="r1", dependent_archetype_id="home_charger",
                            expression="filtered_stock")]
    sub = _dependent_sub_with_initial(rules, {"home_charger": 10.0})
    result = compute_dependent_subsystem(sub, _primary_system(), _primary_result())
    # Primary BEV+ICE total = 100 in 2020 → rule says 100; floor is 10 → stays 100.
    assert result.years[0].stock["home_charger"] == 100.0


def test_initial_stock_empty_dict_is_backward_compat():
    rules = [DependencyRule(id="r1", dependent_archetype_id="home_charger",
                            expression="filtered_stock * 0.1")]
    sub = _dependent_sub_with_initial(rules, {})
    result = compute_dependent_subsystem(sub, _primary_system(), _primary_result())
    assert result.years[0].stock["home_charger"] == pytest.approx(10.0)


def test_initial_stock_only_affects_base_year():
    rules = [DependencyRule(id="r1", dependent_archetype_id="home_charger",
                            expression="filtered_stock * 0.1")]
    sub = _dependent_sub_with_initial(rules, {"home_charger": 50.0})
    result = compute_dependent_subsystem(sub, _primary_system(), _primary_result())
    # 2021 primary = 100 → rule = 10 → NOT clamped by initial_stock.
    assert result.years[1].stock["home_charger"] == pytest.approx(10.0)
    # 2022 primary = 100 → rule = 10.
    assert result.years[2].stock["home_charger"] == pytest.approx(10.0)


def test_initial_stock_for_archetype_without_rule():
    # An archetype in initial_stock but no rule still shows up at t0 only.
    rules = [DependencyRule(id="r1", dependent_archetype_id="home_charger",
                            expression="filtered_stock * 0.1")]
    sub = _dependent_sub_with_initial(rules, {"public_charger": 25.0})
    result = compute_dependent_subsystem(sub, _primary_system(), _primary_result())
    assert result.years[0].stock.get("public_charger") == 25.0
    # No rule → subsequent years see 0 for public_charger → decommissioned.
    assert result.years[1].outflow.get("public_charger") == 25.0


# ── parse_dependent_stock_file ──────────────────────────────────────────────


def test_parse_dependent_stock_csv_single_dim():
    from mapper.core.dsm_engine import parse_dependent_stock_file
    dims = [DimensionDef(name="infra_type", display_name="Type",
                         labels=["home_charger", "public_charger"])]
    csv_bytes = b"infra_type,count\nhome_charger,100\npublic_charger,25\n"
    parsed, rows = parse_dependent_stock_file(csv_bytes, "stock.csv", dims)
    assert parsed == {"home_charger": 100.0, "public_charger": 25.0}
    assert rows == 2


def test_parse_dependent_stock_csv_multi_dim():
    from mapper.core.dsm_engine import parse_dependent_stock_file
    dims = [
        DimensionDef(name="infra_type", display_name="Type", labels=["charger", "station"]),
        DimensionDef(name="location", display_name="Location", labels=["urban", "rural"]),
    ]
    csv_bytes = b"infra_type,location,count\ncharger,urban,50\ncharger,rural,10\nstation,urban,5\n"
    parsed, rows = parse_dependent_stock_file(csv_bytes, "stock.csv", dims)
    assert parsed == {"charger|urban": 50.0, "charger|rural": 10.0, "station|urban": 5.0}
    assert rows == 3


def test_parse_dependent_stock_rejects_unknown_label():
    from mapper.core.dsm_engine import parse_dependent_stock_file
    dims = [DimensionDef(name="infra_type", display_name="Type",
                         labels=["home_charger"])]
    csv_bytes = b"infra_type,count\nbogus,100\n"
    with pytest.raises(ValueError, match="not a valid label"):
        parse_dependent_stock_file(csv_bytes, "stock.csv", dims)


def test_parse_dependent_stock_missing_column():
    from mapper.core.dsm_engine import parse_dependent_stock_file
    dims = [DimensionDef(name="infra_type", display_name="Type",
                         labels=["home_charger"])]
    csv_bytes = b"count\n100\n"
    with pytest.raises(ValueError, match="missing required column"):
        parse_dependent_stock_file(csv_bytes, "stock.csv", dims)


def test_dependent_stock_template_csv_shape():
    from mapper.core.dsm_engine import dependent_stock_template_csv
    dims = [DimensionDef(name="infra_type", display_name="Type",
                         labels=["home_charger", "public_charger"])]
    csv_text = dependent_stock_template_csv(dims)
    lines = [l.strip() for l in csv_text.splitlines()]
    assert lines[0] == "infra_type,count"
    assert lines[1].startswith("home_charger,")
    assert lines[2].startswith("public_charger,")
