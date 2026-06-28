# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""API responses must declare themselves uncacheable.

Regression guard for the cohort-mapping "table doesn't update after upload"
bug: the API serves dynamic, mutation-driven data with read and write on
different urls (GET .../cohort-mappings vs POST .../cohort-mappings/upload),
so without a cache directive a browser/webview could serve a stale cached GET
after a mutation. Every /api response carries Cache-Control: no-store; static
(non-/api) paths are left cacheable.
"""
from __future__ import annotations

from fastapi.testclient import TestClient


def _client() -> TestClient:
    from mapper.main import app
    return TestClient(app)


def test_api_get_has_no_store():
    c = _client()
    r = c.get("/api/health")
    assert r.status_code == 200
    assert r.headers.get("cache-control") == "no-store"


def test_api_list_endpoint_has_no_store():
    c = _client()
    r = c.get("/api/dsm/systems")
    assert r.status_code == 200
    assert r.headers.get("cache-control") == "no-store"


def test_non_api_path_is_not_forced_no_store():
    # The desktop build serves the content-hashed SPA at non-/api paths; those
    # stay cacheable. The docs page is a convenient non-/api 200.
    c = _client()
    r = c.get("/docs")
    assert r.status_code == 200
    assert r.headers.get("cache-control") != "no-store"
