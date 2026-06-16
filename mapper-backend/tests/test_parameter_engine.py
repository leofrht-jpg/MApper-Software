"""Tests for ParameterEngine safe-evaluator and BOM expression resolution.

Run with: python -m pytest mapper-backend/tests/test_parameter_engine.py -v
"""
from __future__ import annotations

import pytest

from mapper.core.bom_engine import (
    collect_quantity_expressions,
    resolve_archetype_with_engine,
    resolve_roots_with_engine,
)
from mapper.core.parameter_engine import (
    ALLOWED_FUNCTIONS,
    ParameterEngine,
    ParameterError,
    validate_parameter_name,
)
from mapper.models.bom_schemas import Archetype, BOMNode, EcoinventLink
from mapper.models.parameter_schemas import Parameter


# ── Engine basics ───────────────────────────────────────────────────────────


def _engine(**params: float) -> ParameterEngine:
    return ParameterEngine([Parameter(name=n, value=v) for n, v in params.items()])


def test_plain_numbers_passthrough():
    e = _engine()
    assert e.resolve(53.0) == 53.0
    assert e.resolve(7) == 7.0
    assert e.resolve("42") == 42.0
    assert e.resolve("3.14") == 3.14


def test_basic_arithmetic():
    e = _engine(a=10, b=3)
    assert e.resolve("a + b") == 13
    assert e.resolve("a - b") == 7
    assert e.resolve("a * b") == 30
    assert e.resolve("a / b") == pytest.approx(10 / 3)
    assert e.resolve("a ** 2") == 100
    assert e.resolve("(a + b) * 2") == 26
    assert e.resolve("-a") == -10


def test_functions():
    e = _engine(a=5, b=10, c=-3)
    assert e.resolve("max(a, b)") == 10
    assert e.resolve("min(a, b, c)") == -3
    assert e.resolve("abs(c)") == 3
    assert e.resolve("round(3.7)") == 4
    assert e.resolve("round(3.14159, 2)") == 3.14
    assert e.resolve("sum(a, b, c)") == 12


def test_parameter_in_function():
    e = _engine(battery_mass_lfp=250, battery_mass_nmc811=230)
    assert e.resolve("max(battery_mass_lfp, battery_mass_nmc811)") == 250
    assert e.resolve("battery_mass_lfp * 0.35") == pytest.approx(87.5)


# ── Errors ──────────────────────────────────────────────────────────────────


def test_undefined_parameter():
    e = _engine(a=1)
    with pytest.raises(ParameterError, match="Undefined parameter: 'missing'"):
        e.resolve("a + missing")


def test_division_by_zero():
    e = _engine(a=10, zero=0)
    with pytest.raises(ParameterError, match="Division by zero"):
        e.resolve("a / zero")
    with pytest.raises(ParameterError, match="Division by zero"):
        e.resolve("a // zero")
    with pytest.raises(ParameterError, match="Modulo by zero"):
        e.resolve("a % zero")


def test_empty_expression():
    e = _engine()
    with pytest.raises(ParameterError, match="empty"):
        e.resolve("")
    with pytest.raises(ParameterError, match="empty"):
        e.resolve("   ")
    with pytest.raises(ParameterError, match="empty"):
        e.resolve(None)


def test_syntax_error():
    e = _engine(a=1)
    with pytest.raises(ParameterError, match="Syntax error"):
        e.resolve("a + *")
    with pytest.raises(ParameterError, match="Syntax error"):
        e.resolve("(a + 1")


# ── Safety ──────────────────────────────────────────────────────────────────


def test_attribute_access_rejected():
    e = _engine()
    with pytest.raises(ParameterError):
        e.resolve("os.system('ls')")


def test_subscript_rejected():
    e = _engine()
    with pytest.raises(ParameterError, match="Disallowed"):
        e.resolve("[1, 2, 3][0]")


def test_builtin_function_rejected():
    e = _engine()
    with pytest.raises(ParameterError, match="Disallowed function"):
        e.resolve("print('hi')")
    with pytest.raises(ParameterError, match="Disallowed function"):
        e.resolve("__import__('os')")


def test_boolean_rejected():
    e = _engine()
    with pytest.raises(ParameterError):
        e.resolve("True + 1")


def test_string_literal_rejected():
    e = _engine()
    with pytest.raises(ParameterError, match="Only numeric"):
        e.resolve("'hello' + 1")


def test_keyword_args_rejected():
    e = _engine(a=1)
    with pytest.raises(ParameterError, match="Keyword arguments"):
        e.resolve("round(a, ndigits=2)")


def test_huge_exponent_rejected():
    e = _engine()
    with pytest.raises(ParameterError, match="Exponent too large"):
        e.resolve("2 ** 1000")


def test_lambda_rejected():
    e = _engine()
    with pytest.raises(ParameterError):
        e.resolve("(lambda: 1)()")


def test_reserved_function_as_parameter():
    # A parameter named "min" would conflict with the function.
    err = validate_parameter_name("min")
    assert err is not None
    assert "reserved" in err.lower()


def test_parameter_name_validation():
    assert validate_parameter_name("battery_mass_lfp") is None
    assert validate_parameter_name("a") is None
    assert validate_parameter_name("_hidden") is None
    assert validate_parameter_name("BatteryMass") is not None  # uppercase
    assert validate_parameter_name("1st") is not None  # starts with digit
    assert validate_parameter_name("foo bar") is not None  # space
    assert validate_parameter_name("") is not None


# ── find_references ─────────────────────────────────────────────────────────


def test_find_references():
    refs = ParameterEngine.find_references("a + b * max(c, d)")
    assert refs == {"a", "b", "c", "d"}
    # Function names should not appear.
    assert "max" not in refs


def test_find_references_numeric_literal():
    assert ParameterEngine.find_references("42") == set()
    assert ParameterEngine.find_references(42) == set()
    assert ParameterEngine.find_references("") == set()


def test_find_references_bad_syntax():
    # Unparseable → empty set (not an exception).
    assert ParameterEngine.find_references("a + (") == set()


# ── BOM integration ─────────────────────────────────────────────────────────


def _make_archetype_with_expressions() -> Archetype:
    link = EcoinventLink(database="ei", code="x", name="X")
    return Archetype(
        id="arc1",
        name="BEV",
        bom=[
            BOMNode(
                name="Manufacturing",
                node_type="component",
                quantity=1,
                scope="inflows",
                children=[
                    BOMNode(
                        name="Battery pack",
                        node_type="material",
                        quantity=1.0,
                        quantity_expression="battery_mass_lfp",
                        unit="kg",
                        ecoinvent_activity=link,
                    ),
                    BOMNode(
                        name="Motor",
                        node_type="material",
                        quantity=1.0,
                        quantity_expression="motor_mass * 1.1",
                        unit="kg",
                        ecoinvent_activity=link,
                    ),
                    BOMNode(
                        name="Frame",
                        node_type="material",
                        quantity=100.0,  # plain number, no expression
                        unit="kg",
                        ecoinvent_activity=link,
                    ),
                ],
            ),
        ],
    )


def test_collect_quantity_expressions():
    arc = _make_archetype_with_expressions()
    exprs = collect_quantity_expressions(arc.bom)
    assert exprs == ["battery_mass_lfp", "motor_mass * 1.1"]


def test_resolve_archetype_with_engine():
    arc = _make_archetype_with_expressions()
    engine = ParameterEngine([
        Parameter(name="battery_mass_lfp", value=250),
        Parameter(name="motor_mass", value=53),
    ])
    resolved = resolve_archetype_with_engine(arc, engine)
    battery = resolved.bom[0].children[0]
    motor = resolved.bom[0].children[1]
    frame = resolved.bom[0].children[2]
    assert battery.quantity == 250
    assert battery.quantity_expression == "battery_mass_lfp"  # preserved
    assert motor.quantity == pytest.approx(53 * 1.1)
    assert frame.quantity == 100  # unchanged
    assert frame.quantity_expression is None
    # Original arc was not mutated.
    assert arc.bom[0].children[0].quantity == 1.0


def test_resolve_missing_parameter_raises():
    arc = _make_archetype_with_expressions()
    engine = ParameterEngine([Parameter(name="battery_mass_lfp", value=250)])
    with pytest.raises(ParameterError, match="motor_mass"):
        resolve_archetype_with_engine(arc, engine)
