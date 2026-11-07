# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Every warning/error code the backend emits has an entry in the help registry.

The registry is owned by the frontend (`mapper-frontend/src/data/diagnostics.json`: title,
one-line summary, cause, fix, per code). This test reads that one file, so there is no second
copy to keep in step. It fails when a code is emitted that the registry does not know (a new
warning would then reach users with no help entry), and when a backend entry names a code
nothing emits any more (dead help).

A code is found STRUCTURALLY, by walking the AST of `mapper/`, never by grepping message text:
  * `_issue(row, "<severity>", "<code>", ...)`           the BOM validator
  * `{"error": "<code>", ...}` in a dict literal         route-level refusals (HTTPException detail)
  * `codes.append("<code>")`                             the authored engine
  * `CellError(sheet, row, column, message, "<code>")`   authored Excel cell errors
  * keys of the `_CODE_COLUMN` map                       engine codes attributed to Excel columns

Codes the frontend assigns itself (`origin: "frontend"`) are not emitted here and are checked by
`mapper-frontend/tests/diagnosticsRegistry.test.ts`.
"""
from __future__ import annotations

import ast
import json
import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
REGISTRY = REPO / "mapper-frontend" / "src" / "data" / "diagnostics.json"
PACKAGE = Path(__file__).resolve().parents[1] / "mapper"
CODE = re.compile(r"^[a-z][a-z0-9]*(_[a-z0-9]+)+$")


def _registry() -> dict:
    if not REGISTRY.exists():
        pytest.fail(f"the diagnostics registry is missing: {REGISTRY}")
    return json.loads(REGISTRY.read_text(encoding="utf-8"))


def _str(node: ast.AST | None) -> str | None:
    return node.value if isinstance(node, ast.Constant) and isinstance(node.value, str) else None


def emitted_codes() -> dict[str, list[str]]:
    """code -> where it is emitted (file:line)."""
    found: dict[str, list[str]] = {}

    def add(code: str | None, path: Path, line: int) -> None:
        if code:
            found.setdefault(code, []).append(f"{path.relative_to(PACKAGE.parent)}:{line}")

    for path in sorted(PACKAGE.rglob("*.py")):
        for n in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(n, ast.Call):
                f = n.func
                name = f.id if isinstance(f, ast.Name) else f.attr if isinstance(f, ast.Attribute) else ""
                if name == "_issue" and len(n.args) >= 3:
                    add(_str(n.args[2]), path, n.lineno)
                if name == "append" and isinstance(f, ast.Attribute):
                    base = f.value.id if isinstance(f.value, ast.Name) else getattr(f.value, "attr", "")
                    if base == "codes" and n.args:
                        add(_str(n.args[0]), path, n.lineno)
                if name == "CellError":
                    arg = n.args[4] if len(n.args) > 4 else next((k.value for k in n.keywords if k.arg == "code"), None)
                    add(_str(arg), path, n.lineno)
            elif isinstance(n, ast.Dict):
                for k, v in zip(n.keys, n.values):
                    if _str(k) == "error" and (c := _str(v)) and CODE.match(c):
                        add(c, path, n.lineno)
            elif isinstance(n, ast.Assign) and isinstance(n.value, ast.Dict) and any(
                isinstance(t, ast.Name) and t.id == "_CODE_COLUMN" for t in n.targets
            ):
                for k in n.value.keys:
                    add(_str(k), path, n.lineno)
    return found


def test_the_scan_finds_the_codes_it_is_known_to_find():
    """The detector itself: if it silently found nothing, every other test here would pass."""
    found = emitted_codes()
    for known in ("code_truncated", "waste_sign", "bom_biosphere_link", "project_state_mismatch",
                  "negative_amount", "bv_required", "duplicate_key", "authored_excel_invalid"):
        assert known in found, f"the scan no longer finds {known}"
    assert len(found) >= 60


def test_every_emitted_code_has_a_registry_entry():
    reg = _registry()
    missing = {c: where for c, where in emitted_codes().items() if c not in reg}
    assert not missing, (
        "These codes are emitted but have no entry in mapper-frontend/src/data/diagnostics.json "
        f"(add title, summary, cause, fix): {json.dumps(missing, indent=1)}"
    )


def test_every_backend_entry_is_emitted():
    reg = _registry()
    emitted = emitted_codes()
    dead = sorted(c for c, e in reg.items() if e.get("origin") == "backend" and c not in emitted)
    assert not dead, f"registry entries marked origin=backend that nothing emits: {dead}"


def test_a_frontend_origin_code_is_not_also_emitted_by_the_backend():
    reg = _registry()
    emitted = emitted_codes()
    clash = sorted(c for c, e in reg.items() if e.get("origin") == "frontend" and c in emitted)
    assert not clash, f"{clash} are emitted by the backend: mark them origin=backend"


def test_the_validator_literal_matches_the_registry():
    """`ValidationErrorType` is the list the BOM report keys on; each member needs an entry."""
    from typing import get_args

    from mapper.models.bom_schemas import ValidationErrorType

    reg = _registry()
    members = set(get_args(ValidationErrorType))
    assert members <= set(reg), sorted(members - set(reg))
    assert all(reg[m]["surface"] == "bom-validation-report" for m in members)
