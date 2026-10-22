# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""The authored routes need `Content-Type: application/json`, and say so badly.

The frontend half of this fix lives in `api/client.ts`. This half pins the
SERVER's side of the contract, against the real app, with the body sent the way
a browser `fetch` sends it: raw bytes, and a header only if the client set one.
``TestClient(...).post(json=...)`` cannot show this — it sets the header for
you, so it passes while the app is unusable from the browser.

What a missing header produces is the reason this was hard to read in the
field: not "415 Unsupported Media Type" but **422 model_attributes_type**,
"Input should be a valid dictionary or object to extract fields from", with the
JSON quoted back in `input` AS A STRING. That looks like the schema rejecting
the payload's shape. It is Starlette never having parsed it.

Covers all five routes the authoring UI calls, because fixing one call site and
declaring the class closed is how four of them would have stayed broken.
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(monkeypatch) -> TestClient:
    """The app, with the authored routes on the FAKE Brightway backend.

    Without this the labelled-body case reached the real one: ``POST
    /authored-databases`` wrote an empty ``guard-db`` into whichever Brightway
    project was current on the developer's machine (found in default,
    Battery Circularity and EVS40). The storage roots were redirected by the
    conftest; Brightway itself never was, and this test is about a header, not
    about writing anything.
    """
    from mapper.api import authored as api
    from mapper.api import bom
    from mapper.main import app
    from tests.test_authored_databases import FakeBackend

    backend = FakeBackend(installed=["biosphere3", "ecoinvent-3.10-cutoff"])
    monkeypatch.setattr(api, "_project", lambda: "P")
    monkeypatch.setattr(api, "get_backend", lambda project: backend)
    monkeypatch.setattr(bom, "_archetypes", {"P": {}})
    return TestClient(app)


#: (method, path, body) for every authored route the UI posts a model to.
ROUTES = [
    ("POST", "/api/authored-databases", {"name": "guard-db", "description": ""}),
    ("POST", "/api/authored-databases/guard-db/activities",
     {"name": "a", "unit": "kilogram", "scope": "complete", "exchanges": []}),
    ("PUT", "/api/authored-databases/guard-db/activities/deadbeef",
     {"name": "a", "unit": "kilogram", "scope": "complete", "exchanges": []}),
    ("POST", "/api/authored-databases/reached-indicators",
     {"flows": [{"database": "biosphere3", "code": "x"}]}),
    ("POST", "/api/authored-databases/preview-exchange",
     {"flow_database": "biosphere3", "flow_code": "x", "amount": 1.0, "pedigree": {}}),
]

IDS = [f"{m} {p}" for m, p, _ in ROUTES]


@pytest.mark.parametrize(("method", "path", "body"), ROUTES, ids=IDS)
def test_a_bare_string_body_is_refused_as_unparsed_text(client, method, path, body):
    """The failure the field saw. Pinned so the error stays recognisable."""
    c = client
    r = c.request(method, path, content=json.dumps(body))  # no Content-Type
    assert r.status_code == 422, (
        f"{method} {path} accepted an unlabelled body; this test no longer "
        f"demonstrates why the header is needed (got {r.status_code})"
    )
    detail = r.json().get("detail") or []
    kinds = {d.get("type") for d in detail if isinstance(d, dict)}
    assert "model_attributes_type" in kinds, (
        f"{method} {path} rejected the body for a DIFFERENT reason {kinds}; the "
        "fixture may have drifted out of schema and stopped testing the header"
    )
    # The tell that made this read as a schema bug: the body comes back as a str.
    assert any(isinstance(d.get("input"), str) for d in detail if isinstance(d, dict))


@pytest.mark.parametrize(("method", "path", "body"), ROUTES, ids=IDS)
def test_the_same_body_parses_once_it_is_labelled(client, method, path, body):
    """With the header, the body is parsed — the route may then fail on its own
    merits (404 for a missing database, 422 on a FIELD), but never again with
    `model_attributes_type` on the whole body."""
    c = client
    r = c.request(method, path, content=json.dumps(body),
                  headers={"Content-Type": "application/json"})
    assert r.status_code != 415
    if r.status_code == 422:
        detail = r.json().get("detail") or []
        kinds = {d.get("type") for d in detail if isinstance(d, dict)}
        assert "model_attributes_type" not in kinds, (
            f"{method} {path} still reports the body as unparsed WITH the header"
        )
