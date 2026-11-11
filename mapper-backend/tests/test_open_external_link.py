# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
#
# © Copyright 2026 Technical University of Denmark
# Lead developer: Leonardo Ferhati

"""Clicking an external link in the packaged app: the backend opens it.

The page is a remote http origin with no Tauri IPC, so it asks the backend, which
hands https, http and mailto links to the system default handler and refuses
everything else. Through the real route; only the OS call is captured, because CI
cannot open a browser.
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def env(monkeypatch):
    calls: list[list[str]] = []
    monkeypatch.setattr("subprocess.Popen", lambda argv: calls.append(argv))
    from mapper.main import app

    return TestClient(app), calls


def _post(c, url):
    return c.post("/api/system/open-external", content=json.dumps({"url": url}),
                  headers={"Content-Type": "application/json"})


@pytest.mark.parametrize("url", [
    "https://github.com/polca/premise",
    "http://example.org/a?b=c#d",
    "mailto:romain.sacchi@psi.ch",
    "HTTPS://Example.org/Path",
])
def test_an_allowed_scheme_is_handed_to_the_os(env, url):
    c, calls = env
    r = _post(c, url)
    assert r.status_code == 200, r.text
    assert r.json() == {"opened": url}
    (argv,) = calls
    assert argv[-1] == url                      # the URL is one argv element, nothing is joined
    assert argv[0] in ("open", "rundll32", "xdg-open")


@pytest.mark.parametrize("url", [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "data:text/html,<script>1</script>",
    "blob:http://localhost:8765/abc",
    "ftp://example.org/x",
    "tel:+4512345678",
    "x-custom-scheme://thing",
    "vscode://file/etc/passwd",
    "//example.org/no-scheme",
    "example.org",
    "",
    "   ",
    "https://",                                  # no host
    "http:///only-path",
    "mailto:",                                   # no address
    "https://exa mple.org",                      # whitespace
    "https://example.org/\nSecond-line",         # control character
    "https://example.org/" + "a" * 2100,         # too long
])
def test_everything_else_is_refused_and_launches_nothing(env, url):
    c, calls = env
    r = _post(c, url)
    assert r.status_code == 400, (url, r.text)
    assert "Only https, http and mailto" in r.json()["detail"]
    assert calls == []


def test_an_os_failure_is_a_500_with_the_reason(env, monkeypatch):
    c, _ = env

    def boom(argv):
        raise OSError("no handler")

    monkeypatch.setattr("subprocess.Popen", boom)
    r = _post(c, "https://example.org")
    assert r.status_code == 500 and "no handler" in r.json()["detail"]


def test_the_route_lives_at_api_system_and_not_api_api(env):
    """The cancel route once lived at /api/api/...; a route is tested through the app."""
    from mapper.main import app

    paths = [r.path for r in app.routes if hasattr(r, "path")]
    assert "/api/system/open-external" in paths
    assert not any(p.startswith("/api/api") for p in paths)
