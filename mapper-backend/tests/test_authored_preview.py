# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Preview and save must give the same verdict for the same exchange.

The authoring UI shows, as the user types, what saving will do: the basic
variance and its source, the GSD2 against the floor, and any refusal. That is
only worth having if it is the SAME answer saving gives. A preview that drifts
from the save path is worse than none -- it tells the user an exchange is fine
and the save refuses it, or warns about a floor the save does not apply.

So these tests do not ask whether preview works. For every input they send the
exchange to BOTH endpoints and require: the same accept/refuse verdict, the
same problem list on refusal, and the stored exchange equal to the previewed
one on acceptance.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from mapper.api import authored as api

from tests.test_authored_databases import CO2, FEW, IND, NOBV, NOX, PED_HIGH, PED_LOW, RARE, FakeBackend

CASES = {
    "floored": dict(flow_code=NOX.code, amount=0.01, pedigree=PED_HIGH),
    "below floor, no reason": dict(flow_code=NOX.code, amount=0.01, pedigree=PED_LOW),
    "below floor, with reason": dict(flow_code=NOX.code, amount=0.01, pedigree=PED_LOW,
                                     floor_reason="Stack measurement, n=40"),
    "unfloored, no user variance": dict(flow_code=RARE.code, amount=1.0, pedigree=PED_HIGH),
    "unfloored, user variance and reason": dict(flow_code=RARE.code, amount=1.0, pedigree=PED_HIGH,
                                                basic_variance=0.2, basic_variance_reason="Supplier range"),
    "user variance without a reason": dict(flow_code=RARE.code, amount=1.0, pedigree=PED_HIGH,
                                           basic_variance=0.2),
    "too few ecoinvent exchanges": dict(flow_code=FEW.code, amount=1.0, pedigree=PED_HIGH,
                                        basic_variance=0.1, basic_variance_reason="assumed"),
    "floor but no ecoinvent variance": dict(flow_code=NOBV.code, amount=1.0, pedigree=PED_LOW,
                                            basic_variance=0.0, basic_variance_reason="assumed"),
    "overriding ecoinvent's variance": dict(flow_code=NOX.code, amount=0.01, pedigree=PED_HIGH,
                                            basic_variance=0.0001, basic_variance_reason="lower"),
    "negative amount": dict(flow_code=CO2.code, amount=-3.0, pedigree=PED_HIGH),
    "zero amount": dict(flow_code=CO2.code, amount=0.0, pedigree=PED_HIGH),
    "very large amount": dict(flow_code=CO2.code, amount=1e9, pedigree=PED_HIGH),
    "not a biosphere database": dict(flow_database="ecoinvent-3.10-cutoff", flow_code="x",
                                     amount=1.0, pedigree=PED_HIGH),
    "unknown flow": dict(flow_code="no-such-flow", amount=1.0, pedigree=PED_HIGH),
    "indicator flow type": dict(flow_code=IND.code, amount=1.0, pedigree=PED_HIGH),
    "incomplete pedigree": dict(flow_code=NOX.code, amount=0.01, pedigree={"reliability": 2}),
}


@pytest.fixture()
def client(monkeypatch):
    backend = FakeBackend(installed=["biosphere3", "ecoinvent-3.10-cutoff"])
    monkeypatch.setattr(api, "_project", lambda: "P")
    monkeypatch.setattr(api, "get_backend", lambda project: backend)
    from mapper.api import bom

    monkeypatch.setattr(bom, "_archetypes", {"P": {}})
    from mapper.main import app

    c = TestClient(app)
    assert c.post("/api/authored-databases", json={"name": "mine"}).status_code == 200
    return c


def _save(client, exchange):
    return client.post("/api/authored-databases/mine/activities", json={
        "name": "a", "unit": "kilogram", "scope": "complete", "exchanges": [exchange]})


@pytest.mark.parametrize("case", sorted(CASES))
def test_preview_and_save_give_the_same_verdict(client, case):
    exchange = CASES[case]
    preview = client.post("/api/authored-databases/preview-exchange", json=exchange)
    save = _save(client, exchange)

    if preview.status_code == 422:
        # Request-level validation (e.g. an incomplete pedigree): both
        # endpoints must refuse it the same way, before any rule runs.
        assert save.status_code == 422, f"{case}: preview refused the request, save accepted it"
        return

    assert preview.status_code == 200, preview.text
    p = preview.json()
    if p["ok"]:
        assert save.status_code == 200, f"{case}: preview accepted, save refused: {save.text}"
        stored = save.json()["exchanges"][0]
        assert stored == p["exchange"], f"{case}: the saved exchange differs from the preview"
    else:
        assert save.status_code == 422, f"{case}: preview refused, save accepted"
        assert save.json()["detail"]["problems"] == p["problems"], \
            f"{case}: preview and save report different problems"
        assert save.json()["detail"]["codes"] == p["codes"], \
            f"{case}: preview and save report different codes"
        assert p["codes"] and "invalid" not in p["codes"], \
            f"{case}: every exchange refusal must carry a specific code"


def test_every_verdict_is_exercised():
    """The table must contain both outcomes, or the agreement is vacuous."""
    b = FakeBackend()
    from mapper.core import authored_engine as eng
    from mapper.models.authored_schemas import ExchangeInput
    from pydantic import ValidationError

    outcomes = set()
    for ex in CASES.values():
        try:
            eng.resolve_exchange(ExchangeInput(**ex), b)
            outcomes.add("accepted")
        except eng.AuthoredError:
            outcomes.add("refused")
        except ValidationError:
            outcomes.add("invalid request")
    assert outcomes == {"accepted", "refused", "invalid request"}


def test_preview_writes_nothing(client):
    from mapper.core import authored_storage as store

    defs_before = store.definitions_path("P").read_text()
    for ex in CASES.values():
        client.post("/api/authored-databases/preview-exchange", json=ex)
    assert store.definitions_path("P").read_text() == defs_before


# ── The table checks agreement at the inputs it lists. This checks it everywhere.

def _function(tree, name):
    import ast

    return next(n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name)


def test_save_applies_no_exchange_rule_that_preview_does_not():
    """Every exchange-level rule must live in ``resolve_exchange``.

    Preview calls ``resolve_exchange``; saving reaches exchanges only through
    ``build_activity``. If ``build_activity``'s per-exchange loop did anything
    besides call ``resolve_exchange``, saving could refuse (or alter) an exchange
    that preview accepted -- for inputs no table would think to list. So the loop
    body must be exactly: try resolve_exchange(...) / except AuthoredError.
    """
    import ast
    import inspect

    from mapper.core import authored_engine as eng

    tree = ast.parse(inspect.getsource(eng))
    loops = [n for n in ast.walk(_function(tree, "build_activity")) if isinstance(n, ast.For)
             and isinstance(n.iter, ast.Attribute) and n.iter.attr == "exchanges"]
    assert len(loops) == 1, "build_activity must have exactly one loop over the exchanges"
    body = loops[0].body
    assert len(body) == 1 and isinstance(body[0], ast.Try), \
        "the exchange loop may contain only a try: resolve_exchange(...) -- put new exchange rules IN resolve_exchange"
    calls = [n.func.id for n in ast.walk(ast.Module(body=body[0].body, type_ignores=[]))
             if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)]
    assert calls == ["resolve_exchange"], f"unexpected calls in the exchange loop: {calls}"


def test_preview_calls_the_same_function():
    import ast
    import inspect

    from mapper.api import authored

    fn = _function(ast.parse(inspect.getsource(authored)), "preview_exchange")
    called = {n.func.attr for n in ast.walk(fn) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)}
    assert "resolve_exchange" in called

