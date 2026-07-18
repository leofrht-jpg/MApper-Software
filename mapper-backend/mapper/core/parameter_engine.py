# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Safe expression evaluation for parameter-referencing BOM quantities.

Expressions look like ``battery_mass_lfp * 0.35`` or ``max(a, b) + 1``. They
are parsed with :mod:`ast` and walked with a whitelist visitor — no ``eval``,
no ``exec``, no attribute access, no subscript, no comprehensions. Only a
fixed set of arithmetic operators and a handful of numeric functions.

Design notes:

* Parameters are numeric only; there are no parameter-to-parameter references,
  so no cycle detection is needed at this layer.
* ``resolve`` accepts either a ``str`` expression or a numeric literal — the
  BOM model stores quantities as ``float`` with an optional
  ``quantity_expression: str`` raw-expression string. Callers that don't have
  an expression just pass the float and get it back unchanged.
* Error messages always include the offending expression so the UI can map
  them back to the right BOM row.
"""
from __future__ import annotations

import ast

from mapper.models.parameter_schemas import Parameter, ParameterTable


# Whitelists. Anything not in these sets causes ``ParameterError``.
_ALLOWED_BINOPS: tuple[type[ast.operator], ...] = (
    ast.Add,
    ast.Sub,
    ast.Mult,
    ast.Div,
    ast.FloorDiv,
    ast.Mod,
    ast.Pow,
)
_ALLOWED_UNARYOPS: tuple[type[ast.unaryop], ...] = (ast.UAdd, ast.USub)
ALLOWED_FUNCTIONS: frozenset[str] = frozenset({"min", "max", "abs", "round", "sum"})


class ParameterError(ValueError):
    """Raised when an expression fails to parse, references an unknown
    parameter, uses a disallowed construct, or hits a runtime error such as
    division by zero.
    """


class _SafeEvaluator(ast.NodeVisitor):
    def __init__(self, values: dict[str, float]) -> None:
        self.values = values

    def visit(self, node: ast.AST) -> float:
        handler = getattr(self, f"_eval_{type(node).__name__}", None)
        if handler is None:
            raise ParameterError(
                f"Disallowed expression construct: {type(node).__name__}"
            )
        return handler(node)

    def _eval_Expression(self, node: ast.Expression) -> float:
        return self.visit(node.body)

    def _eval_Constant(self, node: ast.Constant) -> float:
        # ``bool`` is a subclass of ``int`` — exclude it so ``True/False`` in
        # an expression fails cleanly rather than silently becoming 1/0.
        if isinstance(node.value, bool) or not isinstance(node.value, (int, float)):
            raise ParameterError(
                f"Only numeric constants are allowed (got {type(node.value).__name__})"
            )
        return float(node.value)

    def _eval_Name(self, node: ast.Name) -> float:
        # Function names are rejected here; they are only valid in Call nodes.
        if node.id in ALLOWED_FUNCTIONS:
            raise ParameterError(
                f"'{node.id}' is a reserved function name and cannot be used as a parameter"
            )
        if node.id not in self.values:
            raise ParameterError(f"Undefined parameter: '{node.id}'")
        return float(self.values[node.id])

    def _eval_BinOp(self, node: ast.BinOp) -> float:
        if not isinstance(node.op, _ALLOWED_BINOPS):
            raise ParameterError(f"Disallowed operator: {type(node.op).__name__}")
        left = self.visit(node.left)
        right = self.visit(node.right)
        try:
            if isinstance(node.op, ast.Add):
                return left + right
            if isinstance(node.op, ast.Sub):
                return left - right
            if isinstance(node.op, ast.Mult):
                return left * right
            if isinstance(node.op, ast.Div):
                if right == 0:
                    raise ParameterError("Division by zero")
                return left / right
            if isinstance(node.op, ast.FloorDiv):
                if right == 0:
                    raise ParameterError("Division by zero")
                return left // right
            if isinstance(node.op, ast.Mod):
                if right == 0:
                    raise ParameterError("Modulo by zero")
                return left % right
            if isinstance(node.op, ast.Pow):
                # Cap extreme exponents to keep float behaviour predictable.
                if abs(right) > 500:
                    raise ParameterError(f"Exponent too large: {right}")
                return left ** right
        except OverflowError as e:
            raise ParameterError(f"Numeric overflow: {e}")
        raise ParameterError(f"Unhandled operator: {type(node.op).__name__}")

    def _eval_UnaryOp(self, node: ast.UnaryOp) -> float:
        if not isinstance(node.op, _ALLOWED_UNARYOPS):
            raise ParameterError(
                f"Disallowed unary operator: {type(node.op).__name__}"
            )
        operand = self.visit(node.operand)
        return -operand if isinstance(node.op, ast.USub) else +operand

    def _eval_Call(self, node: ast.Call) -> float:
        if not isinstance(node.func, ast.Name):
            raise ParameterError("Function calls must use a plain function name")
        fn_name = node.func.id
        if fn_name not in ALLOWED_FUNCTIONS:
            raise ParameterError(
                f"Disallowed function: '{fn_name}'. Allowed: "
                f"{', '.join(sorted(ALLOWED_FUNCTIONS))}"
            )
        if node.keywords:
            raise ParameterError(f"Keyword arguments not allowed in {fn_name}()")
        args = [self.visit(a) for a in node.args]
        if not args:
            raise ParameterError(f"{fn_name}() requires at least one argument")
        try:
            if fn_name == "min":
                return float(min(args))
            if fn_name == "max":
                return float(max(args))
            if fn_name == "sum":
                return float(sum(args))
            if fn_name == "abs":
                if len(args) != 1:
                    raise ParameterError("abs() takes exactly 1 argument")
                return float(abs(args[0]))
            if fn_name == "round":
                if len(args) == 1:
                    return float(round(args[0]))
                if len(args) == 2:
                    return float(round(args[0], int(args[1])))
                raise ParameterError("round() takes 1 or 2 arguments")
        except (TypeError, ValueError) as e:
            raise ParameterError(f"{fn_name}() failed: {e}")
        raise ParameterError(f"Unhandled function: {fn_name}")


class ParameterEngine:
    """Resolves parameter expressions against a fixed set of numeric values."""

    def __init__(
        self,
        parameters: (
            ParameterTable
            | dict[str, Parameter]
            | dict[str, float]
            | list[Parameter]
            | None
        ) = None,
        scenario: str | None = None,
        year: int | None = None,
    ) -> None:
        """Build the name→value map used to resolve expressions.

        Accepts a :class:`ParameterTable` (with an optional ``scenario`` name
        for per-scenario overrides and an optional ``year`` for time-varying
        keyframe parameters) or one of the legacy shapes: a list/dict of
        :class:`Parameter`, or a pre-resolved ``dict[str, float]`` values map
        (``scenario``/``year`` are ignored for the legacy shapes). ``year`` only
        affects keyframe parameters; scalar tables resolve identically with or
        without it.
        """
        if parameters is None:
            self.params: dict[str, float] = {}
            return
        if isinstance(parameters, ParameterTable):
            self.params = parameters.resolve_all(scenario, year)
            return
        if isinstance(parameters, list):
            self.params = {p.name: float(p.value) for p in parameters}
            return
        # dict: either {name: Parameter} (legacy) or {name: float} (pre-resolved).
        self.params = {
            name: float(v.value if isinstance(v, Parameter) else v)
            for name, v in parameters.items()
        }

    # ── Public API ──────────────────────────────────────────────────────────

    def resolve(
        self,
        expression: str | float | int | None,
        extra_vars: dict[str, float] | None = None,
    ) -> float:
        """Resolve ``expression`` to a float.

        * ``None`` → ``ParameterError`` ("Expression is empty").
        * ``int`` / ``float`` → returned as-is (fast path for BOMs that don't
          use expressions).
        * numeric-only string (``"53.0"``) → parsed directly.
        * everything else → parsed via :mod:`ast` and evaluated against the
          parameter values.

        ``extra_vars`` shadows ``self.params`` for this call only — used by the
        subsystem engine to inject per-rule variables like ``filtered_stock``
        and ``year`` without mutating the parameter set. Keys colliding with
        reserved function names raise :class:`ParameterError`.
        """
        if expression is None:
            raise ParameterError("Expression is empty")
        if isinstance(expression, bool):
            raise ParameterError("Boolean is not a valid expression")
        if isinstance(expression, (int, float)):
            return float(expression)
        if not isinstance(expression, str):
            raise ParameterError(
                f"Expression must be a string or number (got {type(expression).__name__})"
            )
        s = expression.strip()
        if not s:
            raise ParameterError("Expression is empty")
        # Fast path: plain numeric literal.
        try:
            return float(s)
        except ValueError:
            pass
        try:
            tree = ast.parse(s, mode="eval")
        except SyntaxError as e:
            raise ParameterError(f"Syntax error in '{s}': {e.msg}")
        if extra_vars:
            for name in extra_vars:
                if name in ALLOWED_FUNCTIONS:
                    raise ParameterError(
                        f"'{name}' is a reserved function name and cannot be used as a variable"
                    )
            merged: dict[str, float] = {**self.params, **{k: float(v) for k, v in extra_vars.items()}}
        else:
            merged = self.params
        return _SafeEvaluator(merged).visit(tree)

    def validate_expression(self, expression: str | float | int | None) -> list[str]:
        """Return a list of errors for ``expression`` (empty list = valid)."""
        try:
            self.resolve(expression)
            return []
        except ParameterError as e:
            return [str(e)]

    @staticmethod
    def find_references(expression: str | float | int | None) -> set[str]:
        """Extract parameter names referenced in ``expression``.

        Unparseable expressions yield an empty set (callers should call
        :meth:`validate_expression` if they need to report the error).
        Function names from :data:`ALLOWED_FUNCTIONS` are excluded.
        """
        if not isinstance(expression, str):
            return set()
        s = expression.strip()
        if not s:
            return set()
        try:
            tree = ast.parse(s, mode="eval")
        except SyntaxError:
            return set()
        refs: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Name) and node.id not in ALLOWED_FUNCTIONS:
                refs.add(node.id)
        return refs


# ── Validation helpers for parameter definitions ────────────────────────────

import re

_NAME_RE = re.compile(r"^[a-z_][a-z0-9_]*$")


def validate_parameter_name(name: str) -> str | None:
    """Return an error message if ``name`` is not a valid parameter name.

    Rules: non-empty, snake_case (lowercase letters + digits + underscore),
    must start with a letter or underscore, must not collide with reserved
    function names.
    """
    if not name:
        return "Parameter name is required"
    if not _NAME_RE.match(name):
        return (
            f"Invalid parameter name '{name}': must be snake_case (lowercase "
            "letters, digits, underscore; start with a letter or underscore)"
        )
    if name in ALLOWED_FUNCTIONS:
        return f"Parameter name '{name}' conflicts with a reserved function name"
    return None
