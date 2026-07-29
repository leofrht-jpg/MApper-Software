# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""CORS must expose ``Content-Disposition`` to cross-origin JS.

The Excel-export surfaces read the server-built ``Content-Disposition`` filename
(it names contributing subsystems the client can't always compute — AESA passes
``[]``). CORS hides every response header from JS except a safelist unless the
server opts in via ``expose_headers``. Without it, dev (Vite :5173 → backend
:8000, cross-origin) silently drops the header and downloads fall back to the
client-built name — the reported ``Car_Fleet_AESA.xlsx`` regression.
"""
from fastapi.testclient import TestClient

from mapper.main import app


def test_cors_exposes_content_disposition_header():
    client = TestClient(app)
    # An ACTUAL (non-preflight) cross-origin request must carry
    # access-control-expose-headers listing Content-Disposition, or the browser
    # withholds it from response.headers.get(...).
    r = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
    exposed = r.headers.get("access-control-expose-headers", "")
    assert "content-disposition" in exposed.lower(), (
        f"Content-Disposition not exposed to cross-origin JS; got {exposed!r}"
    )


def test_cors_preflight_allows_export_post():
    """Sanity: the export POST is permitted cross-origin (preflight OK)."""
    client = TestClient(app)
    r = client.options(
        "/api/aesa/export",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert r.status_code in (200, 204)
    assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"
